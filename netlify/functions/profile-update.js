/**
 * Netlify function: profile-update  (STARTUP_REQUIREMENTS item 84)
 *
 * The one writer of what strangers see on a profile — handle,
 * display_name and avatar_url. The client filters these too, but a
 * client check binds honest clients only: anyone could PATCH PostgREST
 * with their own JWT. supabase/privacy_lockdown_2026_10b.sql revokes the
 * client's UPDATE (and INSERT) on those three columns, so after it runs
 * this is the only path, and its checks are binding:
 *   · handle        format (= the SQL check) + the public-text filter
 *   · display_name  ≤ 40 chars, invisible characters stripped, filtered
 *   · avatar_url    a small JPEG/PNG/WebP data URL, screened by
 *                   lib/imageModeration (the same check as avatar-check
 *                   and group crests). Fails CLOSED: no verdict (no key,
 *                   over the daily cap, timeout) stores no picture.
 *
 * POST, Bearer Supabase JWT. Body: any of
 *   { handle?: string, display_name?: string|null, avatar_url?: string|null }
 * Keys left out are left alone. → 200
 *   { ok: true, profile: { id, handle, display_name, avatar_url },
 *     avatar?: 'approved' | 'rejected' | 'pending' | 'unchanged' | 'cleared',
 *     reason?: string }      (reason: why a picture was rejected)
 * Errors: 400 { error, field } (filter / format), 409 handle taken,
 *         429 rate limit, 503 paused or database unreachable.
 *
 * Every other self-editable profile field (is_searchable, last_active_at,
 * level, leaderboard_optin, leaderboard_color) is still written by the
 * client directly — they are not shown to strangers as text or images.
 *
 * Limits: 10 a minute per instance (brake) + 40 changing writes a day per
 * account (durable, lib/dailyCap → ai_usage); a no-op write costs one
 * read and never counts. Avatar screening also spends the 'avatar' AI
 * cap (10 a day), shared with avatar-check.
 *
 * Kill switch: area 'social'.
 */
const crypto = require('crypto');
const { pauseGate } = require('../lib/killSwitch');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const sbKeys = require('../lib/sbKeys');
const { screenImage } = require('../lib/imageModeration');
const { withinDailyAiCap } = require('../lib/aiQuota');
const { withinDailyCap } = require('../lib/dailyCap');
const { planProfileUpdate, diffAgainst, writeError, resetChecks, RESET_MESSAGE } = require('../lib/profileUpdate');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

const DAILY_WRITES = 40;
const RETURN_COLS = 'id,handle,display_name,avatar_url';

/* Screening verdicts by image hash, per warm instance — the same picture
   arriving twice (a retry, a second device) is not paid for twice. */
const VERDICTS = new Map();
const VERDICT_CAP = 2000;

async function screenAvatar(avatar, userId) {
  const hash = crypto.createHash('sha256').update(avatar.base64).digest('hex');
  const known = VERDICTS.get(hash);
  if (known) return known;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { decision: 'pending' };
  if (!(await withinDailyAiCap('avatar', userId))) return { decision: 'pending' };
  const v = await screenImage(avatar.base64, avatar.mediaType, apiKey);
  if (v.decision !== 'pending') {
    if (VERDICTS.size >= VERDICT_CAP) VERDICTS.delete(VERDICTS.keys().next().value);
    VERDICTS.set(hash, v);
  }
  return v;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const pausedRes = pauseGate('social', CORS);
  if (pausedRes) return pausedRes;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const env = process.env;
  const url = env.SUPABASE_URL;
  if (!url || !sbKeys.serviceKey(env)) return json(500, { error: 'Not configured.' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const { userId } = auth;
  if (!underLimit('profile-update', userId, 10)) return tooMany(CORS);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const plan = planProfileUpdate(body);
  if (!plan.ok) return json(plan.status, { error: plan.error, field: plan.field });

  // The stored row, so unchanged fields are not rewritten and an
  // unchanged picture is not re-screened.
  let current = null;
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=${RETURN_COLS}`,
      { headers: sbKeys.serviceHeaders(env) });
    if (!res.ok) {
      console.error('profile-update: read failed', res.status);
      return json(503, { error: 'Could not save your profile — try again.' });
    }
    current = (await res.json())[0] || null;
  } catch (e) {
    console.error('profile-update: read unreachable', e?.message);
    return json(503, { error: 'Could not save your profile — try again.' });
  }

  const changes = diffAgainst(plan.fields, current);

  // An owner reset sticks (item 112): refuse a value the moderation trail
  // says was removed. Fail soft — before safety_2026_10b.sql is run the
  // table doesn't exist and nothing is refused.
  const checks = resetChecks(changes);
  if (checks.length) {
    try {
      const kinds = checks.map(c => c.kind).join(',');
      const hashes = checks.map(c => c.hash).join(',');
      const res = await fetch(`${url}/rest/v1/moderation_actions?target_id=eq.${encodeURIComponent(userId)}`
        + `&action=in.(${kinds})&value_hash=in.(${hashes})&select=action,value_hash`, { headers: sbKeys.serviceHeaders(env) });
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        const hit = checks.find(c => (rows || []).some(r => r.action === c.kind && r.value_hash === c.hash));
        if (hit) return json(400, { error: RESET_MESSAGE[hit.field], field: hit.field === 'avatar' ? 'avatar' : hit.field });
      }
    } catch { /* fail soft: the reset trail is unreadable — let the write through as before */ }
  }

  const patch = {};
  if ('handle' in changes) patch.handle = changes.handle;
  if ('display_name' in changes) patch.display_name = changes.display_name;

  let avatarStatus = plan.fields.avatar ? 'unchanged' : undefined;
  let reason;
  if (changes.avatar) {
    if (changes.avatar.clear) {
      patch.avatar_url = null;
      avatarStatus = 'cleared';
    } else {
      const v = await screenAvatar(changes.avatar, userId);
      if (v.decision === 'approved') {
        patch.avatar_url = changes.avatar.dataUrl;
        avatarStatus = 'approved';
      } else {
        // Rejected or undecided: the new picture is not published, and
        // the old one doesn't stay up as if nothing changed (the same
        // result the client produced before this function existed).
        if (current?.avatar_url) patch.avatar_url = null;
        avatarStatus = v.decision === 'rejected' ? 'rejected' : 'pending';
        if (v.decision === 'rejected') reason = v.reason || 'Does not meet the picture guidelines.';
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    const out = { ok: true, profile: current || { id: userId, handle: null, display_name: null, avatar_url: null } };
    if (avatarStatus) out.avatar = avatarStatus;
    if (reason) out.reason = reason;
    return json(200, out);
  }

  if (!(await withinDailyCap('profile-write', userId, DAILY_WRITES, env))) {
    return json(429, { error: 'That\'s a lot of profile changes for one day — try again tomorrow.' });
  }

  // Upsert: updates the named columns of an existing row, or creates the
  // row (tier etc. take their defaults) for an account that has none yet.
  let saved;
  try {
    const res = await fetch(`${url}/rest/v1/profiles?on_conflict=id&select=${RETURN_COLS}`, {
      method: 'POST',
      headers: sbKeys.serviceHeaders(env, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify({ id: userId, ...patch }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const e = writeError(res.status, errBody);
      if (e.status >= 500) console.error('profile-update: write failed', res.status, errBody?.code || '');
      return json(e.status, { error: e.error, field: e.field });
    }
    saved = (await res.json())[0] || null;
  } catch (e) {
    console.error('profile-update: write unreachable', e?.message);
    return json(503, { error: 'Could not save your profile — try again.' });
  }

  const out = { ok: true, profile: saved || { id: userId, ...current, ...patch } };
  if (avatarStatus) out.avatar = avatarStatus;
  if (reason) out.reason = reason;
  return json(200, out);
};

/**
 * Re-screening profile pictures published before screening existed
 * (STARTUP_REQUIREMENTS item 112; Online Safety Act draft X4).
 *
 * Avatars live in profiles.avatar_url as small data URLs — not Storage.
 * Since avatar-check, an honest client screens a picture before
 * publishing it, but nothing on the server recorded that, and pictures
 * published earlier were never screened at all. avatar_screenings
 * (supabase/safety_2026_10b.sql) records a verdict against a hash of the
 * exact avatar_url, so "unscreened" means: never screened, or changed
 * since — which also catches a client that skipped avatar-check.
 *
 * The owner presses a button; each press screens a small batch:
 *   - at most BATCH pictures, screened in parallel with a short timeout
 *     (the function has ~10 s);
 *   - every screen counts against the owner's durable daily AI cap
 *     ('avatar-rescreen' in lib/aiQuota.js) — a cost ceiling, not a
 *     per-minute brake;
 *   - fail-soft: no API key → nothing screened, said plainly; a timeout
 *     or unparseable answer → no verdict written, the picture stays in
 *     the backlog for the next press.
 *
 * A rejection does NOT remove the picture. It is flagged (and logged in
 * moderation_actions); the owner then keeps it or removes it from the
 * queue — the screen is a first pass, a person decides (same rule as
 * group crests). Removing goes through resetProfile, so it's audited,
 * sticky and the user is told.
 *
 * Callers must have verified the owner server-side (lib/owner.js).
 */
const { screenImage, parseDataUrl } = require('./imageModeration');
const { withinDailyAiCap } = require('./aiQuota');
const M = require('./moderationCore');

const BATCH = 4;
const SCREEN_TIMEOUT_MS = 7_000;

async function rpc(env, name, args = {}) {
  return M.sb(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/** → [200, { ok, status: { withAvatar, unscreened, flagged }, flagged: [...] }] */
async function rescreenStatus(env) {
  const [sRes, fRes] = await Promise.all([
    rpc(env, 'avatar_screen_status'),
    rpc(env, 'avatar_screen_flagged', { p_limit: 50 }),
  ]);
  if (M.missingSchema(sRes) || M.missingSchema(fRes)) return M.SAFETY_NOT_INSTALLED;
  if (!sRes.ok) throw new Error(`rescreen status ${sRes.status}`);
  if (!fRes.ok) throw new Error(`rescreen flagged ${fRes.status}`);
  const status = await sRes.json();
  const flagged = (await fRes.json()).map(r => ({
    userId: r.user_id, handle: r.handle || null, name: r.display_name || null,
    avatarUrl: r.avatar_url || null, reason: r.reason || null, screenedAt: r.screened_at || null,
  }));
  return [200, { ok: true, status, flagged }];
}

async function saveVerdict(env, row) {
  const res = await M.sb(env, 'avatar_screenings?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`verdict ${res.status}`);
}

/**
 * Screen the next batch. → [200, { ok, screened, approved, flagged,
 * pending, capped, status }] or a fail-soft error body.
 */
async function rescreenBatch(env, ownerId, apiKey) {
  if (!apiKey) return [503, { error: 'Screening needs ANTHROPIC_API_KEY on Netlify — nothing was screened.' }];
  const cRes = await rpc(env, 'avatar_screen_candidates', { p_limit: BATCH });
  if (M.missingSchema(cRes)) return M.SAFETY_NOT_INSTALLED;
  if (!cRes.ok) throw new Error(`candidates ${cRes.status}`);
  const candidates = await cRes.json();

  const tally = { screened: 0, approved: 0, flagged: 0, pending: 0, capped: false };
  await Promise.all(candidates.map(async (c) => {
    const img = parseDataUrl(c.avatar_url);
    if (!img.ok) {
      // Not something we can show a model (or a browser): flag it for a person.
      await saveVerdict(env, { user_id: c.user_id, avatar_hash: c.avatar_hash, decision: 'rejected', reason: 'Unreadable picture', screened_at: new Date().toISOString() });
      await M.logAction(env, { targetId: c.user_id, actorId: ownerId, action: 'avatar_flagged', note: 'Unreadable picture' });
      tally.screened++; tally.flagged++;
      return;
    }
    if (!(await withinDailyAiCap('avatar-rescreen', ownerId))) { tally.capped = true; return; }
    const verdict = await screenImage(img.base64, img.mediaType, apiKey, { timeoutMs: SCREEN_TIMEOUT_MS });
    if (verdict.decision === 'pending') { tally.pending++; return; }
    tally.screened++;
    if (verdict.decision === 'approved') {
      tally.approved++;
      await saveVerdict(env, { user_id: c.user_id, avatar_hash: c.avatar_hash, decision: 'approved', reason: null, screened_at: new Date().toISOString() });
    } else {
      tally.flagged++;
      const reason = String(verdict.reason || 'Does not meet the picture guidelines.').slice(0, 200);
      await saveVerdict(env, { user_id: c.user_id, avatar_hash: c.avatar_hash, decision: 'rejected', reason, screened_at: new Date().toISOString() });
      await M.logAction(env, { targetId: c.user_id, actorId: ownerId, action: 'avatar_flagged', note: reason });
    }
  }));

  const [, after] = await rescreenStatus(env);
  console.info(`moderation: avatar re-screen ${tally.screened} screened, ${tally.flagged} flagged, ${tally.pending} pending${tally.capped ? ', daily cap reached' : ''}`);
  return [200, { ok: true, ...tally, status: after && after.status, flagged: after && after.flagged }];
}

/**
 * The owner's call on a flagged picture. Body: { userId, decision:
 * 'keep' | 'remove', note? }.
 *   keep   — records a human 'kept' verdict against the current picture
 *   remove — resetProfile(['avatar']): audited, sticky, the user told
 */
async function avatarDecision(env, ownerId, body) {
  const userId = String(body.userId || '');
  if (!M.UUID.test(userId)) return [400, { error: 'userId required' }];
  if (body.decision === 'remove') {
    return M.resetProfile(env, ownerId, { userId, fields: ['avatar'], note: body.note || 'Picture flagged by re-screen' });
  }
  if (body.decision !== 'keep') return [400, { error: "decision must be 'keep' or 'remove'" }];
  const pRes = await M.sb(env, `profiles?id=eq.${userId}&select=avatar_url`);
  if (!pRes.ok) throw new Error(`profile read ${pRes.status}`);
  const p = (await pRes.json())[0];
  if (!p || !p.avatar_url) return [404, { error: 'no picture to keep' }];
  const now = new Date().toISOString();
  try {
    await saveVerdict(env, {
      user_id: userId, avatar_hash: M.resetHash('reset_avatar', p.avatar_url), decision: 'kept',
      reason: null, screened_at: now, reviewed_by: ownerId, reviewed_at: now,
    });
  } catch (e) {
    if (/ 40[04]$/.test(String(e?.message))) return M.SAFETY_NOT_INSTALLED;
    throw e;
  }
  await M.logAction(env, { targetId: userId, actorId: ownerId, action: 'avatar_kept', note: body.note || null });
  return [200, { ok: true, kept: true }];
}

module.exports = { rescreenStatus, rescreenBatch, avatarDecision, BATCH };

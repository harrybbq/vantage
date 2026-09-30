/**
 * Netlify serverless function: prestige-up
 *
 * Explicit, user-confirmed prestige: at canonical OVR 99 the user may
 * reset their competitive climb in exchange for prestige += 1 (cap 99).
 *
 * Server-side guards (never trusts the client):
 *   - the OVR RECOMPUTED here, from one fresh read of the state, must
 *     be >= 99 — not the stored profiles.ratings_ovr. Checking the
 *     stored value and then snapshotting the baseline from a second,
 *     later read let a user empty their state in between: the guard
 *     passed on yesterday's 99, the baseline came out as zero, and the
 *     next recompute put them straight back at 99 with prestige + 1.
 *     Repeat to P99. Guard and baseline now come from the same read.
 *   - profiles.prestige must be < 99
 *   - at least PRESTIGE_COOLDOWN_DAYS since profiles.prestiged_at, when
 *     that column exists (supabase/audit_schema_2026_10.sql). Before it
 *     does, the 10 s debounce below is the only brake — fail soft.
 *   - the prestige PATCH is conditional on the prestige value read, so
 *     two concurrent requests cannot both land.
 *
 * Mechanics — competitive reset only, nothing is wiped:
 *   1. Snapshot the user's CURRENT raw per-category points
 *      (derivePoints over raw user_data.state) into
 *      profiles.prestige_baseline. Setting baseline = current points
 *      (not adding) makes the next climb start from zero even across
 *      repeated prestiges, since raw points are cumulative.
 *   2. prestige += 1.
 *   3. Recompute via the shared helper — canonical OVR drops to the
 *      floor; achievements / logs / savings / self-check cooldowns all
 *      stay untouched.
 */

const { derivePoints, deriveRatings, loadRatingInputs, writeRatings } = require('../lib/recompute');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const PRESTIGE_MAX = 99;
const PRESTIGE_COOLDOWN_DAYS = 7;
const DAY_MS = 86_400_000;

const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

// One prestige attempt per user per 10s — absorbs double-clicks on the
// confirm button without needing a DB lock.
const recent = new Map();
function debounced(userId) {
  const now = Date.now();
  const last = recent.get(userId) || 0;
  recent.set(userId, now);
  return now - last < 10_000;
}

/**
 * profiles.prestiged_at, read on its own so a missing column (schema
 * not yet run) is a 400 on THIS query only. → { supported, at }.
 */
async function readPrestigedAt(supabaseUrl, sbHeaders, userId) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=prestiged_at`, { headers: sbHeaders });
    if (!res.ok) return { supported: false, at: null };
    const row = (await res.json())[0];
    return { supported: true, at: row?.prestiged_at || null };
  } catch {
    return { supported: false, at: null };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return reply(500, { error: 'not configured' });
  const env = { supabaseUrl, serviceKey };

  // ── Auth ──
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return reply(401, { error: 'missing token' });
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return reply(401, { error: 'invalid token' });
  const user = await userRes.json();
  const userId = user?.id;
  if (!userId) return reply(401, { error: 'no user id' });

  if (debounced(userId)) return reply(429, { error: 'try again in a moment' });

  const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  try {
    // ── Cooldown (fail soft until the column exists) ──
    const stamp = await readPrestigedAt(supabaseUrl, sbHeaders, userId);
    if (stamp.at && Date.now() - new Date(stamp.at).getTime() < PRESTIGE_COOLDOWN_DAYS * DAY_MS) {
      return reply(429, { error: `You can prestige once every ${PRESTIGE_COOLDOWN_DAYS} days.` });
    }

    // ── ONE read: state, friends, prestige row, macro days ──
    const inp = await loadRatingInputs(userId, env, { createdAt: user.created_at || null });
    if (!inp.profile) return reply(404, { error: 'no profile' });
    const prevPrestige = inp.prestige;
    if (prevPrestige >= PRESTIGE_MAX) return reply(400, { error: 'max prestige reached' });

    // Guard on the value recomputed from THIS read, net of the current
    // baseline — exactly what the leaderboard would show right now.
    const current = deriveRatings(inp.state, inp.friends, inp.baseline, inp.macroDays, inp.createdAt);
    if (current.ovr < 99) {
      // Store the honest number while we have it, so the button the
      // client showed off a stale 99 goes away.
      await writeRatings(userId, current, env).catch(() => null);
      return reply(400, { error: 'OVR must be 99 to prestige' });
    }

    // ── Baseline from the same read ──
    const baseline = derivePoints(inp.state, inp.friends, inp.macroDays, inp.createdAt);
    const newPrestige = prevPrestige + 1;
    const patch = { prestige: newPrestige, prestige_baseline: baseline };
    if (stamp.supported) patch.prestiged_at = new Date().toISOString();

    // Conditional on the prestige we read: a concurrent request that got
    // there first leaves this one matching zero rows.
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&prestige=eq.${prevPrestige}&select=id`, {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
    if (!patchRes.ok) {
      console.error('prestige-up: patch failed', patchRes.status, (await patchRes.text().catch(() => '')).slice(0, 300));
      throw new Error('prestige patch failed');
    }
    const updated = await patchRes.json().catch(() => []);
    if (!Array.isArray(updated) || !updated.length) return reply(409, { error: 'try again in a moment' });

    // ── Canonical OVR drops to the new floor — same inputs, new baseline ──
    const ratings = deriveRatings(inp.state, inp.friends, baseline, inp.macroDays, inp.createdAt);
    const computedAt = await writeRatings(userId, ratings, env);

    return reply(200, { ok: true, prestige: newPrestige, ratings, computedAt });
  } catch (e) {
    console.error('prestige-up failed', e?.message);
    return reply(500, { error: 'prestige failed' });
  }
};

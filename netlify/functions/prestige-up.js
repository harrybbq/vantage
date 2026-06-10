/**
 * Netlify serverless function: prestige-up
 *
 * Explicit, user-confirmed prestige: at canonical OVR 99 the user may
 * reset their competitive climb in exchange for prestige += 1 (cap 99).
 *
 * Server-side guards (never trusts the client):
 *   - profiles.ratings_ovr must be >= 99
 *   - profiles.prestige must be < 99
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

const { derivePoints, recomputeUser } = require('../lib/recompute');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const PRESTIGE_MAX = 99;

// One prestige attempt per user per 10s — absorbs double-clicks on the
// confirm button without needing a DB lock.
const recent = new Map();
function debounced(userId) {
  const now = Date.now();
  const last = recent.get(userId) || 0;
  recent.set(userId, now);
  return now - last < 10_000;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  // ── Auth ──
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  if (debounced(userId)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'try again in a moment' }) };
  }

  const sbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  try {
    // ── Guards against the CANONICAL profile values ──
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=ratings_ovr,prestige`,
      { headers: sbHeaders }
    );
    const prof = profRes.ok ? (await profRes.json())[0] : null;
    if (!prof) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'no profile' }) };
    if ((prof.ratings_ovr || 0) < 99) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'OVR must be 99 to prestige' }) };
    }
    if ((prof.prestige || 0) >= PRESTIGE_MAX) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'max prestige reached' }) };
    }

    // ── Snapshot current raw points as the new baseline ──
    const stateRes = await fetch(
      `${supabaseUrl}/rest/v1/user_data?id=eq.${userId}&select=state`,
      { headers: sbHeaders }
    );
    if (!stateRes.ok) throw new Error('state read failed');
    const state = (await stateRes.json())?.[0]?.state || {};

    const friendsRes = await fetch(
      `${supabaseUrl}/rest/v1/friendships?status=eq.accepted&or=(requester_id.eq.${userId},addressee_id.eq.${userId})&select=requester_id`,
      { headers: sbHeaders }
    );
    const friends = friendsRes.ok ? (await friendsRes.json()).length : 0;

    const baseline = derivePoints(state, friends);
    const newPrestige = (prof.prestige || 0) + 1;

    const patchRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ prestige: newPrestige, prestige_baseline: baseline }),
    });
    if (!patchRes.ok) throw new Error('prestige patch failed');

    // ── Recompute so the canonical OVR drops to the new floor ──
    const { ratings, computedAt } = await recomputeUser(userId, { supabaseUrl, serviceKey });

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ ok: true, prestige: newPrestige, ratings, computedAt }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message || 'prestige failed' }) };
  }
};

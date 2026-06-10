/**
 * Netlify serverless function: get-leaderboard
 *
 * Returns one of four boards: scope ∈ {friends, global} × timeframe ∈
 * {alltime, weekly}. Reads only server-canonical profiles + rating_snapshots
 * (see RANKING_SYSTEM.md trust boundary — never trust the client's
 * S.ratings for anything friend-visible).
 *
 * The only "derivation" here is `climb = current_ovr − snapshot_ovr_~7d_ago`
 * (a subtraction over stored values, not a rating algorithm).
 *
 * Stale-self refresh: if the caller's ratings_computed_at is null or > 24h
 * old, the caller is recomputed via the shared helper before the board is
 * built. Keeps the user's own row honest no matter how stale they were.
 */

const { recomputeUser } = require('../lib/recompute');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const STALE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MIN_AGE_MS = 6 * 24 * 60 * 60 * 1000; // ≥6 days = "weekly"
const GLOBAL_TOP_N = 100;
const WEEKLY_CANDIDATE_POOL = 500; // wider net for weekly-climb candidates

// ── Tiny rate limit ──
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimits = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const e = rateLimits.get(ip) || { count: 0, t: now };
  if (now - e.t > RATE_LIMIT_WINDOW_MS) { e.count = 0; e.t = now; }
  e.count++;
  rateLimits.set(ip, e);
  return e.count <= RATE_LIMIT_MAX;
}

// PostgREST helper with shared headers.
function sb(supabaseUrl, serviceKey, path, init = {}) {
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

// ── Snapshot fetch (batched) ─────────────────────────────────────────────
// Returns Map<userId, snapshotOvr> — the most recent snapshot per user that
// is at least SNAPSHOT_MIN_AGE_MS old. Implemented via PostgREST's
// `in.(...)` + ORDER BY; we then keep only the newest qualifying row per
// user in JS (DISTINCT ON would be ideal but isn't expressible in PostgREST).
async function fetchSnapshotOvrs(supabaseUrl, serviceKey, userIds) {
  if (!userIds.length) return new Map();
  const cutoffIso = new Date(Date.now() - SNAPSHOT_MIN_AGE_MS).toISOString();
  const inClause = `(${userIds.join(',')})`;
  const res = await sb(supabaseUrl, serviceKey,
    `/rest/v1/rating_snapshots?user_id=in.${inClause}&snapshotted_at=lte.${cutoffIso}&select=user_id,ovr,snapshotted_at&order=snapshotted_at.desc`
  );
  if (!res.ok) return new Map();
  const rows = await res.json();
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.user_id)) out.set(r.user_id, r.ovr); // first = newest per user
  }
  return out;
}

// Build a leaderboard row from a profile + (optional) snapshot ovr.
function rowFromProfile(p, snapshotOvr, callerId) {
  const ratings = p.ratings || {};
  const climb = (snapshotOvr == null || p.ratings_ovr == null)
    ? null
    : p.ratings_ovr - snapshotOvr;
  return {
    rank: 0, // assigned by caller
    userId: p.id,
    username: p.display_name || (p.handle ? '@' + p.handle : 'Unknown'),
    avatarUrl: p.avatar_url || null,
    ovr: p.ratings_ovr || 1,
    categories: {
      brain:   ratings.brain   || 1,
      finance: ratings.finance || 1,
      fitness: ratings.fitness || 1,
      social:  ratings.social  || 1,
    },
    climb,
    prestige: p.prestige || 0,
    ratingsComputedAt: p.ratings_computed_at || null,
    isSelf: p.id === callerId,
  };
}

// Lifetime sort key: prestige × 100 + OVR (mirrors the generated
// profiles.lifetime_rating column).
function lifetimeOf(r) {
  return (r.prestige || 0) * 100 + (r.ovr || 0);
}

function sortRows(rows, timeframe) {
  if (timeframe === 'weekly') {
    return rows.slice().sort((a, b) => {
      const av = a.climb, bv = b.climb;
      if (av == null && bv == null) return lifetimeOf(b) - lifetimeOf(a);
      if (av == null) return 1;   // nulls last
      if (bv == null) return -1;
      return bv - av;
    });
  }
  // All-time ranks by lifetime (prestige first, then current OVR).
  return rows.slice().sort((a, b) => lifetimeOf(b) - lifetimeOf(a));
}

// ── Scope handlers ───────────────────────────────────────────────────────
async function buildFriendsBoard({ supabaseUrl, serviceKey, callerId, timeframe }) {
  const fRes = await sb(supabaseUrl, serviceKey,
    `/rest/v1/friendships?status=eq.accepted&or=(requester_id.eq.${callerId},addressee_id.eq.${callerId})&select=requester_id,addressee_id`
  );
  const edges = fRes.ok ? await fRes.json() : [];
  const friendIds = edges.map(e => e.requester_id === callerId ? e.addressee_id : e.requester_id);
  const ids = Array.from(new Set([callerId, ...friendIds]));

  const pRes = await sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?id=in.(${ids.join(',')})&select=id,handle,display_name,avatar_url,ratings,ratings_ovr,ratings_computed_at,prestige`
  );
  const profiles = pRes.ok ? await pRes.json() : [];

  const snaps = await fetchSnapshotOvrs(supabaseUrl, serviceKey, ids);
  const rows = profiles.map(p => rowFromProfile(p, snaps.get(p.id), callerId));
  const sorted = sortRows(rows, timeframe);
  sorted.forEach((r, i) => { r.rank = i + 1; });

  const callerRank = (sorted.find(r => r.isSelf) || {}).rank || null;
  return { rows: sorted, callerRank };
}

async function buildGlobalBoard({ supabaseUrl, serviceKey, callerId, timeframe }) {
  // Caller's own profile (whether opted in or not — used for the pinned
  // row and to detect opt-out state). The board excludes opted-out users.
  const meRes = await sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?id=eq.${callerId}&select=id,handle,display_name,avatar_url,ratings,ratings_ovr,ratings_computed_at,leaderboard_optin,prestige,lifetime_rating`
  );
  const meRows = meRes.ok ? await meRes.json() : [];
  const me = meRows[0] || null;

  // Candidate pool: top by OVR among opted-in users. For weekly we widen
  // the pool because climb leaders aren't always OVR leaders.
  const limit = timeframe === 'weekly' ? WEEKLY_CANDIDATE_POOL : GLOBAL_TOP_N;
  const candRes = await sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?leaderboard_optin=eq.true&ratings_ovr=not.is.null&select=id,handle,display_name,avatar_url,ratings,ratings_ovr,ratings_computed_at,prestige&order=lifetime_rating.desc&limit=${limit}`
  );
  const candidates = candRes.ok ? await candRes.json() : [];

  const candIds = candidates.map(p => p.id);
  const snaps = await fetchSnapshotOvrs(supabaseUrl, serviceKey, candIds);
  let rows = candidates.map(p => rowFromProfile(p, snaps.get(p.id), callerId));
  rows = sortRows(rows, timeframe).slice(0, GLOBAL_TOP_N);
  rows.forEach((r, i) => { r.rank = i + 1; });

  // Caller pinning + true rank
  let callerRank = null;
  const callerInTop = rows.find(r => r.isSelf);
  if (callerInTop) {
    callerRank = callerInTop.rank;
  } else if (me && me.leaderboard_optin && me.ratings_ovr != null) {
    // Compute caller's true rank among opted-in users.
    if (timeframe === 'alltime') {
      const myLifetime = (me.prestige || 0) * 100 + (me.ratings_ovr || 0);
      const cntRes = await sb(supabaseUrl, serviceKey,
        `/rest/v1/profiles?leaderboard_optin=eq.true&lifetime_rating=gt.${myLifetime}&select=id`,
        { headers: { Prefer: 'count=exact' } }
      );
      const range = cntRes.headers.get('content-range') || '';
      const above = parseInt(range.split('/')[1] || '0', 10);
      callerRank = above + 1;
    } else {
      // Weekly: rank = 1 + count of opted-in users with strictly higher
      // climb. We don't have a column for climb — approximate by counting
      // candidates we've already loaded that beat caller's climb.
      const callerSnap = (await fetchSnapshotOvrs(supabaseUrl, serviceKey, [callerId])).get(callerId);
      const callerClimb = callerSnap == null ? null : (me.ratings_ovr - callerSnap);
      if (callerClimb != null) {
        callerRank = 1 + rows.filter(r => r.climb != null && r.climb > callerClimb).length;
      }
    }
    // Pin caller's row at the end with their true rank.
    const callerRow = rowFromProfile(me, (await fetchSnapshotOvrs(supabaseUrl, serviceKey, [callerId])).get(callerId), callerId);
    callerRow.rank = callerRank || rows.length + 1;
    rows.push(callerRow);
  } else {
    callerRank = null; // opted out (or never rated) — UI shows opt-in CTA
  }

  return { rows, callerRank };
}

// ── Handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate limited' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  // Auth: verify the user's JWT
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const callerId = (await userRes.json())?.id;
  if (!callerId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  // Body
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const scope     = body.scope === 'global' ? 'global' : 'friends';
  const timeframe = body.timeframe === 'weekly' ? 'weekly' : 'alltime';

  // ── Stale-self check: refresh caller's ratings if >24h or missing.
  // Done before the board build so the caller's row reflects today.
  try {
    const meCheck = await sb(supabaseUrl, serviceKey,
      `/rest/v1/profiles?id=eq.${callerId}&select=ratings_computed_at`
    );
    const meRow = meCheck.ok ? (await meCheck.json())[0] : null;
    const stale = !meRow?.ratings_computed_at ||
      (Date.now() - new Date(meRow.ratings_computed_at).getTime()) > STALE_MS;
    if (stale) {
      await recomputeUser(callerId, { supabaseUrl, serviceKey }).catch(() => null);
    }
  } catch { /* non-fatal — the board still loads with whatever profile holds */ }

  try {
    const board = scope === 'global'
      ? await buildGlobalBoard({ supabaseUrl, serviceKey, callerId, timeframe })
      : await buildFriendsBoard({ supabaseUrl, serviceKey, callerId, timeframe });

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        scope, timeframe,
        computedAt: new Date().toISOString(),
        callerRank: board.callerRank,
        rows: board.rows,
      }),
    };
  } catch (e) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: e.message || 'leaderboard build failed' }),
    };
  }
};

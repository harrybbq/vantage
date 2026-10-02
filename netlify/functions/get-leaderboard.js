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
const { suspendedIds } = require('../lib/suspended');
const { inChunks } = require('../lib/pgPage');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const STALE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MIN_AGE_MS = 6 * 24 * 60 * 60 * 1000; // ≥6 days = "weekly"

/**
 * The day the rating formula was corrected.
 *
 * Weekly climb is `today's OVR − the OVR we stored a week ago`, which
 * only means anything if both were computed the same way. The server
 * had been pricing every vision at a flat 8 xp against a catalogue
 * running 50–1000, so correcting it moves most users up by several
 * points at once. Comparing across that would have handed everyone a
 * one-off climb they did not earn — in the same week the group league
 * starts scoring on exactly that number.
 *
 * So snapshots from before the correction are not read. Climb shows as
 * "—" until a week of comparable ones exists, which is the truthful
 * answer to "how much did you move this week" when the ruler changed.
 * The rows stay in the table; nothing is deleted. Once past
 * this + 7 days the constant is inert and can go.
 */
const FORMULA_EPOCH_ISO = '2026-09-14T00:00:00.000Z';
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
//
// Chunked and paged (2026-09-30). The weekly pool is 500 ids — an 18 kB
// `in.()` URL — and each has a snapshot a day, so the answer ran to
// thousands of rows against PostgREST's silent 1000-row cap. Now ≤150
// ids a request, each chunk paged newest-first until every id in it has
// shown up (its first row IS its newest) — usually one page. `user_id`
// breaks timestamp ties so pages are stable. Any failed read still
// means "no climb data", as before.
//
// SNAPSHOT_LOOKBACK_MS bounds how far back a chunk can page. The cron
// writes a row for every rated profile every day, so anyone with a
// qualifying snapshot has one inside the fortnight before the cutoff
// unless the cron was down for two weeks. Without the bound, one new
// user in a chunk (no qualifying row, so the early stop never fires)
// would page through every snapshot the other 149 ever had.
const SNAPSHOT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
async function fetchSnapshotOvrs(supabaseUrl, serviceKey, userIds) {
  if (!userIds.length) return new Map();
  const cutoffMs = Date.now() - SNAPSHOT_MIN_AGE_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const lookbackIso = new Date(cutoffMs - SNAPSHOT_LOOKBACK_MS).toISOString();
  let rows;
  try {
    rows = await inChunks(userIds, (csv, offset, limit) => sb(supabaseUrl, serviceKey,
      `/rest/v1/rating_snapshots?user_id=in.(${csv})&snapshotted_at=lte.${cutoffIso}` +
      `&snapshotted_at=gte.${FORMULA_EPOCH_ISO}&snapshotted_at=gte.${lookbackIso}` +
      `&select=user_id,ovr,snapshotted_at&order=snapshotted_at.desc,user_id.asc` +
      `&limit=${limit}&offset=${offset}`
    ), { firstPer: 'user_id', what: 'leaderboard snapshots' });
  } catch {
    return new Map();
  }
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
    nameColor: null, // filled by attachNameColors (best-effort)
  };
}

// Best-effort: colour each row's name with the user's chosen accent
// (profiles.leaderboard_color, opt-in via Settings). Kept as a separate
// query so a missing column (migration not yet applied) can't break the
// board — a 400 just means no colours this run.
//
// Pro and lifetime only, checked HERE against the server-owned tier: the
// colour is a Pro customisation (CLAUDE.md tier line), and the column is
// client-writable, so a free account that set it directly was showing a
// paid feature to everyone.
async function attachNameColors(supabaseUrl, serviceKey, rows) {
  const ids = Array.from(new Set(rows.map(r => r.userId).filter(Boolean)));
  if (!ids.length) return;
  try {
    // Chunked: ~101 ids today (board + pinned row), but the URL must not
    // grow with the board. A failed chunk throws → no colours this run.
    const data = await inChunks(ids, (csv, offset, limit) => sb(supabaseUrl, serviceKey,
      `/rest/v1/profiles?id=in.(${csv})&select=id,leaderboard_color,tier&order=id&limit=${limit}&offset=${offset}`
    ), { what: 'leaderboard colours' });
    const byId = new Map(data
      .filter(d => d.tier === 'pro' || d.tier === 'lifetime')
      .map(d => [d.id, d.leaderboard_color]));
    for (const r of rows) {
      const c = byId.get(r.userId);
      if (c && /^#[0-9a-fA-F]{6}$/.test(c)) r.nameColor = c;
    }
  } catch { /* best effort */ }
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

  // Chunked — a well-connected user's friend list is an unbounded
  // `in.()`. A failed read shows an empty board, as it always has.
  const allProfiles = await inChunks(ids, (csv, offset, limit) => sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?id=in.(${csv})&select=id,handle,display_name,avatar_url,ratings,ratings_ovr,ratings_computed_at,prestige` +
    `&order=id&limit=${limit}&offset=${offset}`
  ), { what: 'friends board profiles' }).catch(() => []);
  const suspended = await suspendedIds({ supabaseUrl, serviceKey });
  const profiles = allProfiles.filter(p => p.id === callerId || !suspended.has(p.id));

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
  // Suspended users are removed from the public board (item 63). The
  // caller's own pinned row below is unaffected — only others see less.
  const suspended = await suspendedIds({ supabaseUrl, serviceKey });
  const candidates = (candRes.ok ? await candRes.json() : [])
    .filter(p => p.id === callerId || !suspended.has(p.id));

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
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }

  // Auth: verify the user's JWT
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const caller = await userRes.json();
  const callerId = caller?.id;
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
      await recomputeUser(callerId, { supabaseUrl, serviceKey }, { createdAt: caller?.created_at || null })
        .catch(() => null);
    }
  } catch { /* non-fatal — the board still loads with whatever profile holds */ }

  try {
    const board = scope === 'global'
      ? await buildGlobalBoard({ supabaseUrl, serviceKey, callerId, timeframe })
      : await buildFriendsBoard({ supabaseUrl, serviceKey, callerId, timeframe });
    await attachNameColors(supabaseUrl, serviceKey, board.rows);

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
    console.error('get-leaderboard:', e?.message);
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'leaderboard build failed' }),
    };
  }
};

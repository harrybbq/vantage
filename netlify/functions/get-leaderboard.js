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
 *
 * ── Shared cache (item 91) ──────────────────────────────────────────────
 * The GLOBAL top 100 is the same for everyone, so it is built at most
 * once per BOARD_TTL_MS and shared: module scope on a warm instance, and
 * one row in public.function_cache across instances (lib/sharedCache.js;
 * fails soft to module scope until retention_2026_10b.sql is run). A
 * build is ~8 queries (500 candidates, suspended set, 4+ snapshot
 * chunks, avatars/colours); a cached view is 1–3 small ones.
 *
 * Only the shared part is cached. Per caller, every view still reads
 * the caller's own profile fresh and, from it: marks their row, swaps in
 * their current numbers, drops them from what THEY see if they have
 * just opted out, and computes their true rank + pinned row when they
 * are outside the top 100. Friends boards are per-user and never cached.
 *
 * What the cache delays, by at most BOARD_TTL_MS for OTHER viewers: a
 * new opt-out, a suspension, a rating change. Five minutes, on a board
 * the client already caches for 60 s.
 *
 * Avatars: only the 100 rows that are shown carry one (they are data
 * URIs, several kB each). The weekly pool reads 500 candidates WITHOUT
 * avatars and fetches them for the final 100 only; friends boards past
 * 100 rows get initials (the client already renders those).
 */

const { pauseGate } = require('../lib/killSwitch');
const sbKeys = require('../lib/sbKeys');
const { recomputeUser } = require('../lib/recompute');
const { suspendedIds } = require('../lib/suspended');
const { inChunks } = require('../lib/pgPage');
const { createSharedCache, pgCacheStore } = require('../lib/sharedCache');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const STALE_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MIN_AGE_MS = 6 * 24 * 60 * 60 * 1000; // ≥6 days = "weekly"

// Snapshots from before the last formula change are not compared, and
// a prestige between two snapshots counts as the climb to 99 plus the
// climb since — see netlify/lib/ratingsEpoch.js.
const { FORMULA_EPOCH_ISO, climbSince } = require('../lib/ratingsEpoch');
const GLOBAL_TOP_N = 100;
const WEEKLY_CANDIDATE_POOL = 500; // wider net for weekly-climb candidates
const AVATAR_TOP_N = 100;          // rows past this get initials, not a data URI
const BOARD_TTL_MS = 5 * 60_000;   // shared global board lifetime

// Profile columns for a board row. Avatars are fetched separately for
// the rows that are actually shown (see attachAvatarsAndColors).
const ROW_COLS = 'id,handle,display_name,ratings,ratings_ovr,ratings_computed_at,prestige,prestiged_at';
const ME_COLS = ROW_COLS + ',avatar_url,leaderboard_optin,lifetime_rating';

const boardCache = createSharedCache({ ttlMs: BOARD_TTL_MS });
let storeFor = null; // { url, store } — one per instance, so its missing-table memory sticks
function sharedStore(supabaseUrl, serviceKey) {
  if (!storeFor || storeFor.url !== supabaseUrl) {
    storeFor = { url: supabaseUrl, store: pgCacheStore({ supabaseUrl, serviceKey }) };
  }
  return storeFor.store;
}

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
    headers: sbKeys.serviceKeyHeaders(serviceKey, {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    }),
  });
}

// ── Snapshot fetch (batched) ─────────────────────────────────────────────
// Returns Map<userId, { ovr, at }> — the most recent snapshot per user that
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
    if (!out.has(r.user_id)) out.set(r.user_id, { ovr: r.ovr, at: r.snapshotted_at }); // first = newest per user
  }
  return out;
}

// Build a leaderboard row from a profile + (optional) snapshot { ovr, at }.
// prestiged_at is read only to measure the climb; it is not in the row.
function rowFromProfile(p, snap, callerId) {
  const ratings = p.ratings || {};
  const climb = climbSince(p.ratings_ovr, snap?.ovr, p.prestiged_at, snap?.at);
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

// Best-effort: avatars for the shown rows, and each row's name colour
// (profiles.leaderboard_color, opt-in via Settings). One query for both;
// if leaderboard_color isn't there yet (migration not applied) the 400
// falls back to avatars alone, and any failure leaves initials / no
// colours — never a broken board.
//
// Pro and lifetime only, checked HERE against the server-owned tier: the
// colour is a Pro customisation (CLAUDE.md tier line), and the column is
// client-writable, so a free account that set it directly was showing a
// paid feature to everyone.
//
// The first AVATAR_TOP_N rows get an avatar; every row gets its colour.
// Chunked: the URL must not grow with the board (a friends board can be
// long). A failed chunk throws → the fallback / nothing this run.
async function attachAvatarsAndColors(supabaseUrl, serviceKey, rows, { avatars = true } = {}) {
  const avatarIds = new Set(avatars ? rows.slice(0, AVATAR_TOP_N).map(r => r.userId).filter(Boolean) : []);
  const ids = Array.from(new Set(rows.map(r => r.userId).filter(Boolean)));
  if (!ids.length) return;
  const read = (cols) => inChunks(ids, (csv, offset, limit) => sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?id=in.(${csv})&select=${cols}&order=id&limit=${limit}&offset=${offset}`
  ), { what: 'leaderboard avatars/colours' });
  let data = null;
  try {
    data = await read(avatarIds.size ? 'id,avatar_url,leaderboard_color,tier' : 'id,leaderboard_color,tier');
  } catch {
    if (avatarIds.size) { try { data = await read('id,avatar_url'); } catch { data = null; } }
  }
  if (!data) return;
  const byId = new Map(data.map(d => [d.id, d]));
  for (const r of rows) {
    const d = byId.get(r.userId);
    if (!d) continue;
    if (avatarIds.has(r.userId) && 'avatar_url' in d) r.avatarUrl = d.avatar_url || null;
    const c = (d.tier === 'pro' || d.tier === 'lifetime') ? d.leaderboard_color : null;
    if (c && /^#[0-9a-fA-F]{6}$/.test(c)) r.nameColor = c;
  }
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
    `/rest/v1/profiles?id=in.(${csv})&select=${ROW_COLS}` +
    `&order=id&limit=${limit}&offset=${offset}`
  ), { what: 'friends board profiles' }).catch(() => []);
  const suspended = await suspendedIds({ supabaseUrl, serviceKey });
  const profiles = allProfiles.filter(p => p.id === callerId || !suspended.has(p.id));

  const snaps = await fetchSnapshotOvrs(supabaseUrl, serviceKey, ids);
  const rows = profiles.map(p => rowFromProfile(p, snaps.get(p.id), callerId));
  const sorted = sortRows(rows, timeframe);
  sorted.forEach((r, i) => { r.rank = i + 1; });
  // Avatars for the top 100 (initials past that) + Pro name colours.
  await attachAvatarsAndColors(supabaseUrl, serviceKey, sorted);

  const callerRank = (sorted.find(r => r.isSelf) || {}).rank || null;
  return { rows: sorted, callerRank };
}

/**
 * The shared part of the global board: the top GLOBAL_TOP_N opted-in,
 * unsuspended users, ranked, with climb, avatars and name colours.
 * Caller-agnostic (isSelf is false on every row) so it can be cached for
 * everyone; buildGlobalBoard personalises a copy.
 */
async function buildSharedGlobalRows({ supabaseUrl, serviceKey, timeframe }) {
  // Candidate pool: top by lifetime among opted-in users. For weekly we
  // widen the pool because climb leaders aren't always OVR leaders.
  // No avatars here — 500 data URIs to show 100 was the waste (item 91).
  const limit = timeframe === 'weekly' ? WEEKLY_CANDIDATE_POOL : GLOBAL_TOP_N;
  const candRes = await sb(supabaseUrl, serviceKey,
    `/rest/v1/profiles?leaderboard_optin=eq.true&ratings_ovr=not.is.null&select=${ROW_COLS}&order=lifetime_rating.desc&limit=${limit}`
  );
  // A failed read must not be cached (and shared) as "nobody is on the
  // board": throw, and the cache serves its last good copy or the
  // handler answers 500 as before.
  if (!candRes.ok) throw new Error(`candidates read ${candRes.status}`);
  // Suspended users are removed from the public board (item 63). A
  // suspended caller still sees their own pinned row (buildGlobalBoard).
  const suspended = await suspendedIds({ supabaseUrl, serviceKey });
  const candidates = (await candRes.json()).filter(p => !suspended.has(p.id));

  const snaps = await fetchSnapshotOvrs(supabaseUrl, serviceKey, candidates.map(p => p.id));
  const rows = sortRows(candidates.map(p => rowFromProfile(p, snaps.get(p.id), null)), timeframe)
    .slice(0, GLOBAL_TOP_N);
  rows.forEach((r, i) => { r.rank = i + 1; });
  await attachAvatarsAndColors(supabaseUrl, serviceKey, rows);
  return rows;
}

/**
 * Personalise the shared rows for one caller. Pure — exported for the
 * tests. `me` is the caller's fresh profile (null = the read failed).
 *   · their own row is marked isSelf and carries their CURRENT numbers
 *     (the shared copy can be up to BOARD_TTL_MS old);
 *   · if they have opted out since the copy was built, they don't see
 *     themselves on it (others may, until the next rebuild);
 *   · returns { rows, callerInTop } — fresh objects; the cached rows are
 *     never mutated.
 */
function personaliseRows(sharedRows, me, callerId) {
  let rows = sharedRows.map(r => ({ ...r, isSelf: r.userId === callerId }));
  const idx = rows.findIndex(r => r.isSelf);
  if (idx === -1) return { rows, callerInTop: null };
  // Profile read failed → keep the shared row as it is, just marked.
  if (!me) return { rows, callerInTop: rows[idx] };
  if (me.leaderboard_optin === false || me.ratings_ovr == null) {
    rows = rows.filter(r => !r.isSelf);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { rows, callerInTop: null };
  }
  const old = rows[idx];
  const fresh = rowFromProfile(me, null, callerId);
  rows[idx] = {
    ...old,
    username: fresh.username,
    avatarUrl: me.avatar_url || null,
    ovr: fresh.ovr,
    categories: fresh.categories,
    prestige: fresh.prestige,
    ratingsComputedAt: fresh.ratingsComputedAt,
    // Same snapshot baseline, today's OVR.
    climb: old.climb == null ? null : old.climb + (fresh.ovr - old.ovr),
  };
  return { rows, callerInTop: rows[idx] };
}

async function buildGlobalBoard({ supabaseUrl, serviceKey, callerId, timeframe, me }) {
  const shared = await boardCache.get(`leaderboard:global:${timeframe}:v1`,
    () => buildSharedGlobalRows({ supabaseUrl, serviceKey, timeframe }),
    { store: sharedStore(supabaseUrl, serviceKey) });

  const { rows, callerInTop } = personaliseRows(shared.data, me, callerId);

  // Caller pinning + true rank
  let callerRank = null;
  if (callerInTop) {
    callerRank = callerInTop.rank;
  } else if (me && me.leaderboard_optin && me.ratings_ovr != null) {
    // One snapshot read for the caller, used for both the weekly rank
    // and the pinned row's climb (it used to be read twice).
    const callerSnap = (await fetchSnapshotOvrs(supabaseUrl, serviceKey, [callerId])).get(callerId);
    // Compute caller's true rank among opted-in users.
    if (timeframe === 'alltime') {
      const myLifetime = (me.prestige || 0) * 100 + (me.ratings_ovr || 0);
      const cntRes = await sb(supabaseUrl, serviceKey,
        `/rest/v1/profiles?leaderboard_optin=eq.true&lifetime_rating=gt.${myLifetime}&select=id&limit=1`,
        { headers: { Prefer: 'count=exact' } }
      );
      const range = cntRes.headers.get('content-range') || '';
      const above = parseInt(range.split('/')[1] || '0', 10);
      callerRank = above + 1;
    } else {
      // Weekly: rank = 1 + count of opted-in users with strictly higher
      // climb. We don't have a column for climb — approximate by counting
      // board rows that beat caller's climb.
      const callerClimb = climbSince(me.ratings_ovr, callerSnap?.ovr, me.prestiged_at, callerSnap?.at);
      if (callerClimb != null) {
        callerRank = 1 + rows.filter(r => r.climb != null && r.climb > callerClimb).length;
      }
    }
    // Pin caller's row at the end with their true rank.
    const callerRow = rowFromProfile(me, callerSnap, callerId);
    callerRow.rank = callerRank || rows.length + 1;
    await attachAvatarsAndColors(supabaseUrl, serviceKey, [callerRow], { avatars: false });
    rows.push(callerRow);
  } else {
    callerRank = null; // opted out (or never rated) — UI shows opt-in CTA
  }

  return { rows, callerRank, computedAt: new Date(shared.at).toISOString() };
}

// ── Handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const pausedRes = pauseGate('social', CORS);
  if (pausedRes) return pausedRes;
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate limited' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = sbKeys.serviceKey(process.env);
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }

  // Auth: verify the user's JWT
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: sbKeys.userHeaders(process.env, token),
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

  // ── The caller's own profile, read ONCE: the stale-self check uses it,
  // and the global board personalises the shared copy with it.
  // Stale-self: refresh the caller's ratings if >24h old or missing,
  // before the board so their row reflects today (then re-read it).
  const readMe = async () => {
    const r = await sb(supabaseUrl, serviceKey, `/rest/v1/profiles?id=eq.${callerId}&select=${ME_COLS}`);
    return r.ok ? ((await r.json())[0] || null) : null;
  };
  let me = null;
  try {
    me = await readMe();
    const stale = !me?.ratings_computed_at ||
      (Date.now() - new Date(me.ratings_computed_at).getTime()) > STALE_MS;
    if (stale) {
      const done = await recomputeUser(callerId, { supabaseUrl, serviceKey }, { createdAt: caller?.created_at || null })
        .catch(() => null);
      if (done && scope === 'global') me = (await readMe()) || me;
    }
  } catch { /* non-fatal — the board still loads with whatever profile holds */ }

  try {
    const board = scope === 'global'
      ? await buildGlobalBoard({ supabaseUrl, serviceKey, callerId, timeframe, me })
      : await buildFriendsBoard({ supabaseUrl, serviceKey, callerId, timeframe });

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        scope, timeframe,
        computedAt: board.computedAt || new Date().toISOString(),
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

// For efficiency.test.mjs: pure helpers + the cache, no network.
exports._test = { personaliseRows, rowFromProfile, sortRows, boardCache, BOARD_TTL_MS, AVATAR_TOP_N };

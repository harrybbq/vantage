/**
 * Launch batch D — efficiency & retention (items 87, 91, 95, 96).
 *
 *   · sharedCache: memory hit / miss / expiry, shared-row hit, in-flight
 *     dedupe, stale-on-error, missing-table backoff.
 *   · get-leaderboard: a smoke run with a fake Supabase — the global
 *     board is built once and then served from cache (memory, then the
 *     shared row on a "cold" instance), per-caller parts stay correct,
 *     avatars only on the shown 100.
 *
 * No network: every handler runs against a fake fetch that records calls.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── sharedCache ─────────────────────────────────────────────────────────
{
  const { createSharedCache, pgCacheStore } = require('./sharedCache.js');
  let t = 1_000_000;
  const now = () => t;
  const c = createSharedCache({ ttlMs: 5 * 60_000, now });
  let builds = 0;
  const build = async () => { builds++; return { v: builds }; };

  let r = await c.get('k', build);
  eq([r.source, r.data.v, builds], ['built', 1, 1], 'first get builds');
  t += 60_000;
  r = await c.get('k', build);
  eq([r.source, r.data.v, builds], ['memory', 1, 1], 'inside TTL → memory hit, no build');
  t += 5 * 60_000;
  r = await c.get('k', build);
  eq([r.source, r.data.v, builds], ['built', 2, 2], 'past TTL → rebuilt');

  // In-flight dedupe: three concurrent misses share one build.
  const c2 = createSharedCache({ ttlMs: 1000, now });
  let slow = 0;
  const slowBuild = () => new Promise(res => setTimeout(() => res({ v: ++slow }), 10));
  const all = await Promise.all([c2.get('x', slowBuild), c2.get('x', slowBuild), c2.get('x', slowBuild)]);
  eq([slow, all.map(a => a.data.v)], [1, [1, 1, 1]], 'concurrent misses → one build');

  // Stale on error: a failed rebuild serves the last good copy (≤ maxStale).
  const c3 = createSharedCache({ ttlMs: 1000, maxStaleMs: 10_000, now });
  await c3.get('s', async () => ({ v: 'good' }));
  t += 2000;
  r = await c3.get('s', async () => { throw new Error('db down'); });
  eq([r.source, r.data.v], ['stale', 'good'], 'failed rebuild → stale copy');
  t += 20_000;
  await assert.rejects(c3.get('s', async () => { throw new Error('db down'); }), /db down/, 'too stale → error propagates'); n++;

  // Shared store: a fresh row is used instead of building; a stale one is not.
  const rows = new Map();
  const store = {
    read: async k => rows.get(k) || null,
    write: async (k, data, at) => { rows.set(k, { at, data }); },
  };
  const c4 = createSharedCache({ ttlMs: 5 * 60_000, now });
  let b4 = 0;
  rows.set('g', { at: t - 60_000, data: { from: 'row' } });
  r = await c4.get('g', async () => { b4++; return { from: 'build' }; }, { store });
  eq([r.source, r.data.from, b4], ['shared', 'row', 0], 'fresh shared row → no build');
  rows.set('h', { at: t - 10 * 60_000, data: { from: 'old row' } });
  r = await c4.get('h', async () => { b4++; return { from: 'build' }; }, { store });
  eq([r.source, r.data.from, b4, rows.get('h').data.from], ['built', 'build', 1, 'build'], 'stale shared row → build and write back');
  rows.set('f', { at: t + 3_600_000, data: { from: 'future' } });
  r = await c4.get('f', async () => ({ from: 'build' }), { store });
  eq(r.source, 'built', 'a row stamped in the future (clock skew) is not trusted');

  // pgCacheStore: missing table → one request, then backed off for 10 min.
  let calls = 0;
  const fake404 = async () => { calls++; return { ok: false, status: 404, json: async () => ({}) }; };
  const pg = pgCacheStore({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc', fetchImpl: fake404, now });
  eq(await pg.read('k'), null, 'missing table → null');
  await pg.read('k'); await pg.write('k', {}, t);
  eq(calls, 1, 'missing table remembered: no further requests');
  t += 11 * 60_000;
  await pg.read('k');
  eq(calls, 2, 'retries after the backoff');

  // pgCacheStore: a good row parses; the write is an upsert with the service key on apikey.
  const seen = [];
  const fakeOk = async (url, init = {}) => {
    seen.push({ url, init });
    if ((init.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => [{ payload: { a: 1 }, built_at: new Date(t).toISOString() }] };
    }
    return { ok: true, status: 201, json: async () => ({}) };
  };
  const pg2 = pgCacheStore({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'sb_secret_x', fetchImpl: fakeOk, now });
  eq(await pg2.read('leaderboard:global:alltime:v1'), { at: t, data: { a: 1 } }, 'row read');
  await pg2.write('k', { b: 2 }, t);
  const w = seen[1];
  ok(/function_cache\?on_conflict=key$/.test(w.url), 'write targets function_cache with on_conflict');
  ok(/merge-duplicates/.test(w.init.headers.Prefer), 'write is an upsert');
  eq(w.init.headers.apikey, 'sb_secret_x', 'new secret key goes on apikey');
  ok(!('Authorization' in w.init.headers), 'new secret key is not sent as Bearer');
}

// ── get-leaderboard smoke run ───────────────────────────────────────────
function jsonRes(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: k => headers[k.toLowerCase()] ?? null },
    json: async () => body, text: async () => JSON.stringify(body),
  };
}
const uid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
// Heavy, realistic pool: 600 opted-in users, every one with a ~7 kB avatar.
const AVATAR = 'data:image/jpeg;base64,' + 'A'.repeat(7000);
const POOL = Array.from({ length: 600 }, (_, i) => ({
  id: uid(i + 1), handle: `user${i + 1}`, display_name: `User ${i + 1}`,
  ratings: { brain: 50, finance: 50, fitness: 50, social: 50 },
  ratings_ovr: 99 - Math.floor(i / 8), prestige: i < 3 ? 2 : 0,
  ratings_computed_at: new Date().toISOString(), avatar_url: AVATAR,
  leaderboard_optin: true, tier: i % 10 === 0 ? 'pro' : 'free', leaderboard_color: '#ff0000',
}));
const lifetime = p => (p.prestige || 0) * 100 + p.ratings_ovr;
const POOL_SORTED = POOL.slice().sort((a, b) => lifetime(b) - lifetime(a));

function makeSupabase({ cacheTable = true } = {}) {
  const log = [];
  const cacheRows = new Map();
  const fake = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname;
    const q = u.searchParams;
    const method = init.method || 'GET';
    if (path === '/auth/v1/user') {
      const tok = (init.headers.Authorization || '').replace('Bearer ', '');
      log.push('auth');
      return jsonRes({ id: tok });
    }
    if (path === '/rest/v1/function_cache') {
      log.push(`cache:${method}`);
      if (!cacheTable) return jsonRes({ code: 'PGRST205' }, { status: 404 });
      if (method === 'GET') {
        const key = q.get('key').replace(/^eq\./, '');
        const r = cacheRows.get(key);
        return jsonRes(r ? [r] : []);
      }
      const body = JSON.parse(init.body);
      cacheRows.set(body.key, { payload: body.payload, built_at: body.built_at });
      return jsonRes(null, { status: 201 });
    }
    if (path === '/rest/v1/rating_snapshots') { log.push('snapshots'); return jsonRes([]); }
    if (path === '/rest/v1/friendships') {
      log.push('friendships');
      // uid(1) has 150 accepted friends (uid 2..151).
      return jsonRes(String(q.get('or')).includes(uid(1))
        ? Array.from({ length: 150 }, (_, i) => ({ requester_id: uid(1), addressee_id: uid(i + 2) }))
        : []);
    }
    if (path === '/rest/v1/profiles') {
      const sel = q.get('select') || '';
      if (q.get('suspended_at')) { log.push('suspended'); return jsonRes([]); }
      if (q.get('lifetime_rating')) {
        log.push('rankcount');
        const gt = Number(q.get('lifetime_rating').replace('gt.', ''));
        const above = POOL.filter(p => lifetime(p) > gt).length;
        return jsonRes([], { headers: { 'content-range': `0-0/${above}` } });
      }
      if (q.get('leaderboard_optin') === 'eq.true') {
        log.push(`candidates:${q.get('limit')}`);
        const cols = sel.split(',');
        return jsonRes(POOL_SORTED.slice(0, Number(q.get('limit'))).map(p => Object.fromEntries(cols.map(c => [c, p[c]]))));
      }
      const idEq = q.get('id');
      if (idEq && idEq.startsWith('eq.')) {
        log.push('me');
        const id = idEq.slice(3);
        const p = POOL.find(x => x.id === id) || { id, handle: 'outsider', display_name: 'Outsider', ratings: {}, ratings_ovr: 10, prestige: 0, ratings_computed_at: new Date().toISOString(), leaderboard_optin: true, avatar_url: AVATAR };
        return jsonRes([Object.fromEntries(sel.split(',').map(c => [c, p[c]]))]);
      }
      if (idEq && idEq.startsWith('in.(')) {
        const ids = idEq.slice(4, -1).split(',');
        log.push(`byid:${sel}:${ids.length}`);
        return jsonRes(ids.map(id => POOL.find(p => p.id === id)).filter(Boolean)
          .map(p => Object.fromEntries(sel.split(',').map(c => [c, p[c]]))));
      }
    }
    log.push(`UNEXPECTED ${method} ${path}?${q}`);
    return jsonRes({}, { status: 500 });
  };
  return { fake, log, cacheRows };
}

{
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  delete process.env.VANTAGE_PAUSE;
  const sbx = makeSupabase();
  globalThis.fetch = sbx.fake;
  const LB = require('../functions/get-leaderboard.js');
  const call = (caller, body, ip = '203.0.113.9') => LB.handler({
    httpMethod: 'POST', headers: { authorization: `Bearer ${caller}`, 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

  // 1. First global weekly view builds: 500 candidates WITHOUT avatars,
  //    then avatars + colours for the 100 shown rows only.
  let res = await call(uid(5), { scope: 'global', timeframe: 'weekly' });
  let body = JSON.parse(res.body);
  eq(res.statusCode, 200, 'global weekly 200');
  ok(sbx.log.includes('candidates:500'), 'weekly pool still 500 candidates');
  const candSel = sbx.log.find(l => l.startsWith('candidates'));
  ok(candSel, 'candidates read');
  const avatarReads = sbx.log.filter(l => l.startsWith('byid:id,avatar_url'));
  eq(avatarReads.map(l => l.split(':').pop()), ['100'], 'avatars fetched once, for exactly the 100 shown rows');
  eq(body.rows.length, 100, 'caller in top → 100 rows, no pinned row');
  eq(body.rows.filter(r => r.isSelf).map(r => r.userId), [uid(5)], 'caller row marked isSelf');
  eq(body.callerRank, body.rows.find(r => r.isSelf).rank, 'callerRank = their row');
  ok(body.rows.every(r => r.avatarUrl === AVATAR), 'every shown row has its avatar');
  ok(body.rows.filter(r => r.nameColor).every(r => POOL.find(p => p.id === r.userId).tier === 'pro'), 'colours only for Pro');
  eq(sbx.log.filter(l => l === 'cache:POST').length, 1, 'built board written to function_cache');

  // 2. A second user on the same instance: memory hit — no candidates,
  //    no snapshots, no avatars; only their own profile.
  sbx.log.length = 0;
  res = await call(uid(42), { scope: 'global', timeframe: 'weekly' });
  body = JSON.parse(res.body);
  eq(sbx.log, ['auth', 'me'], 'cached view = auth + own profile only');
  eq(body.rows.filter(r => r.isSelf).map(r => r.userId), [uid(42)], 'isSelf is per caller, not cached');
  ok(!body.rows.some(r => r.isSelf && r.userId === uid(5)), 'previous caller not marked self');

  // 3. A caller outside the top 100 (alltime): pinned row with true rank.
  sbx.log.length = 0;
  res = await call(uid(450), { scope: 'global', timeframe: 'alltime' });
  body = JSON.parse(res.body);
  ok(sbx.log.includes('candidates:100'), 'alltime board built once');
  sbx.log.length = 0;
  res = await call(uid(450), { scope: 'global', timeframe: 'alltime' });
  body = JSON.parse(res.body);
  const pinned = body.rows[body.rows.length - 1];
  eq(body.rows.length, 101, 'top 100 + pinned');
  eq([pinned.userId, pinned.isSelf], [uid(450), true], 'pinned row is the caller');
  eq(body.callerRank, POOL.filter(p => lifetime(p) > lifetime(POOL[449])).length + 1, 'true rank from the count query');
  ok(!sbx.log.some(l => l.startsWith('candidates')), 'pinned path does not rebuild the board');
  eq(sbx.log.filter(l => l.startsWith('byid:id,leaderboard_color,tier:1')).length, 1, 'pinned row: colour read only, no avatar re-read');
  eq(pinned.avatarUrl, AVATAR, 'pinned row carries the caller’s own avatar (from their profile)');

  // 4. Cold instance: memory cleared → the shared row is used, not rebuilt.
  LB._test.boardCache.clear();
  sbx.log.length = 0;
  res = await call(uid(7), { scope: 'global', timeframe: 'weekly' });
  body = JSON.parse(res.body);
  ok(sbx.log.includes('cache:GET'), 'cold instance reads function_cache');
  ok(!sbx.log.some(l => l.startsWith('candidates') || l === 'snapshots'), 'and does not rebuild');
  eq(body.rows.length, 100, 'shared rows served');

  // 5. personaliseRows: opted-out-since-build caller doesn't see themselves.
  const shared = body.rows.map(r => ({ ...r, isSelf: false }));
  const me = { ...POOL[2], leaderboard_optin: false };
  const p = LB._test.personaliseRows(shared, me, uid(3));
  ok(!p.rows.some(r => r.userId === uid(3)), 'opted-out caller removed from their own view');
  eq(p.rows.map(r => r.rank), p.rows.map((_, i) => i + 1), 're-ranked without gaps');
  ok(shared.some(r => r.userId === uid(3)), 'cached rows not mutated');
  const p2 = LB._test.personaliseRows(shared, { ...POOL[2], ratings_ovr: POOL[2].ratings_ovr + 3 }, uid(3));
  eq(p2.callerInTop.ovr, POOL[2].ratings_ovr + 3, 'caller row shows their current OVR');
  const p3 = LB._test.personaliseRows(shared, null, uid(3));
  ok(p3.callerInTop && p3.callerInTop.isSelf, 'profile read failed → row kept, marked self');

  // 6. Friends board: never cached; >100 rows → initials past 100.
  sbx.log.length = 0;
  res = await call(uid(1), { scope: 'friends', timeframe: 'alltime' });
  ok(sbx.log.includes('friendships') && !sbx.log.includes('cache:GET'), 'friends board is per user, uncached');
  body = JSON.parse(res.body);
  eq(body.rows.length, 151, 'friends board: caller + 150 friends');
  ok(body.rows.slice(0, 100).every(r => r.avatarUrl === AVATAR), 'top 100 friends have avatars');
  ok(body.rows.slice(100).every(r => r.avatarUrl === null), 'friends past 100 get initials (no data URI)');
  ok(body.rows.slice(100).some(r => r.nameColor), 'but still get their Pro colour');
  eq(body.rows.filter(r => r.isSelf).map(r => r.userId), [uid(1)], 'friends board marks caller');

  // 7. Kill switch still answers 503 before any work.
  process.env.VANTAGE_PAUSE = 'social';
  sbx.log.length = 0;
  res = await call(uid(1), { scope: 'global', timeframe: 'weekly' });
  eq([res.statusCode, sbx.log.length], [503, 0], 'social paused → 503, no Supabase calls');
  delete process.env.VANTAGE_PAUSE;

  ok(!sbx.log.some(l => l.startsWith('UNEXPECTED')), 'no unexpected requests');
}

// ── ipLimit ─────────────────────────────────────────────────────────────
{
  const { createIpLimiter, clientIp } = require('./ipLimit.js');
  let t = 0;
  const L = createIpLimiter([{ ms: 60_000, max: 3 }, { ms: 3_600_000, max: 5 }], { now: () => t, maxKeys: 50 });
  const seq = [];
  for (let i = 0; i < 4; i++) seq.push(L.hit('1.2.3.4').allowed);
  eq(seq, [true, true, true, false], 'per-minute window: 3 allowed, 4th refused');
  eq(L.hit('5.6.7.8').allowed, true, 'other IPs unaffected');
  t += 61_000;
  eq(L.hit('1.2.3.4').allowed, true, 'next minute: 5th of the hour allowed (refused hits still counted)');
  eq(L.hit('1.2.3.4').allowed, false, '6th of the hour refused by the hourly window');
  t += 3_600_000;
  eq(L.hit('1.2.3.4').allowed, true, 'after the hour, allowed again');
  eq(L.peek('1.2.3.4', 1), 1, 'peek reads the hourly count without counting');
  for (let i = 0; i < 200; i++) L.hit(`10.0.0.${i}`);
  ok(L.size() <= 51, `memory bounded (size ${L.size()})`);
  eq(clientIp({ headers: { 'x-nf-client-connection-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }), '9.9.9.9', 'Netlify IP header wins');
  eq(clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } }), '1.1.1.1', 'XFF first hop fallback');
  eq(clientIp({}), 'unknown', 'no headers → unknown');
  assert.throws(() => createIpLimiter([]), /window/); n++;
}

// ── sessionCache ────────────────────────────────────────────────────────
{
  const { sessionUserId, _cache } = require('./sessionCache.js');
  const env = { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' };
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (exp) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', exp })}.sig`;
  let t = 1_700_000_000_000;
  let calls = 0;
  const fakeAuth = async (url, init) => {
    calls++;
    const tok = init.headers.Authorization.replace('Bearer ', '');
    return tok.endsWith('.bad') ? { ok: false, status: 401, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: 'u1' }) };
  };
  const ev = tok => ({ headers: { authorization: `Bearer ${tok}` } });
  const good = jwt(Math.floor(t / 1000) + 3600);
  eq(await sessionUserId(ev(good), { env, fetchImpl: fakeAuth, now: () => t }), 'u1', 'valid token → user id');
  eq(await sessionUserId(ev(good), { env, fetchImpl: fakeAuth, now: () => t + 1000 }), 'u1', 'cached');
  eq(calls, 1, 'second check served from cache, no Auth call');
  ok(![..._cache.keys()].some(k => k.includes(good)), 'cache keyed by hash, never the raw token');
  eq(await sessionUserId(ev(good), { env, fetchImpl: fakeAuth, now: () => t + 6 * 60_000 }), 'u1', 'past 5 min → re-verified');
  eq(calls, 2, 're-verification made one call');
  const bad = `${b64({ alg: 'HS256' })}.${b64({ sub: 'x' })}.bad`;
  eq(await sessionUserId(ev(bad), { env, fetchImpl: fakeAuth, now: () => t }), null, 'rejected token → null');
  await sessionUserId(ev(bad), { env, fetchImpl: fakeAuth, now: () => t + 1000 });
  eq(calls, 3, 'rejection cached too');
  const expired = jwt(Math.floor(t / 1000) - 10);
  eq(await sessionUserId(ev(expired), { env, fetchImpl: fakeAuth, now: () => t }), null, 'expired token → null without an Auth call');
  eq(calls, 3, 'no call for an expired token');
  eq(await sessionUserId({ headers: { authorization: 'Bearer not-a-jwt' } }, { env, fetchImpl: fakeAuth }), null, 'junk → null');
  eq(await sessionUserId({ headers: {} }, { env, fetchImpl: fakeAuth }), null, 'no header → null');
}

// ── weather ─────────────────────────────────────────────────────────────
{
  const W = require('../functions/weather.js');
  const geo = o => Buffer.from(JSON.stringify(o)).toString('base64');
  const LDN = { city: 'London', country: { code: 'GB', name: 'United Kingdom' }, subdivision: { code: 'ENG' }, latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' };
  eq(W._test.geoFromHeaders({ 'x-nf-geo': geo(LDN) }), { city: 'London', country: 'GB', latitude: 51.5074, longitude: -0.1278 }, 'base64 x-nf-geo parsed');
  eq(W._test.geoFromHeaders({ 'x-nf-geo': JSON.stringify(LDN) }).city, 'London', 'plain-JSON x-nf-geo (dev) parsed');
  eq(W._test.geoFromHeaders({ 'x-nf-geo': geo({ city: 'Leeds', country: { code: 'GB' } }) }), { city: 'Leeds', country: 'GB' }, 'no lat/lon → city only');
  eq(W._test.geoFromHeaders({ 'x-nf-geo': geo({ latitude: 0, longitude: 0 }) }), null, '0,0 is "unknown", not the Gulf of Guinea');
  eq(W._test.geoFromHeaders({ 'x-nf-geo': '%%%' }), null, 'garbage → null');
  eq(W._test.geoFromHeaders({}), null, 'absent → null');

  const upstream = [];
  globalThis.fetch = async (url) => {
    upstream.push(String(url));
    if (String(url).includes('ipwho')) throw new Error('ipwho.is must never be called');
    if (String(url).includes('geocoding-api')) return { ok: true, json: async () => ({ results: [{ latitude: 53.8, longitude: -1.55 }] }) };
    if (String(url).includes('api.open-meteo.com')) return { ok: true, json: async () => ({ current: { temperature_2m: 12.4, weather_code: 3, is_day: 1 } }) };
    if (String(url).includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ id: 'u-weather' }) };
    throw new Error('unexpected ' + url);
  };
  const get = (headers) => W.handler({ httpMethod: 'GET', headers });
  let r = await get({ 'x-nf-client-connection-ip': '198.51.100.1', 'x-nf-geo': geo(LDN) });
  let b = JSON.parse(r.body);
  eq([r.statusCode, b.tempC, b.tempF, b.code, b.city], [200, 12, 54, 3, 'London'], 'weather from x-nf-geo');
  eq(r.headers['Cache-Control'], 'private, max-age=900', 'success is private-cacheable only');
  r = await get({ 'x-nf-client-connection-ip': '198.51.100.2', 'x-nf-geo': geo({ ...LDN, latitude: 51.52, longitude: -0.11 }) });
  eq(upstream.filter(u => u.includes('api.open-meteo.com')).length, 1, 'same ~11 km cell → served from cache');
  r = await get({ 'x-nf-client-connection-ip': '198.51.100.3', 'x-nf-geo': geo({ city: 'Leeds', country: { code: 'GB' } }) });
  b = JSON.parse(r.body);
  eq([b.city, b.tempC], ['Leeds', 12], 'city-only geo → geocoded by name');
  ok(upstream.some(u => u.includes('geocoding-api') && u.includes('name=Leeds') && u.includes('countryCode=GB')), 'geocoder got the city name only');
  ok(!upstream.some(u => /198\.51\.100/.test(u)), 'the caller IP is never sent upstream');
  r = await get({ 'x-nf-client-connection-ip': '198.51.100.4' });
  eq(JSON.parse(r.body), { error: 'location unavailable' }, 'no geo → chip hidden, no third-party lookup');
  ok(!upstream.some(u => u.includes('ipwho')), 'ipwho.is never called');

  // Rate limit: anonymous allowance, then session required, then hard cap.
  // Date.now is faked so calls can be spaced past the 10-a-minute brake.
  const realNow = Date.now;
  let ft = realNow();
  Date.now = () => ft;
  try {
    let authCalls = 0;
    const baseFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).includes('/auth/v1/user')) authCalls++; return baseFetch(url, init); };
    const ip = { 'x-nf-client-connection-ip': '203.0.113.50', 'x-nf-geo': geo(LDN) };
    let statuses = [];
    for (let i = 0; i < W._test.ANON_PER_HOUR; i++) { statuses.push((await get(ip)).statusCode); ft += 7000; }
    ok(statuses.every(s => s === 200), `first ${W._test.ANON_PER_HOUR} anonymous calls an hour served`);
    eq(authCalls, 0, 'no Auth call inside the anonymous allowance');
    eq((await get(ip)).statusCode, 429, 'past the allowance without a session → 429');
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const tok = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u', exp: Math.floor(ft / 1000) + 7200 })}.s`;
    const ip2 = { 'x-nf-client-connection-ip': '203.0.113.51', 'x-nf-geo': geo(LDN), authorization: `Bearer ${tok}` };
    statuses = [];
    for (let i = 0; i < W._test.SIGNED_IN_PER_HOUR; i++) { statuses.push((await get(ip2)).statusCode); ft += 7000; }
    ok(statuses.every(s => s === 200), `signed-in caller: ${W._test.SIGNED_IN_PER_HOUR} an hour served`);
    // 48 verified calls over ~5.6 min: one Auth call, then one more when
    // the 5-minute verdict cache lapses — never one per call.
    eq(authCalls, 2, 'session verified once per 5 minutes (cached by token hash), not per call');
    eq((await get(ip2)).statusCode, 429, 'hourly cap applies even signed in');
    const ip3 = { 'x-nf-client-connection-ip': '203.0.113.52', 'x-nf-geo': geo(LDN) };
    statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await get(ip3)).statusCode);
    eq([statuses.slice(0, 10).every(s => s === 200), statuses[10]], [true, 429], 'burst brake: 10 a minute for everyone');
    globalThis.fetch = baseFetch;
  } finally { Date.now = realNow; }
  eq((await W.handler({ httpMethod: 'POST', headers: {} })).statusCode, 405, 'GET only');
}

// ── client-error ────────────────────────────────────────────────────────
{
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  const inserts = [];
  let insertStatus = 201;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/rest/v1/client_errors')) { inserts.push(JSON.parse(init.body)); return { ok: insertStatus < 300, status: insertStatus }; }
    if (String(url).includes('/auth/v1/user')) return { ok: false, status: 401, json: async () => ({}) };
    throw new Error('unexpected ' + url);
  };
  const CE = require('../functions/client-error.js');
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  const post = (body, headers = {}) => CE.handler({ httpMethod: 'POST', headers: { 'user-agent': UA, 'x-nf-client-connection-ip': '192.0.2.1', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  let r = await post({ kind: 'window.onerror', message: 'TypeError: x is undefined', stack: 'at a (b.js:1:2)', url: 'https://vantagevision.netlify.app/hub?token=abc#x', release: 'index-Abc123.js' });
  eq(r.statusCode, 204, '204');
  eq(inserts.length, 1, 'stored');
  eq([inserts[0].kind, inserts[0].url, inserts[0].release, inserts[0].user_id], ['window.onerror', 'https://vantagevision.netlify.app/hub', 'index-Abc123.js', null], 'shaped: real kind kept, query stripped, no user');
  await post({ kind: 'window.onerror', message: 'TypeError: x is undefined', stack: 'at a (b.js:1:2)' });
  eq(inserts.length, 1, 'same report from same IP inside a minute → deduped');
  await post({ message: '   ' });
  await post({ stack: '' });
  await post([1, 2]);
  await post('not json');
  await post({ message: 'no ua' }, { 'user-agent': '' });
  eq(inserts.length, 1, 'whitespace / empty / array / non-JSON / no-UA dropped');
  await post({ message: 'odd release', release: '<script>' });
  eq(inserts[1].release, null, 'non-build-id release nulled');
  eq((await post('x'.repeat(9000))).statusCode, 413, 'oversize → 413');
  insertStatus = 400;
  await post({ message: 'capped A' });
  await post({ message: 'capped B' });
  eq(inserts.length, 3, 'a 400 (durable cap / no table) backs the instance off');
  CE._test.reset(); insertStatus = 201;
  let codes = [];
  for (let i = 0; i < 31; i++) codes.push((await post({ message: `burst ${i}` }, { 'x-nf-client-connection-ip': '192.0.2.99' })).statusCode);
  eq([codes.slice(0, 30).every(c => c === 204), codes[30]], [true, 429], '30 a minute per IP, then 429');
}

// ── vitals-beacon ───────────────────────────────────────────────────────
{
  const rows = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/rest/v1/web_vitals')) { rows.push(JSON.parse(init.body)); return { ok: true, status: 201 }; }
    throw new Error('unexpected ' + url);
  };
  const VB = require('../functions/vitals-beacon.js');
  const beacon = (body, headers = {}) => VB.handler({ httpMethod: 'POST', headers: { 'user-agent': 'Mozilla/5.0', 'x-nf-client-connection-ip': '192.0.2.7', ...headers }, body: JSON.stringify(body) });
  await beacon({ path: '/hub', lcp: 1800, cls: 0.02, nav: 'navigate', device: 'mobile' });
  eq(rows.length, 1, 'beacon stored');
  ok(!('ua' in rows[0]) && !('ip' in rows[0]), 'no UA / IP stored');
  await beacon({ path: '/hub', lcp: 1800 }, { 'user-agent': '' });
  await beacon({ path: '/hub' });
  eq(rows.length, 1, 'no UA, or no metric → dropped');
  eq((await VB.handler({ httpMethod: 'POST', headers: {}, body: 'x'.repeat(3000) })).statusCode, 413, 'oversize → 413');
}

// ── retention (item 96) ─────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');
  const R = require('./retention.js');
  const USER_CONTENT = ['user_data', 'user_data_history', 'nutrition_log', 'messages', 'friendships', 'profiles', 'push_tokens', 'blocks', 'groups'];

  // Query builder refuses user content, and anything not on the list.
  for (const t of USER_CONTENT) {
    assert.throws(() => R.buildPruneCall(t), /user content|not a retention target/, `${t} refused`); n++;
    ok(R.NEVER.has(t) || ['groups'].includes(t), `${t} on the NEVER list`);
    ok(!R.TARGETS.some(x => x.target === t), `${t} is not a target`);
  }
  assert.throws(() => R.buildPruneCall('client_errors; drop table user_data'), /not a retention target/); n++;
  assert.throws(() => R.buildPruneCall(''), /not a retention target/); n++;
  // Even if someone adds a user-content table to TARGETS, NEVER wins.
  R.TARGETS.push({ target: 'messages', days: 1 });
  assert.throws(() => R.buildPruneCall('messages'), /user content/, 'NEVER beats TARGETS'); n++;
  R.TARGETS.pop();
  eq(R.buildPruneCall('client_errors', { limit: 99999, dryRun: true }),
    { path: '/rest/v1/rpc/retention_prune', body: { p_target: 'client_errors', p_limit: 2000, p_dry_run: true } }, 'limit clamped to 2000');
  eq(R.buildPruneCall('reports').body.p_limit, R.BATCH, 'default batch');

  // SQL ↔ JS: same targets, same windows; SQL touches no user-content table.
  const sql = readFileSync(join(root, 'supabase', 'retention_2026_10b.sql'), 'utf8');
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const branches = [...code.matchAll(/p_target = '(\w+)'/g)].map(m => m[1]);
  eq(branches.sort(), R.TARGETS.map(t => t.target).sort(), 'SQL function names exactly the JS targets');
  const unit = { days: 1, months: 30, hours: 1 / 24 };
  for (const { target, days } of R.TARGETS) {
    const start = code.indexOf(`p_target = '${target}'`);
    const next = code.slice(start + 10).search(/elsif p_target|\belse\b\s*\n\s*raise/);
    const body = code.slice(start, start + 10 + next);
    const ivs = [...body.matchAll(/interval '(\d+) (day|days|month|months)'/g)]
      .map(m => Number(m[1]) * unit[m[2].replace(/s$/, '') + 's']);
    ok(ivs.length > 0 && ivs.every(d => Math.abs(d - days) <= 5), `${target}: SQL window ${ivs.join('/')}d matches JS ${days}d`);
  }
  for (const t of USER_CONTENT) {
    ok(!new RegExp(`(delete\\s+from|truncate|update)\\s+(public\\.)?${t}\\b`, 'i').test(code), `SQL never deletes/updates ${t}`);
  }
  const deletes = [...code.matchAll(/delete\s+from\s+public\.(\w+)/gi)].map(m => m[1]);
  ok(deletes.length > 0 && deletes.every(t => R.TARGETS.some(x => x.target === t)), `every SQL delete is a target (${[...new Set(deletes)].join(', ')})`);
  ok(/revoke all on function public\.retention_prune\(text, integer, boolean\) from public, anon, authenticated/.test(code), 'prune function revoked from app roles');
  ok(/raise exception 'retention_prune: % is not a retention target'/.test(code), 'SQL raises for any other target');
  ok(/^begin;$/m.test(code) && /^commit;$/m.test(code), 'one transaction');
  // Header documents the user-content rule (the owner reads it before running).
  ok(/NEVER USER CONTENT/.test(sql) && USER_CONTENT.slice(0, 6).every(t => sql.includes(t)), 'header names the user-content tables it never touches');
  // The function and lib source never name a user-content table in a request path.
  const fnSrc = readFileSync(join(root, 'netlify', 'functions', 'retention-prune.js'), 'utf8');
  for (const t of USER_CONTENT) ok(!fnSrc.includes(`/rest/v1/${t}`), `retention-prune never calls /rest/v1/${t}`);

  // Runner: batches until a short batch, respects caps, budget and errors.
  const calls = [];
  const backlog = { client_errors: 1234, web_vitals: 0, rating_snapshots: 20000 };
  const rpc = async (path, body) => {
    calls.push(body.p_target);
    if (body.p_target === 'coach_nudges') return { ok: false, status: 400 };       // table missing
    const left = backlog[body.p_target] || 0;
    const c = Math.min(left, body.p_limit);
    backlog[body.p_target] = left - c;
    return { ok: true, status: 200, count: c };
  };
  let t = 0;
  const res = await R.runRetention({ rpc, now: () => t, sleep: async ms => { t += ms; } });
  eq([res.client_errors.deleted, res.client_errors.batches, res.client_errors.complete], [1234, 3, true], 'client_errors: 500+500+234, complete');
  eq([res.web_vitals.deleted, res.web_vitals.batches, res.web_vitals.complete], [0, 1, true], 'nothing to do = one cheap call');
  eq([res.rating_snapshots.deleted, res.rating_snapshots.batches, res.rating_snapshots.complete], [10000, 20, false], 'backlog capped at 20 batches (10k rows) per run');
  ok(/failed \(400\)/.test(res.coach_nudges.error), 'a missing table fails that target only');
  ok(res.reports.complete && res.function_cache.complete, 'later targets still ran');
  ok(!calls.some(c => USER_CONTENT.includes(c)), 'runner never asked for a user-content table');
  // Time budget: a slow DB stops new work.
  let t2 = 0;
  const slow = async (p, body) => { t2 += 6000; return { ok: true, status: 200, count: body.p_limit }; };
  const res2 = await R.runRetention({ rpc: slow, now: () => t2, sleep: async () => {} });
  ok(Object.values(res2).some(r => r.skipped === 'time budget'), 'time budget stops new batches');
  // 404 = SQL not run yet.
  const res3 = await R.runRetention({ rpc: async () => ({ ok: false, status: 404 }), sleep: async () => {} });
  ok(Object.values(res3).every(r => r.error === 'retention_prune not installed' && r.deleted === 0), 'before the SQL: nothing happens, every target says so');
  // Dry run: one call per target, flagged.
  const dry = [];
  await R.runRetention({ rpc: async (p, b) => { dry.push(b); return { ok: true, status: 200, count: b.p_limit }; }, dryRun: true, sleep: async () => {} });
  eq([dry.length, dry.every(b => b.p_dry_run === true)], [R.TARGETS.length, true], 'dry run = one flagged call per target');

  // The handler: scheduler-only, paused by VANTAGE_PAUSE=all|retention, logs counts.
  const RP = require('../functions/retention-prune.js');
  eq([RP._test.pausedForRetention('all'), RP._test.pausedForRetention('AI, retention'), RP._test.pausedForRetention('ai,social,sync,push'), RP._test.pausedForRetention('')],
    [true, true, false, false], 'retention pauses for all|retention only');
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  delete process.env.CRON_SECRET;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => {
    seen.push(String(url));
    ok(String(url).endsWith('/rest/v1/rpc/retention_prune'), 'handler only calls the prune RPC');
    return { ok: true, status: 200, json: async () => 0 };
  };
  const denied = await RP.handler({ httpMethod: 'GET', headers: {}, body: '' });
  eq([denied.statusCode, seen.length], [401, 0], 'a plain web request is refused (no CRON_SECRET)');
  process.env.VANTAGE_PAUSE = 'all';
  let r = await RP.handler({ body: JSON.stringify({ next_run: 'x' }) });
  eq([JSON.parse(r.body).paused, seen.length], [true, 0], 'paused → no DB calls');
  delete process.env.VANTAGE_PAUSE;
  const logs = [];
  const info = console.info;
  console.info = (...a) => logs.push(a.join(' '));
  r = await RP.handler({ body: JSON.stringify({ next_run: 'x' }) });
  console.info = info;
  eq([r.statusCode, seen.length], [200, R.TARGETS.length], 'scheduled run: one call per target when nothing is old');
  ok(logs.some(l => /^retention-prune: client_errors=0 /.test(l)), 'logs one line of counts');
}

// ── netlify.toml schedules ──────────────────────────────────────────────
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  const schedules = {};
  for (const m of toml.matchAll(/^\[functions\."([\w-]+)"\]\s*\n\s*schedule\s*=\s*"([^"]+)"/gm)) schedules[m[1]] = m[2];
  const FIELD = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const validField = (f, [lo, hi]) => f.split(',').every(part => {
    const [range, step] = part.split('/');
    if (step !== undefined && !/^\d+$/.test(step)) return false;
    if (range === '*') return true;
    const [a, b] = range.split('-').map(Number);
    return Number.isInteger(a) && a >= lo && a <= hi && (b === undefined || (Number.isInteger(b) && b >= a && b <= hi));
  });
  const validCron = s => { const f = s.trim().split(/\s+/); return f.length === 5 && f.every((x, i) => validField(x, FIELD[i])); };
  for (const [fn, cron] of Object.entries(schedules)) {
    ok(validCron(cron), `${fn}: "${cron}" is a valid 5-field cron`);
    ok(existsSync(join(root, 'netlify', 'functions', `${fn}.js`)), `${fn}: function file exists`);
  }
  eq(schedules['push-dispatch'], '*/5 * * * *', 'push-dispatch every 5 minutes (item 87)');
  eq(schedules['retention-prune'], '47 4 * * 0', 'retention weekly, Sunday 04:47 UTC');
  ok(!Object.values(schedules).includes('* * * * *'), 'no every-minute cron left');
  // Rough monthly invocation count of push-dispatch: 30 days × 24 h × 12.
  eq(30 * 24 * 60 / 5, 8640, 'push-dispatch ≈ 8.6k runs / 30 days (was 43.2k)');
}

console.log(`efficiency (items 87/91/95/96): ${n} checks passed`);

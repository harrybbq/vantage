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

// Exposed for the later sections of this file.
export { eq, ok, jsonRes };
console.log(`efficiency (leaderboard + cache): ${n} checks passed`);

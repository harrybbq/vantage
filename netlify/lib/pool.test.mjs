/**
 * The bounded pool (item 93) and whoop-cron / oura-cron on top of it:
 * concurrency never exceeds n, the deadline stops starts but not
 * in-flight work, one failure doesn't stop the others, and whoop-cron
 * stays inside its WHOOP request budget with the per-account order
 * (token refresh persisted → data → CAS write) unchanged.
 * No network: fetch is faked.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pool } = require('./pool.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── concurrency never exceeds n; every item runs; results in input order ──
{
  let live = 0, peak = 0;
  const items = Array.from({ length: 23 }, (_, i) => i);
  const r = await pool(items, 4, async i => { live++; peak = Math.max(peak, live); await sleep(2 + (i % 3)); live--; return i * 2; });
  eq(peak, 4, 'peak concurrency is exactly n');
  eq(r.started, 23, 'all started');
  eq(r.notReached, 0, 'none left');
  eq(r.results.map(x => x.value), items.map(i => i * 2), 'results in input order');
}
{
  let live = 0, peak = 0;
  await pool([1, 2], 6, async () => { live++; peak = Math.max(peak, live); await sleep(2); live--; });
  eq(peak, 2, 'never more workers than items');
  eq((await pool([], 4, async () => 1)).started, 0, 'empty list');
  eq((await pool(null, 4, async () => 1)).notReached, 0, 'non-array is empty');
}

// ── one failure doesn't stop the others ──
{
  const r = await pool([1, 2, 3, 4, 5], 2, async i => { if (i === 2) throw new Error('boom'); return i; });
  eq(r.results.map(x => x.ok), [true, false, true, true, true], 'only the failing one fails');
  eq(r.results[1].error.message, 'boom', 'error kept');
  eq(r.started, 5, 'the rest still ran');
}
{
  const r = await pool([1, 2, 3], 1, i => { if (i === 1) throw new Error('sync throw'); return i; });
  eq(r.results.map(x => x.ok), [false, true, true], 'a synchronous throw is contained too');
}

// ── deadline: no new starts after it, in-flight ones finish ──
{
  let t = 0;
  const finished = [];
  const r = await pool([1, 2, 3, 4, 5, 6], 2, async i => { t += 10; await sleep(1); finished.push(i); return i; }, { deadline: 20, now: () => t });
  eq(r.started, 2, 'two started before the clock passed the deadline');
  eq(r.notReached, 4, 'the rest are reported as not reached');
  eq(finished.sort(), [1, 2], 'in-flight work finished');
}
{
  const r = await pool([1, 2, 3], 2, async i => i, { deadline: 0, now: () => 5 });
  eq([r.started, r.notReached], [0, 3], 'past deadline: nothing starts');
}

// ── canStart: a shared budget, reserved synchronously in fn ──
{
  let reserved = 0;
  const r = await pool(Array.from({ length: 20 }, (_, i) => i), 4, async () => { reserved += 5; await sleep(1); }, { canStart: () => reserved + 5 <= 30 });
  eq(r.started, 6, 'budget 30 at 5 each → 6 started, even with 4 workers racing');
  eq(r.notReached, 14, 'rest not reached');
}

// ── whoop-cron on the pool ───────────────────────────────────────────
const USERS = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
const DEAD = new Set(USERS.slice(0, 6));          // revoked at WHOOP: refresh fails
const log = [];
let inFlightWhoop = 0, peakWhoopUsers = 0;
const activeUsers = new Set();
const seenUsers = new Set();   // the dead-token recheck re-reads the row; count each account once

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || 'GET';
  log.push({ method, u, headers: init.headers || {}, body: init.body });
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/rest/v1/whoop_tokens?select=user_id')) return json(USERS.map(user_id => ({ user_id })));
  let m = u.match(/whoop_tokens\?user_id=eq\.([0-9a-f-]+)/);
  if (m && method === 'GET') {
    if (!seenUsers.has(m[1])) { seenUsers.add(m[1]); activeUsers.add(m[1]); }
    peakWhoopUsers = Math.max(peakWhoopUsers, activeUsers.size);
    return json([{ user_id: m[1], access_token: 'old', refresh_token: `rt-${m[1]}`, expires_at: '2020-01-01T00:00:00Z' }]);
  }
  if (m && method === 'PATCH') return new Response(null, { status: 204 });
  if (u.includes('oauth2/token')) {
    const rt = new URLSearchParams(init.body).get('refresh_token');
    const uid = rt.slice(3);
    if (DEAD.has(uid)) { activeUsers.delete(uid); return new Response('invalid_grant', { status: 400 }); }
    return json({ access_token: `at-${uid}`, refresh_token: `rt2-${uid}`, expires_in: 3600 });
  }
  if (u.startsWith('https://api.prod.whoop.com/developer')) {
    inFlightWhoop++;
    await sleep(2);
    inFlightWhoop--;
    const day = new Date().toISOString().slice(0, 10);
    if (u.includes('/v2/recovery')) return json({ records: [{ created_at: `${day}T07:00:00Z`, cycle_id: 1, score: { recovery_score: 70, resting_heart_rate: 50, hrv_rmssd_milli: 60 } }] });
    return json({ records: [] });
  }
  m = u.match(/user_data\?id=eq\.([0-9a-f-]+)/);
  if (m && method === 'GET') return json([{ state: { vitalsLog: {} }, updated_at: '2026-10-20T05:00:00Z' }]);
  if (m && method === 'PATCH') { activeUsers.delete(m[1]); return json([{ updated_at: 'x' }]); }
  return json([]);
};

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy.service.TEST';
process.env.WHOOP_CLIENT_ID = 'id';
process.env.WHOOP_CLIENT_SECRET = 'secret';
delete process.env.VANTAGE_PAUSE;
const whoopCron = require('../functions/whoop-cron.js');
const { CONFIG } = whoopCron;

const out = [];
const origInfo = console.info, origErr = console.error, origWarn = console.warn;
console.info = (...a) => out.push(a.join(' '));
console.error = () => {}; console.warn = () => {};
let res;
try {
  res = await whoopCron.handler({ body: JSON.stringify({ next_run: '2026-10-20T06:00:00Z' }) });
} finally {
  console.info = origInfo; console.error = origErr; console.warn = origWarn;
}
eq(res.statusCode, 200, 'whoop-cron: run ends 200');
const list = log.find(l => l.u.includes('whoop_tokens?select=user_id'));
ok(/updated_at=lt\.[^&]+&order=updated_at\.asc/.test(list.u), 'whoop-cron: oldest first, skipping accounts touched in the last 3 h');
const refreshes = log.filter(l => l.u.includes('oauth2/token')).length;
const dataCalls = log.filter(l => l.u.startsWith('https://api.prod.whoop.com/developer')).length;
ok(refreshes + dataCalls <= CONFIG.WHOOP_BUDGET, `whoop-cron: stays within the WHOOP budget (${refreshes + dataCalls} ≤ ${CONFIG.WHOOP_BUDGET})`);
eq(refreshes, 6 + Math.floor((CONFIG.WHOOP_BUDGET - 6) / CONFIG.COST_PER_ACCOUNT), 'whoop-cron: dead tokens give their budget back (6 dead + 10 live)');
ok(peakWhoopUsers <= CONFIG.CONCURRENCY, `whoop-cron: never more than ${CONFIG.CONCURRENCY} accounts at once (peak ${peakWhoopUsers})`);
const writes = log.filter(l => l.method === 'PATCH' && l.u.includes('user_data?id=eq.'));
eq(writes.length, 10, 'whoop-cron: one CAS write per synced account');
ok(writes.every(w => /updated_at=eq\./.test(w.u)), 'whoop-cron: every state write is compare-and-set');
// Per account: refresh → token persisted → data → state write, in that order.
for (const uid of USERS.slice(6, 16)) {
  const idx = (pred) => log.findIndex(pred);
  const iRefresh = idx(l => l.u.includes('oauth2/token') && String(l.body).includes(`rt-${uid}`));
  const iPersist = idx(l => l.method === 'PATCH' && l.u.includes(`whoop_tokens?user_id=eq.${uid}`));
  const iWrite = idx(l => l.method === 'PATCH' && l.u.includes(`user_data?id=eq.${uid}`));
  ok(iRefresh >= 0 && iPersist > iRefresh && iWrite > iPersist, `whoop-cron: ${uid.slice(-2)} refresh → persist → write`);
}
ok(log.every(l => !l.u.includes('supabase.co') || !('Authorization' in l.headers)), 'whoop-cron: Supabase calls carry no Authorization (sbKeys)');
const line = out.find(s => s.startsWith('whoop-cron:')) || '';
ok(/10 synced, 0 skipped, 6 failed, 0 busy .*24 not reached .*of 40 due/.test(line), `whoop-cron: counts logged (${line})`);

// ── oura-cron on the pool: smoke ──
{
  const ouraCron = require('../functions/oura-cron.js');
  process.env.OURA_CLIENT_ID = 'id'; process.env.OURA_CLIENT_SECRET = 'secret';
  const saved = globalThis.fetch;
  const users = Array.from({ length: 9 }, (_, i) => `u${i}`);
  let live = 0, peak = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = b => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes('oura_tokens?select=user_id')) return json(users.map(user_id => ({ user_id })));
    if (u.includes('oura_tokens?user_id=eq.')) {
      if ((init.method || 'GET') === 'GET') { live++; peak = Math.max(peak, live); await sleep(3); live--; }
      return json([{ access_token: 'a', refresh_token: 'r', expires_at: '2999-01-01T00:00:00Z' }]);
    }
    if (u.includes('api.ouraring.com')) return json({ data: [] });
    return json([]);
  };
  const lines = [];
  const i0 = console.info; console.info = (...a) => lines.push(a.join(' '));
  try {
    const r = await ouraCron.handler({ body: JSON.stringify({ next_run: 'x' }) });
    eq(r.statusCode, 200, 'oura-cron: run ends 200');
  } finally { console.info = i0; globalThis.fetch = saved; }
  ok(peak <= 4 && peak > 1, `oura-cron: runs accounts in parallel, at most 4 (peak ${peak})`);
  ok(/0 synced, 9 skipped, 0 failed, 0 busy .*0 not reached .*of 9/.test(lines.find(s => s.startsWith('oura-cron:')) || ''), 'oura-cron: counts logged');
}

console.log(`check:pool — ${n} checks passed`);

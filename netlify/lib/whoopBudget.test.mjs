/**
 * WHOOP's app-wide request budget (gap C13): the on-open skip, the 429 /
 * X-RateLimit-Remaining backoff, and what whoop-sync answers with each.
 *
 *   1. syncSkip / parseRateLimit / rateBackoff — the pure decisions.
 *   2. whoopList / fetchWhoopData — a 429 is never retried and carries
 *      its rate headers up; all four refused throws whoopStatus 429.
 *   3. The whoop-sync handler end to end with a faked fetch: a recent
 *      on-open sync calls WHOOP zero times, a manual one still runs,
 *      a 429 answers { rateLimited } and holds the instance off WHOOP.
 *   4. The authorize scopes no longer ask for read:profile (gap C4).
 *
 * Hermetic: SUPABASE_* and WHOOP_* from the real environment are cleared
 * first, and fetch is faked (no network).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);

for (const k of Object.keys(process.env)) {
  if (/^(VITE_)?SUPABASE_|^WHOOP_|^OURA_|^VANTAGE_PAUSE/.test(k)) delete process.env[k];
}

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const W = require('./whoop.js');
const NOW = Date.parse('2026-10-22T12:00:00Z');
const ago = min => new Date(NOW - min * 60_000).toISOString();

// ── 1. pure decisions ──────────────────────────────────────────────
eq(W.ON_OPEN_WINDOW_MS, 60 * 60_000, 'the on-open window is an hour');
eq(W.syncSkip({ auto: true, updatedAt: ago(10), now: NOW }), 'recent', 'on-open, synced 10 min ago → skip');
eq(W.syncSkip({ auto: true, updatedAt: ago(59), now: NOW }), 'recent', '59 min ago → still skip');
eq(W.syncSkip({ auto: true, updatedAt: ago(60), now: NOW }), null, 'an hour ago → sync');
eq(W.syncSkip({ auto: true, updatedAt: ago(600), now: NOW }), null, 'long ago → sync');
eq(W.syncSkip({ auto: false, updatedAt: ago(1), now: NOW }), null, 'a manual sync is never skipped as recent');
eq(W.syncSkip({ auto: true, updatedAt: null, now: NOW }), null, 'no stamp → sync');
eq(W.syncSkip({ auto: true, updatedAt: 'garbage', now: NOW }), null, 'unreadable stamp → sync');
eq(W.syncSkip({ auto: true, updatedAt: new Date(NOW + 5 * 60_000).toISOString(), now: NOW }), null, 'a stamp from the future does not skip');
eq(W.syncSkip({ auto: false, now: NOW, backoffUntil: NOW + 1000 }), 'rate-limited', 'a backoff stops a manual sync too');
eq(W.syncSkip({ auto: true, updatedAt: ago(600), now: NOW, backoffUntil: NOW + 1000 }), 'rate-limited', 'and an on-open one');
eq(W.syncSkip({ auto: true, updatedAt: ago(600), now: NOW, backoffUntil: NOW - 1 }), null, 'an expired backoff does nothing');

const H = obj => ({ get: k => obj[k.toLowerCase()] ?? null });
eq(W.parseRateLimit(H({})), { remaining: null, resetSec: null }, 'no headers → nulls');
eq(W.parseRateLimit(H({ 'x-ratelimit-remaining': '98', 'x-ratelimit-reset': '42' })), { remaining: 98, resetSec: 42 }, 'plain integers');
eq(W.parseRateLimit(H({ 'x-ratelimit-remaining': '98, 9001' })).remaining, 98, 'a per-window list: the smallest binds');
eq(W.parseRateLimit(H({ 'retry-after': '30' })).resetSec, 30, 'Retry-After when there is no reset header');
eq(W.parseRateLimit(null), { remaining: null, resetSec: null }, 'no headers object at all');

eq(W.rateBackoff({ status: 200, remaining: 80, now: NOW }), 0, 'plenty left → no backoff');
eq(W.rateBackoff({ status: 200, remaining: null, now: NOW }), 0, 'no header → no backoff');
eq(W.rateBackoff({ status: 429, now: NOW }), NOW + 60_000, '429 with no reset → a minute');
eq(W.rateBackoff({ status: 429, resetSec: 20, now: NOW }), NOW + 20_000, '429 waits for the reset');
eq(W.rateBackoff({ status: 200, remaining: W.RATE_FLOOR, resetSec: 15, now: NOW }), NOW + 15_000, 'nearly spent → wait for the reset');
eq(W.rateBackoff({ status: 200, remaining: W.RATE_FLOOR + 1, resetSec: 15, now: NOW }), 0, 'just above the floor → carry on');
eq(W.rateBackoff({ status: 429, resetSec: 86_400, now: NOW }), NOW + 60 * 60_000, 'a day-long reset is capped at an hour');
eq(W.rateBackoff({ status: 429, resetSec: 0, now: NOW }), NOW + 60_000, 'a zero reset is not "retry now"');
ok(/busy/i.test(W.whoopReason(429)) && !/fail/i.test(W.whoopReason(429)), '429 words are calm, not a failure');

// ── fake fetch, shared by 2 and 3 ──────────────────────────────────
const calls = [];
let whoopReply = () => ({ status: 200, body: { records: [] }, headers: { 'x-ratelimit-remaining': '90', 'x-ratelimit-reset': '30' } });
let tokenRow = null;
const respond = ({ status = 200, body = {}, headers = {} }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.includes('/auth/v1/user')) return respond({ body: { id: 'user-1', email: 'a@b.c' } });
  if (u.includes('/rest/v1/user_data')) return respond({ body: [{ id: 'user-1', consent: null }] });
  if (u.includes('/rest/v1/consent_events')) return respond({ body: [] });
  if (u.includes('/rest/v1/whoop_tokens')) return respond({ body: tokenRow ? [tokenRow] : [] });
  if (u.includes('api.prod.whoop.com/developer/')) return respond(whoopReply(u));
  throw new Error('unexpected fetch ' + u);
};
const whoopCalls = () => calls.filter(u => u.includes('api.prod.whoop.com/developer/')).length;

// ── 2. whoopList / fetchWhoopData ──────────────────────────────────
{
  calls.length = 0;
  whoopReply = () => ({ status: 429, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '25' } });
  const r = await W.whoopList('/v2/recovery', 'tok', 'a', 'b');
  eq(whoopCalls(), 1, 'a 429 is not retried');
  eq(r.error.status, 429, 'the 429 is reported');
  eq(r.rate, { status: 429, remaining: 0, resetSec: 25 }, 'with its rate headers');

  calls.length = 0;
  let thrown = null;
  try { await W.fetchWhoopData('tok', 3); } catch (e) { thrown = e; }
  ok(thrown, 'all four refused → throws');
  eq(thrown.whoopStatus, 429, 'as a 429');
  eq(thrown.rate.status, 429, 'carrying the rate picture');
  eq(thrown.rate.resetSec, 25, 'and the reset');
  eq(whoopCalls(), 4, 'one call per collection, no retries');

  // Partial: data still comes back, with a calm warning and the rate.
  calls.length = 0;
  whoopReply = u => (u.includes('/v2/cycle')
    ? { status: 429, body: {}, headers: { 'x-ratelimit-remaining': '0' } }
    : { status: 200, body: { records: [] }, headers: { 'x-ratelimit-remaining': '40' } });
  const part = await W.fetchWhoopData('tok', 3);
  eq(part.rate.status, 429, 'a partial 429 is still seen');
  eq(part.rate.remaining, 0, 'tightest remaining wins');
  ok(part.warnings.some(w => /busy/i.test(w)), 'partial 429 → a calm warning, not an error');
}

// ── 3. the handler ─────────────────────────────────────────────────
Object.assign(process.env, {
  SUPABASE_URL: 'https://sb.example',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  WHOOP_CLIENT_ID: 'id',
  WHOOP_CLIENT_SECRET: 'secret',
});
const freshHandler = () => {
  for (const k of Object.keys(require.cache)) {
    if (/whoop-sync\.js$|requireUser\.js$|consentGate\.js$/.test(k)) delete require.cache[k];
  }
  return require('../functions/whoop-sync.js').handler;
};
const call = (handler, body) => handler({
  httpMethod: 'POST',
  headers: { authorization: 'Bearer jwt' },
  body: JSON.stringify(body),
});
const realNow = Date.now;
const liveRow = updatedMinAgo => ({
  user_id: 'user-1', access_token: 'tok', refresh_token: 'ref',
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  updated_at: new Date(Date.now() - updatedMinAgo * 60_000).toISOString(),
});

{
  // On-open, synced 10 minutes ago → skipped, WHOOP never called.
  const handler = freshHandler();
  whoopReply = () => ({ status: 200, body: { records: [] }, headers: { 'x-ratelimit-remaining': '90' } });
  tokenRow = liveRow(10);
  calls.length = 0;
  const res = await call(handler, { days: 7, auto: true });
  const body = JSON.parse(res.body);
  eq(res.statusCode, 200, 'skip is a 200');
  eq(body, { ok: true, skipped: 'recent', days: 7, vitals: {}, burn: {}, warnings: [] }, 'skip shape: empty, flagged');
  eq(whoopCalls(), 0, 'a skipped sync costs WHOOP nothing');
  ok(calls.some(u => u.includes('whoop_tokens') && u.includes('select=updated_at')), 'it read only the stamp');

  // Manual, same account, same minute → runs.
  calls.length = 0;
  const man = await call(handler, { days: 7 });
  eq(man.statusCode, 200, 'manual sync runs');
  eq(JSON.parse(man.body).skipped, undefined, 'and is not a skip');
  eq(whoopCalls(), 4, 'four collections fetched');

  // On-open, synced 2 hours ago → runs.
  tokenRow = liveRow(120);
  calls.length = 0;
  const old = await call(handler, { days: 7, auto: true });
  eq(JSON.parse(old.body).skipped, undefined, 'stale stamp → real sync');
  eq(whoopCalls(), 4, 'which reaches WHOOP');

  // Not connected → 404, as before, even on the on-open path.
  tokenRow = null;
  const none = await call(handler, { days: 7, auto: true });
  eq(none.statusCode, 404, 'no token row → not connected');
}

{
  // WHOOP says 429 → calm rateLimited answer, then the instance holds off.
  const handler = freshHandler();
  tokenRow = liveRow(120);
  whoopReply = () => ({ status: 429, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '40' } });
  calls.length = 0;
  const res = await call(handler, { days: 7 });
  const body = JSON.parse(res.body);
  eq(res.statusCode, 429, '429 out');
  eq(body.rateLimited, true, 'flagged so the app can tell it from the per-user brake');
  ok(/busy/i.test(body.error), 'calm words');
  ok(body.retryAfterSec >= 1 && body.retryAfterSec <= 40, 'retry hint from WHOOP’s reset');
  eq(res.headers['Retry-After'], String(body.retryAfterSec), 'and as a header');
  eq(body.reconnect, undefined, 'never asks the user to reconnect');

  whoopReply = () => ({ status: 200, body: { records: [] } });
  calls.length = 0;
  const again = await call(handler, { days: 7, auto: true });
  eq(again.statusCode, 429, 'within the backoff → answered without asking WHOOP');
  eq(whoopCalls(), 0, 'no retry storm');
  const manual = await call(handler, { days: 7 });
  eq(manual.statusCode, 429, 'a manual sync waits too');
  eq(whoopCalls(), 0, 'still nothing sent to WHOOP');

  // After the reset passes, syncing resumes.
  Date.now = () => realNow() + 41_000;
  try {
    const later = await call(handler, { days: 7 });
    eq(later.statusCode, 200, 'after the reset → syncs again');
    eq(whoopCalls(), 4, 'and reaches WHOOP');
  } finally { Date.now = realNow; }
}

{
  // A successful sync that reports the budget nearly spent backs off too.
  const handler = freshHandler();
  tokenRow = liveRow(120);
  whoopReply = () => ({ status: 200, body: { records: [] }, headers: { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': '30' } });
  const first = await call(handler, { days: 7 });
  eq(first.statusCode, 200, 'the sync that saw it keeps its data');
  calls.length = 0;
  const next = await call(handler, { days: 7 });
  eq(next.statusCode, 429, 'the next one waits for the reset');
  eq(whoopCalls(), 0, 'without asking WHOOP');
}

// ── 4. scopes ──────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../functions/whoop-connect.js', import.meta.url), 'utf8');
  const m = /const SCOPES = '([^']*)'/.exec(src);
  ok(m, 'SCOPES found');
  eq(m[1], 'offline read:recovery read:sleep read:workout read:cycles', 'read:profile dropped, the rest unchanged');
}

console.log(`whoopBudget: ${n} checks passed`);

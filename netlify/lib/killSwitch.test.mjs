/**
 * Kill switch (item 78): VANTAGE_PAUSE parsing, the 503 shape, and real
 * handlers answering 503 / returning early when their area is paused —
 * and working normally (and never-paused functions staying up) when not.
 * No network: fetch is faked and records every call.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KS = require('./killSwitch.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };
const set = s => [...s].sort();

// ── Parsing ──
eq(set(KS.parsePause('')), [], 'empty → nothing paused');
eq(set(KS.parsePause(undefined)), [], 'unset → nothing paused');
eq(set(KS.parsePause('ai')), ['ai'], 'one area');
eq(set(KS.parsePause(' AI , Sync ')), ['ai', 'sync'], 'case-insensitive, whitespace ok');
eq(set(KS.parsePause('all')), ['ai', 'push', 'social', 'sync'], 'all = every area');
eq(set(KS.parsePause('ALL,bogus')), ['ai', 'push', 'social', 'sync'], 'all with junk');
eq(set(KS.parsePause('bogus, moderation, delete-account,,')), [], 'unknown values ignored — nothing can pause moderation or deletion');
eq(set(KS.parsePause('push,push')), ['push'], 'duplicates harmless');
eq(KS.paused('social', { VANTAGE_PAUSE: 'social' }), true, 'paused()');
eq(KS.paused('ai', { VANTAGE_PAUSE: 'social' }), false, 'other areas untouched');
eq(KS.paused('ai', {}), false, 'no env var → running');

// ── Response shape ──
{
  const r = KS.pausedResponse('ai', { 'Access-Control-Allow-Origin': '*' });
  eq(r.statusCode, 503, '503');
  eq(r.headers['Retry-After'], '600', 'Retry-After 600');
  eq(r.headers['Cache-Control'], 'no-store', 'no-store');
  eq(r.headers['Access-Control-Allow-Origin'], '*', 'CORS kept so the browser can read it');
  eq(JSON.parse(r.body), { error: 'paused', area: 'ai', message: KS.MESSAGE }, 'body shape');
  eq(KS.pauseGate('ai', {}, { VANTAGE_PAUSE: '' }), null, 'gate open when not paused');
  eq(KS.pauseGate('ai', {}, { VANTAGE_PAUSE: 'ai' }).statusCode, 503, 'gate closed when paused');
}

// ── Handlers ──
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET' });
  return { ok: false, status: 401, json: async () => ({}), text: async () => '' };
};
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy.service.TEST';
process.env.VITE_SUPABASE_ANON_KEY = 'legacy.anon.TEST';
process.env.WHOOP_CLIENT_ID = 'id';
process.env.WHOOP_CLIENT_SECRET = 'secret';
const fn = name => require(`../functions/${name}.js`);
const post = (body = '{}') => ({ httpMethod: 'POST', headers: { authorization: 'Bearer user.jwt' }, body });

const HTTP = {
  ai: ['ai-food-detect', 'ai-coach-daily', 'recipe-from-video', 'destination-brief'],
  social: ['get-leaderboard', 'groups', 'prestige-up', 'avatar-check'],
  sync: ['whoop-sync', 'oura-sync', 'health-sync'],
};

for (const [area, names] of Object.entries(HTTP)) {
  for (const name of names) {
    process.env.VANTAGE_PAUSE = area;
    calls.length = 0;
    const method = name === 'destination-brief' ? 'GET' : 'POST';
    const r = await fn(name).handler({ ...post(), httpMethod: method });
    eq(r.statusCode, 503, `${name}: 503 when ${area} is paused`);
    eq(JSON.parse(r.body).error, 'paused', `${name}: paused body`);
    eq(calls.length, 0, `${name}: nothing upstream is touched while paused`);
    const pre = await fn(name).handler({ httpMethod: 'OPTIONS', headers: {} });
    eq(pre.statusCode, 204, `${name}: preflight still answered`);

    process.env.VANTAGE_PAUSE = 'push';
    const live = await fn(name).handler({ ...post(), httpMethod: method });
    ok(live.statusCode !== 503 || JSON.parse(live.body || '{}').error !== 'paused', `${name}: runs normally when ${area} is not paused`);
  }
}

// Scheduled functions return early without a fetch.
for (const [name, area] of [['whoop-cron', 'sync'], ['oura-cron', 'sync'], ['settle-leagues', 'social'], ['push-dispatch', 'push']]) {
  process.env.VANTAGE_PAUSE = area;
  calls.length = 0;
  const r = await fn(name).handler({ body: JSON.stringify({ next_run: '2026-10-20T06:00:00Z' }) });
  eq(r.statusCode, 200, `${name}: paused run ends cleanly`);
  eq(JSON.parse(r.body), { paused: true, area }, `${name}: says it was paused`);
  eq(calls.length, 0, `${name}: no database or upstream call`);
}
{
  process.env.VANTAGE_PAUSE = 'ai';
  calls.length = 0;
  await fn('whoop-cron').handler({ body: JSON.stringify({ next_run: 'x' }) });
  ok(calls.length > 0, 'whoop-cron runs when only ai is paused');
}

// OAuth callbacks redirect back with ?whoop=paused instead of a JSON page.
for (const [name, param] of [['whoop-callback', 'whoop'], ['oura-callback', 'oura']]) {
  process.env.VANTAGE_PAUSE = 'sync';
  const r = await fn(name).handler({ httpMethod: 'GET', headers: { host: 'x.test' }, queryStringParameters: { code: 'c', state: 's' } });
  eq(r.statusCode, 302, `${name}: redirects`);
  ok(String(r.headers.Location).includes(`${param}=paused`), `${name}: ?${param}=paused`);
}

// Never paused, even by `all`.
process.env.VANTAGE_PAUSE = 'all';
for (const name of ['health', 'delete-account', 'moderation', 'support-ticket', 'client-error', 'csp-report', 'security-console']) {
  const method = name === 'health' || name === 'security-console' ? 'GET' : 'POST';
  const r = await fn(name).handler({ ...post(), httpMethod: method, headers: { authorization: 'Bearer user.jwt', 'x-nf-client-connection-ip': '9.9.9.9' } });
  const body = (() => { try { return JSON.parse(r.body || '{}'); } catch { return {}; } })();
  ok(body.error !== 'paused', `${name}: never paused`);
}
delete process.env.VANTAGE_PAUSE;

console.log(`check:killswitch — ${n} checks passed`);

/**
 * opsMark (items 27/82): the request shape (service headers via sbKeys,
 * the rpc path, clamped fields) and that it NEVER throws — unconfigured,
 * SQL not applied (404), network error, timeout, bad JSON all resolve to
 * null. No network: fetch is faked.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { opsMark, buildRequest } = require('./opsMark.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const NEW = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const LEGACY = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.key' };

// Silence the one-line warnings while testing failure paths.
const warned = [];
console.warn = (...a) => warned.push(a.join(' '));

// ── Request shape ──
{
  const r = buildRequest('migration', 'phase 3 — start', { batch: 2 }, NEW);
  eq(r.url, 'https://example.supabase.co/rest/v1/rpc/ops_mark', 'rpc path, trailing slash trimmed');
  eq(r.init.method, 'POST', 'POST');
  eq(r.init.headers.apikey, 'sb_secret_test', 'service key on apikey (via sbKeys)');
  ok(!('Authorization' in r.init.headers), 'a new sb_secret key is NOT sent as Bearer');
  eq(r.init.headers['Content-Type'], 'application/json', 'json body');
  eq(JSON.parse(r.init.body), { kind: 'migration', label: 'phase 3 — start', details: { batch: 2 } }, 'named args for PostgREST');

  const l = buildRequest('sql', 'x', {}, LEGACY);
  eq(l.init.headers.Authorization, 'Bearer legacy.jwt.key', 'a legacy JWT key keeps apikey + Bearer, as sbKeys does everywhere');

  const long = JSON.parse(buildRequest('k'.repeat(100), 'l'.repeat(1000), ['not', 'an', 'object'], NEW).init.body);
  eq(long.kind.length, 40, 'kind clamped to 40');
  eq(long.label.length, 300, 'label clamped to 300');
  eq(long.details, {}, 'non-object details become {}');

  eq(buildRequest('a', 'b', {}, { SUPABASE_URL: 'https://x.supabase.co' }), null, 'no service key → no request');
  eq(buildRequest('a', 'b', {}, { SUPABASE_SECRET_KEY: 'sb_secret_x' }), null, 'no URL → no request');
}

// ── Happy path ──
{
  const seen = [];
  const at = await opsMark('retention', 'retention run', { rows: 12 }, {
    env: NEW, actor: 'netlify:retention',
    fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => '2026-10-20T21:00:00+00:00' }; },
  });
  eq(at, '2026-10-20T21:00:00+00:00', 'returns the mark time');
  eq(seen.length, 1, 'one call');
  eq(JSON.parse(seen[0].init.body).details, { rows: 12, actor: 'netlify:retention' }, 'actor travels in details (ops_mark moves it to the actor column)');
  ok(seen[0].init.signal, 'request carries an abort signal (timeout)');
}

// ── Fail soft: every failure resolves to null, never throws ──
{
  const cases = [
    ['unconfigured', { env: {}, fetchImpl: async () => { throw new Error('must not be called'); } }],
    ['SQL not applied (404)', { env: NEW, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'secret detail' }) }) }],
    ['server error (500)', { env: NEW, fetchImpl: async () => ({ ok: false, status: 500 }) }],
    ['network error', { env: NEW, fetchImpl: async () => { throw new TypeError('fetch failed'); } }],
    ['bad JSON', { env: NEW, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) }],
    ['non-string body', { env: NEW, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ at: 1 }) }) }],
    ['null response', { env: NEW, fetchImpl: async () => null }],
    ['no fetch available', { env: NEW, fetchImpl: 'not a function' }],
    ['timeout', { env: NEW, timeoutMs: 20, fetchImpl: (url, init) => new Promise((_, rej) => {
      init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    }) }],
  ];
  for (const [what, opts] of cases) {
    let threw = false, out;
    try { out = await opsMark('x', 'y', {}, opts); } catch { threw = true; }
    ok(!threw, `${what}: does not throw`);
    eq(out, null, `${what}: resolves to null`);
  }
  ok(warned.some(w => w.includes('timeout')), 'a timeout is logged as such');
  ok(warned.every(w => !w.includes('sb_secret_test') && !w.includes('example.supabase.co') && !w.includes('secret detail')),
     'warnings never contain the key, the URL or a response body');
}

console.log(`opsMark: ${n} checks passed`);

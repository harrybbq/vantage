/**
 * The rate-limited v2 entries in netlify/functions/*.mjs (STARTUP_
 * REQUIREMENTS item 86).
 *
 * For every converted function:
 *   · `config.rateLimit` has the intended values, and is written as a
 *     LITERAL in the source — Netlify reads it statically, and a
 *     non-literal rateLimit is dropped without a build error
 *     (zip-it-and-ship-it in_source_config: `rateLimit.optional().catch(undefined)`);
 *   · no `path` (it would take the function off /.netlify/functions/<name>);
 *   · the old `.js` is gone (a name collision), the handler lives in lib/handlers;
 *   · OPTIONS and an unauthenticated request through the adapter answer
 *     exactly what the v1 handler answers — status, every header, body —
 *     and the expected status (204 / 401) holds.
 * And for the functions that must never be IP-limited (webhooks, crons,
 * the Apple Health shortcut, OAuth callbacks, telemetry), that they are
 * still plain v1 with no rateLimit anywhere.
 *
 * No network: fetch is stubbed, and the unauthenticated paths must not
 * call it at all. Every value here is invented test data.
 *
 * Run: npm run check:ratelimit   (also part of npm run build)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FN_DIR = join(here, '..', 'functions');
const require = createRequire(import.meta.url);

let n = 0;
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };
const deq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── Environment (invented) ─────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://example-project.supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
delete process.env.VANTAGE_PAUSE;

const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).startsWith('https://api.open-meteo.com/')) {
    return new Response(JSON.stringify({ current: { temperature_2m: 11.4, weather_code: 3, is_day: 1 } }), { status: 200 });
  }
  throw new Error(`unexpected network call in test: ${url}`);
};

// ── What was converted, and to what ────────────────────────────────────
// limit = windowLimit per 60 s per IP; method = the one the client uses.
const AI = 20;
const GENERAL = 300;
const CONVERTED = {
  'ai-food-detect':    { limit: AI,      method: 'POST' },
  'ai-coach-daily':    { limit: AI,      method: 'POST' },
  'recipe-from-video': { limit: AI,      method: 'POST' },
  'avatar-check':      { limit: AI,      method: 'POST' },
  'support-ticket':    { limit: AI,      method: 'POST' },
  'food-search':       { limit: GENERAL, method: 'GET' },
  'shop-autofill':     { limit: GENERAL, method: 'POST' },
  'shop-price-check':  { limit: GENERAL, method: 'POST' },
  'destination-brief': { limit: GENERAL, method: 'GET' },
  'market-quotes':     { limit: GENERAL, method: 'GET' },
  'news-today':        { limit: GENERAL, method: 'GET' },
  'weather':           { limit: GENERAL, method: 'GET', anonymousOk: true },
  'get-leaderboard':   { limit: GENERAL, method: 'POST' },
};

// Never limited by IP: a shared sender (RevenueCat, Netlify's scheduler,
// an Apple Health shortcut, an OAuth redirect) or telemetry that must
// keep flowing during an incident. They stay v1 and unlimited.
const NEVER = [
  'revenuecat-webhook', 'push-dispatch', 'snapshot-ratings', 'whoop-cron', 'oura-cron',
  'settle-leagues', 'security-sweep', 'retention-prune', 'health-sync',
  'whoop-callback', 'oura-callback', 'csp-report', 'client-error', 'vitals-beacon',
  'delete-account', 'apple-token',
];

const BASE = 'https://deploy-preview-1--example.netlify.app';
const ORIGIN = 'capacitor://localhost';

/** Same request as a v1 event, built independently of the adapter. */
function v1Event(name, method, { headers = {}, body = null, query = {} } = {}) {
  const qs = new URLSearchParams(query).toString();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    path: `/.netlify/functions/${name}`,
    httpMethod: method,
    headers: lower,
    multiValueHeaders: Object.fromEntries(Object.entries(lower).map(([k, v]) => [k, [v]])),
    queryStringParameters: { ...query },
    multiValueQueryStringParameters: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, [v]])),
    body,
    isBase64Encoded: !lower['content-type'],
    rawUrl: `${BASE}/.netlify/functions/${name}${qs ? `?${qs}` : ''}`,
    rawQuery: qs,
  };
}
function v2Request(name, method, { headers = {}, body = null, query = {} } = {}) {
  const qs = new URLSearchParams(query).toString();
  return new Request(`${BASE}/.netlify/functions/${name}${qs ? `?${qs}` : ''}`, { method, headers, body });
}

/** The v1 result as a client would see it: status, lower-cased headers, body text. */
function seenV1(r) {
  const headers = {};
  for (const [k, v] of Object.entries(r.headers || {})) headers[k.toLowerCase()] = String(v);
  const nullBody = [204, 205, 304].includes(r.statusCode);
  return { status: r.statusCode, headers, body: nullBody ? '' : (r.body ?? '') };
}
async function seenV2(res) {
  const headers = {};
  for (const [k, v] of res.headers) headers[k] = v;
  return { status: res.status, headers, body: await res.text() };
}

// ── Static checks on the entry sources ─────────────────────────────────
{
  const mjs = readdirSync(FN_DIR).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)).sort();
  deq(mjs, Object.keys(CONVERTED).sort(), 'the .mjs entries are exactly the converted set');

  for (const [name, want] of Object.entries(CONVERTED)) {
    eq(existsSync(join(FN_DIR, `${name}.js`)), false, `${name}: old .js removed (no name collision with the .mjs)`);
    ok(existsSync(join(here, 'handlers', `${name}.js`)), `${name}: v1 handler kept in lib/handlers`);

    const src = readFileSync(join(FN_DIR, `${name}.mjs`), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const literal = new RegExp(
      'export const config = \\{\\s*rateLimit: \\{\\s*windowLimit: (\\d+),\\s*windowSize: (\\d+),\\s*'
      + "aggregateBy: \\['ip', 'domain'\\],\\s*\\},\\s*\\};");
    const m = code.match(literal);
    ok(m, `${name}: config.rateLimit is a plain literal Netlify can read statically`);
    eq(Number(m[1]), want.limit, `${name}: literal windowLimit ${want.limit}`);
    eq(Number(m[2]), 60, `${name}: literal windowSize 60`);
    ok(!/\bpath\s*:/.test(code), `${name}: no custom path (keeps /.netlify/functions/${name})`);
    ok(!/\bexports\.handler\b|export (const|function|async function) handler\b/.test(code), `${name}: no handler export (that would make it v1 and drop the limit)`);
    ok(/^export default adapt\(v1\.handler\);$/m.test(code), `${name}: default export is the adapter`);
    ok(code.includes(`from '../lib/handlers/${name}.js'`), `${name}: wraps its own handler`);
  }

  for (const name of NEVER) {
    eq(existsSync(join(FN_DIR, `${name}.mjs`)), false, `${name}: not converted`);
    const p = join(FN_DIR, `${name}.js`);
    ok(existsSync(p), `${name}: still a v1 function`);
    const code = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ok(!/\brateLimit\s*:/.test(code) && !/export (const|default)/.test(code), `${name}: no rateLimit config, no ESM default export`);
  }

  // Every scheduled function in netlify.toml stays unlimited.
  const toml = readFileSync(join(here, '..', '..', 'netlify.toml'), 'utf8');
  const scheduled = [...toml.matchAll(/\[functions\."([^"]+)"\]\s*\n\s*schedule\s*=/g)].map(x => x[1]);
  ok(scheduled.length >= 7, 'found the scheduled functions in netlify.toml');
  for (const name of scheduled) {
    ok(NEVER.includes(name) && !(name in CONVERTED), `${name}: scheduled → never IP-limited`);
  }
}

// ── Load each v2 module, check config, drive requests through it ──────
for (const [name, want] of Object.entries(CONVERTED)) {
  const mod = await import(pathToFileURL(join(FN_DIR, `${name}.mjs`)).href);
  deq(mod.config, { rateLimit: { windowLimit: want.limit, windowSize: 60, aggregateBy: ['ip', 'domain'] } },
    `${name}: exported config`);
  eq(typeof mod.default, 'function', `${name}: default export is a function (v2)`);
  eq(mod.handler, undefined, `${name}: no named handler export`);

  const v1 = require(`./handlers/${name}.js`);

  // OPTIONS preflight — what a browser / the native shell sends first.
  const preHeaders = { Origin: ORIGIN, 'Access-Control-Request-Method': want.method, 'X-NF-Client-Connection-IP': '203.0.113.50' };
  const before = seenV1(await v1.handler(v1Event(name, 'OPTIONS', { headers: preHeaders }), {}));
  const after = await seenV2(await mod.default(v2Request(name, 'OPTIONS', { headers: preHeaders }), { ip: '203.0.113.50' }));
  deq(after, before, `${name}: OPTIONS identical through the adapter`);
  ok(after.status === 204 || after.status === 200, `${name}: OPTIONS answers ${after.status}`);
  ok(after.headers['access-control-allow-origin'], `${name}: preflight carries CORS`);

  // Unauthenticated real call, the way the client sends it minus the token.
  const isPost = want.method === 'POST';
  const reqOpts = {
    headers: { Origin: ORIGIN, 'X-NF-Client-Connection-IP': '203.0.113.51', ...(isPost ? { 'Content-Type': 'application/json' } : {}) },
    body: isPost ? '{}' : null,
    query: name === 'food-search' ? { mode: 'name', q: 'oats' } : {},
  };
  const callsBefore = fetchCalls.length;
  const b = seenV1(await v1.handler(v1Event(name, want.method, reqOpts), {}));
  const a = await seenV2(await mod.default(v2Request(name, want.method, reqOpts), { ip: '203.0.113.51' }));
  deq(a, b, `${name}: unauthenticated ${want.method} identical through the adapter`);
  if (want.anonymousOk) {
    eq(a.status, 200, `${name}: anonymous call allowed (status 200)`);
  } else {
    eq(a.status, 401, `${name}: unauthenticated → 401`);
  }
  eq(fetchCalls.length, callsBefore, `${name}: no network call on the unauthenticated path`);
}

// ── weather: the geo header still reaches the handler ─────────────────
{
  const mod = await import(pathToFileURL(join(FN_DIR, 'weather.mjs')).href);
  const geo = Buffer.from(JSON.stringify({ city: 'Leeds', country: { code: 'GB' }, latitude: 53.8, longitude: -1.55 })).toString('base64');
  const res = await mod.default(v2Request('weather', 'GET', { headers: { 'x-nf-geo': geo, 'x-nf-client-connection-ip': '203.0.113.60' } }), {});
  const body = await res.json();
  eq(res.status, 200, 'weather: 200 with an x-nf-geo header');
  eq(body.tempC, 11, 'weather: geo from the header → Open-Meteo answer');
  ok(fetchCalls.some(u => u.includes('latitude=53.8') && u.includes('longitude=-1.6')), 'weather: coarse lat/lon from x-nf-geo used');

  // Header absent, Netlify context.geo present → the adapter's fallback.
  const res2 = await mod.default(v2Request('weather', 'GET', { headers: { 'x-nf-client-connection-ip': '203.0.113.61' } }),
    { geo: { city: 'Hull', country: { code: 'GB' }, latitude: 53.7, longitude: -0.3 } });
  const body2 = await res2.json();
  eq(body2.tempC, 11, 'weather: context.geo fallback reaches the handler');
}

console.log(`check:ratelimit (entries) — ${n} checks passed`);

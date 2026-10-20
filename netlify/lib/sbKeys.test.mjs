/**
 * Supabase keys (item 85): the helper, a source scan that keeps every
 * function on it, and a smoke run of real handlers with a fake fetch
 * that records the headers each one sends — once with the new
 * SUPABASE_SECRET_KEY set and once with only the legacy keys.
 *
 * No network. Never prints a key (the fake values are not secrets).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const K = require('./sbKeys.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── The helper ──────────────────────────────────────────────────────
{
  const both = { SUPABASE_SECRET_KEY: 'sb_secret_new', SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.service' };
  eq(K.serviceKey(both), 'sb_secret_new', 'secret key preferred when set');
  eq(K.serviceKey({ SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.service' }), 'legacy.jwt.service', 'legacy fallback');
  eq(K.serviceKey({ SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'legacy.jwt.service' }), 'legacy.jwt.service', 'an empty secret var does not win');
  eq(K.serviceKey({}), '', 'nothing set → empty (callers 500 "not configured")');

  eq(K.publicKey({ SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SUPABASE_ANON_KEY: 'anon', VITE_SUPABASE_ANON_KEY: 'vanon' }), 'sb_publishable_x', 'publishable preferred');
  eq(K.publicKey({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_v', SUPABASE_ANON_KEY: 'anon' }), 'sb_publishable_v', 'client publishable var also counts');
  eq(K.publicKey({ SUPABASE_ANON_KEY: 'anon', VITE_SUPABASE_ANON_KEY: 'vanon' }), 'anon', 'anon fallback');
  eq(K.publicKey({ VITE_SUPABASE_ANON_KEY: 'vanon' }), 'vanon', 'VITE anon fallback');
  eq(K.publicKey({}), '', 'nothing set → empty');

  const h = K.serviceHeaders(both, { Prefer: 'return=minimal' });
  eq(h, { Prefer: 'return=minimal', apikey: 'sb_secret_new' }, 'service headers: apikey + extras');
  ok(!('Authorization' in h), 'service headers carry NO Authorization');
  ok(!('Authorization' in K.serviceHeaders({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })), 'no Authorization with the legacy key either');
  ok(!('Authorization' in K.serviceKeyHeaders('k', { Authorization: 'Bearer k' })), 'the key cannot be smuggled back onto Authorization');
  eq(K.serviceKeyHeaders('k', { 'Content-Type': 'application/json' }), { 'Content-Type': 'application/json', apikey: 'k' }, 'serviceKeyHeaders keeps extras');

  const u = K.userHeaders({ SUPABASE_PUBLISHABLE_KEY: 'pub', SUPABASE_SECRET_KEY: 'sec' }, 'user.jwt.here', { Accept: 'x' });
  eq(u, { Accept: 'x', apikey: 'pub', Authorization: 'Bearer user.jwt.here' }, 'user headers: public apikey + the user JWT');
  eq(K.userHeaders({ SUPABASE_SERVICE_ROLE_KEY: 'svc' }, 'j').apikey, 'svc', 'no public key configured → service key, as requireUser always did');
  eq(K.userApiKey({ SUPABASE_ANON_KEY: 'anon', SUPABASE_SECRET_KEY: 'sec' }), 'anon', 'public key wins over the service key for user calls');
}

// ── Source scan: nothing under netlify/ reads the keys directly ─────
{
  const roots = [join(here, '..', 'lib'), join(here, '..', 'functions')];
  const files = roots.flatMap(d => readdirSync(d).filter(f => f.endsWith('.js')).map(f => join(d, f)));
  // A Bearer built from something that is (or may be) a Supabase project key.
  const KEYISH = /Bearer \$\{\s*([\w.]*(?:serviceKey|SERVICE_ROLE|SECRET_KEY|ANON|PUBLISHABLE|apikey)[\w.]*|key|e\.key|env\.key)\s*\}/i;
  const offenders = [];
  for (const f of files) {
    if (f.endsWith('sbKeys.js')) continue;
    const src = readFileSync(f, 'utf8');
    const name = f.slice(f.indexOf('netlify'));
    if (src.includes('SUPABASE_SERVICE_ROLE_KEY')) offenders.push(`${name}: names SUPABASE_SERVICE_ROLE_KEY`);
    if (/SUPABASE_SECRET_KEY|SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY/.test(src.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '').replace(/'[^'\n]*'/g, "''"))) {
      offenders.push(`${name}: reads a Supabase key env var outside sbKeys.js`);
    }
    const m = src.match(KEYISH);
    if (m) offenders.push(`${name}: builds "Bearer \${${m[1]}}"`);
    // Same variable on apikey and on Bearer = the legacy double-send.
    for (const am of src.matchAll(/apikey:\s*([\w.]+)/g)) {
      const v = am[1].replace(/\./g, '\\.');
      if (new RegExp(`Bearer \\$\\{\\s*${v}\\s*\\}`).test(src)) offenders.push(`${name}: sends ${am[1]} as apikey AND Bearer`);
    }
  }
  eq(offenders, [], 'every function and lib goes through lib/sbKeys.js');
  ok(files.length > 40, 'the scan actually saw the functions');
}

// ── Smoke: real handlers, fake fetch, both key setups ───────────────
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', headers: { ...(init.headers || {}) } });
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    return { ok: true, status: 200, json: async () => ({ id: '00000000-0000-0000-0000-000000000001', email: 'owner@example.com' }) };
  }
  return { ok: true, status: 200, json: async () => [], text: async () => '', headers: new Map() };
};

const KEY_ENV = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];

function fresh(rel) {
  const p = require.resolve(rel);
  delete require.cache[p];
  return require(p);
}

async function scenario(label, keys, expect) {
  for (const k of KEY_ENV) delete process.env[k];
  Object.assign(process.env, keys);
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.OWNER_EMAIL = 'owner@example.com';

  // health: one service read
  calls.length = 0;
  const health = fresh('../functions/health.js');
  const hr = await health.handler({ httpMethod: 'GET', headers: { 'x-nf-client-connection-ip': `1.1.1.${n % 250}` } });
  eq(hr.statusCode, 200, `${label}: health answers`);
  const hc = calls.find(c => c.url.includes('/rest/v1/config'));
  eq(hc.headers.apikey, expect.service, `${label}: health sends the service key on apikey`);
  ok(!('Authorization' in hc.headers), `${label}: health sends no Authorization`);

  // wearable-disconnect: verify the user, then a service delete
  calls.length = 0;
  const wd = fresh('../functions/wearable-disconnect.js');
  const wr = await wd.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user.jwt.abc' }, body: '{"provider":"whoop"}' });
  eq(wr.statusCode, 200, `${label}: disconnect answers`);
  const who = calls.find(c => c.url.endsWith('/auth/v1/user'));
  eq(who.headers.Authorization, 'Bearer user.jwt.abc', `${label}: the user JWT is kept on the session check`);
  eq(who.headers.apikey, expect.user, `${label}: session check uses the public key`);
  const del = calls.find(c => c.method === 'DELETE');
  eq(del.headers.apikey, expect.service, `${label}: delete runs with the service key`);
  ok(!('Authorization' in del.headers), `${label}: delete sends no Authorization`);

  // admin-set-rating: owner check as the user, PATCH as service
  calls.length = 0;
  const asr = fresh('../functions/admin-set-rating.js');
  const ar = await asr.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user.jwt.abc' }, body: '{"ovr":50,"prestige":0}' });
  eq(ar.statusCode, 200, `${label}: admin-set-rating answers`);
  const patch = calls.find(c => c.method === 'PATCH');
  eq(patch.headers.apikey, expect.service, `${label}: PATCH carries the service key`);
  ok(!('Authorization' in patch.headers), `${label}: PATCH sends no Authorization`);

  // requireUser (every AI / social endpoint)
  calls.length = 0;
  const { requireUser } = fresh('./requireUser.js');
  const ru = await requireUser({ headers: { authorization: 'Bearer user.jwt.abc' } }, {});
  ok(ru.userId, `${label}: requireUser verifies`);
  eq(calls[0].headers, { apikey: expect.user, Authorization: 'Bearer user.jwt.abc' }, `${label}: requireUser headers`);

  // a lib: whoop's token read goes through serviceHeaders(env)
  calls.length = 0;
  const whoop = fresh('./whoop.js');
  await whoop.getFreshToken?.('00000000-0000-0000-0000-000000000001', process.env).catch(() => null);
  const tok = calls.find(c => c.url.includes('whoop_tokens'));
  if (tok) {
    eq(tok.headers.apikey, expect.service, `${label}: whoop lib uses the service key`);
    ok(!('Authorization' in tok.headers), `${label}: whoop lib sends no Authorization`);
  }

  // not configured stays a 500
  for (const k of KEY_ENV) delete process.env[k];
  const none = await fresh('../functions/wearable-disconnect.js').handler({ httpMethod: 'POST', headers: {}, body: '{}' });
  eq(none.statusCode, 500, `${label}: no key at all → 500 not configured`);
}

await scenario('new keys', {
  SUPABASE_SECRET_KEY: 'sb_secret_TEST', SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.TEST',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_TEST', VITE_SUPABASE_ANON_KEY: 'legacy.anon.TEST',
}, { service: 'sb_secret_TEST', user: 'sb_publishable_TEST' });

await scenario('legacy only', {
  SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.TEST', VITE_SUPABASE_ANON_KEY: 'legacy.anon.TEST',
}, { service: 'legacy.service.TEST', user: 'legacy.anon.TEST' });

await scenario('legacy, no public key for functions', {
  SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.TEST',
}, { service: 'legacy.service.TEST', user: 'legacy.service.TEST' });

console.log(`check:sbkeys — ${n} checks passed`);

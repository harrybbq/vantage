/**
 * Item 117: Sign in with Apple token capture + revocation on deletion.
 * lib/appleRevoke.js (pure parts), the apple-token function and the
 * delete-account function with fetch faked. No network; every
 * SUPABASE_*, REVENUECAT_*, APPLE_* and REVIEW_* variable is cleared and
 * the Apple key is generated here.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

function clearEnv() {
  for (const k of Object.keys(process.env)) {
    if (/^(SUPABASE_|VITE_SUPABASE_|REVENUECAT_|APPLE_|REVIEW_)/.test(k)) delete process.env[k];
  }
}
clearEnv();

const require = createRequire(import.meta.url);
const AR = require('./appleRevoke.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const NOW = Date.parse('2026-10-20T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

// ── Which sign-in was it ──
const ident = (provider, at) => ({ provider, last_sign_in_at: at == null ? null : iso(at) });
eq(AR.latestIdentity({ identities: [] }), null, 'no identities');
eq(AR.latestIdentity({ identities: [ident('google', NOW - 5000), ident('apple', NOW - 1000)] }).provider, 'apple', 'newest wins');
eq(AR.appleSignInIsFresh({ identities: [ident('apple', NOW - 60_000)] }, NOW), true, 'apple a minute ago');
eq(AR.appleSignInIsFresh({ identities: [ident('apple', NOW - 11 * 60_000)] }, NOW), false, 'apple too long ago');
eq(AR.appleSignInIsFresh({ identities: [ident('apple', NOW - 60_000), ident('google', NOW - 1000)] }, NOW), false, 'a later Google sign-in never stores as Apple');
eq(AR.appleSignInIsFresh({ identities: [ident('email', NOW - 1000)] }, NOW), false, 'password sign-in');
eq(AR.appleSignInIsFresh({ identities: [ident('apple', null)] }, NOW), false, 'no stamp');
eq(AR.appleSignInIsFresh({ identities: [ident('apple', NOW + 10 * 60_000)] }, NOW), false, 'stamp from the future');
eq(AR.appleSignInIsFresh(null, NOW), false, 'no user');

// ── Token shape ──
eq(AR.cleanToken('  r1234567890abcdef.0.nzrq.AbC-_~+/=  '), 'r1234567890abcdef.0.nzrq.AbC-_~+/=', 'trimmed, allowed chars');
eq(AR.cleanToken('short'), null, 'too short');
eq(AR.cleanToken('x'.repeat(2049)), null, 'too long');
eq(AR.cleanToken('has spaces in the middle'), null, 'spaces');
eq(AR.cleanToken('<script>alert(1)</script>xx'), null, 'markup');
eq(AR.cleanToken(42), null, 'not a string');

// ── Seal / open ──
const TOKEN = 'r0123456789abcdef0123.0.abcd.EFGH';
eq(AR.sealToken(TOKEN, ''), { token: TOKEN, enc: 'none' }, 'no secret → stored as is');
{
  const s = AR.sealToken(TOKEN, 'test-secret');
  eq(s.enc, 'aes-256-gcm-v1', 'encrypted');
  ok(!s.token.includes(TOKEN), 'ciphertext does not contain the token');
  eq(AR.openToken(s, 'test-secret'), TOKEN, 'round trip');
  eq(AR.openToken(s, 'other-secret'), null, 'wrong secret → null, no throw');
  eq(AR.openToken(s, ''), null, 'secret removed → null');
  eq(AR.openToken({ token: 'junk', enc: 'aes-256-gcm-v1' }, 'test-secret'), null, 'junk ciphertext');
  ok(AR.sealToken(TOKEN, 'test-secret').token !== s.token, 'fresh IV per seal');
}
eq(AR.openToken({ token: TOKEN, enc: 'none' }, 'any'), TOKEN, 'plain row opens with or without secret');
eq(AR.openToken(null, 'x'), null, 'no row');

// ── Config ──
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
eq(AR.appleConfig({}).missing, ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_SERVICES_ID'], 'names what is missing');
eq(AR.appleConfig({ APPLE_TEAM_ID: 'T', APPLE_KEY_ID: 'K', APPLE_PRIVATE_KEY: PEM }, 'bundle').clientId, 'com.vantage.app', 'bundle kind defaults to the app id');
const envPem = PEM.trim().replace(/\n/g, '\\n');
eq(AR.normalisePem(envPem), PEM.trim(), 'escaped newlines from a Netlify env value');
{
  const body = PEM.split('\n').filter(l => l && !l.startsWith('-----')).join('');
  ok(crypto.createPrivateKey(AR.normalisePem(body)), 'bare base64 body is wrapped');
}

// ── Client secret JWT ──
{
  const cfg = AR.appleConfig({ APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: envPem, APPLE_SERVICES_ID: 'com.example.web' });
  const jwt = AR.buildClientSecret(cfg, 1_800_000_000);
  const [h, c, s] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
  eq(dec(h), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' }, 'header');
  eq(dec(c), { iss: 'TEAM123456', iat: 1_800_000_000, exp: 1_800_000_300, aud: 'https://appleid.apple.com', sub: 'com.example.web' }, 'claims');
  const sig = Buffer.from(s, 'base64url');
  eq(sig.length, 64, 'raw r||s signature (ieee-p1363), not DER');
  ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig), 'signature verifies with the public key');
  ok(!/[+/=]/.test(jwt), 'base64url, no padding');
}

// ── Revoke call ──
const APPLE_ENV = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: envPem, APPLE_SERVICES_ID: 'com.example.web' };
{
  const seen = [];
  const fake = async (url, init) => { seen.push({ url, init }); return new Response('', { status: 200 }); };
  const r = await AR.revokeStoredToken({ token: TOKEN, enc: 'none', client_kind: 'services' }, APPLE_ENV, fake);
  eq(r, { ok: true, status: 200 }, 'revoked');
  eq(seen[0].url, 'https://appleid.apple.com/auth/revoke', 'Apple revoke endpoint');
  eq(seen[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded', 'form encoded');
  const form = new URLSearchParams(seen[0].init.body);
  eq([form.get('client_id'), form.get('token'), form.get('token_type_hint')], ['com.example.web', TOKEN, 'refresh_token'], 'form fields');
  ok(form.get('client_secret').split('.').length === 3, 'client secret is a JWT');
}
{
  let called = 0;
  const fake = async () => { called++; return new Response('', { status: 200 }); };
  eq((await AR.revokeStoredToken({ token: TOKEN, enc: 'none' }, {}, fake)).reason, 'not_configured', 'no env → not configured');
  eq(called, 0, '… and Apple is not called');
  eq((await AR.revokeStoredToken({ token: 'x', enc: 'aes-256-gcm-v1' }, APPLE_ENV, fake)).reason, 'token_unreadable', 'undecryptable');
  eq((await AR.revokeStoredToken({ token: TOKEN, enc: 'none' }, { ...APPLE_ENV, APPLE_PRIVATE_KEY: 'not a key' }, fake)).reason, 'bad_private_key', 'bad key');
  eq((await AR.revokeStoredToken({ token: TOKEN, enc: 'none' }, APPLE_ENV, async () => new Response('', { status: 400 }))).reason, 'apple_refused', 'Apple 400');
  eq((await AR.revokeStoredToken({ token: TOKEN, enc: 'none' }, APPLE_ENV, async () => { throw new Error('down'); })).reason, 'unreachable', 'network error → no throw');
}

// ── Handlers, fetch faked ──
let user = { id: '00000000-0000-4000-8000-0000000000aa', email: 'a@example.test', identities: [] };
let tableStatus = 201;
let storedRow = null;
let appleCalls = 0;
let authDeleteStatus = 200;
const log = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || 'GET';
  log.push(`${method} ${u.replace(/^https:\/\/example\.invalid/, '')}`);
  if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify(user), { status: 200 });
  if (u.includes('/rest/v1/apple_tokens') && method === 'POST') {
    if (tableStatus < 300) storedRow = JSON.parse(init.body);
    return new Response('', { status: tableStatus });
  }
  if (u.includes('/rest/v1/apple_tokens') && method === 'GET') {
    if (tableStatus === 404) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(storedRow ? [{ token: storedRow.token, enc: storedRow.enc, client_kind: storedRow.client_kind }] : []), { status: 200 });
  }
  if (u.startsWith('https://appleid.apple.com/')) { appleCalls++; return new Response('', { status: 200 }); }
  if (u.includes('/auth/v1/admin/users/')) return new Response('', { status: authDeleteStatus });
  if (u.includes('/rest/v1/groups')) return new Response('[]', { status: 200 });
  if (u.includes('/rest/v1/tracker_streaks')) return new Response('', { status: 204 });
  if (u.includes('/storage/v1/object/list/')) return new Response('[]', { status: 200 });
  if (u.includes('/rest/v1/function_cache')) return new Response('', { status: 204 });
  return new Response('not faked', { status: 599 });
};
function baseEnv(extra = {}) {
  clearEnv();
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  Object.assign(process.env, extra);
}
const capture = require('../functions/apple-token.js').handler;
const del = require('../functions/delete-account.js').handler;
const post = (h, body) => h({ httpMethod: 'POST', headers: { authorization: 'Bearer test-jwt' }, body: JSON.stringify(body) });

baseEnv();
{
  user.identities = [ident('google', Date.now() - 1000)];
  const r = await post(capture, { refresh_token: TOKEN });
  eq([r.statusCode, JSON.parse(r.body).stored, JSON.parse(r.body).reason], [200, false, 'not_apple_sign_in'], 'Google sign-in: not stored');
  eq(storedRow, null, 'nothing written');
}
{
  user.identities = [ident('apple', Date.now() - 1000)];
  const r = await post(capture, { refresh_token: 'nope' });
  eq(r.statusCode, 400, 'bad token → 400');
}
{
  tableStatus = 404;
  const r = await post(capture, { refresh_token: TOKEN });
  eq([r.statusCode, JSON.parse(r.body).reason], [200, 'not_installed'], 'SQL not run → fail soft');
  tableStatus = 201;
}
{
  const r = await post(capture, { refresh_token: TOKEN });
  eq([r.statusCode, JSON.parse(r.body).stored], [200, true], 'Apple sign-in stored');
  eq([storedRow.user_id, storedRow.enc, storedRow.client_kind, storedRow.token], [user.id, 'none', 'services', TOKEN], 'row for the caller, plain without a secret');
  ok(!r.body.includes(TOKEN), 'token never echoed');
}
{
  baseEnv({ APPLE_TOKEN_SECRET: 'test-secret' });
  storedRow = null;
  await post(capture, { refresh_token: TOKEN });
  eq(storedRow.enc, 'aes-256-gcm-v1', 'encrypted with APPLE_TOKEN_SECRET');
  eq(AR.openToken(storedRow, 'test-secret'), TOKEN, 'decryptable server-side');
}
{
  const r = await capture({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ refresh_token: TOKEN }) });
  eq(r.statusCode, 401, 'no session → 401');
}

// delete-account: revoke after a successful delete; never blocks it.
{
  baseEnv({ ...APPLE_ENV, APPLE_TOKEN_SECRET: 'test-secret' });
  log.length = 0; appleCalls = 0;
  const r = await post(del, { confirm: 'DELETE' });
  eq([r.statusCode, JSON.parse(r.body).ok], [200, true], 'deleted');
  eq(appleCalls, 1, 'Apple revoke called once');
  const iRead = log.findIndex(l => l.startsWith('GET /rest/v1/apple_tokens'));
  const iDel = log.findIndex(l => l.startsWith('DELETE /auth/v1/admin/users/'));
  const iApple = log.findIndex(l => l.includes('appleid.apple.com'));
  ok(iRead >= 0 && iRead < iDel && iDel < iApple, 'read before the auth delete, revoke after it');
}
{
  baseEnv();   // no Apple env at all
  appleCalls = 0;
  const r = await post(del, { confirm: 'DELETE' });
  eq([r.statusCode, JSON.parse(r.body).ok, appleCalls], [200, true, 0], 'Apple env missing: deletion still succeeds, no Apple call');
}
{
  baseEnv(APPLE_ENV);
  tableStatus = 404; appleCalls = 0;
  const r = await post(del, { confirm: 'DELETE' });
  eq([r.statusCode, appleCalls], [200, 0], 'table missing: deletion still succeeds');
  tableStatus = 201;
}
{
  baseEnv(APPLE_ENV);
  authDeleteStatus = 500; appleCalls = 0;
  const r = await post(del, { confirm: 'DELETE' });
  eq([r.statusCode, appleCalls], [502, 0], 'auth delete failed: nothing revoked');
  authDeleteStatus = 200;
}
{
  baseEnv({ ...APPLE_ENV, APPLE_TOKEN_SECRET: 'test-secret' });
  const origFetch = globalThis.fetch;
  let tried = 0;
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://appleid.apple.com/') ? (tried++, Promise.reject(new Error('down'))) : origFetch(url, init));
  const r = await post(del, { confirm: 'DELETE' });
  eq([r.statusCode, tried], [200, 1], 'Apple unreachable: tried once, deletion still reported done');
  globalThis.fetch = origFetch;
}

console.log(`appleRevoke: ${n} checks passed`);

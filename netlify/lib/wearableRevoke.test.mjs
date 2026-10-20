/**
 * node netlify/lib/wearableRevoke.test.mjs — item 125.
 *
 *   1. revokeProvider: WHOOP's DELETE /developer/v2/user/access with the
 *      Bearer token; a near-expiry token is refreshed first; every
 *      failure (refresh refused, 5xx, network, timeout) is swallowed;
 *      Oura is not called (endpoint unverified); no token in any log.
 *   2. wearable-disconnect: revoke runs BEFORE the token row is deleted,
 *      and the row is deleted even when the revoke fails.
 *   3. delete-account: revoke runs BEFORE the auth delete; the token and
 *      user_data rows are swept AFTER it; a failing revoke never fails
 *      the deletion.
 *
 * Hermetic: SUPABASE_* and provider vars from the real environment are
 * cleared first, and fetch is faked (no network).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const k of Object.keys(process.env)) {
  if (/^(VITE_)?SUPABASE_|^WHOOP_|^OURA_|^REVENUECAT_|^VANTAGE_PAUSE/.test(k)) delete process.env[k];
}

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const USER = '11111111-1111-4111-8111-111111111111';
const SB = 'https://sb.test';
const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service.jwt.key', WHOOP_CLIENT_ID: 'c', WHOOP_CLIENT_SECRET: 's' };

// ── fake fetch ──
let calls = [];
let tokenRow = null;           // whoop_tokens row, or null
let ouraRow = null;
let revokeStatus = 204;        // or 'network' | 'hang'
let refreshStatus = 200;
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || 'GET', auth: init.headers?.Authorization || '' });
  if (u.endsWith('/auth/v1/user')) return json(200, { id: USER, email: 'a@example.test' });
  if (u.includes('/rest/v1/whoop_tokens') && (init.method || 'GET') === 'GET') return json(200, tokenRow ? [tokenRow] : []);
  if (u.includes('/rest/v1/oura_tokens') && (init.method || 'GET') === 'GET') return json(200, ouraRow ? [ouraRow] : []);
  if (u.includes('/oauth/oauth2/token')) {
    if (refreshStatus !== 200) return new Response('no', { status: refreshStatus });
    return json(200, { access_token: 'FRESH-ACCESS', refresh_token: 'FRESH-REFRESH', expires_in: 3600 });
  }
  if (u.includes('/developer/v2/user/access')) {
    if (revokeStatus === 'network') throw new Error('ECONNRESET');
    if (revokeStatus === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    return new Response(null, { status: revokeStatus });
  }
  if (u.includes('/rest/v1/groups')) return json(200, []);
  if (u.includes('/rest/v1/')) return new Response(null, { status: 204 });
  if (u.includes('/auth/v1/admin/users/')) return new Response(null, { status: 200 });
  if (u.includes('/storage/v1/')) return json(200, []);
  return new Response('unexpected', { status: 500 });
};
const logs = [];
for (const lvl of ['log', 'info', 'warn', 'error']) {
  console[lvl] = (...a) => { logs.push(a.join(' ')); };
}
const out = (...a) => process.stdout.write(a.join(' ') + '\n');

const { revokeProvider, revokeAll } = require('./wearableRevoke.js');
const live = () => ({ user_id: USER, access_token: 'LIVE-ACCESS', refresh_token: 'LIVE-REFRESH', expires_at: new Date(Date.now() + 3600e3).toISOString() });
const reset = () => { calls = []; logs.length = 0; tokenRow = live(); ouraRow = null; revokeStatus = 204; refreshStatus = 200; };
const revokeCalls = () => calls.filter(c => c.url.includes('/developer/v2/user/access'));

// ── 1. revokeProvider ──
{
  reset();
  const r = await revokeProvider('whoop', USER, ENV);
  eq(r, { provider: 'whoop', attempted: true, revoked: true, reason: 'ok' }, 'WHOOP revoked');
  eq(revokeCalls().length, 1, 'one revoke call');
  eq(revokeCalls()[0].method, 'DELETE', 'DELETE');
  eq(revokeCalls()[0].url, 'https://api.prod.whoop.com/developer/v2/user/access', 'documented URL');
  eq(revokeCalls()[0].auth, 'Bearer LIVE-ACCESS', 'with the stored access token');
}
{
  reset();
  tokenRow = { ...live(), expires_at: new Date(Date.now() + 30e3).toISOString() };
  await revokeProvider('whoop', USER, ENV);
  ok(calls.some(c => c.url.includes('/oauth/oauth2/token')), 'near-expiry token refreshed first');
  eq(revokeCalls()[0].auth, 'Bearer FRESH-ACCESS', 'revoked with the fresh token');
}
{
  reset();
  tokenRow = { ...live(), expires_at: new Date(Date.now() - 1).toISOString() };
  refreshStatus = 400;
  const r = await revokeProvider('whoop', USER, ENV);
  eq(r.reason, 'token', 'spent refresh token → nothing to revoke with, no throw');
  eq(revokeCalls().length, 0, 'no revoke attempted');
}
{
  reset(); tokenRow = null;
  eq((await revokeProvider('whoop', USER, ENV)).reason, 'not-connected', 'no row → nothing to do');
}
for (const [status, reason] of [[500, 'status-500'], [429, 'status-429'], [401, 'status-401'], ['network', 'network']]) {
  reset(); revokeStatus = status;
  const r = await revokeProvider('whoop', USER, ENV);
  eq([r.revoked, r.reason], [false, reason], `${status} swallowed`);
}
{
  reset(); revokeStatus = 'hang';
  const t0 = Date.now();
  const r = await revokeProvider('whoop', USER, ENV, { timeoutMs: 50 });
  eq(r.reason, 'network', 'a hung provider times out');
  ok(Date.now() - t0 < 2000, 'quickly');
}
{
  reset(); ouraRow = live();
  const r = await revokeProvider('oura', USER, ENV);
  eq(r, { provider: 'oura', attempted: false, revoked: false, reason: 'unsupported' }, 'Oura: unverified endpoint is not called');
  ok(!calls.some(c => c.url.includes('ouraring')), 'no Oura request at all');
}
{
  reset();
  const r = await revokeProvider('whoop', USER, { ...ENV, SUPABASE_URL: undefined, VITE_SUPABASE_URL: SB });
  eq(r.revoked, true, 'VITE_SUPABASE_URL is accepted (as the functions do)');
  eq((await revokeProvider('whoop', USER, {})).reason, 'not-configured', 'no Supabase URL → not configured, no throw');
}
{
  reset();
  const all = await revokeAll(USER, ENV);
  eq(all.map(r => r.provider), ['whoop', 'oura'], 'revokeAll covers both');
  reset(); revokeStatus = 500; tokenRow = { ...live(), expires_at: new Date(Date.now() + 30e3).toISOString() };
  await revokeProvider('whoop', USER, ENV);
  ok(!logs.join('\n').match(/LIVE-|FRESH-|11111111/), 'no token or user id in any log line');
}

// ── 2. wearable-disconnect ──
Object.assign(process.env, ENV);
const disconnect = require('../functions/wearable-disconnect.js').handler;
const ev = provider => ({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ provider }) });
{
  reset();
  const res = await disconnect(ev('whoop'));
  eq(res.statusCode, 200, 'disconnect ok');
  eq(JSON.parse(res.body), { ok: true, revoked: true }, 'reports the revoke');
  const iRevoke = calls.findIndex(c => c.url.includes('/developer/v2/user/access'));
  const iDelete = calls.findIndex(c => c.url.includes('/rest/v1/whoop_tokens') && c.method === 'DELETE');
  ok(iRevoke >= 0 && iDelete > iRevoke, 'revoke happens before the token row is deleted');
}
{
  reset(); revokeStatus = 'network';
  const res = await disconnect(ev('whoop'));
  eq(res.statusCode, 200, 'a failed revoke still disconnects');
  ok(calls.some(c => c.url.includes('/rest/v1/whoop_tokens') && c.method === 'DELETE'), 'and the row is still deleted');
}
{
  reset(); ouraRow = live();
  const res = await disconnect(ev('oura'));
  eq(res.statusCode, 200, 'Oura disconnect unchanged');
  ok(calls.some(c => c.url.includes('/rest/v1/oura_tokens') && c.method === 'DELETE'), 'Oura row deleted');
  eq(revokeCalls().length, 0, 'no WHOOP revoke for an Oura disconnect');
}

// ── 3. delete-account ──
const del = require('../functions/delete-account.js').handler;
{
  reset();
  const res = await del({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ confirm: 'DELETE' }) });
  eq(res.statusCode, 200, 'account deleted');
  const iRevoke = calls.findIndex(c => c.url.includes('/developer/v2/user/access'));
  const iAuth = calls.findIndex(c => c.url.includes('/auth/v1/admin/users/') && c.method === 'DELETE');
  ok(iRevoke >= 0 && iAuth > iRevoke, 'revoke before the auth delete (the cascade removes the tokens)');
  for (const t of ['whoop_tokens', 'oura_tokens', 'user_data?', 'user_data_history']) {
    const i = calls.findIndex(c => c.url.includes(`/rest/v1/${t}`) && c.method === 'DELETE');
    ok(i > iAuth, `${t} swept after the auth delete`);
  }
}
{
  reset(); revokeStatus = 500;
  const res = await del({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ confirm: 'DELETE' }) });
  eq(res.statusCode, 200, 'a failed revoke never fails the deletion');
}

out(`wearableRevoke: ${n} checks passed`);

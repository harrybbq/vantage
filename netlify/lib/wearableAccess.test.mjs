/**
 * node netlify/lib/wearableAccess.test.mjs — item 127, server half.
 *
 *   · checkWearableAccess: open / allowlist × owner / listed / already
 *     connected / not listed; fail soft = open before the SQL is run and
 *     on read errors.
 *   · whoop-connect / oura-connect: a refused account gets a 403 with the
 *     clear sentence and no authorize URL; { check: true } reports status
 *     without issuing a state.
 *   · ouraList / fetchOuraData: errors surface instead of "0 days".
 *
 * Hermetic: real SUPABASE_* / provider / owner env cleared; fetch faked.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const k of Object.keys(process.env)) {
  if (/^(VITE_)?SUPABASE_|^WHOOP_|^OURA_|^(VITE_)?OWNER_EMAIL|^OAUTH_|^VANTAGE_PAUSE/.test(k)) delete process.env[k];
}

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const USER = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service.jwt.key', OWNER_EMAIL: 'owner@example.test' };
// lib/owner.js reads the owner list from process.env (as in production).
process.env.OWNER_EMAIL = ENV.OWNER_EMAIL;

// ── fake world ──
let world;
const reset = (o = {}) => { world = { config: 'open', configStatus: 200, listed: false, listStatus: 200, tokens: false, throwOn: null, ...o }; calls = []; };
let calls = [];
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const fake = async (url, init = {}) => {
  const u = String(url);
  calls.push(u);
  if (world.throwOn && u.includes(world.throwOn)) throw new Error('network');
  if (u.endsWith('/auth/v1/user')) {
    const auth = init.headers?.Authorization || init.headers?.authorization || '';
    return json(200, { id: USER, email: auth === 'Bearer owner' ? 'owner@example.test' : 'a@example.test' });
  }
  if (u.includes('/rest/v1/config')) {
    if (world.configStatus !== 200) return json(world.configStatus, { message: 'relation does not exist' });
    return json(200, world.config == null ? [] : [{ value: world.config }]);
  }
  if (u.includes('/rest/v1/wearable_access_allowlist')) {
    if (world.listStatus !== 200) return json(world.listStatus, { message: 'nope' });
    return json(200, world.listed ? [{ id: 1 }] : []);
  }
  if (u.includes('_tokens')) return json(200, world.tokens ? [{ user_id: USER }] : []);
  return new Response('unexpected', { status: 500 });
};
globalThis.fetch = fake;
console.warn = () => {}; console.info = () => {}; console.error = () => {};
const out = (...a) => process.stdout.write(a.join(' ') + '\n');

const { checkWearableAccess, limitedMessage } = require('./wearableAccess.js');
const check = (o = {}) => checkWearableAccess({ userId: USER, email: 'a@example.test', provider: 'whoop', ...o }, ENV, fake);

// ── checkWearableAccess ──
reset();
eq((await check()).reason, 'open', 'open mode → allowed');
eq((await check()).allowed, true, 'open allowed');
reset({ config: null });
eq((await check()).reason, 'open', 'no config row → open');
reset({ configStatus: 404 });
eq((await check()).reason, 'unconfigured', 'config missing (SQL not run) → open');
eq((await check()).allowed, true, '…allowed');
reset({ throwOn: '/rest/v1/config' });
eq((await check()).allowed, true, 'config read throws → open');

reset({ config: 'allowlist' });
eq(await check(), { allowed: false, limited: true, listed: false, reason: 'not-listed' }, 'allowlist, not listed → refused');
reset({ config: ' AllowList ' });
eq((await check()).allowed, false, 'mode value is trimmed and case-folded');
reset({ config: 'allowlist', listed: true });
eq((await check()).reason, 'listed', 'listed → allowed');
reset({ config: 'allowlist', tokens: true });
eq((await check()).reason, 'connected', 'already holds a token row → reconnect allowed');
reset({ config: 'allowlist' });
const owner = await check({ email: 'OWNER@example.test' });
eq([owner.allowed, owner.reason], [true, 'owner'], 'owner always allowed');
ok(!calls.some(u => u.includes('allowlist')), 'owner needs no list read');
reset({ config: 'allowlist', listStatus: 404 });
eq((await check()).allowed, true, 'list table missing → open');
reset({ config: 'allowlist', throwOn: 'wearable_access_allowlist' });
eq((await check()).allowed, true, 'list read throws → open');
reset({ config: 'allowlist' });
eq((await checkWearableAccess({ userId: USER, provider: 'whoop' }, {}, fake)).reason, 'unconfigured', 'no Supabase env → open');
eq((await check({ provider: 'garmin' })).reason, 'unconfigured', 'unknown provider → not gated here');
reset({ config: 'allowlist' });
await check({ provider: 'oura' });
ok(calls.some(u => u.includes('/rest/v1/oura_tokens')), 'Oura checks oura_tokens');

// ── messages ──
ok(/WHOOP connections are limited while WHOOP reviews Vantage\. You're not on the list yet/.test(limitedMessage('whoop')), 'refusal sentence');
ok(/You're on the list\./.test(limitedMessage('oura', true)), 'listed sentence');

// ── the connect functions ──
Object.assign(process.env, ENV, {
  URL: 'https://vantagevision.netlify.app', SUPABASE_ANON_KEY: 'anon.jwt.key',
  WHOOP_CLIENT_ID: 'wc', WHOOP_CLIENT_SECRET: 'ws', OURA_CLIENT_ID: 'oc', OURA_CLIENT_SECRET: 'os',
});
const whoop = require('../functions/whoop-connect.js').handler;
const oura = require('../functions/oura-connect.js').handler;
const ev = (body, jwt = 'jwt') => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: body ? JSON.stringify(body) : '' });

reset({ config: 'allowlist' });
{
  const res = await whoop(ev());
  eq(res.statusCode, 403, 'not listed → 403');
  const body = JSON.parse(res.body);
  eq(body.limited, true, 'limited flag');
  ok(/limited while WHOOP reviews Vantage/.test(body.error), 'clear message');
  ok(!res.body.includes('oauth2/auth') && !('Set-Cookie' in res.headers), 'no authorize URL, no state cookie');
}
reset({ config: 'allowlist', listed: true });
{
  const res = await whoop(ev());
  eq(res.statusCode, 200, 'listed → authorize URL');
  ok(JSON.parse(res.body).url.includes('oauth2/auth'), 'url issued');
}
reset({ config: 'allowlist' });
{
  const res = await whoop(ev(null, 'owner'));
  eq(res.statusCode, 200, 'owner connects');
}
reset({ config: 'allowlist' });
{
  const res = await oura(ev());
  eq(res.statusCode, 403, 'Oura gated the same way');
  ok(/Oura connections are limited while Oura reviews Vantage/.test(JSON.parse(res.body).error), 'Oura sentence');
}
reset({ config: 'allowlist' });
{
  const res = await whoop(ev({ check: true }));
  eq(res.statusCode, 200, 'status check answers 200');
  const a = JSON.parse(res.body).access;
  eq([a.allowed, a.limited, a.listed], [false, true, false], 'status: refused');
  ok(/not on the list yet/.test(a.message), 'status message');
  ok(!res.body.includes('oauth2/auth') && !('Set-Cookie' in res.headers), 'a check issues no state');
}
reset({ config: 'allowlist', listed: true });
{
  const a = JSON.parse((await whoop(ev({ check: true }))).body).access;
  ok(/You're on the list/.test(a.message), 'status: on the list');
}
reset({ config: 'allowlist', tokens: true });
eq(JSON.parse((await whoop(ev({ check: true }))).body).access.message, null, 'connected: no note');
reset();
{
  const a = JSON.parse((await whoop(ev({ check: true }))).body).access;
  eq([a.allowed, a.limited, a.message], [true, false, null], 'open: nothing to say');
  eq((await whoop(ev())).statusCode, 200, 'open: connect as before');
}
reset({ configStatus: 404 });
eq((await whoop(ev())).statusCode, 200, 'SQL not run: connect as before');

// ── Oura errors surface (gap C12) ──
{
  const { ouraList, fetchOuraData } = require('./oura.js');
  const f403 = async () => new Response('{}', { status: 403 });
  const r = await ouraList('/sleep', 'tok', '2026-10-01', '2026-10-02', f403);
  eq(r.records, [], 'no records');
  eq(r.error.status, 403, 'error carried');
  ok(/Membership/.test(r.error.reason), '403 → membership sentence');
  await assert.rejects(() => fetchOuraData('tok', 7, f403), e => e.ouraStatus === 403 && /Membership/.test(e.message)); n++;
  const f401 = async () => new Response('{}', { status: 401 });
  await assert.rejects(() => fetchOuraData('tok', 7, f401), e => e.ouraStatus === 401 && /reconnect Oura/.test(e.message)); n++;
  const fNet = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(() => fetchOuraData('tok', 7, fNet), e => /Could not reach Oura/.test(e.message)); n++;
  // one collection failing is a warning, not a failure
  const mixed = async u => (String(u).includes('/workout')
    ? new Response('{}', { status: 403 })
    : json(200, { data: String(u).includes('/sleep') ? [{ day: '2026-10-01', type: 'long_sleep', total_sleep_duration: 27000 }] : [] }));
  const got = await fetchOuraData('tok', 7, mixed);
  eq(got.vitals['2026-10-01'].sleep, 7.5, 'the rest still maps');
  eq(got.warnings.length, 1, 'one warning');
}

out(`wearable access (server): ${n} checks passed`);

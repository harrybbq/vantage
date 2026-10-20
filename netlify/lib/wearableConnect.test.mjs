/**
 * node netlify/lib/wearableConnect.test.mjs — WHOOP/Oura connect from the
 * native app (STARTUP item 115) without loosening the web flow.
 *
 *   1. The native state token: round trip, expiry, wrong provider, wrong
 *      user, wrong/missing verifier, tampering, reuse, and that neither
 *      kind of state is accepted by the other kind's check.
 *   2. The connect functions: no body → the cookie flow exactly as
 *      before; { platform:'native', challenge } → a cookie-less native
 *      state with the SAME registered redirect_uri.
 *   3. The callbacks: web GET unchanged; native GET hands the code to
 *      com.vantage.app://wearable-callback without exchanging it and
 *      without anything secret in the URL; failures carry a reason; the
 *      app's POST finish exchanges only with verifier + matching user.
 *
 * No network: fetch is faked and every call recorded.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

const SITE = 'https://vantagevision.netlify.app';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SECRETS = { WHOOP_CLIENT_SECRET: 'whoop-secret-xyz', OURA_CLIENT_SECRET: 'oura-secret-xyz' };

Object.assign(process.env, {
  URL: SITE,
  SUPABASE_URL: 'https://sb.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service.jwt.key',
  SUPABASE_ANON_KEY: 'anon.jwt.key',
  WHOOP_CLIENT_ID: 'whoop-client',
  OURA_CLIENT_ID: 'oura-client',
  ...SECRETS,
});
delete process.env.OAUTH_STATE_SECRET;
delete process.env.OAUTH_REDIRECT_BASE;
delete process.env.VANTAGE_PAUSE;

// ── fake fetch ──────────────────────────────────────────────────────
const calls = [];
let tokenStatus = 200;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, init });
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/auth/v1/user')) {
    const auth = init.headers?.Authorization || init.headers?.authorization || '';
    if (auth === 'Bearer jwt-a') return json(200, { id: USER_A, email: 'a@example.test' });
    if (auth === 'Bearer jwt-b') return json(200, { id: USER_B, email: 'b@example.test' });
    return json(401, { msg: 'bad jwt' });
  }
  if (u.includes('/oauth')) {
    if (tokenStatus !== 200) return new Response('nope', { status: tokenStatus });
    return json(200, { access_token: 'ACCESS-TOKEN-SECRET', refresh_token: 'REFRESH-TOKEN-SECRET', expires_in: 3600 });
  }
  if (u.includes('/rest/v1/')) return new Response('', { status: 201 });
  return new Response('unexpected', { status: 500 });
};
const tokenCalls = () => calls.filter(c => c.url.includes('/oauth'));
const storeCalls = () => calls.filter(c => c.url.includes('/rest/v1/'));

const S = require('./oauthState.js');
const R = require('./redirectUri.js');

const makeVerifier = () => randomBytes(32).toString('base64url');
const challengeOf = v => createHash('sha256').update(v).digest('base64url');
const env = { ...SECRETS };

// ── 1. The native state token ───────────────────────────────────────
{
  const v = makeVerifier();
  const c = challengeOf(v);
  eq(v.length, 43, 'a 32-byte verifier is 43 base64url chars');
  ok(S.isChallenge(c), 'its SHA-256 is a well-formed challenge');
  ok(!S.isChallenge('short'), 'malformed challenge refused');
  assert.throws(() => S.issueNativeState(USER_A, 'whoop', 'nope', env)); n++;

  const st = S.issueNativeState(USER_A, 'whoop', c, env);
  eq(S.stateMode(st, 'whoop', env), 'native', 'stateMode → native');
  eq(S.checkNativeState(st, 'whoop', env), { ok: true }, 'GET-time check passes');

  const good = S.verifyNativeState(st, 'whoop', { userId: USER_A, verifier: v }, env);
  eq(good.userId, USER_A, 'round trip → the state user');
  ok(good.nonce && good.nonce.length >= 16, 'carries a random nonce');

  // Two issues for the same user and challenge differ: never deterministic.
  ok(S.issueNativeState(USER_A, 'whoop', c, env) !== st, 'state is not deterministic');

  eq(S.verifyNativeState(st, 'oura', { userId: USER_A, verifier: v }, env).error, 'badstate', 'wrong provider refused');
  eq(S.stateMode(st, 'oura', env), null, 'and is not even authentic for the other provider');
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_B, verifier: v }, env).error, 'badstate', 'wrong user refused');
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_A, verifier: makeVerifier() }, env).error, 'badstate', 'wrong verifier refused');
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_A }, env).error, 'badstate', 'missing verifier refused');
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_A, verifier: c }, env).error, 'badstate', 'the challenge itself is not the verifier');
  eq(S.verifyNativeState(st, 'whoop', { verifier: v }, env).error, 'badstate', 'no authenticated user refused');

  // Tampering: swap the user inside the payload, keep the signature.
  const [payload, sig] = st.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...data, u: USER_B })).toString('base64url') + '.' + sig;
  eq(S.verifyNativeState(forged, 'whoop', { userId: USER_B, verifier: v }, env).error, 'badstate', 'payload tamper refused');
  eq(S.stateMode(forged, 'whoop', env), null, 'tampered state is not authentic');
  eq(S.verifyNativeState(payload + '.' + sig.slice(0, -2) + 'AA', 'whoop', { userId: USER_A, verifier: v }, env).error, 'badstate', 'signature tamper refused');
  eq(S.verifyNativeState(st + '.x', 'whoop', { userId: USER_A, verifier: v }, env).error, 'badstate', 'extra segment refused');
  eq(S.verifyNativeState('', 'whoop', { userId: USER_A, verifier: v }, env).error, 'badstate', 'empty refused');
  // Signed with another key (another site / an old secret).
  const otherKey = S.issueNativeState(USER_A, 'whoop', c, { WHOOP_CLIENT_SECRET: 'other' });
  eq(S.verifyNativeState(otherKey, 'whoop', { userId: USER_A, verifier: v }, env).error, 'badstate', 'foreign key refused');
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_A, verifier: v }, {}).error, 'notconfigured', 'no secret → notconfigured');

  // Expiry.
  const realNow = Date.now;
  Date.now = () => realNow() + S.TTL_MS + 1000;
  eq(S.verifyNativeState(st, 'whoop', { userId: USER_A, verifier: v }, env).error, 'expired', 'expired refused');
  eq(S.checkNativeState(st, 'whoop', env).error, 'expired', 'GET-time check sees expiry too');
  Date.now = realNow;

  // Reuse (per instance; the provider's single-use code is the lock).
  ok(S.consumeNonce(good.nonce, good.expires), 'first finish consumes the nonce');
  ok(!S.consumeNonce(good.nonce, good.expires), 'second finish with the same nonce refused');
  ok(!S.consumeNonce('', 0), 'empty nonce refused');

  // Cross-kind: a native state never passes the web check, even with a
  // cookie carrying its nonce — and a web state never passes native.
  const ev = { headers: { cookie: `${S.COOKIE}=${data.n}` } };
  eq(S.verifyState(st, 'whoop', ev, env).error, 'badstate', 'web check refuses a native state');
  const web = S.issueState(USER_A, 'whoop', env);
  const webNonce = web.cookie.split(';')[0].split('=')[1];
  eq(S.verifyState(web.state, 'whoop', { headers: { cookie: `${S.COOKIE}=${webNonce}` } }, env).userId, USER_A, 'web round trip unchanged');
  eq(S.verifyState(web.state, 'whoop', { headers: {} }, env).error, 'badstate', 'web state without its cookie still refused');
  eq(S.stateMode(web.state, 'whoop', env), 'web', 'stateMode → web');
  eq(S.verifyNativeState(web.state, 'whoop', { userId: USER_A, verifier: v }, env).error, 'badstate', 'native check refuses a web state');
  ok(/HttpOnly/.test(web.cookie) && /SameSite=Lax/.test(web.cookie) && /Max-Age=600/.test(web.cookie), 'web cookie attributes unchanged');
}

// ── redirectUri ─────────────────────────────────────────────────────
{
  eq(R.redirectUriFor({ headers: { host: 'evil.test' } }, 'whoop'), `${SITE}/.netlify/functions/whoop-callback`, 'redirect URI is the constant, not the host');
  eq(R.nativeReturnUrl('oura', { status: 'error', reason: 'denied', empty: '' }), 'com.vantage.app://wearable-callback?provider=oura&status=error&reason=denied', 'native return URL');
}

// ── 2. Connect functions ────────────────────────────────────────────
const connect = p => require(`../functions/${p}-connect.js`).handler;
const statefrom = url => new URL(url).searchParams.get('state');

for (const p of ['whoop', 'oura']) {
  calls.length = 0;
  // Web: no body, exactly as VitalsHistoryCard has always sent it.
  const web = await connect(p)({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt-a', host: 'alias.test' } });
  eq(web.statusCode, 200, `${p}-connect web: 200`);
  ok(/vantage_oauth_nonce=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/.test(web.headers['Set-Cookie'] || ''), `${p}-connect web: nonce cookie set`);
  const wb = JSON.parse(web.body);
  eq(S.stateMode(statefrom(wb.url), p, env), 'web', `${p}-connect web: web state`);
  eq(new URL(wb.url).searchParams.get('redirect_uri'), `${SITE}/.netlify/functions/${p}-callback`, `${p}-connect web: registered redirect_uri`);

  // Native: platform + challenge.
  const v = makeVerifier();
  const nat = await connect(p)({
    httpMethod: 'POST', headers: { authorization: 'Bearer jwt-a', host: 'alias.test' },
    body: JSON.stringify({ platform: 'native', challenge: challengeOf(v) }),
  });
  eq(nat.statusCode, 200, `${p}-connect native: 200`);
  ok(!('Set-Cookie' in nat.headers), `${p}-connect native: no cookie`);
  const nb = JSON.parse(nat.body);
  const nst = statefrom(nb.url);
  eq(S.stateMode(nst, p, env), 'native', `${p}-connect native: native state`);
  eq(S.verifyNativeState(nst, p, { userId: USER_A, verifier: v }, env).userId, USER_A, `${p}-connect native: bound to the caller + verifier`);
  eq(new URL(nb.url).searchParams.get('redirect_uri'), `${SITE}/.netlify/functions/${p}-callback`, `${p}-connect native: SAME registered redirect_uri`);
  ok(!nb.url.includes(v), `${p}-connect native: the verifier never leaves the device`);

  const bad = await connect(p)({ httpMethod: 'POST', headers: { authorization: 'Bearer jwt-a' }, body: JSON.stringify({ platform: 'native' }) });
  eq(bad.statusCode, 400, `${p}-connect native without a challenge: 400`);
  const anon = await connect(p)({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ platform: 'native', challenge: challengeOf(v) }) });
  eq(anon.statusCode, 401, `${p}-connect: still needs a session`);
}

// ── 3. Callbacks ────────────────────────────────────────────────────
const callback = p => require(`../functions/${p}-callback.js`).handler;
const loc = r => String(r.headers?.Location || '');

for (const p of ['whoop', 'oura']) {
  const cb = callback(p);

  // Web GET, unchanged.
  {
    calls.length = 0;
    const web = S.issueState(USER_A, p, env);
    const nonce = web.cookie.split(';')[0].split('=')[1];
    const r = await cb({ httpMethod: 'GET', headers: { host: 'alias.test', cookie: `${S.COOKIE}=${nonce}` }, queryStringParameters: { code: 'web-code', state: web.state } });
    eq(r.statusCode, 302, `${p} web: 302`);
    eq(loc(r), `${SITE}/?${p}=connected`, `${p} web: back to the site root with ?${p}=connected`);
    ok(/Max-Age=0/.test(r.headers['Set-Cookie']), `${p} web: nonce cookie burnt`);
    eq(tokenCalls().length, 1, `${p} web: one token exchange`);
    const sent = new URLSearchParams(tokenCalls()[0].init.body);
    eq(sent.get('redirect_uri'), `${SITE}/.netlify/functions/${p}-callback`, `${p} web: exchange uses the registered redirect_uri`);
    eq(sent.get('code'), 'web-code', `${p} web: exchanges the code`);
    eq(JSON.parse(storeCalls()[0].init.body).user_id, USER_A, `${p} web: tokens filed under the state user`);

    calls.length = 0;
    const noCookie = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'x', state: web.state } });
    eq(loc(noCookie), `${SITE}/?${p}=badstate`, `${p} web: no cookie → badstate`);
    eq(tokenCalls().length, 0, `${p} web: nothing exchanged without the cookie`);

    const denied = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { error: 'access_denied', state: web.state } });
    eq(loc(denied), `${SITE}/?${p}=denied`, `${p} web: denied`);
    const forged = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'x', state: 'abc.def' } });
    eq(loc(forged), `${SITE}/?${p}=badstate`, `${p}: a forged state takes the web path, never the app scheme`);
  }

  // Native GET → hand-off to the app, no exchange.
  const v = makeVerifier();
  const st = S.issueNativeState(USER_A, p, challengeOf(v), env);
  {
    calls.length = 0;
    const r = await cb({ httpMethod: 'GET', headers: { host: 'alias.test' }, queryStringParameters: { code: 'native-code', state: st } });
    eq(r.statusCode, 302, `${p} native GET: 302`);
    const L = new URL(loc(r));
    eq(`${L.protocol}//${L.host}`, 'com.vantage.app://wearable-callback', `${p} native GET: to the app scheme`);
    eq(L.searchParams.get('provider'), p, `${p} native GET: names the provider`);
    eq(L.searchParams.get('status'), 'ready', `${p} native GET: status=ready`);
    eq(L.searchParams.get('code'), 'native-code', `${p} native GET: carries the one-time code`);
    eq(L.searchParams.get('state'), st, `${p} native GET: and its state`);
    eq(tokenCalls().length, 0, `${p} native GET: does NOT exchange the code`);
    ok(!('Set-Cookie' in r.headers), `${p} native GET: no cookie games`);
    eq(r.headers['Cache-Control'], 'no-store', `${p} native GET: not cacheable`);
    for (const secret of [...Object.values(SECRETS), 'ACCESS-TOKEN-SECRET', 'REFRESH-TOKEN-SECRET', 'service.jwt.key', v]) {
      ok(!loc(r).includes(secret), `${p} native GET: no secret in the URL (${secret.slice(0, 6)}…)`);
    }

    const denied = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { error: 'access_denied', state: st } });
    eq(loc(denied), `com.vantage.app://wearable-callback?provider=${p}&status=error&reason=denied`, `${p} native GET: denied → reason`);
    const nocode = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { state: st } });
    eq(loc(nocode), `com.vantage.app://wearable-callback?provider=${p}&status=error&reason=nocode`, `${p} native GET: nocode → reason`);

    const realNow = Date.now;
    Date.now = () => realNow() + S.TTL_MS + 1000;
    const exp = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'c', state: st } });
    Date.now = realNow;
    eq(loc(exp), `com.vantage.app://wearable-callback?provider=${p}&status=error&reason=expired`, `${p} native GET: expired → reason`);

    process.env.VANTAGE_PAUSE = 'sync';
    const pz = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'c', state: st } });
    eq(loc(pz), `com.vantage.app://wearable-callback?provider=${p}&status=paused`, `${p} native GET: paused → status=paused`);
    const pzWeb = await cb({ httpMethod: 'GET', headers: {}, queryStringParameters: { code: 'c', state: 's' } });
    eq(loc(pzWeb), `${SITE}/?${p}=paused`, `${p} web GET: ?${p}=paused still`);
    delete process.env.VANTAGE_PAUSE;
  }

  // Native POST finish.
  const finish = (body, jwt = 'jwt-a') => cb({
    httpMethod: 'POST',
    headers: { authorization: jwt ? `Bearer ${jwt}` : '', host: 'alias.test' },
    body: JSON.stringify(body),
  });
  {
    eq((await cb({ httpMethod: 'OPTIONS', headers: {} })).statusCode, 204, `${p} finish: preflight`);

    calls.length = 0;
    const wrongV = await finish({ code: 'c1', state: st, verifier: makeVerifier() });
    eq(wrongV.statusCode, 403, `${p} finish: wrong verifier → 403`);
    eq(JSON.parse(wrongV.body), { error: 'badstate' }, `${p} finish: vague reason`);
    const wrongUser = await finish({ code: 'c1', state: st, verifier: v }, 'jwt-b');
    eq(wrongUser.statusCode, 403, `${p} finish: another account's session → 403`);
    eq((await finish({ code: 'c1', state: st, verifier: v }, '')).statusCode, 401, `${p} finish: no session → 401`);
    eq((await finish({ state: st, verifier: v })).statusCode, 400, `${p} finish: no code → 400`);
    const web = S.issueState(USER_A, p, env);
    eq((await finish({ code: 'c1', state: web.state, verifier: v })).statusCode, 403, `${p} finish: a web state cannot be finished natively`);
    eq(tokenCalls().length, 0, `${p} finish: nothing exchanged by any refused attempt`);

    process.env.VANTAGE_PAUSE = 'sync';
    const pz = await finish({ code: 'c1', state: st, verifier: v });
    eq([pz.statusCode, JSON.parse(pz.body).error], [503, 'paused'], `${p} finish: paused → 503 paused`);
    delete process.env.VANTAGE_PAUSE;

    calls.length = 0;
    const r = await finish({ code: 'native-code', state: st, verifier: v });
    eq(r.statusCode, 200, `${p} finish: 200`);
    eq(JSON.parse(r.body), { ok: true, status: 'connected' }, `${p} finish: connected, no tokens in the body`);
    ok(!r.body.includes('TOKEN'), `${p} finish: tokens never returned to the app`);
    const sent = new URLSearchParams(tokenCalls()[0].init.body);
    eq(sent.get('redirect_uri'), `${SITE}/.netlify/functions/${p}-callback`, `${p} finish: same registered redirect_uri as the authorize call`);
    eq(sent.get('code'), 'native-code', `${p} finish: exchanges the handed-off code`);
    eq(JSON.parse(storeCalls()[0].init.body).user_id, USER_A, `${p} finish: filed under the verified user`);

    calls.length = 0;
    const replay = await finish({ code: 'native-code', state: st, verifier: v });
    eq(replay.statusCode, 403, `${p} finish: replay on this instance refused`);
    eq(tokenCalls().length, 0, `${p} finish: replay never reaches the provider`);

    // A fresh state whose exchange fails reports the reason, not text.
    const v2 = makeVerifier();
    const st2 = S.issueNativeState(USER_A, p, challengeOf(v2), env);
    tokenStatus = 400;
    const tf = await finish({ code: 'used-code', state: st2, verifier: v2 });
    tokenStatus = 200;
    eq([tf.statusCode, JSON.parse(tf.body)], [502, { error: 'tokenfail' }], `${p} finish: token failure → tokenfail`);
  }
}

console.log(`check:wearableconnect (server) — ${n} checks passed`);

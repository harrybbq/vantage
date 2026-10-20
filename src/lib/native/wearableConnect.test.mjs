// node src/lib/native/wearableConnect.test.mjs — the client half of WHOOP /
// Oura connect (STARTUP item 115): the return-URL parser and the native/web
// branching, with Capacitor, fetch and storage faked.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseWearableCallback, WEARABLE_CALLBACK_URL } from './wearableReturn.js';
import { parseAuthCallback } from './authCallback.js';
import {
  makePkce, requestConnect, openAuthorize, finishConnect, verifierKey,
  deliverWearableResult, takeWearableResult, onWearableResult, WEARABLE_RETURN_EVENT,
} from './wearableConnect.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ── The return URL ──────────────────────────────────────────────────
eq(WEARABLE_CALLBACK_URL, 'com.vantage.app://wearable-callback', 'scheme + host');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}?provider=whoop&status=ready&code=C&state=S.T`),
  { provider: 'whoop', status: 'ready', reason: null, code: 'C', state: 'S.T' }, 'ready hand-off');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}?provider=oura&status=error&reason=denied`),
  { provider: 'oura', status: 'error', reason: 'denied', code: null, state: null }, 'error + reason');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}/?provider=whoop&status=paused`).status, 'paused', 'paused, trailing slash ok');
eq(parseWearableCallback('COM.VANTAGE.APP://wearable-callback?provider=whoop&status=paused').provider, 'whoop', 'scheme case ignored');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}?provider=whoop&status=error&reason=<b>pwned</b>`).reason, 'error', 'crafted reason squashed');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}?provider=whoop&status=weird&code=C&state=S`),
  { provider: 'whoop', status: 'error', reason: 'error', code: null, state: null }, 'unknown status → error, code dropped');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}?provider=fitbit&status=ready`), null, 'unknown provider → not ours');
eq(parseWearableCallback(`${WEARABLE_CALLBACK_URL}X?provider=whoop`), null, 'look-alike host → not ours');
eq(parseWearableCallback('com.vantage.app://auth-callback?code=x'), null, 'sign-in return is not a wearable return');
eq(parseAuthCallback(`${WEARABLE_CALLBACK_URL}?provider=whoop&status=ready&code=C&state=S`), null, 'and a wearable return is not a sign-in return');
eq(parseWearableCallback('https://vantagevision.netlify.app/?whoop=connected'), null, 'web return is not a deep link');
eq(parseWearableCallback(undefined), null, 'non-string');

// ── PKCE pair ───────────────────────────────────────────────────────
{
  const { verifier, challenge } = await makePkce();
  ok(/^[A-Za-z0-9_-]{43}$/.test(verifier), 'verifier: 43 base64url chars (32 bytes)');
  eq(challenge, createHash('sha256').update(verifier).digest('base64url'), 'challenge = base64url(SHA-256(verifier)), as the server computes it');
  ok((await makePkce()).verifier !== verifier, 'fresh each time');
}

// ── Fakes ───────────────────────────────────────────────────────────
function memStorage() {
  const m = new Map();
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
function harness({ native, respond }) {
  const calls = [];
  const opened = [];
  const navigated = [];
  const storage = memStorage();
  const deps = {
    native,
    storage,
    apiUrl: p => (native ? 'https://vantagevision.netlify.app' + p : p),
    getToken: async () => 'jwt-a',
    fetch: async (url, init) => {
      calls.push({ url, init });
      const [status, body] = respond(url, init);
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    },
    openBrowser: async url => { opened.push(url); },
    navigate: url => { navigated.push(url); },
  };
  return { deps, calls, opened, navigated, storage };
}
const AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth?state=x';

// ── Web: exactly the request the panel always sent, then navigate ───
{
  const h = harness({ native: false, respond: () => [200, { ok: true, url: AUTH, redirectUri: 'r' }] });
  const r = await requestConnect('whoop', h.deps);
  eq(h.calls.length, 1, 'web: one connect call');
  eq(h.calls[0].url, '/.netlify/functions/whoop-connect', 'web: relative function URL');
  eq(h.calls[0].init, { method: 'POST', headers: { Authorization: 'Bearer jwt-a' } }, 'web: no body, no platform — the cookie flow');
  eq(h.storage.m.size, 0, 'web: nothing stored');
  await openAuthorize(r, h.deps);
  eq(h.navigated, [AUTH], 'web: the page navigates to the provider');
  eq(h.opened, [], 'web: no system browser');
}

// ── Native: challenge out, verifier kept, system browser ────────────
let nativeVerifier;
{
  const h = harness({ native: true, respond: () => [200, { ok: true, url: AUTH }] });
  const r = await requestConnect('whoop', h.deps);
  eq(h.calls[0].url, 'https://vantagevision.netlify.app/.netlify/functions/whoop-connect', 'native: absolute function URL');
  const sent = JSON.parse(h.calls[0].init.body);
  eq(sent.platform, 'native', 'native: says so');
  nativeVerifier = h.storage.getItem(verifierKey('whoop'));
  ok(nativeVerifier, 'native: verifier kept on the device');
  eq(sent.challenge, createHash('sha256').update(nativeVerifier).digest('base64url'), 'native: only the challenge is sent');
  ok(!h.calls[0].init.body.includes(nativeVerifier), 'native: the verifier never leaves');
  await openAuthorize(r, h.deps);
  eq(h.opened, [AUTH], 'native: opened with @capacitor/browser');
  eq(h.navigated, [], 'native: the WebView is NOT navigated');

  // A failed start clears the verifier and reports the server's line.
  const f = harness({ native: true, respond: () => [500, { error: 'WHOOP is not set up on this site yet.' }] });
  await assert.rejects(requestConnect('whoop', f.deps), /not set up/); n++;
  eq(f.storage.m.size, 0, 'native: failed start leaves no verifier');
}

// ── Native finish ───────────────────────────────────────────────────
{
  const ready = { provider: 'whoop', status: 'ready', code: 'CODE', state: 'ST.SIG', reason: null };

  const h = harness({ native: true, respond: () => [200, { ok: true, status: 'connected' }] });
  h.storage.setItem(verifierKey('whoop'), 'V'.repeat(43));
  eq(await finishConnect(ready, h.deps), 'connected', 'finish → connected');
  eq(h.calls[0].url, 'https://vantagevision.netlify.app/.netlify/functions/whoop-callback', 'finish POSTs to the callback');
  eq(JSON.parse(h.calls[0].init.body), { code: 'CODE', state: 'ST.SIG', verifier: 'V'.repeat(43) }, 'finish sends code + state + verifier');
  eq(h.calls[0].init.headers.Authorization, 'Bearer jwt-a', 'finish carries the session');
  eq(h.storage.getItem(verifierKey('whoop')), null, 'verifier used once');
  eq(await finishConnect(ready, h.deps), 'restart', 'no verifier (second try / other device) → restart, no call');
  eq(h.calls.length, 1, 'and nothing sent');

  const statuses = [
    [[503, { error: 'paused', area: 'sync' }], 'paused'],
    [[503, { error: 'Paused for maintenance — back soon.', paused: true }], 'paused'],
    [[403, { error: 'badstate' }], 'badstate'],
    [[502, { error: 'tokenfail' }], 'tokenfail'],
    [[401, { error: 'session expired — sign in again' }], 'signin'],
    [[429, { error: 'Too many requests — give it a minute.' }], 'busy'],
    [[500, { error: 'Some raw upstream text that should not be shown' }], 'error'],
  ];
  for (const [resp, want] of statuses) {
    const x = harness({ native: true, respond: () => resp });
    x.storage.setItem(verifierKey('whoop'), 'V'.repeat(43));
    eq(await finishConnect(ready, x.deps), want, `finish: ${resp[0]} → ${want}`);
  }
  const off = harness({ native: true, respond: () => { throw new Error('offline'); } });
  off.storage.setItem(verifierKey('whoop'), 'V'.repeat(43));
  eq(await finishConnect(ready, off.deps), 'offline', 'finish: network failure → offline');

  // Non-ready returns need no network.
  const none = harness({ native: true, respond: () => { throw new Error('should not be called'); } });
  eq(await finishConnect({ provider: 'oura', status: 'paused' }, none.deps), 'paused', 'status=paused → paused (kill switch)');
  eq(await finishConnect({ provider: 'oura', status: 'error', reason: 'denied' }, none.deps), 'denied', 'status=error → its reason');
  eq(await finishConnect({ provider: 'oura', status: 'ready', code: null, state: 'x' }, none.deps), 'nocode', 'ready without code → nocode');
  eq(await finishConnect(null, none.deps), 'error', 'nothing → error');
}

// ── Delivery: parked for a panel that is not there yet, or by event ─
{
  const target = new EventTarget();
  const seen = [];
  deliverWearableResult('oura', 'connected', target);
  eq(takeWearableResult('oura'), 'connected', 'parked result taken on mount');
  eq(takeWearableResult('oura'), null, 'and only once');

  const off = onWearableResult('whoop', r => seen.push(r), target);
  deliverWearableResult('oura', 'denied', target);
  eq(seen, [], 'a WHOOP panel ignores an Oura return');
  eq(takeWearableResult('oura'), 'denied', 'which stays parked for the Oura panel');
  deliverWearableResult('whoop', 'connected', target);
  eq(seen, ['connected'], 'mounted panel gets it from the event');
  eq(takeWearableResult('whoop'), null, 'and it is consumed, so a remount does not repeat it');
  off();
  deliverWearableResult('whoop', 'paused', target);
  eq(seen, ['connected'], 'unsubscribed panel hears nothing');
  eq(takeWearableResult('whoop'), 'paused', 'the next mount takes it instead');

  let navigations = 0;
  target.addEventListener(WEARABLE_RETURN_EVENT, () => { navigations++; });
  deliverWearableResult('whoop', 'connected', target);
  eq(navigations, 1, 'the app-level listener (Settings › Tools) hears every return');
  takeWearableResult('whoop');
}

console.log(`check:wearableconnect (client) — ${n} checks passed`);

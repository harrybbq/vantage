/**
 * WHOOP / Oura connect, web and native, as plain functions.
 *
 * Every side effect (fetch, the session token, storage, the browser, page
 * navigation) comes in through `deps`, so the check script can drive the
 * native and web branches under node with fakes. lib/native/deepLinks.js
 * supplies the real ones.
 *
 *   WEB     POST <provider>-connect with no body — byte-for-byte what the
 *           panel always sent — and navigate the page to the authorize
 *           URL. The server's HttpOnly nonce cookie does the binding.
 *
 *   NATIVE  The provider page runs in the SYSTEM browser, which never
 *           sees our cookie, so:
 *             1. make a random verifier, keep it on this device, send
 *                only its SHA-256 challenge with { platform: 'native' };
 *             2. open the authorize URL with @capacitor/browser;
 *             3. the callback forwards code + state to
 *                com.vantage.app://wearable-callback (wearableReturn.js);
 *             4. `finishConnect` POSTs code + state + verifier back to
 *                the callback with the session; the server exchanges
 *                only if the verifier matches and the session is the
 *                user who started. Nothing secret ever sits in a URL
 *                that would be useful to anyone else.
 */

export const WEARABLE_RETURN_EVENT = 'vantage:wearable-return';
const LABEL = { whoop: 'WHOOP', oura: 'Oura' };

/** Where the verifier waits while the browser is up. localStorage, so
 *  it survives Android killing the app behind the browser sheet. */
export const verifierKey = provider => `vb-wearable-verifier:${provider}`;

// Used only if storage throws (private mode, a locked-down WebView): the
// warm-return case still works, a cold start can't — and says so.
const memory = new Map();
function store(storage, key, value) {
  try { storage.setItem(key, value); return; } catch { /* fall through */ }
  memory.set(key, value);
}
function load(storage, key) {
  try { const v = storage.getItem(key); if (v) return v; } catch { /* fall through */ }
  return memory.get(key) || null;
}
function drop(storage, key) {
  try { storage.removeItem(key); } catch { /* ignore */ }
  memory.delete(key);
}

const b64url = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** → { verifier, challenge } — 32 random bytes and their SHA-256, both base64url. */
export async function makePkce(cryptoObj = globalThis.crypto) {
  const raw = new Uint8Array(32);
  cryptoObj.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/**
 * Step 1: ask the server for the authorize URL.
 * → { native, url, body }. Throws an Error with a user-facing message.
 */
export async function requestConnect(provider, deps) {
  const { native, fetch, apiUrl, getToken, storage } = deps;
  const token = await getToken();
  const init = { method: 'POST', headers: { Authorization: `Bearer ${token}` } };
  if (native) {
    const { verifier, challenge } = await makePkce(deps.crypto);
    store(storage, verifierKey(provider), verifier);
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ platform: 'native', challenge });
  }
  const res = await fetch(apiUrl(`/.netlify/functions/${provider}-connect`), init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) {
    if (native) drop(storage, verifierKey(provider));
    throw new Error(body.error || 'connect failed');
  }
  return { native: !!native, url: body.url, body };
}

/** Step 2: send the person to the provider. */
export async function openAuthorize({ native, url }, deps) {
  if (native) await deps.openBrowser(url);
  else deps.navigate(url);
}

/**
 * Step 4 (native only): turn a parsed wearable return into a result the
 * panel already understands — the same words the web's `?whoop=<result>`
 * carries: 'connected', 'paused', or a short failure reason.
 */
export async function finishConnect(cb, deps) {
  if (!cb) return 'error';
  if (cb.status === 'paused') return 'paused';
  if (cb.status !== 'ready') return cb.reason || 'error';
  if (!cb.code || !cb.state) return 'nocode';

  const { fetch, apiUrl, getToken, storage } = deps;
  const key = verifierKey(cb.provider);
  const verifier = load(storage, key);
  // One try per verifier, success or failure: a second finish with the
  // same pair is refused by the server anyway, and a stale verifier
  // lying around only invites confusion with the next attempt.
  drop(storage, key);
  if (!verifier) return 'restart';

  try {
    const token = await getToken();
    const res = await fetch(apiUrl(`/.netlify/functions/${cb.provider}-callback`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: cb.code, state: cb.state, verifier }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) return 'connected';
    if (res.status === 503 && (body.paused || body.error === 'paused')) return 'paused';
    if (res.status === 401) return 'signin';
    if (res.status === 429) return 'busy';
    return /^[a-z]{1,24}$/.test(body.error || '') ? body.error : 'error';
  } catch {
    return 'offline';
  }
}

/** A line for the panel when the native start has handed over to the browser. */
export const browserHint = provider =>
  `Finish in the browser — you'll come back here when ${LABEL[provider] || provider} is linked.`;

// ── Delivering the result to whichever panel is (or will be) there ────
//
// The return can arrive with the panel mounted (the usual case: the
// browser sheet sat on top of Settings › Tools) or before it exists
// (Android killed the app; it cold-starts on the hub). So the result is
// parked, an event announces it, and the panel takes it either from the
// event or when it mounts. Taking is destructive: shown once.
const pending = new Map();

export function deliverWearableResult(provider, result, target = globalThis.window) {
  pending.set(provider, result);
  try {
    target?.dispatchEvent(new CustomEvent(WEARABLE_RETURN_EVENT, { detail: { provider, result } }));
  } catch { /* no window (tests) or an old WebView: the panel takes it on mount */ }
}

export function takeWearableResult(provider) {
  if (!pending.has(provider)) return null;
  const r = pending.get(provider);
  pending.delete(provider);
  return r;
}

/** Subscribe a mounted panel. → unsubscribe. */
export function onWearableResult(provider, fn, target = globalThis.window) {
  if (!target?.addEventListener) return () => {};
  const h = e => {
    if (e?.detail?.provider !== provider) return;
    const r = takeWearableResult(provider);
    if (r) fn(r);
  };
  target.addEventListener(WEARABLE_RETURN_EVENT, h);
  return () => target.removeEventListener(WEARABLE_RETURN_EVENT, h);
}

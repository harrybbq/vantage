/**
 * OAuth `state` for wearable account-linking — issue and verify.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 * The original state was `${userId}.${HMAC(userId)}`: deterministic,
 * eternal, and tied to nothing but the account. That is enough to stop
 * someone FORGING a state, and not enough to stop them REUSING one.
 *
 * The attack it allowed, entirely from a normal account:
 *   1. Attacker starts a connect flow and reads their own state — it
 *      never changes and never expires.
 *   2. Attacker sends the victim a provider authorize link carrying the
 *      ATTACKER's state.
 *   3. Victim approves on the provider (they may already be signed in).
 *   4. The provider redirects to our callback with the VICTIM's code and
 *      the ATTACKER's state. The HMAC verifies — it is a real state.
 *   5. We exchange the victim's code and file the VICTIM's tokens under
 *      the ATTACKER's user_id.
 *
 * The attacker's account then syncs the victim's sleep, HRV, resting
 * heart rate and workouts. Health data, which UK GDPR treats as special
 * category, delivered to the wrong person. Harmless while the feature
 * was owner-only; a real vulnerability the moment every user can link a
 * device.
 *
 * ── What replaces it ────────────────────────────────────────────────
 * Three properties the old state lacked:
 *
 *   single-use   a random nonce, echoed in an HttpOnly cookie that the
 *                callback consumes and clears. A state without its
 *                matching cookie is refused, so a state lifted from a
 *                URL is worthless in anyone else's browser.
 *   short-lived  a signed expiry, default 10 minutes. Even the browser
 *                that issued it cannot replay one tomorrow.
 *   bound        the cookie is set on OUR origin at connect time, so
 *                only the browser that started the flow can finish it.
 *
 * SameSite=Lax is deliberate and load-bearing: the provider's redirect
 * back to us is a top-level GET navigation, which Lax permits, while
 * still withholding the cookie from cross-site subrequests. `Strict`
 * would drop the cookie on the very redirect this depends on.
 *
 * The HMAC key is OAUTH_STATE_SECRET when set, falling back to the
 * provider's client secret so existing deployments keep working without
 * new configuration.
 */
const crypto = require('crypto');

const COOKIE = 'vantage_oauth_nonce';
const TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const b64url = buf => Buffer.from(buf).toString('base64url');

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/** Constant-time compare — a plain === on a MAC leaks it a byte at a
 *  time to anyone patient enough to measure. */
function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function secretFor(env, provider) {
  return env.OAUTH_STATE_SECRET
    || (provider === 'oura' ? env.OURA_CLIENT_SECRET : env.WHOOP_CLIENT_SECRET)
    || '';
}

/**
 * → { state, cookie } — put `state` in the authorize URL and return
 * `cookie` as a Set-Cookie header on the same response.
 */
function issueState(userId, provider, env) {
  const secret = secretFor(env, provider);
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = b64url(JSON.stringify({ u: userId, p: provider, n: nonce, e: Date.now() + TTL_MS }));
  const state = `${payload}.${hmac(payload, secret)}`;
  const cookie = [
    `${COOKIE}=${nonce}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ].join('; ');
  return { state, cookie };
}

function readCookie(event, name) {
  const raw = event.headers?.cookie || event.headers?.Cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/**
 * → { userId } when the state is authentic, unexpired, for this
 * provider, and accompanied by its own nonce cookie. Otherwise
 * { error: '<reason>' } — the reason is for our logs and the redirect
 * marker, never a hint to an attacker about which check failed.
 *
 * `clearCookie` should be sent back on the redirect so the nonce cannot
 * be used twice.
 */
function verifyState(stateStr, provider, event, env) {
  const secret = secretFor(env, provider);
  if (!secret) return { error: 'notconfigured' };

  const [payload, sig] = String(stateStr || '').split('.');
  if (!payload || !sig) return { error: 'badstate' };
  if (!safeEqual(sig, hmac(payload, secret))) return { error: 'badstate' };

  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return { error: 'badstate' }; }
  if (!data || data.p !== provider) return { error: 'badstate' };
  // A native state is never finished by the browser path: it has no
  // cookie, and its proof of possession is the app's verifier, which
  // only the POST finish (verifyNativeState) checks.
  if (data.m) return { error: 'badstate' };
  if (!UUID_RE.test(String(data.u || ''))) return { error: 'badstate' };
  if (!data.e || Date.now() > data.e) return { error: 'expired' };

  // The single-use half: the nonce must come back from the browser that
  // started the flow.
  const cookieNonce = readCookie(event, COOKIE);
  if (!cookieNonce || !safeEqual(cookieNonce, data.n || '')) return { error: 'badstate' };

  return { userId: data.u };
}

const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/* ── Native starts (the Capacitor app) ────────────────────────────────
 *
 * The cookie cannot work in the app. The connect call is a fetch from
 * the WebView, the provider page opens in the SYSTEM browser
 * (SFSafariViewController / Chrome Custom Tabs), and the callback lands
 * there — a different cookie jar, so the nonce never comes back.
 *
 * Dropping the cookie and keeping only "signed + unexpired + provider"
 * would bring back exactly the attack described at the top of this
 * file: anyone can POST a native connect for their OWN account, mail the
 * resulting authorize link to a victim, and have the victim's code
 * filed under the attacker. The cookie's job — "only the place that
 * started the flow can finish it" — needs a replacement, not a removal.
 *
 * The replacement is the PKCE shape (RFC 7636), with our server as the
 * authorization server:
 *
 *   connect   the app makes a random 32-byte VERIFIER, keeps it on the
 *             device, and sends only its SHA-256 CHALLENGE. The signed
 *             state carries { u, p, n, e, m:'native', c:challenge }.
 *   callback  (GET, in the system browser) checks signature, provider
 *             and expiry, and does NOT exchange the code. It hands
 *             `code` + `state` to com.vantage.app://wearable-callback.
 *   finish    (POST from the app, with the Supabase JWT) — the code is
 *             exchanged only when SHA-256(verifier) matches the
 *             challenge AND the JWT's user is the user inside the state.
 *
 * So a native state lifted from a URL is as worthless as a web one: the
 * attacker's link, approved by a victim, sends the victim's code to the
 * victim's own phone, where the victim's app holds no verifier for it
 * and signs in as a different user than the state names.
 *
 * Single use. The authorization code is single-use at the provider
 * (RFC 6749 §4.1.2: a second exchange MUST be denied), so a replayed
 * finish fails at the token exchange and stores nothing; the state
 * expires in 10 minutes; the app deletes its verifier after one try;
 * and `consumeNonce` below refuses a nonce this instance has already
 * finished. That last one is per function instance — a brake, not the
 * guarantee; the provider's code is the guarantee, and it is enforced
 * by the party that issued it, which is the right place for it. No
 * table, so nothing for the owner to migrate and no DB round trip.
 *
 * Residual risk, same as every custom-scheme OAuth return (and as item
 * 42's sign-in): a malicious app on the VICTIM's phone that registers
 * our scheme, combined with a phished approval inside 10 minutes. The
 * fix for that class is verified links (Android App Links / iOS
 * Universal Links on the https site) — see STARTUP item 115.
 */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;      // base64url SHA-256, no padding
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;   // RFC 7636 §4.1 length range

const sha256url = v => crypto.createHash('sha256').update(String(v)).digest('base64url');

/** True for a well-formed challenge: what the connect call must send. */
const isChallenge = c => CHALLENGE_RE.test(String(c || ''));

/**
 * → state string for a native start. No cookie: the challenge inside it
 * is what binds the flow to the device that holds the verifier.
 */
function issueNativeState(userId, provider, challenge, env) {
  if (!isChallenge(challenge)) throw new Error('bad challenge');
  const secret = secretFor(env, provider);
  const nonce = crypto.randomBytes(16).toString('base64url');
  const payload = b64url(JSON.stringify({
    u: userId, p: provider, n: nonce, e: Date.now() + TTL_MS, m: 'native', c: challenge,
  }));
  return `${payload}.${hmac(payload, secret)}`;
}

/** Signature-checked payload, or null. Expiry is the caller's call. */
function readSigned(stateStr, provider, env) {
  const secret = secretFor(env, provider);
  if (!secret) return null;
  const [payload, sig, extra] = String(stateStr || '').split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(payload, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && data.p === provider ? data : null;
  } catch { return null; }
}

/**
 * 'native' | 'web' | null — which return path an AUTHENTIC state asked
 * for. The callback uses it to decide where to send the browser, so an
 * unsigned or foreign state never earns the app-scheme redirect.
 */
function stateMode(stateStr, provider, env) {
  const data = readSigned(stateStr, provider, env);
  if (!data) return null;
  return data.m === 'native' ? 'native' : 'web';
}

/**
 * The callback's GET-time check of a native state: authentic, for this
 * provider, unexpired. Proof of possession comes later, at finish.
 */
function checkNativeState(stateStr, provider, env) {
  if (!secretFor(env, provider)) return { error: 'notconfigured' };
  const data = readSigned(stateStr, provider, env);
  if (!data || data.m !== 'native') return { error: 'badstate' };
  if (!UUID_RE.test(String(data.u || ''))) return { error: 'badstate' };
  if (!data.e || Date.now() > data.e) return { error: 'expired' };
  return { ok: true };
}

/**
 * The finish check. `userId` is the caller's VERIFIED id (requireUser),
 * `verifier` the preimage the app kept. → { userId, nonce } or
 * { error } with the same deliberately vague reasons as verifyState.
 */
function verifyNativeState(stateStr, provider, { userId, verifier } = {}, env) {
  const base = checkNativeState(stateStr, provider, env);
  if (base.error) return base;
  const data = readSigned(stateStr, provider, env);
  if (!VERIFIER_RE.test(String(verifier || ''))) return { error: 'badstate' };
  if (!isChallenge(data.c) || !safeEqual(sha256url(verifier), data.c)) return { error: 'badstate' };
  if (!userId || !safeEqual(String(userId), String(data.u))) return { error: 'badstate' };
  return { userId: data.u, nonce: String(data.n || ''), expires: data.e };
}

// Nonces finished on THIS instance, with their expiry so the set prunes
// itself. See "Single use" above for why this is a brake, not the lock.
const USED = new Map();
function consumeNonce(nonce, expires) {
  const now = Date.now();
  for (const [k, e] of USED) if (e < now) USED.delete(k);
  if (!nonce || USED.has(nonce)) return false;
  USED.set(nonce, expires || now + TTL_MS);
  return true;
}

module.exports = {
  issueState, verifyState, clearCookie, COOKIE,
  issueNativeState, stateMode, checkNativeState, verifyNativeState, consumeNonce, isChallenge, sha256url,
  TTL_MS,
};

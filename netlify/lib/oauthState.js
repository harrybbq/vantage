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
  if (!UUID_RE.test(String(data.u || ''))) return { error: 'badstate' };
  if (!data.e || Date.now() > data.e) return { error: 'expired' };

  // The single-use half: the nonce must come back from the browser that
  // started the flow.
  const cookieNonce = readCookie(event, COOKIE);
  if (!cookieNonce || !safeEqual(cookieNonce, data.n || '')) return { error: 'badstate' };

  return { userId: data.u };
}

const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

module.exports = { issueState, verifyState, clearCookie, COOKIE };

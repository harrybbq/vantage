/**
 * Withdraw Vantage's access at the provider, before the stored tokens
 * are deleted (item 125, 2026-10-20).
 *
 * WHOOP documents `DELETE https://api.prod.whoop.com/developer/v2/user/access`
 * (operation revokeUserOauthAccess: no body, 204 on success; 400 / 401 /
 * 429 / 500 otherwise) and asks apps to call it when a user disconnects.
 * Deleting our token row alone stops us using the grant, but leaves it
 * live in the user's WHOOP account. Called from:
 *   · wearable-disconnect (Disconnect on the WHOOP panel), and
 *   · delete-account, before the auth delete whose cascade removes the
 *     token rows.
 *
 * Oura: UNVERIFIED. A community client library has a revokeAccessToken
 * call (reportedly `GET https://api.ouraring.com/oauth/revoke?access_token=…`),
 * but Oura's own docs could not be read from the build machine on
 * 2026-10-20 and guessing an endpoint is worse than not calling one. Set
 * `revoke` below once confirmed from cloud.ouraring.com/docs/authentication
 * (question Q5 in docs/WEARABLE_APPROVALS.md §3.2). Until then Oura
 * disconnect deletes the tokens only, as before.
 *
 * Best effort, always: every failure is logged (status only, never a
 * token or user id) and swallowed. The caller deletes the token row
 * whatever happens here — a provider outage must never leave a user
 * unable to disconnect or delete their account.
 */
const whoop = require('./whoop');
const oura = require('./oura');

const TIMEOUT_MS = 5000;

const PROVIDERS = {
  whoop: {
    getFreshToken: whoop.getFreshToken,
    revoke: token => ({
      url: 'https://api.prod.whoop.com/developer/v2/user/access',
      init: { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    }),
  },
  oura: {
    getFreshToken: oura.getFreshToken,
    revoke: null, // unverified — see header
  },
};

/** whoop.js / oura.js read env.SUPABASE_URL only; the functions also accept VITE_SUPABASE_URL. */
function normaliseEnv(env) {
  const e = env || {};
  return e.SUPABASE_URL ? e : { ...e, SUPABASE_URL: e.VITE_SUPABASE_URL };
}

async function fetchWithTimeout(url, init, ms, fetchImpl) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    return await fetchImpl(url, ctl ? { ...init, signal: ctl.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Revoke one provider's grant for a user. Never throws.
 * → { provider, attempted, revoked, reason }
 *    reason: 'unsupported' | 'not-connected' | 'not-configured' | 'token' | 'status-<n>' | 'network' | 'ok'
 */
async function revokeProvider(provider, userId, env = process.env, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, getToken } = {}) {
  const p = PROVIDERS[provider];
  if (!p || !p.revoke) return { provider, attempted: false, revoked: false, reason: 'unsupported' };
  const e = normaliseEnv(env);
  if (!e.SUPABASE_URL) return { provider, attempted: false, revoked: false, reason: 'not-configured' };

  let token = null;
  try {
    // Refreshes first when the access token is near expiry (and persists
    // the rotated refresh token, as every sync does).
    token = await (getToken || p.getFreshToken)(userId, e);
  } catch (err) {
    // A spent refresh token means the grant is already unusable to us;
    // nothing to revoke with. Logged without detail.
    console.warn(`wearable-revoke: ${provider} token unavailable (${err && err.whoopStatus ? err.whoopStatus : 'error'}) — tokens will still be deleted`);
    return { provider, attempted: false, revoked: false, reason: 'token' };
  }
  if (!token) return { provider, attempted: false, revoked: false, reason: 'not-connected' };

  const { url, init } = p.revoke(token);
  try {
    const res = await fetchWithTimeout(url, init, timeoutMs, fetchImpl);
    // 204 is the documented success.
    if (res.ok) return { provider, attempted: true, revoked: true, reason: 'ok' };
    console.warn(`wearable-revoke: ${provider} revoke returned ${res.status} — tokens will still be deleted`);
    return { provider, attempted: true, revoked: false, reason: `status-${res.status}` };
  } catch {
    console.warn(`wearable-revoke: ${provider} revoke unreachable — tokens will still be deleted`);
    return { provider, attempted: true, revoked: false, reason: 'network' };
  }
}

/** Every provider, in parallel (account deletion). Never throws. */
async function revokeAll(userId, env = process.env, opts = {}) {
  const out = await Promise.all(Object.keys(PROVIDERS).map(p => revokeProvider(p, userId, env, opts).catch(() => ({ provider: p, attempted: false, revoked: false, reason: 'error' }))));
  return out;
}

module.exports = { revokeProvider, revokeAll, PROVIDERS, TIMEOUT_MS };

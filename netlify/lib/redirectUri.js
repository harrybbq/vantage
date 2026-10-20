/**
 * The OAuth redirect URI, in one place.
 *
 * Both wearable flows used to build this from `event.headers.host` —
 * whatever hostname the browser happened to arrive on. That works only
 * while every visitor uses the exact host registered with the provider,
 * and nothing enforces that: the apex and `www.`, the `*.netlify.app`
 * fallback domain, a deploy preview and an installed PWA can all reach
 * the same site under different hosts. Land on any of them and the
 * provider sees a `redirect_uri` it has never been shown, which is what
 * produces
 *
 *   Error: invalid_request
 *   Hint: The "redirect_uri" parameter does not match any of the
 *         OAuth 2.0 Client's pre-registered redirect urls.
 *
 * A redirect URI is a value you REGISTER, so it has to be a constant, not
 * something derived from the request. Resolution order:
 *
 *   1. OAUTH_REDIRECT_BASE — set this in Netlify when the value you have
 *      registered with WHOOP/Oura is not the site's primary URL.
 *   2. URL — Netlify's own env var holding the site's main address. This
 *      is the right default: it is the same string no matter which alias
 *      the browser used to get here.
 *   3. The request host — last resort, so a site with neither configured
 *      behaves as it did before rather than failing outright.
 *
 * The authorize call and the token exchange MUST send byte-identical
 * values or the exchange is rejected, which is the other reason this is
 * one function rather than two string literals in two files.
 */

function siteBase(event) {
  const configured = process.env.OAUTH_REDIRECT_BASE || process.env.URL || '';
  const base = configured.trim().replace(/\/+$/, '');
  if (base) return base;
  return `https://${event?.headers?.host || ''}`;
}

/** e.g. https://example.com/.netlify/functions/whoop-callback */
function redirectUriFor(event, provider) {
  return `${siteBase(event)}/.netlify/functions/${provider}-callback`;
}

/**
 * Where to send the browser after the flow finishes. Same reasoning:
 * bouncing the user back to `event.headers.host` can drop them on a
 * different origin from the one they started on, which loses the
 * Supabase session stored there.
 */
function appUrl(event, query = '') {
  return `${siteBase(event)}/${query ? '?' + query : ''}`;
}

/**
 * Where a NATIVE start goes after the callback: back into the app, not
 * to the website. The provider still redirects to the registered https
 * callback above (providers only accept registered URIs, and a custom
 * scheme there would be one more value to keep in sync); it is the
 * callback that forwards to the app.
 *
 * A constant, like the redirect URI: the scheme is the bundle id
 * (capacitor.config.ts) and the host is the one the app's intent filter
 * and src/lib/native/wearableReturn.js listen for. Never built from the
 * request, so the callback cannot be made to redirect anywhere else.
 *
 * Carries a status and, for the hand-off, the one-time code + state.
 * Never a token: the code is useless without the client secret (server
 * only) AND the verifier the app kept AND the user's session — see
 * lib/oauthState.js "Native starts".
 */
const NATIVE_RETURN = 'com.vantage.app://wearable-callback';

function nativeReturnUrl(provider, params = {}) {
  const q = new URLSearchParams({ provider });
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v));
  return `${NATIVE_RETURN}?${q}`;
}

module.exports = { siteBase, redirectUriFor, appUrl, nativeReturnUrl, NATIVE_RETURN };

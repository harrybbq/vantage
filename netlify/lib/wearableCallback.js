/**
 * The wearable OAuth callback, shared by whoop-callback and oura-callback.
 *
 * Two ways in, decided by the (signed) state the connect call issued:
 *
 *   WEB    GET from the provider's redirect, in the browser that started
 *          the flow. Unchanged from before the native work: verifyState
 *          (signature + expiry + provider + the HttpOnly nonce cookie),
 *          exchange the code, store the tokens, burn the cookie, 302 to
 *          the site root with `?<provider>=<result>`.
 *
 *   NATIVE two steps, because the system browser the provider page runs
 *          in is not the app (lib/oauthState.js "Native starts"):
 *     GET  — the provider's redirect, in the system browser. Check the
 *            state is authentic, for this provider and unexpired; do NOT
 *            exchange. 302 to com.vantage.app://wearable-callback with
 *            status=ready + code + state (or status=error|paused +
 *            reason). The OS hands that URL to the app.
 *     POST — the app, with its Supabase JWT and the verifier it kept.
 *            Exchange only when the verifier matches the state's
 *            challenge AND the JWT's user is the state's user. JSON back.
 *
 * The redirect_uri sent in the token exchange is the same registered
 * https constant either way (lib/redirectUri) — it must be byte-identical
 * to the authorize call's, and the authorize call always sends that one.
 */
const { paused, pausedResponse } = require('./killSwitch');
const sbKeys = require('./sbKeys');
const {
  verifyState, clearCookie, stateMode, checkNativeState, verifyNativeState, consumeNonce,
} = require('./oauthState');
const { redirectUriFor, appUrl, nativeReturnUrl } = require('./redirectUri');
const { requireUser, underLimit, tooMany } = require('./requireUser');

// Only the app's finish POST is a cross-origin fetch (capacitor://localhost,
// https://localhost). No credentials ride on it — the JWT is a header.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

/**
 * @param {{
 *   provider: 'whoop'|'oura',
 *   tokenUrl: string,
 *   table: string,              e.g. 'whoop_tokens'
 *   clientIdVar: string,        env var names
 *   clientSecretVar: string,
 *   defaultExpiresIn: number,   seconds, when the provider omits expires_in
 *   requireTokens: boolean,     refuse a 200 that carries no tokens (Oura)
 * }} cfg
 */
function makeCallback(cfg) {
  const { provider } = cfg;

  function webRedirect(event, result) {
    // Always burn the nonce, success or failure — a state that
    // survives one attempt is a state that can be retried.
    // Back to the site's canonical origin, not the request host: the two
    // can differ, and the Supabase session lives on the origin the user
    // actually signed in on.
    return {
      statusCode: 302,
      headers: { Location: appUrl(event, `${provider}=${result}`), 'Set-Cookie': clearCookie },
      body: '',
    };
  }

  function nativeRedirect(params) {
    return {
      statusCode: 302,
      headers: {
        Location: nativeReturnUrl(provider, params),
        // The hand-off URL carries a one-time code: keep it out of caches
        // and out of any Referer the browser might send onwards.
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
      body: '',
    };
  }

  /** → 'connected' or a short reason. Never throws. */
  async function exchangeAndStore(event, userId, code) {
    const env = process.env;
    const serviceKey = sbKeys.serviceKey(env);
    try {
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: env[cfg.clientIdVar],
          client_secret: env[cfg.clientSecretVar],
          // Byte-identical to what the connect call sent, or the provider
          // rejects the exchange. Both come from the same helper so they
          // cannot drift — and it is the same for web and native starts.
          redirect_uri: redirectUriFor(event, provider),
        }),
      });
      if (!tokenRes.ok) {
        console.error(`${provider} token exchange failed:`, tokenRes.status, await tokenRes.text().catch(() => ''));
        return 'tokenfail';
      }
      const tok = await tokenRes.json();
      if (cfg.requireTokens && (!tok.access_token || !tok.refresh_token)) {
        console.error(`${provider} token exchange returned no tokens`);
        return 'tokenfail';
      }
      const expiresAt = new Date(Date.now() + (tok.expires_in || cfg.defaultExpiresIn) * 1000).toISOString();

      const up = await fetch(`${env.SUPABASE_URL}/rest/v1/${cfg.table}`, {
        method: 'POST',
        headers: sbKeys.serviceKeyHeaders(serviceKey, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify({
          user_id: userId,
          access_token: tok.access_token,
          refresh_token: tok.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!up.ok) {
        console.error(`${provider} token store failed:`, up.status, await up.text().catch(() => ''));
        return 'storefail';
      }
      return 'connected';
    } catch (e) {
      console.error(`${provider} callback error:`, e?.message);
      return 'error';
    }
  }

  async function webGet(event, q) {
    // Kill switch (lib/killSwitch): a browser redirect, so say it with the
    // same ?provider=<result> the app already reads rather than a 503 page.
    if (paused('sync')) return webRedirect(event, 'paused');
    if (q.error) return webRedirect(event, 'denied');
    // Authentic, unexpired, for this provider, AND accompanied by
    // the nonce cookie set when this browser began the flow.
    const checked = verifyState(q.state, provider, event, process.env);
    if (checked.error) return webRedirect(event, checked.error);
    if (!q.code) return webRedirect(event, 'nocode');
    return webRedirect(event, await exchangeAndStore(event, checked.userId, q.code));
  }

  function nativeGet(q) {
    if (paused('sync')) return nativeRedirect({ status: 'paused' });
    if (q.error) return nativeRedirect({ status: 'error', reason: 'denied' });
    const checked = checkNativeState(q.state, provider, process.env);
    if (checked.error) return nativeRedirect({ status: 'error', reason: checked.error });
    if (!q.code) return nativeRedirect({ status: 'error', reason: 'nocode' });
    // The hand-off. No exchange here: this browser can't prove it is the
    // device that started the flow; the app can (verifier + session).
    return nativeRedirect({ status: 'ready', code: q.code, state: q.state });
  }

  async function nativeFinish(event) {
    const json = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });
    if (paused('sync')) return pausedResponse('sync', CORS);

    const auth = await requireUser(event, CORS);
    if (auth.error) return auth.error;
    if (!underLimit(`${provider}-finish`, auth.userId, 10)) return tooMany(CORS);

    let body = {};
    try { body = JSON.parse(event.body || '{}') || {}; } catch { /* treated as missing */ }
    const code = typeof body.code === 'string' ? body.code : '';
    if (!code || code.length > 2048) return json(400, { error: 'nocode' });

    const checked = verifyNativeState(body.state, provider, { userId: auth.userId, verifier: body.verifier }, process.env);
    if (checked.error) return json(checked.error === 'notconfigured' ? 500 : 403, { error: checked.error });
    if (!consumeNonce(checked.nonce, checked.expires)) return json(403, { error: 'badstate' });

    const result = await exchangeAndStore(event, checked.userId, code);
    if (result !== 'connected') return json(502, { error: result });
    return json(200, { ok: true, status: 'connected' });
  }

  return async function handler(event) {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    if (event.httpMethod === 'POST') return nativeFinish(event);
    const q = event.queryStringParameters || {};
    // Only an AUTHENTIC native state earns the app-scheme redirect;
    // anything else (web state, forged, missing) takes the web path,
    // which is exactly what happened before native starts existed.
    if (stateMode(q.state, provider, process.env) === 'native') return nativeGet(q);
    return webGet(event, q);
  };
}

module.exports = { makeCallback, CORS };

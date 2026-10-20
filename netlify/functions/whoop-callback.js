/**
 * Netlify function: whoop-callback
 *
 * Step 2 of the WHOOP OAuth flow. WHOOP redirects here with
 * ?code&state.
 *
 *   Web start    verify the state (signature, expiry, provider, and the
 *                HttpOnly nonce cookie), exchange the code, store the
 *                tokens in whoop_tokens (service-role only), and bounce
 *                back to the site with ?whoop=<result>.
 *   Native start hand the code to the app at
 *                com.vantage.app://wearable-callback; the app POSTs it
 *                back here with its session and PKCE-style verifier, and
 *                only then is it exchanged.
 *
 * The logic lives in lib/wearableCallback.js so WHOOP and Oura cannot
 * drift apart; see there and lib/oauthState.js for the why.
 */
const { makeCallback } = require('../lib/wearableCallback');

exports.handler = makeCallback({
  provider: 'whoop',
  tokenUrl: 'https://api.prod.whoop.com/oauth/oauth2/token',
  table: 'whoop_tokens',
  clientIdVar: 'WHOOP_CLIENT_ID',
  clientSecretVar: 'WHOOP_CLIENT_SECRET',
  defaultExpiresIn: 3600,
  requireTokens: false,
});

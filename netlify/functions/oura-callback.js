/**
 * Netlify function: oura-callback
 *
 * Step 2 of the Oura OAuth flow, mirroring whoop-callback. Oura
 * redirects here with ?code&state.
 *
 *   Web start    verify the state (signature, expiry, provider, and the
 *                HttpOnly nonce cookie), exchange the code, store the
 *                tokens in oura_tokens (service-role only), and bounce
 *                back to the site with ?oura=<result>.
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
  provider: 'oura',
  tokenUrl: 'https://api.ouraring.com/oauth/token',
  table: 'oura_tokens',
  clientIdVar: 'OURA_CLIENT_ID',
  clientSecretVar: 'OURA_CLIENT_SECRET',
  defaultExpiresIn: 86400,
  // Oura has answered 200 without tokens; storing nulls would look
  // connected and fail every sync.
  requireTokens: true,
});

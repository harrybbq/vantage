/**
 * Netlify function: whoop-connect
 *
 * Step 1 of the WHOOP OAuth flow. The signed-in user POSTs here with
 * their Supabase JWT; we return the WHOOP authorize URL carrying a
 * signed, expiring, single-use `state` (lib/oauthState.js).
 *
 * Body (optional JSON): { platform: 'native', challenge } from the
 * Capacitor app. A native start gets a cookie-less state bound to the
 * app's PKCE-style challenge instead of the nonce cookie, because the
 * provider page runs in the system browser, which never sees our
 * cookie. No body (the web) → the cookie flow, unchanged.
 *
 * Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET (HMAC key),
 *      SUPABASE_URL and the service key (lib/sbKeys).
 */
const { issueState, issueNativeState, isChallenge } = require('../lib/oauthState');
const { redirectUriFor } = require('../lib/redirectUri');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { checkWearableAccess, accessGate, accessStatus } = require('../lib/wearableAccess');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const SCOPES = 'offline read:recovery read:sleep read:workout read:cycles read:profile';


exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = process.env;
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    console.error('whoop-connect: WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET not set');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP is not set up on this site yet.' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('whoop-connect', userId, 10)) return tooMany(CORS);

  let req = {};
  try { req = JSON.parse(event.body || '{}') || {}; } catch { /* no body: web */ }
  // Item 127: while WHOOP reviews Vantage only listed accounts may start a
  // connect (lib/wearableAccess.js; open until the owner flips the
  // switch). { check: true } asks without starting anything, so the
  // panel can say so before the button is pressed.
  if (req.check === true) {
    const a = await checkWearableAccess({ userId, email: auth.email, provider: 'whoop' });
    return { statusCode: 200, headers: CORS, body: JSON.stringify(accessStatus(a, 'whoop')) };
  }
  const refused = await accessGate({ userId, email: auth.email, provider: 'whoop' }, CORS);
  if (refused) return refused;

  // Constant, registrable value — NOT the request's host. See lib/redirectUri.
  const redirectUri = redirectUriFor(event, 'whoop');
  // Logged because when WHOOP rejects it the user sees WHOOP's error page,
  // not ours, so this is the only place the actual value is visible.
  console.info('whoop-connect: redirect_uri', redirectUri);
  // Native (the Capacitor app) or web? Only an explicit, well-formed
  // native request leaves the cookie flow; anything else is the web
  // flow exactly as it was.
  const native = req.platform === 'native';
  if (native && !isChallenge(req.challenge)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Could not start connect — please try again.' }) };
  }
  const { state, cookie } = native
    ? { state: issueNativeState(userId, 'whoop', req.challenge, process.env), cookie: null }
    : issueState(userId, 'whoop', process.env);
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  // Web: the nonce cookie is what makes the state single-use and
  // browser-bound; the callback refuses a web state without it.
  // Native: no cookie — the challenge inside the state does that job.
  //
  // redirectUri and clientId are echoed back so the two halves of a
  // "redirect_uri does not match" failure are both inspectable. The
  // redirect alone is not enough to diagnose it: a redirect URL is
  // registered ON a specific WHOOP app, so a correct-looking URL
  // registered against a DIFFERENT app than the client_id in Netlify
  // fails in exactly the same way and looks identical from the outside.
  // client_id is not a secret — WHOOP puts it in the authorize URL.
  return {
    statusCode: 200,
    headers: cookie ? { ...CORS, 'Set-Cookie': cookie } : CORS,
    body: JSON.stringify({ ok: true, url, redirectUri, clientId: WHOOP_CLIENT_ID }),
  };
};

/**
 * Netlify function: whoop-connect
 *
 * Step 1 of the WHOOP OAuth flow. The signed-in user POSTs here with
 * their Supabase JWT; we return the WHOOP authorize URL carrying a
 * tamper-proof `state` (userId + HMAC) so the callback can bind the
 * tokens to the right account without any session storage.
 *
 * Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET (HMAC key),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
const { issueState } = require('../lib/oauthState');
const { redirectUriFor } = require('../lib/redirectUri');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = process.env;
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP env missing — set WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in Netlify' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('whoop-connect', userId, 10)) return tooMany(CORS);

  // Constant, registrable value — NOT the request's host. See lib/redirectUri.
  const redirectUri = redirectUriFor(event, 'whoop');
  // Logged because when WHOOP rejects it the user sees WHOOP's error page,
  // not ours, so this is the only place the actual value is visible.
  console.info('whoop-connect: redirect_uri', redirectUri);
  const { state, cookie } = issueState(userId, 'whoop', process.env);
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  // The nonce cookie is what makes the state single-use and
  // browser-bound; the callback refuses a state without it.
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
    headers: { ...CORS, 'Set-Cookie': cookie },
    body: JSON.stringify({ ok: true, url, redirectUri, clientId: WHOOP_CLIENT_ID }),
  };
};

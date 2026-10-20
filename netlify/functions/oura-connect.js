/**
 * Netlify function: oura-connect
 *
 * Step 1 of the Oura OAuth flow, mirroring whoop-connect. The signed-in
 * user POSTs here with their Supabase JWT; we return the Oura authorize
 * URL carrying a signed, expiring, single-use `state` (lib/oauthState.js).
 *
 * Body (optional JSON): { platform: 'native', challenge } from the
 * Capacitor app — same branching as whoop-connect.
 *
 * Env: OURA_CLIENT_ID, OURA_CLIENT_SECRET (also the HMAC key),
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

const AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
// `daily` covers readiness + activity, `heartrate` the HR series behind
// sleep figures, `workout` the sessions we turn into burn entries.
// Deliberately no `personal` — we never need name/email/DOB, and not
// asking for it is one less thing to disclose in the privacy policy.
const SCOPES = 'daily heartrate workout';


exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const { OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;
  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
    console.error('oura-connect: OURA_CLIENT_ID / OURA_CLIENT_SECRET not set');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Oura is not set up on this site yet.' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('oura-connect', userId, 10)) return tooMany(CORS);

  let req = {};
  try { req = JSON.parse(event.body || '{}') || {}; } catch { /* no body: web */ }
  // Item 127: while Oura reviews Vantage only listed accounts may start a
  // connect (lib/wearableAccess.js; open until the owner flips the
  // switch). { check: true } asks without starting anything, so the
  // panel can say so before the button is pressed.
  if (req.check === true) {
    const a = await checkWearableAccess({ userId, email: auth.email, provider: 'oura' });
    return { statusCode: 200, headers: CORS, body: JSON.stringify(accessStatus(a, 'oura')) };
  }
  const refused = await accessGate({ userId, email: auth.email, provider: 'oura' }, CORS);
  if (refused) return refused;

  // Constant, registrable value — NOT the request's host. See lib/redirectUri.
  const redirectUri = redirectUriFor(event, 'oura');
  console.info('oura-connect: redirect_uri', redirectUri);
  // Native (the Capacitor app) or web? Only an explicit, well-formed
  // native request leaves the cookie flow; anything else is the web
  // flow exactly as it was.
  const native = req.platform === 'native';
  if (native && !isChallenge(req.challenge)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Could not start connect — please try again.' }) };
  }
  const { state, cookie } = native
    ? { state: issueNativeState(userId, 'oura', req.challenge, process.env), cookie: null }
    : issueState(userId, 'oura', process.env);
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: OURA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  // Web: the nonce cookie is what makes the state single-use and
  // browser-bound; the callback refuses a web state without it.
  // Native: no cookie — the challenge inside the state does that job.
  return {
    statusCode: 200,
    headers: cookie ? { ...CORS, 'Set-Cookie': cookie } : CORS,
    body: JSON.stringify({ ok: true, url, redirectUri }),
  };
};

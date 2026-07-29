/**
 * Netlify function: oura-connect
 *
 * Step 1 of the Oura OAuth flow, mirroring whoop-connect. The signed-in
 * user POSTs here with their Supabase JWT; we return the Oura authorize
 * URL carrying a tamper-proof `state` (userId + HMAC) so the callback
 * can bind the tokens to the right account without any session storage.
 *
 * Env: OURA_CLIENT_ID, OURA_CLIENT_SECRET (also the HMAC key),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
const { issueState } = require('../lib/oauthState');
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;
  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Oura env missing — set OURA_CLIENT_ID / OURA_CLIENT_SECRET in Netlify' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;
  if (!underLimit('oura-connect', userId, 10)) return tooMany(CORS);

  const redirectUri = `https://${event.headers.host}/.netlify/functions/oura-callback`;
  const { state, cookie } = issueState(userId, 'oura', process.env);
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: OURA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  // The nonce cookie is what makes the state single-use and
  // browser-bound; the callback refuses a state without it.
  return {
    statusCode: 200,
    headers: { ...CORS, 'Set-Cookie': cookie },
    body: JSON.stringify({ ok: true, url }),
  };
};

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
const crypto = require('crypto');

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

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;
  if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Oura env missing — set OURA_CLIENT_ID / OURA_CLIENT_SECRET in Netlify' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  const redirectUri = `https://${event.headers.host}/.netlify/functions/oura-callback`;
  const state = `${userId}.${sign(userId, OURA_CLIENT_SECRET)}`;
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: OURA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, url }) };
};

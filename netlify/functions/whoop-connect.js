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
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const SCOPES = 'offline read:recovery read:sleep read:workout read:cycles read:profile';

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = process.env;
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP env missing — set WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET in Netlify' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  const redirectUri = `https://${event.headers.host}/.netlify/functions/whoop-callback`;
  const state = `${userId}.${sign(userId, WHOOP_CLIENT_SECRET)}`;
  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id: WHOOP_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, url }) };
};

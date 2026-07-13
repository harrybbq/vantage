/**
 * Netlify function: whoop-sync
 *
 * Pulls the caller's recent WHOOP data (recovery, sleep, workouts,
 * cycles) and RETURNS it mapped to Vantage's store shapes — it never
 * writes user_data.state itself. The client merges via update(), so
 * every write flows through the normal save pipeline and its
 * anti-wipe guards (no server/client write races).
 *
 * POST, Bearer Supabase JWT. Body: { days?: number } (default 7,
 * max 30). Token refresh + mapping live in ../lib/whoop (shared with
 * the scheduled whoop-cron so the two paths never drift).
 *
 * Returns { ok, vitals:{date:{sleep,rhr,hrv,recovery,strain}},
 *           burn:{date:[{id,label,kcal}]} }
 */
const { getFreshToken, fetchWhoopData } = require('../lib/whoop');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const env = process.env;
  if (!env.WHOOP_CLIENT_ID || !env.WHOOP_CLIENT_SECRET) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'WHOOP env missing' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* fine */ }
  const days = Math.min(30, Math.max(1, parseInt(body.days) || 7));

  try {
    const accessToken = await getFreshToken(userId, env);
    if (!accessToken) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'not connected' }) };
    const { vitals, burn } = await fetchWhoopData(accessToken, days);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, days, vitals, burn }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message || 'whoop sync failed' }) };
  }
};

/**
 * Netlify function: wearable-disconnect
 *
 * Deletes the caller's stored OAuth tokens for a wearable, which is how
 * consent is withdrawn. The privacy policy already promises this —
 * "disconnect WHOOP in Settings (this also deletes the stored WHOOP
 * access tokens)" and "WHOOP tokens — deleted immediately when you
 * disconnect" — but nothing implemented it. Adding Oura made that a
 * promise about two integrations rather than one, so it's built for
 * both.
 *
 * POST, Bearer Supabase JWT. Body: { provider: 'whoop' | 'oura' }.
 *
 * You can only ever disconnect YOURSELF: the id comes from the verified
 * token, never the body, so there is no id to tamper with. The delete
 * needs the service role because the token tables are RLS-locked with
 * no policies — clients can't touch them directly by design.
 *
 * The synced vitals stay in the user's own state. Disconnecting stops
 * future syncing; it doesn't retract history the user may still want,
 * and deleting it would be a data-loss surprise. Account deletion
 * remains the route for erasing everything.
 */
const TABLES = { whoop: 'whoop_tokens', oura: 'oura_tokens' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const env = process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* treated as missing */ }
  const table = TABLES[String(body.provider || '').toLowerCase()];
  if (!table) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'unknown provider' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };
  const userRes = await fetch(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const userId = (await userRes.json())?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  try {
    const del = await fetch(`${url}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=minimal',
      },
    });
    // 404 = the table doesn't exist yet (schema SQL not run). Nothing is
    // stored, so the user is disconnected either way — say so rather
    // than showing an error for a state that is already correct.
    if (!del.ok && del.status !== 404) {
      const detail = await del.text().catch(() => '');
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'could not disconnect', detail: detail.slice(0, 200) }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: e.message || 'could not disconnect' }) };
  }
};

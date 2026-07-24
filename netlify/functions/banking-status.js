/**
 * banking-status — Open Banking foundation (SCAFFOLD).
 *
 * Reports whether Open Banking is configured on the server. Until the
 * Enable Banking credentials are set in Netlify env, this returns
 * { configured: false } and the client shows a "coming soon" state —
 * the app is otherwise unchanged. No DB, no secrets exposed.
 *
 * To go live later, set these Netlify env vars and implement the real
 * connect/callback/data functions:
 *   ENABLE_BANKING_APP_ID
 *   ENABLE_BANKING_PRIVATE_KEY   (PEM, server-only — never sent to client)
 *
 * GET. Returns { configured, connected, institution }.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const configured = !!(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY);
  // `connected` will be derived per-user from a bank_connections table
  // once the flow is live; scaffold reports false.
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ configured, connected: false, institution: null }),
  };
};

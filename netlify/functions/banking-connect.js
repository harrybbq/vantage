/**
 * banking-connect — Open Banking foundation (SCAFFOLD).
 *
 * Will start the bank-connect consent flow once Enable Banking is
 * configured: create an auth session server-side and return the hosted
 * consent `authUrl` for the client to redirect to. Until then it reports
 * not-configured so the client shows the coming-soon state.
 *
 * POST. Returns { authUrl } when live, or { ok: false, reason }.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };

  const configured = !!(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY);
  if (!configured) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'not_configured' }) };
  }

  // TODO (go-live): using ENABLE_BANKING_APP_ID + ENABLE_BANKING_PRIVATE_KEY,
  // create an Enable Banking auth session and return its consent URL.
  // Token exchange + account/transaction reads live in sibling functions;
  // credentials stay server-side only.
  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, reason: 'not_implemented' }) };
};

/**
 * Netlify function: whoop-callback
 *
 * Step 2 of the WHOOP OAuth flow. WHOOP redirects here with
 * ?code&state. We verify the state HMAC (binds to a Vantage user),
 * exchange the code for access+refresh tokens, store them in
 * whoop_tokens (service-role only), and bounce back into the app.
 */
const { verifyState, clearCookie } = require('../lib/oauthState');

const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';


function redirect(host, result) {
  // Always burn the nonce, success or failure — a state that
  // survives one attempt is a state that can be retried.
  return {
    statusCode: 302,
    headers: { Location: `https://${host}/?whoop=${result}`, 'Set-Cookie': clearCookie },
    body: '',
  };
}

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = process.env;
  const host = event.headers.host;
  const q = event.queryStringParameters || {};

  if (q.error) return redirect(host, 'denied');
  // Authentic, unexpired, for this provider, AND accompanied by
  // the nonce cookie set when this browser began the flow.
  const checked = verifyState(q.state, 'whoop', event, process.env);
  if (checked.error) return redirect(host, checked.error);
  const userId = checked.userId;
  if (!q.code) return redirect(host, 'nocode');

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.code,
        client_id: WHOOP_CLIENT_ID,
        client_secret: WHOOP_CLIENT_SECRET,
        redirect_uri: `https://${host}/.netlify/functions/whoop-callback`,
      }),
    });
    if (!tokenRes.ok) {
      console.error('whoop token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''));
      return redirect(host, 'tokenfail');
    }
    const tok = await tokenRes.json();
    const expiresAt = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();

    const up = await fetch(`${SUPABASE_URL}/rest/v1/whoop_tokens`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!up.ok) {
      console.error('whoop token store failed:', up.status, await up.text().catch(() => ''));
      return redirect(host, 'storefail');
    }
    return redirect(host, 'connected');
  } catch (e) {
    console.error('whoop callback error:', e?.message);
    return redirect(host, 'error');
  }
};

/**
 * Netlify function: oura-callback
 *
 * Step 2 of the Oura OAuth flow, mirroring whoop-callback. Oura
 * redirects here with ?code&state. We verify the state HMAC (binds to a
 * Vantage user), exchange the code for access+refresh tokens, store them
 * in oura_tokens (service-role only), and bounce back into the app.
 */
const { verifyState, clearCookie } = require('../lib/oauthState');
const { redirectUriFor, appUrl } = require('../lib/redirectUri');

const TOKEN_URL = 'https://api.ouraring.com/oauth/token';


function redirect(event, result) {
  // Always burn the nonce, success or failure — a state that
  // survives one attempt is a state that can be retried.
  // Canonical origin, not the request host — see whoop-callback.
  return {
    statusCode: 302,
    headers: { Location: appUrl(event, `oura=${result}`), 'Set-Cookie': clearCookie },
    body: '',
  };
}

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;
  const q = event.queryStringParameters || {};

  if (q.error) return redirect(event, 'denied');
  // Authentic, unexpired, for this provider, AND accompanied by
  // the nonce cookie set when this browser began the flow.
  const checked = verifyState(q.state, 'oura', event, process.env);
  if (checked.error) return redirect(event, checked.error);
  const userId = checked.userId;
  if (!q.code) return redirect(event, 'nocode');

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.code,
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
        // Byte-identical to what oura-connect sent, from the same helper.
        redirect_uri: redirectUriFor(event, 'oura'),
      }),
    });
    if (!tokenRes.ok) {
      console.error('oura token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''));
      return redirect(event, 'tokenfail');
    }
    const tok = await tokenRes.json();
    if (!tok.access_token || !tok.refresh_token) {
      console.error('oura token exchange returned no tokens');
      return redirect(event, 'tokenfail');
    }
    const expiresAt = new Date(Date.now() + (tok.expires_in || 86400) * 1000).toISOString();

    const up = await fetch(`${SUPABASE_URL}/rest/v1/oura_tokens`, {
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
      console.error('oura token store failed:', up.status, await up.text().catch(() => ''));
      return redirect(event, 'storefail');
    }
    return redirect(event, 'connected');
  } catch (e) {
    console.error('oura callback error:', e?.message);
    return redirect(event, 'error');
  }
};

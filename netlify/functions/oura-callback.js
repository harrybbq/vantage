/**
 * Netlify function: oura-callback
 *
 * Step 2 of the Oura OAuth flow, mirroring whoop-callback. Oura
 * redirects here with ?code&state. We verify the state HMAC (binds to a
 * Vantage user), exchange the code for access+refresh tokens, store them
 * in oura_tokens (service-role only), and bounce back into the app.
 */
const crypto = require('crypto');

const TOKEN_URL = 'https://api.ouraring.com/oauth/token';

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function redirect(host, result) {
  return { statusCode: 302, headers: { Location: `https://${host}/?oura=${result}` }, body: '' };
}

exports.handler = async (event) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OURA_CLIENT_ID, OURA_CLIENT_SECRET } = process.env;
  const host = event.headers.host;
  const q = event.queryStringParameters || {};

  if (q.error) return redirect(host, 'denied');
  const [userId, sig] = String(q.state || '').split('.');
  if (!userId || sig !== sign(userId, OURA_CLIENT_SECRET || '')) return redirect(host, 'badstate');
  if (!q.code) return redirect(host, 'nocode');

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.code,
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
        redirect_uri: `https://${host}/.netlify/functions/oura-callback`,
      }),
    });
    if (!tokenRes.ok) {
      console.error('oura token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''));
      return redirect(host, 'tokenfail');
    }
    const tok = await tokenRes.json();
    if (!tok.access_token || !tok.refresh_token) {
      console.error('oura token exchange returned no tokens');
      return redirect(host, 'tokenfail');
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
      return redirect(host, 'storefail');
    }
    return redirect(host, 'connected');
  } catch (e) {
    console.error('oura callback error:', e?.message);
    return redirect(host, 'error');
  }
};

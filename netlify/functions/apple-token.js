/**
 * Netlify function: apple-token  (STARTUP_REQUIREMENTS item 117)
 *
 * Keeps the user's Sign in with Apple refresh token server-side so
 * delete-account can revoke it, as Apple expects of apps that offer
 * Sign in with Apple. Supabase hands the token to the client exactly
 * once, right after an Apple sign-in, and does not keep it — see
 * lib/appleRevoke.js for the whole flow.
 *
 * POST, Bearer Supabase JWT. Body: { refresh_token: string }
 *   200 { ok: true, stored: true }
 *   200 { ok: true, stored: false, reason }   — not an Apple sign-in in
 *       the last 10 minutes, or the SQL has not been run yet (fail soft:
 *       the client never retries or shows anything)
 *   400 bad body · 401 no session · 429 rate limit · 503 database down
 *
 * The token is only ever written for the caller's own account (id from
 * the verified JWT), only when the caller's NEWEST identity is Apple and
 * was stamped within the capture window, and it is never returned.
 * Stored in public.apple_tokens (supabase/apple_revocation_2026_10.sql:
 * RLS on, no policies, no client grant), encrypted with
 * APPLE_TOKEN_SECRET when that is set.
 *
 * Not behind the kill switch: it is part of account deletion's promise,
 * and it costs one upsert.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const sbKeys = require('../lib/sbKeys');
const { appleSignInIsFresh, cleanToken, sealToken } = require('../lib/appleRevoke');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const json = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  const env = process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = sbKeys.serviceKey(env);
  if (!url || !serviceKey) return json(200, { ok: true, stored: false, reason: 'not_configured' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('apple-token', auth.userId, 5)) return tooMany(CORS);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'invalid json' }); }
  const token = cleanToken(body.refresh_token);
  if (!token) return json(400, { error: 'invalid token' });

  if (!appleSignInIsFresh({ identities: auth.identities }, Date.now())) {
    return json(200, { ok: true, stored: false, reason: 'not_apple_sign_in' });
  }

  const sealed = sealToken(token, env.APPLE_TOKEN_SECRET);
  try {
    const res = await fetch(`${url}/rest/v1/apple_tokens?on_conflict=user_id`, {
      method: 'POST',
      headers: sbKeys.serviceKeyHeaders(serviceKey, {
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        user_id: auth.userId,
        token: sealed.token,
        enc: sealed.enc,
        client_kind: 'services',
        updated_at: new Date().toISOString(),
      }),
    });
    if (res.status === 404) return json(200, { ok: true, stored: false, reason: 'not_installed' });
    if (!res.ok) {
      console.error('apple-token: store failed', res.status);
      return json(503, { error: 'could not store' });
    }
  } catch (e) {
    console.error('apple-token: store unreachable', e?.message);
    return json(503, { error: 'could not store' });
  }
  return json(200, { ok: true, stored: true });
};

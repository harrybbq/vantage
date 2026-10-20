import { apiUrl } from '../authFetch';
import { appleTokenToSend } from './appleTokenRule';

/**
 * Hand a fresh Sign in with Apple refresh token to the server, so account
 * deletion can revoke it at Apple (STARTUP_REQUIREMENTS item 117; the
 * whole flow is in netlify/lib/appleRevoke.js).
 *
 * Called from the two places a session first arrives after an OAuth
 * sign-in — the main client's auth listener on the web (lib/supabase.js)
 * and the native PKCE exchange (lib/native/deepLinks.js) — because that
 * is the only moment Supabase exposes the token.
 *
 * Fire and forget. Never throws, never shows anything, never retries:
 * a missed capture costs one un-revoked Apple grant at deletion (logged
 * server-side), and must never get in the way of signing in.
 */
const sent = new Set();

export async function captureAppleToken(session) {
  try {
    const token = appleTokenToSend(session);
    if (!token || sent.has(token)) return;
    sent.add(token);
    await fetch(apiUrl('/.netlify/functions/apple-token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ refresh_token: token }),
    });
  } catch {
    /* offline or not deployed yet — see above */
  }
}

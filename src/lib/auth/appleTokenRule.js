/**
 * Should this session's provider refresh token be sent to apple-token?
 * (STARTUP_REQUIREMENTS item 117.) Pure, no imports, so node can test it.
 *
 * Supabase puts `provider_refresh_token` on the session exactly once,
 * right after an OAuth sign-in (auth-js: "The client library will emit
 * these values only once"). It belongs to whichever provider was just
 * used, and an account can have Google and Apple linked — so the token
 * is Apple's only when the identity with the newest last_sign_in_at is
 * Apple. This is a client-side pre-filter; netlify/functions/apple-token
 * applies the same rule again (plus a 10-minute freshness window) to the
 * user record from the auth server, which is what decides.
 */
export function newestIdentityProvider(user) {
  const ids = Array.isArray(user?.identities) ? user.identities : [];
  let best = null;
  for (const i of ids) {
    const t = Date.parse(i?.last_sign_in_at || '');
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.at) best = { provider: String(i?.provider || ''), at: t };
  }
  return best ? best.provider : null;
}

export function appleTokenToSend(session) {
  const token = session?.provider_refresh_token;
  if (typeof token !== 'string' || token.length < 16) return null;
  if (typeof session?.access_token !== 'string' || !session.access_token) return null;
  if (newestIdentityProvider(session.user) !== 'apple') return null;
  return token;
}

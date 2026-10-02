/**
 * Reading the URL the native app is opened with after sign-in.
 *
 * Pure (no Capacitor, no Supabase, no import.meta) so the check script
 * can run it under node. lib/native/deepLinks.js does the side effects.
 *
 * The scheme is the bundle id. It is registered in AndroidManifest.xml
 * (and must be added to the iOS Info.plist as a URL type once `ios/`
 * exists), and `com.vantage.app://auth-callback` must be on Supabase's
 * redirect allow-list, or Supabase silently falls back to the Site URL
 * and the user lands on the website instead of back in the app.
 */

export const APP_SCHEME = 'com.vantage.app';
export const AUTH_CALLBACK_URL = `${APP_SCHEME}://auth-callback`;

/**
 * @param {string} url
 * @returns {null | {
 *   code: string|null,
 *   accessToken: string|null,
 *   refreshToken: string|null,
 *   error: string|null,
 * }}  null when the URL isn't our auth callback (some other deep link).
 */
export function parseAuthCallback(url) {
  if (typeof url !== 'string') return null;
  // Compare case-insensitively on the scheme+host only: some Android
  // browsers lower-case the scheme, and the path/query are ours.
  const head = url.slice(0, AUTH_CALLBACK_URL.length).toLowerCase();
  if (head !== AUTH_CALLBACK_URL) return null;
  const rest = url.slice(AUTH_CALLBACK_URL.length);
  // Anything after the host other than `/`, `?` or `#` is a different
  // link that merely starts with the same letters.
  if (rest && !/^[/?#]/.test(rest)) return null;

  const hashAt = rest.indexOf('#');
  const beforeHash = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
  const hash = hashAt >= 0 ? rest.slice(hashAt + 1) : '';
  const qAt = beforeHash.indexOf('?');
  const query = qAt >= 0 ? beforeHash.slice(qAt + 1) : '';

  const q = new URLSearchParams(query);
  const h = new URLSearchParams(hash);
  const pick = k => h.get(k) || q.get(k) || null;

  return {
    // PKCE: `?code=` — exchanged with the verifier this device stored.
    code: q.get('code') || null,
    // Implicit: `#access_token=…&refresh_token=…`.
    accessToken: pick('access_token'),
    refreshToken: pick('refresh_token'),
    // Supabase reports a refused sign-in in either place.
    error: pick('error_description') || pick('error') || null,
  };
}

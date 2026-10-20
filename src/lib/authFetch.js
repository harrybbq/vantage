import { supabase } from './supabase';
import { resolveApiUrl } from './native/apiUrl';
import { isNativeApp, apiBase } from './native/platform';
import { calmPaused } from './native/paused';

/**
 * URL for a Netlify function (or any same-site path).
 *
 * Relative on the web, absolute to the deployed site inside the native
 * shell — see lib/native/apiUrl.js for why. Every
 * `/.netlify/functions/…` call in src/ goes through this or authFetch;
 * a bare relative fetch works on the web and silently 404s in the app.
 */
export function apiUrl(path) {
  const native = isNativeApp();
  return resolveApiUrl(path, { native, base: native ? apiBase() : '' });
}

/**
 * fetch() that attaches the current Supabase session token.
 *
 * Used for the functions that cost money (the AI endpoints) or fetch a
 * URL on the user's behalf (the scrapers). Those verify the token
 * server-side and rate-limit per account, so an unauthenticated caller
 * can no longer spend the API budget.
 *
 * Sends nothing extra when there's no session — the function will
 * answer 401 and the caller shows its normal "couldn't load" path,
 * rather than this throwing somewhere unexpected.
 *
 * The URL goes through apiUrl(), so callers pass the relative path.
 * A paused function (server kill switch, VANTAGE_PAUSE) comes back as
 * a 503 whose `error` is already the calm "Paused for maintenance"
 * line — see native/paused.js.
 */
export async function authFetch(url, init = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch { /* treat as signed out */ }

  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return calmPaused(await fetch(apiUrl(url), { ...init, headers }));
}

/**
 * fetch(apiUrl(url)) for callers that attach their own headers (the
 * session token included) — same paused handling as authFetch.
 */
export async function apiFetch(url, init = {}) {
  return calmPaused(await fetch(apiUrl(url), init));
}

import { supabase } from './supabase';

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
 */
export async function authFetch(url, init = {}) {
  let token = null;
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || null;
  } catch { /* treat as signed out */ }

  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

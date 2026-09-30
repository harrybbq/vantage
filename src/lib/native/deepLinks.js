import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { isNativeApp } from './platform';
import { parseAuthCallback, AUTH_CALLBACK_URL } from './authCallback';

/**
 * Native sign-in: system browser out, custom scheme back.
 *
 * On the web Supabase redirects the page to Google/Apple and back to
 * the site. In the app that can't work: the WebView's origin is
 * capacitor://localhost, which no redirect can return to, and Google
 * refuses OAuth inside an embedded WebView at all. So on native:
 *
 *   1. `nativeOAuth()` asks Supabase for the provider URL without
 *      navigating (skipBrowserRedirect) and opens it in the system
 *      browser sheet (@capacitor/browser — SFSafariViewController /
 *      Chrome Custom Tabs, which Google accepts).
 *   2. Supabase finishes and redirects to com.vantage.app://auth-callback.
 *      The OS hands that to the app as `appUrlOpen` (or as the launch
 *      URL if the app had been killed meanwhile).
 *   3. `handleUrl()` exchanges the code for a session, puts it on the
 *      app's main client, and closes the browser sheet. App's
 *      onAuthStateChange takes it from there, exactly as on the web.
 *
 * PKCE, and in its OWN client. A custom scheme can be claimed by any
 * app on Android, so tokens in the redirect URL could be read by an
 * impostor; with PKCE the URL carries only a code, useless without the
 * verifier stored on this device. It isn't set on the shared client
 * because that would change the email links too — confirm and reset
 * emails open in a mail app / browser on possibly another device, where
 * a PKCE code has no verifier and the link would silently do nothing.
 * Those stay on the main client's implicit flow and land on the site.
 */

let oauthClient = null;
function nativeOAuthClient() {
  if (oauthClient) return oauthClient;
  oauthClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        flowType: 'pkce',
        // Separate key: this client must never read or clobber the main
        // session. Persisted so the verifier survives Android killing
        // the app while the browser sheet is up.
        storageKey: 'vb-native-oauth',
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  return oauthClient;
}

// AuthScreen subscribes to show a refused / failed sign-in, since the
// failure arrives here, long after its button handler returned.
const errorListeners = new Set();
export function onNativeAuthError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}
function reportError(message) {
  for (const fn of errorListeners) {
    try { fn(message); } catch { /* a listener's problem, not ours */ }
  }
}

async function closeBrowser() {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch { /* Android: nothing to close, or already closed */ }
}

// A code can only be exchanged once; appUrlOpen and getLaunchUrl can
// both report the same URL on a cold start.
const handled = new Set();

export async function handleUrl(url) {
  const cb = parseAuthCallback(url);
  if (!cb) return false;
  if (handled.has(url)) return true;
  handled.add(url);
  closeBrowser();

  try {
    if (cb.error) throw new Error(cb.error);
    let session = null;
    if (cb.code) {
      const { data, error } = await nativeOAuthClient().auth.exchangeCodeForSession(cb.code);
      if (error) throw error;
      session = data?.session || null;
    } else if (cb.accessToken && cb.refreshToken) {
      session = { access_token: cb.accessToken, refresh_token: cb.refreshToken };
    }
    if (!session) throw new Error('Sign-in did not complete. Please try again.');
    const { error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) throw error;
    // The PKCE client persisted its own copy of the session. The main
    // client now owns it and will rotate the refresh token; a second,
    // stale copy has no reason to sit in storage.
    try { localStorage.removeItem('vb-native-oauth'); } catch { /* private mode */ }
    // An OAuth sign-in is a "remember me" sign-in: the checkbox belongs
    // to the password form, and a stale '0' from an earlier password
    // login would sign this session out on the next launch.
    try { localStorage.setItem('vb4_remember', '1'); } catch { /* private mode */ }
  } catch (e) {
    reportError(e?.message || 'Sign-in failed. Please try again.');
  }
  return true;
}

/**
 * Start Google / Apple sign-in on native. Resolves once the browser
 * sheet is open; the session arrives later through handleUrl().
 */
export async function nativeOAuth(provider, queryParams) {
  const { data, error } = await nativeOAuthClient().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: AUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
      ...(queryParams ? { queryParams } : {}),
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Could not start sign-in.');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

let started = false;

/**
 * Listen for the auth callback. Call once at app start; a no-op on the
 * web, and safe to call again.
 */
export async function initDeepLinks() {
  if (started || !isNativeApp()) return;
  started = true;
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => { handleUrl(url); });
    // Cold start: the app was launched BY the callback (Android often
    // kills the app while the browser is in front).
    const launch = await App.getLaunchUrl();
    if (launch?.url) handleUrl(launch.url);
  } catch (e) {
    started = false;
    console.warn('deep links unavailable:', e?.message);
  }
}

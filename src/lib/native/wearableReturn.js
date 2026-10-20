/**
 * Reading the URL the native app is opened with after a WHOOP / Oura
 * connect (STARTUP item 115).
 *
 * The provider redirects to the registered https callback on the site;
 * for a start made in the app, that callback forwards to
 *
 *   com.vantage.app://wearable-callback?provider=whoop&status=ready&code=…&state=…
 *   com.vantage.app://wearable-callback?provider=oura&status=error&reason=denied
 *   com.vantage.app://wearable-callback?provider=whoop&status=paused
 *
 * (netlify/lib/wearableCallback.js). `ready` is a hand-off, not a
 * success: the app still has to POST the code back with its verifier
 * and session (lib/native/wearableConnect.js) before anything is stored.
 *
 * Pure — no Capacitor, no Supabase, no import.meta — so the check script
 * runs it under node. Same scheme as the sign-in return
 * (authCallback.js); a different host, so neither handler can mistake
 * the other's URL for its own.
 */
import { APP_SCHEME } from './authCallback.js';

export const WEARABLE_CALLBACK_URL = `${APP_SCHEME}://wearable-callback`;
export const WEARABLE_PROVIDERS = ['whoop', 'oura'];
const STATUSES = ['ready', 'error', 'paused'];

/**
 * @param {string} url
 * @returns {null | {
 *   provider: 'whoop'|'oura',
 *   status: 'ready'|'error'|'paused',
 *   reason: string|null,
 *   code: string|null,
 *   state: string|null,
 * }}  null when the URL isn't a wearable return we understand.
 */
export function parseWearableCallback(url) {
  if (typeof url !== 'string') return null;
  // Scheme+host compared case-insensitively (some Android browsers
  // lower-case the scheme); the query is ours and case-sensitive.
  const head = url.slice(0, WEARABLE_CALLBACK_URL.length).toLowerCase();
  if (head !== WEARABLE_CALLBACK_URL) return null;
  const rest = url.slice(WEARABLE_CALLBACK_URL.length);
  if (rest && !/^[/?#]/.test(rest)) return null;

  const hashAt = rest.indexOf('#');
  const beforeHash = hashAt >= 0 ? rest.slice(0, hashAt) : rest;
  const qAt = beforeHash.indexOf('?');
  const q = new URLSearchParams(qAt >= 0 ? beforeHash.slice(qAt + 1) : '');

  const provider = String(q.get('provider') || '').toLowerCase();
  if (!WEARABLE_PROVIDERS.includes(provider)) return null;
  const rawStatus = String(q.get('status') || '');
  const status = STATUSES.includes(rawStatus) ? rawStatus : 'error';
  // Reasons are short codes from our own callback; anything else is
  // squashed so a crafted link can't put prose in the panel.
  const reason = /^[a-z]{1,24}$/.test(q.get('reason') || '') ? q.get('reason') : null;
  return {
    provider,
    status,
    reason: status === 'error' ? (reason || 'error') : null,
    code: status === 'ready' ? (q.get('code') || null) : null,
    state: status === 'ready' ? (q.get('state') || null) : null,
  };
}

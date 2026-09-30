import { DEFAULT_API_BASE } from './apiUrl';

/**
 * Am I running inside the Capacitor shell?
 *
 * Two signals, either is enough (same belt-and-braces reasoning as
 * lib/trading/enabled.js):
 *   1. BUILD FLAG — `npm run cap:*` sets VITE_NATIVE_BUILD=true, and
 *      Vite folds the literal so native-only branches are decided at
 *      build time. Must be written out in full for the substitution.
 *   2. RUNTIME — the native bridge puts `window.Capacitor` on the page
 *      before any app code runs, so a hand-run `vite build` + `cap sync`
 *      still behaves correctly inside the shell.
 */
export const NATIVE_BUILD = import.meta.env.VITE_NATIVE_BUILD === 'true';

export function isNativeApp() {
  if (NATIVE_BUILD) return true;
  if (typeof window === 'undefined') return false;
  try {
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    return !!cap.isNative;
  } catch {
    return false;
  }
}

/** The deployed site, which native builds call and link to. */
export function apiBase() {
  return (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
}

/**
 * The https origin a person (or another service) should be sent to.
 *
 * On the web that's wherever the page is — production, a deploy
 * preview, localhost. In the shell `window.location.origin` is
 * `capacitor://localhost`, which means nothing outside this phone: a
 * Shortcut URL, an OAuth callback or an email link built from it goes
 * nowhere. Those use the deployed site instead.
 */
export function webOrigin() {
  if (isNativeApp() || typeof window === 'undefined') return apiBase();
  return window.location.origin;
}

/**
 * Where the Netlify functions live, as a pure function.
 *
 * On the web every call is a relative `/.netlify/functions/…` and the
 * browser resolves it against the site. Inside the Capacitor shell the
 * page is served from the app bundle (capacitor://localhost on iOS,
 * https://localhost on Android), so the same relative URL hits the
 * bundle and 404s — delete-account, AI, leaderboard, groups, food
 * search, weather all failed there. Native builds prefix the deployed
 * site instead.
 *
 * Kept free of `import.meta.env` and `window` so the check script can
 * run it under plain node; `apiUrl()` in lib/authFetch.js is the
 * wrapper the app calls.
 */

// The production site. Used when a native build doesn't name one via
// VITE_API_BASE — a native binary with no reachable API is worse than
// one pinned to production.
export const DEFAULT_API_BASE = 'https://vantagevision.netlify.app';

/**
 * @param {string} path     e.g. '/.netlify/functions/weather?x=1'
 * @param {{ native?: boolean, base?: string }} opts
 * @returns {string}
 */
export function resolveApiUrl(path, { native = false, base = '' } = {}) {
  if (typeof path !== 'string' || !path) return path;
  // Already absolute — leave it alone, so applying this twice (a caller
  // that wraps, then authFetch wraps again) is harmless.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  if (!native) return path;
  const root = String(base || DEFAULT_API_BASE).replace(/\/+$/, '');
  return root + (path.startsWith('/') ? path : '/' + path);
}

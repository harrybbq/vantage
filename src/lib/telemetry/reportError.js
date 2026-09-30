/**
 * Client error reporting — "know before users tell you" (item 77).
 *
 * Posts to /.netlify/functions/client-error, which stores the row in
 * `public.client_errors` with the service role. Until that function and
 * table exist the POST simply fails and is swallowed: reporting can
 * never be the reason something else breaks, so every path in here
 * catches everything.
 *
 * What goes out is decided in shape.js — the error's own message and
 * stack, the page path, the browser and the build. Never state, never a
 * query string. authFetch attaches the session token when there is one,
 * so the server can fill user_id itself rather than trusting a body.
 *
 * Only production builds send. In dev the report goes to the console.
 */
import { shapeReport, signature, makeLimiter } from './shape.js';
import { authFetch } from '../authFetch.js';

// Relative for now. The native build needs an absolute origin; when
// lib/authFetch.js grows an `apiUrl()` helper, route this through it.
const ENDPOINT = '/.netlify/functions/client-error';

const allow = makeLimiter({ perMinute: 5 });

/** The hashed bundle name identifies the build without a build step. */
function release() {
  try {
    const src = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src') || '';
    return src.split('/').pop() || import.meta.env.MODE || '';
  } catch {
    return '';
  }
}

export function reportError(kind, error) {
  try {
    const report = shapeReport(kind, error, {
      where: typeof window !== 'undefined' ? window.location : null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      release: release(),
    });
    if (!report.message && !report.stack) return;
    if (!allow(signature(report))) return;
    if (!import.meta.env.PROD) {
      console.info('[telemetry] would report', report);
      return;
    }
    authFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // Lets a report fired from pagehide or a dying tab still leave.
      keepalive: true,
    }).catch(() => { /* reporting is best-effort */ });
  } catch {
    /* never let reporting throw */
  }
}

let installed = false;
/** window.onerror + unhandledrejection, once per page. */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', e => {
    // Resource load failures (an <img> 404) arrive here with no error
    // object; they aren't bugs worth a report.
    if (!e || !e.error && !e.message) return;
    reportError('window.onerror', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', e => {
    reportError('unhandledrejection', e?.reason ?? 'unhandled rejection');
  });
}

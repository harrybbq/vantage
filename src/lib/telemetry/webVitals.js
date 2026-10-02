/**
 * Real-user web vitals → /.netlify/functions/vitals-beacon.
 *
 * Installed by importing this module once (src/main.jsx). It:
 *   · samples 1 page load in 5 — the rest do nothing at all;
 *   · measures LCP, INP, CLS, TTFB and FCP with the browser's own
 *     PerformanceObserver (no library);
 *   · sends ONE navigator.sendBeacon when the page is first hidden
 *     (visibilitychange → hidden, or pagehide);
 *   · sends the path, the five numbers, the navigation type and a coarse
 *     device class — no user id, no session token, no query string.
 *     Disclosed in the privacy policy (LegalPage, section 2).
 *
 * Production web builds only. Not in dev, and not inside the native
 * shell — store privacy declarations would have to list it, and the
 * web app is where load performance is a question.
 *
 * Never throws: measurement must not be the reason a page breaks.
 */
import { shouldSample, clsFromShifts, makeInpTracker, deviceClass, shapeBeacon } from './vitalsShape.js';
import { apiUrl } from '../authFetch.js';
import { isNativeApp } from '../native/platform';

const ENDPOINT = '/.netlify/functions/vitals-beacon';
const SAMPLE_RATE = 0.2;

function observe(type, cb, opts = {}) {
  try {
    const po = new PerformanceObserver(list => { for (const e of list.getEntries()) cb(e); });
    po.observe({ type, buffered: true, ...opts });
    return po;
  } catch {
    return null;   // type unsupported in this browser — that metric stays null
  }
}

function install() {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  if (!shouldSample(Math.random(), SAMPLE_RATE)) return;

  let lcp = null, fcp = null;
  const shifts = [];
  const inp = makeInpTracker();

  observe('largest-contentful-paint', e => { lcp = e.renderTime || e.startTime; });
  observe('paint', e => { if (e.name === 'first-contentful-paint') fcp = e.startTime; });
  observe('layout-shift', e => { shifts.push({ value: e.value, startTime: e.startTime, hadRecentInput: e.hadRecentInput }); });
  observe('event', e => inp.add(e), { durationThreshold: 40 });
  observe('first-input', e => inp.add(e));

  let sent = false;
  function send() {
    if (sent) return;
    sent = true;
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      const activation = nav?.activationStart || 0;
      const coarse = window.matchMedia?.('(pointer: coarse)')?.matches || false;
      const body = shapeBeacon({
        pathname: window.location.pathname,
        lcp: lcp == null ? null : Math.max(0, lcp - activation),
        inp: inp.value(),
        cls: clsFromShifts(shifts),
        ttfb: nav ? Math.max(0, nav.responseStart - activation) : null,
        fcp: fcp == null ? null : Math.max(0, fcp - activation),
        nav: nav?.type || null,
        device: deviceClass(window.innerWidth, coarse),
      });
      if (!body) return;
      const url = apiUrl(ENDPOINT);
      const payload = JSON.stringify(body);
      // A string body goes as text/plain: no CORS preflight, which a
      // beacon on an unloading page could never finish.
      if (!(navigator.sendBeacon && navigator.sendBeacon(url, payload))) {
        fetch(url, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
          .catch(() => { /* best effort */ });
      }
    } catch { /* never let measurement throw */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  }, { capture: true });
  window.addEventListener('pagehide', send, { capture: true });
}

try {
  if (import.meta.env.PROD && !isNativeApp()) install();
} catch { /* never let measurement throw */ }

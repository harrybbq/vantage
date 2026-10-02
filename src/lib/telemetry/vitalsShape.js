/**
 * Web-vitals arithmetic, pure — the browser half is webVitals.js.
 * Tested by vitalsShape.test.mjs (npm run check:vitals).
 *
 * Definitions follow web.dev:
 *   CLS  largest "session window" of layout shifts: shifts less than 1 s
 *        apart, the window at most 5 s long; shifts right after user
 *        input (hadRecentInput) don't count.        web.dev/articles/cls
 *   INP  the slowest interaction, except that with many interactions one
 *        outlier per 50 is ignored (≈ p98).          web.dev/articles/inp
 *   LCP  the last largest-contentful-paint entry before the page is
 *        hidden.                                     web.dev/articles/lcp
 */

/** 1 load in `1/rate` is measured. `rand` is Math.random() in the app. */
export function shouldSample(rand, rate = 0.2) {
  return Number.isFinite(rand) && rand >= 0 && rand < rate;
}

/** Layout-shift entries ({ value, startTime, hadRecentInput }) → CLS. */
export function clsFromShifts(entries) {
  let max = 0, current = 0, first = 0, last = 0;
  for (const e of entries || []) {
    if (!e || e.hadRecentInput || !Number.isFinite(e.value)) continue;
    if (current > 0 && e.startTime - last < 1000 && e.startTime - first < 5000) {
      current += e.value;
    } else {
      current = e.value;
      first = e.startTime;
    }
    last = e.startTime;
    if (current > max) max = current;
  }
  return max;
}

/**
 * Tracks the worst latency per interaction and answers INP.
 * add({ interactionId, duration }) for every event-timing entry.
 */
export function makeInpTracker(keep = 10) {
  const byId = new Map();     // interactionId → longest duration
  let count = 0;
  return {
    add(e) {
      if (!e || !e.interactionId || !Number.isFinite(e.duration)) return;
      const prev = byId.get(e.interactionId);
      if (prev == null) count++;
      if (prev == null || e.duration > prev) byId.set(e.interactionId, e.duration);
      // Bound memory on very long sessions: only the worst few matter.
      if (byId.size > keep * 4) {
        const worst = [...byId.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep);
        byId.clear();
        for (const [k, v] of worst) byId.set(k, v);
      }
    },
    value() {
      if (!byId.size) return null;
      const sorted = [...byId.values()].sort((a, b) => b - a);
      const skip = Math.min(sorted.length - 1, Math.floor(count / 50));
      return sorted[skip];
    },
  };
}

/** Coarse device class from the viewport, nothing more identifying. */
export function deviceClass(width, coarsePointer) {
  if (!Number.isFinite(width)) return null;
  if (width < 768) return 'mobile';
  if (width < 1100 && coarsePointer) return 'tablet';
  return 'desktop';
}

const r = (v, digits = 0) => {
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * The beacon body. Path only — `pathname` is passed in, never href, so
 * no query string or fragment can ride along. No user, no session.
 */
export function shapeBeacon({ pathname, lcp, inp, cls, ttfb, fcp, nav, device }) {
  const path = String(pathname || '/').split(/[?#]/)[0].slice(0, 120) || '/';
  const body = {
    path,
    lcp: r(lcp), inp: r(inp), cls: r(cls, 4), ttfb: r(ttfb), fcp: r(fcp),
    nav: typeof nav === 'string' ? nav.slice(0, 24) : null,
    device: device || null,
  };
  const any = ['lcp', 'inp', 'cls', 'ttfb', 'fcp'].some(k => body[k] != null);
  return any ? body : null;
}

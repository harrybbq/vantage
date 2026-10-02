/**
 * Real-user web vitals → Google's good / needs-improvement / poor bands.
 *
 * Thresholds are web.dev's, assessed at the 75th percentile of page
 * loads (https://web.dev/articles/vitals, /articles/fcp, /articles/ttfb):
 *   LCP  ≤ 2.5 s good · > 4.0 s poor        (Core Web Vital)
 *   INP  ≤ 200 ms good · > 500 ms poor      (Core Web Vital)
 *   CLS  ≤ 0.1 good · > 0.25 poor           (Core Web Vital, unitless)
 *   FCP  ≤ 1.8 s good · > 3.0 s poor        (diagnostic)
 *   TTFB ≤ 0.8 s good · > 1.8 s poor        (diagnostic)
 * "Good" includes the threshold itself; "poor" starts strictly above
 * the upper one. Timings are milliseconds (what PerformanceObserver
 * reports, and what the beacon stores).
 *
 * Pure: vitals.test.mjs pins it (npm run check:secvitals).
 */
import { num, fmtMs, NONE } from './format.js';

export const VITALS = [
  { id: 'lcp', name: 'LCP', long: 'Largest Contentful Paint', good: 2500, poor: 4000, core: true },
  { id: 'inp', name: 'INP', long: 'Interaction to Next Paint', good: 200, poor: 500, core: true },
  { id: 'cls', name: 'CLS', long: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, core: true, unitless: true },
  { id: 'fcp', name: 'FCP', long: 'First Contentful Paint', good: 1800, poor: 3000 },
  { id: 'ttfb', name: 'TTFB', long: 'Time to First Byte', good: 800, poor: 1800 },
];
const BY_ID = Object.fromEntries(VITALS.map(v => [v.id, v]));
export const vitalMeta = id => BY_ID[id] || null;

/** Vercel Speed Insights' three buckets; "Great" is web.dev's "Good". */
export const RATING_LABEL = { good: 'Great', ni: 'Needs improvement', poor: 'Poor' };

/** Bucket header thresholds: { good: "≤ 2.5 s", ni: "2.5 s – 4 s", poor: "> 4 s" }. */
export function bucketHeads(id) {
  const m = BY_ID[id];
  if (!m) return null;
  const f = v => fmtVital(id, v);
  return { good: `≤ ${f(m.good)}`, ni: `${f(m.good)} – ${f(m.poor)}`, poor: `> ${f(m.poor)}` };
}

/** Rows ({ value }) sorted into the three buckets, worst first in each. */
export function bucketRows(id, rows) {
  const out = { poor: [], ni: [], good: [], none: [] };
  for (const r of rows || []) {
    const k = rateVital(id, r && r.value);
    out[k || 'none'].push(r);
  }
  for (const k of ['poor', 'ni', 'good']) out[k].sort((a, b) => num(b.value) - num(a.value));
  return out;
}

/**
 * The one-line verdict for a metric. With a good-share (0..1 or 0..100)
 * it is Vercel's "75% of visits had a great LCP"; without one it states
 * the p75 against the threshold, which is all a p75 supports.
 */
export function vitalSentence(id, p75, goodShare = null) {
  const m = BY_ID[id];
  if (!m) return '';
  const g = num(goodShare);
  if (g != null && g >= 0) return `${Math.round(g <= 1 ? g * 100 : g)}% of visits had a great ${m.name}.`;
  const r = rateVital(id, p75);
  if (!r) return `No ${m.name} data yet.`;
  const word = r === 'good' ? 'great' : r === 'ni' ? 'needs improvement' : 'poor';
  return `3 in 4 visits had ${m.name} of ${fmtVital(id, p75)} or better: ${word} (great is ≤ ${fmtVital(id, m.good)}).`;
}

/** → 'good' | 'ni' | 'poor' | null */
export function rateVital(id, value) {
  const m = BY_ID[id];
  const v = num(value);
  if (!m || v == null || v < 0) return null;
  if (v <= m.good) return 'good';
  if (v <= m.poor) return 'ni';
  return 'poor';
}

export function fmtVital(id, value) {
  const v = num(value);
  if (v == null || v < 0) return NONE;
  if (id === 'cls') return v.toFixed(2);
  return fmtMs(v);
}

/**
 * Where a value and the two thresholds sit on a 0..1 track, for the
 * banded bar under each vital. The track runs to 1.5× the poor
 * threshold, so the poor band always has visible width; a value past
 * the end pins there (`clipped`) rather than rescaling the track and
 * flattening the other two bands to nothing.
 * → { good, poor, at|null, clipped }
 */
export function vitalTrack(id, value) {
  const m = BY_ID[id];
  if (!m) return null;
  const max = m.poor * 1.5;
  const v = num(value);
  const at = v == null || v < 0 ? null : Math.min(1, v / max);
  return { good: m.good / max, poor: m.poor / max, at, clipped: v != null && v > max };
}

/** Worst rating across a set of p75s (CWV only) — the headline verdict. */
export function overallRating(p75) {
  let worst = null;
  const order = { good: 0, ni: 1, poor: 2 };
  for (const m of VITALS) {
    if (!m.core) continue;
    const r = rateVital(m.id, p75 && p75[m.id]);
    if (r && (worst == null || order[r] > order[worst])) worst = r;
  }
  return worst;
}

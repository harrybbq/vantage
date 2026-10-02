/**
 * Chart scaling for the Security console's hand-rolled SVG charts.
 *
 * To scale means: the axis starts at zero, its top is a clean number at
 * or above the largest value, and every mark's height is its value over
 * that top — nothing is log-scaled, clipped or "smoothed". These
 * helpers do the arithmetic so the components only draw.
 *
 * Pure: chart.test.mjs pins it (npm run check:secchart).
 */
import { num, toMs } from './format.js';

/** Smallest of 1, 2, 2.5, 5, 10 × 10^k that is ≥ v. 0 or less → 1. */
export function niceMax(v) {
  const n = num(v);
  if (n == null || n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n - 1e-9) return m * p;
  return 10 * p;
}

/**
 * How many intervals divide a niceMax top into round steps:
 * 1 → 5 (0.2s), 2 → 4 (0.5s), 2.5 → 5 (0.5s), 5 → 5 (1s), 10 → 5 (2s).
 */
export function tickCount(max) {
  const m = num(max);
  if (m == null || m <= 0) return 1;
  const mant = Math.round((m / 10 ** Math.floor(Math.log10(m))) * 100) / 100;
  return mant === 2 ? 4 : 5;
}

/** Evenly spaced ticks from 0 to max inclusive: ticks(100, 4) → [0,25,50,75,100]. */
export function ticks(max, count = 4) {
  const m = num(max);
  if (m == null || m <= 0 || count < 1) return [0];
  const out = [];
  for (let i = 0; i <= count; i++) out.push(Math.round((m * i / count) * 1e6) / 1e6);
  return out;
}

/**
 * Stack a time series of per-key counts.
 * series: [{ t, rest, auth, … }], keys: ['rest','auth',…]
 * → { rows: [{ t, total, segs: [{ key, v, y0, y1 }] }], max, totals: {key: sum}, grand }
 * Missing / negative / non-numeric values count as 0 (but the row stays,
 * so the time axis is never compressed). `max` is niceMax of the
 * tallest stack.
 */
export function stack(series, keys) {
  const rows = [];
  const totals = Object.fromEntries(keys.map(k => [k, 0]));
  let top = 0;
  for (const p of Array.isArray(series) ? series : []) {
    if (!p || typeof p !== 'object') continue;
    let y = 0;
    const segs = [];
    for (const k of keys) {
      const v = Math.max(0, num(p[k]) ?? 0);
      segs.push({ key: k, v, y0: y, y1: y + v });
      y += v;
      totals[k] += v;
    }
    rows.push({ t: p.t ?? null, total: y, segs });
    if (y > top) top = y;
  }
  const grand = keys.reduce((s, k) => s + totals[k], 0);
  return { rows, max: niceMax(top), totals, grand };
}

/**
 * Sparkline path through `values` inside a w×h box (y=0 is the top).
 * Zero-based (a flat line at the bottom means zero, not "the minimum"),
 * so two sparklines with the same `max` are comparable. null gaps are
 * skipped by starting a new sub-path.
 * → { line, area, last: {x,y}|null }
 */
export function sparkPath(values, w, h, max = null, pad = 2) {
  const vs = (Array.isArray(values) ? values : []).map(num);
  const finite = vs.filter(v => v != null);
  if (!finite.length) return { line: '', area: '', last: null };
  const top = max != null ? max : niceMax(Math.max(...finite));
  const n = vs.length;
  const x = i => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = v => h - pad - (Math.max(0, Math.min(v, top)) / top) * (h - 2 * pad);
  let line = '', area = '', pen = false, startX = null, last = null, prevX = null;
  vs.forEach((v, i) => {
    if (v == null) {
      if (pen && startX != null) area += `L${prevX.toFixed(1)},${(h - pad).toFixed(1)}Z`;
      pen = false;
      return;
    }
    const px = x(i), py = y(v);
    if (!pen) {
      line += `M${px.toFixed(1)},${py.toFixed(1)}`;
      area += `M${px.toFixed(1)},${(h - pad).toFixed(1)}L${px.toFixed(1)},${py.toFixed(1)}`;
      startX = px;
      pen = true;
    } else {
      line += `L${px.toFixed(1)},${py.toFixed(1)}`;
      area += `L${px.toFixed(1)},${py.toFixed(1)}`;
    }
    prevX = px;
    last = { x: px, y: py };
  });
  if (pen) area += `L${prevX.toFixed(1)},${(h - pad).toFixed(1)}Z`;
  return { line, area, last };
}

/** Axis label for a bucket time: HH:MM up to 3 h, HH:00 up to 48 h, dates beyond. */
export function bucketLabel(t, windowHours = 24) {
  const ms = toMs(t);
  if (ms == null) return '';
  const d = new Date(ms);
  const w = num(windowHours) ?? 24;
  const hh = String(d.getHours()).padStart(2, '0');
  if (w <= 3) return `${hh}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (w <= 48) return `${hh}:00`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Traffic ranges: exactly the Supabase usage.api-counts `interval`
 * values the console forwards as ?range= (15min, 1hr, 3hr, 1day, 7day).
 */
export const RANGES = [
  { id: '15min', label: '15 min', hours: 0.25 },
  { id: '1hr', label: '1 hr', hours: 1 },
  { id: '3hr', label: '3 hr', hours: 3 },
  { id: '1day', label: '1 day', hours: 24 },
  { id: '7day', label: '7 days', hours: 168 },
];
export const rangeHours = id => (RANGES.find(r => r.id === id) || RANGES[3]).hours;

/** The absolute window a preset resolves to: "2 Oct 13:22 – 14:22". */
export function rangeText(id, now = Date.now()) {
  const h = rangeHours(id);
  const from = new Date(now - h * 3600e3), to = new Date(now);
  const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return from.toDateString() === to.toDateString()
    ? `${day(from)} ${hm(from)} – ${hm(to)}`
    : `${day(from)} ${hm(from)} – ${day(to)} ${hm(to)}`;
}

/** Indices to label along an axis of n buckets — at most `max` labels, evenly spaced, always the last. */
export function labelEvery(n, max = 6) {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out = [];
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

/** Bar width inside a band: the band minus a 2px gap, capped at 24px, at least 1. */
export function barWidth(band, cap = 24) {
  const b = num(band) ?? 0;
  return Math.max(1, Math.min(cap, b - 2));
}

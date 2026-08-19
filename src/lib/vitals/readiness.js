/**
 * Readiness, and the arithmetic behind the Vitals panel.
 *
 * Pure — no React, no DOM, no network. Everything here is a function of
 * `S.vitalsLog`, which is a map of `YYYY-MM-DD` to a day's metrics.
 *
 * ── What readiness is, and what it is not ────────────────────────────
 * WHOOP and Oura both publish a recovery score of their own. Where one
 * exists this DEFERS to it rather than inventing a second opinion — two
 * numbers called readiness that disagree is worse than one.
 *
 * With no device, it is computed from the three things a person can log
 * by hand: how long they slept, their resting heart rate, and their HRV
 * if they have it. Each is scored against that person's OWN recent
 * range rather than a population norm, because a resting heart rate of
 * 52 means nothing without knowing whether yours is usually 48 or 64.
 *
 * A score built from one input is not a score, so it says how many it
 * used and the panel is honest about that.
 */

const DAY = 86_400_000;

/** `YYYY-MM-DD` for a date, from LOCAL parts — toISOString is UTC and
 *  names yesterday for most of the evening west of Greenwich. */
export function ymd(d = new Date()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** The last `days` dates, oldest first, ending on `end`. */
export function dateRange(days, end = new Date()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(ymd(new Date(end.getTime() - i * DAY)));
  return out;
}

/**
 * A metric's values over a window, as `{ date, v }`, oldest first.
 * Days with no reading are dropped rather than zero-filled: a missing
 * weight is not a weight of zero, and a chart that draws it as one is
 * lying in a way a gap never does.
 */
export function seriesOf(vitalsLog, key, days = 30, end = new Date()) {
  const log = vitalsLog || {};
  return dateRange(days, end)
    .map(date => ({ date, v: log[date]?.[key] }))
    .filter(p => p.v != null && Number.isFinite(Number(p.v)))
    .map(p => ({ date: p.date, v: Number(p.v) }));
}

/** Where `v` sits in `[lo, hi]`, 0–1, clamped. */
const norm = (v, lo, hi) => (hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo))));

/** The middle of a series, ignoring the extremes that a single bad
 *  night or a broken strap would otherwise define the range by. */
function robustRange(vals) {
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return { lo: at(0.1), hi: at(0.9), mid: at(0.5) };
}

/** How each input is scored, and what it is worth. Sleep leads because
 *  it is the one most people can actually change tonight. */
const PARTS = [
  { key: 'sleep',    label: 'Sleep',      weight: 0.45, higherIsBetter: true },
  { key: 'hrv',      label: 'HRV',        weight: 0.35, higherIsBetter: true },
  { key: 'rhr',      label: 'Resting HR', weight: 0.20, higherIsBetter: false },
];

/**
 * Today's readiness.
 *
 * @returns {{ score, state, parts, source, inputs, note }}
 *   `score` is null when there is nothing to go on — the panel shows a
 *   prompt rather than a zero, because a zero is a claim.
 */
export function readinessFor(vitalsLog, date = ymd(), days = 30) {
  const log = vitalsLog || {};
  const today = log[date] || {};

  // A device's own score wins. Two numbers called readiness that
  // disagree is worse than one.
  const device = today.recovery;
  const parts = [];
  let used = 0, total = 0;

  for (const p of PARTS) {
    const v = today[p.key];
    const hist = seriesOf(log, p.key, days, new Date(`${date}T12:00:00`)).map(x => x.v);
    const range = robustRange(hist);
    if (v == null || !range) {
      parts.push({ ...p, value: null, pct: 0, has: false });
      continue;
    }
    const raw = norm(Number(v), range.lo, range.hi);
    const scored = p.higherIsBetter ? raw : 1 - raw;
    parts.push({ ...p, value: Number(v), pct: Math.round(scored * 100), has: true });
    used += scored * p.weight;
    total += p.weight;
  }

  const computed = total > 0 ? Math.round((used / total) * 100) : null;
  const score = device != null ? Math.round(Number(device)) : computed;
  const inputs = parts.filter(p => p.has).length;

  return {
    score,
    state: score == null ? 'no data' : score >= 75 ? 'primed' : score >= 55 ? 'steady' : score >= 35 ? 'low' : 'spent',
    parts,
    source: device != null ? 'device' : inputs ? 'computed' : 'none',
    inputs,
    note: noteFor(score, device != null, inputs, parts),
  };
}

function noteFor(score, fromDevice, inputs, parts) {
  if (score == null) return 'Log sleep, resting HR or HRV and this fills in.';
  if (fromDevice) return 'Your wearable’s own recovery score — shown as it reports it.';
  // Labels keep their own casing — lowercasing turned "HRV" into "hrv".
  const missing = parts.filter(p => !p.has).map(p => p.label);
  if (inputs === 1) {
    return `Built from one reading, so treat it loosely. Adding ${missing.join(' or ')} sharpens it.`;
  }
  const base = `Scored against your own last 30 days, not a population average.`;
  return missing.length ? `${base} No ${missing.join(' or ')} today.` : base;
}

/**
 * Pearson's r between two metrics over the same days.
 *
 * Only days where BOTH have a reading are used, and fewer than eight of
 * those returns null rather than a number: a correlation over four
 * points is a shape, not a finding, and putting one on screen with two
 * decimal places is the kind of thing that gets believed.
 */
export function correlate(vitalsLog, keyA, keyB, days = 30, minPairs = 8) {
  const log = vitalsLog || {};
  const pairs = [];
  for (const date of dateRange(days)) {
    const a = log[date]?.[keyA], b = log[date]?.[keyB];
    if (a == null || b == null) continue;
    if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) continue;
    pairs.push([Number(a), Number(b)]);
  }
  if (pairs.length < minPairs) return { r: null, n: pairs.length, pairs };

  const n = pairs.length;
  const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
  const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0, da = 0, db = 0;
  for (const [a, b] of pairs) {
    const x = a - ma, y = b - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const r = da && db ? num / Math.sqrt(da * db) : 0;
  return { r: Math.max(-1, Math.min(1, r)), n, pairs };
}

/** Plain words for a correlation, which is what anyone actually wants
 *  from one. Signed, because "strong" alone hides the direction. */
export function strengthOf(r) {
  if (r == null) return 'not enough days yet';
  const a = Math.abs(r);
  const how = a >= 0.7 ? 'strong' : a >= 0.4 ? 'clear' : a >= 0.2 ? 'slight' : 'no real';
  if (how === 'no real') return 'no real link';
  return `${how} ${r > 0 ? 'positive' : 'negative'} link`;
}

/** The change between the first and last reading of a series. */
export function trendOf(points, dp = 1) {
  if (!points || points.length < 2) return null;
  const delta = points[points.length - 1].v - points[0].v;
  return { delta: Number(delta.toFixed(dp)), up: delta > 0, flat: Math.abs(delta) < Math.pow(10, -dp) / 2 };
}

/**
 * An SVG path through a series, scaled to a box. Used for the tile
 * sparklines, where there is no axis and the shape is the whole point.
 */
export function sparkPath(points, w = 60, h = 18, pad = 2) {
  if (!points || points.length < 2) return '';
  const vals = points.map(p => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = pad + (1 - (p.v - lo) / span) * (h - pad * 2);
    return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

/**
 * Vitals metrics — one definition, shared by the Track page's history
 * card and the hub's Vitals widget.
 *
 * The availability rule already existed in VitalsHistoryCard and was
 * carefully thought through; it is lifted here rather than copied so the
 * two surfaces cannot drift into disagreeing about what a user can pick.
 *
 * Sources, and why they matter:
 *   vitals — weight / sleep / rest HR. Enterable by hand, so always
 *            offered; Apple Health and both wearables also write them.
 *   whoop  — HRV, recovery, strain, all-day burn. Only WHOOP writes
 *            strain and burnKcal at all. Oura supplies HRV but has no
 *            strain equivalent, so an Oura-only user must not be given
 *            a Strain line that opens an empty chart.
 *
 * Pure — no DOM, no React.
 */

/* `dp` is decimal places for display and `goodHigh` says which
   direction is the good one — null where there is no such thing. Both
   added for the Track vitals panel; nothing else reads them, and they
   are inert to every existing consumer. */
export const VITAL_METRICS = [
  // Hand-enterable. Always available.
  { key: 'weight',   label: 'Weight',   unit: 'kg',   src: 'vitals', color: 'var(--em)',   step: '0.1', max: 400,   dp: 1, goodHigh: null },
  { key: 'sleep',    label: 'Sleep',    unit: 'h',    src: 'vitals', color: '#6b8afd',     step: '0.5', max: 24,    dp: 1, goodHigh: true },
  { key: 'rhr',      label: 'Rest HR',  unit: 'bpm',  src: 'vitals', color: '#c0563f',     step: '1',   max: 250,   dp: 0, goodHigh: false },
  // Wearable-fed.
  { key: 'hrv',      label: 'HRV',      unit: 'ms',   src: 'whoop',  color: '#12a5a5',     step: '1',   max: 400,   dp: 0, goodHigh: true },
  { key: 'recovery', label: 'Recovery', unit: '%',    src: 'whoop',  color: '#d4a017',     step: '1',   max: 100,   dp: 0, goodHigh: true },
  { key: 'strain',   label: 'Strain',   unit: '',     src: 'whoop',  color: '#a855f7',     step: '0.1', max: 21,    dp: 1, goodHigh: null },
  { key: 'burnKcal', label: 'Burn',     unit: 'kcal', src: 'whoop',  color: '#d99114',     step: '1',   max: 10000, dp: 0, goodHigh: true },
];

/** Format a reading the way its metric wants to be read. */
export function fmtMetric(v, m) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return m?.dp ? n.toFixed(m.dp) : Math.round(n).toLocaleString();
}

/** Where a reading came from, for the tile's corner. Both devices
 *  reporting the same metric shows "2 src" rather than picking one —
 *  a reconciliation UI for an overlap nobody asked for is not worth
 *  building, but pretending there is only one source is a small lie. */
export function sourceLabel(m, S) {
  if (!m || m.src === 'vitals') return 'you';
  const whoop = !!(S && S.whoopConnected), oura = !!(S && S.ouraConnected);
  if (whoop && oura && m.key === 'hrv') return '2 src';
  if (whoop) return 'whoop';
  if (oura) return 'oura';
  return '—';
}

export const metricByKey = key => VITAL_METRICS.find(m => m.key === key) || null;

/** Does any day in the log carry this key? */
export function hasData(S, key) {
  const log = (S && S.vitalsLog) || {};
  for (const d of Object.keys(log)) {
    if (log[d] && log[d][key] != null) return true;
  }
  return false;
}

/**
 * Every metric, each tagged with whether the user can pick it and why
 * not. Nothing is hidden outright — a locked row that says "Connect
 * WHOOP" tells the user the feature exists and what unlocks it, which a
 * missing row cannot.
 *
 * @returns [{ ...metric, available: boolean, reason: string|null }]
 */
export function metricAvailability(S) {
  const whoop = !!(S && S.whoopConnected);
  const oura = !!(S && S.ouraConnected);
  return VITAL_METRICS.map(m => {
    if (m.src === 'vitals') return { ...m, available: true, reason: null };
    // Historical data counts even after a device is disconnected — the
    // numbers are still in the log and still worth charting.
    if (hasData(S, m.key)) return { ...m, available: true, reason: null };
    if (whoop) return { ...m, available: true, reason: null };
    // Oura writes HRV (and sleep/rhr) but has no strain, and its API
    // gives no all-day burn, so offering either would open an empty
    // chart and read as a broken feature rather than an absent one.
    if (oura && (m.key === 'hrv')) return { ...m, available: true, reason: null };
    return {
      ...m,
      available: false,
      reason: oura ? 'Needs WHOOP — Oura does not report this' : 'Connect WHOOP or Oura',
    };
  });
}

/** Just the pickable ones. */
export function availableMetrics(S) {
  return metricAvailability(S).filter(m => m.available);
}

/**
 * Resolve a widget's stored picks to metrics it may actually show.
 *
 * Picks are filtered against availability on every read rather than
 * cleaned up on disconnect: a user who unplugs WHOOP for a fortnight
 * should get their strain line back when they reconnect, not have the
 * choice silently deleted from their widget.
 */
export function resolvePicks(S, picks, fallbackCount = 3) {
  const avail = availableMetrics(S);
  const ok = (picks || []).map(k => avail.find(m => m.key === k)).filter(Boolean);
  return ok.length ? ok : avail.slice(0, fallbackCount);
}

/**
 * Series for charting: [{ key, color, label, unit, points: [[ms, v]] }].
 * Each series keeps its own scale — weight in kg and strain out of 21
 * share no axis, so they are normalised independently at draw time.
 */
export function metricSeries(S, keys, days = 30) {
  const log = (S && S.vitalsLog) || {};
  const cutoff = Date.now() - days * 86400000;
  return keys.map(key => {
    const m = metricByKey(key);
    const points = Object.keys(log).sort()
      .map(d => [new Date(d + 'T12:00').getTime(), log[d] && log[d][key]])
      .filter(([t, v]) => v != null && t >= cutoff);
    return { key, label: m?.label || key, unit: m?.unit || '', color: m?.color || 'var(--em)', points };
  }).filter(s => s.points.length > 0);
}

/**
 * Formatting for the trading report.
 *
 * THE RULE: money arrives as integer strings of minor units (pence) and
 * is never turned into a JavaScript number. A JSON number is an IEEE
 * double and cannot hold every pence value exactly — `2143.02` is not
 * representable, and once a rounding error is in, it is invisible and
 * permanent. So every function here does string arithmetic only, and
 * there is no `sum` — if a total is needed the payload already carries
 * one.
 *
 * Pure, no React, no DOM: the money rules are the part that must be
 * assertable directly.
 */

const SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

/**
 * Integer-minor-units string → display string. Returns null for
 * anything unknown, so callers must decide what "unknown" looks like
 * rather than being handed a plausible zero.
 *
 * `null` in, `null` out is deliberate and load-bearing: the upstream
 * sends null for equity when a holding has no current price, meaning
 * the value is genuinely unknown. Rendering that as £0.00 would be
 * worse than a gap, because a fabricated zero looks like information.
 */
export function formatMinor(minor, currency = 'GBP') {
  if (minor === null || minor === undefined) return null;
  const s = String(minor).trim();
  if (!/^-?\d+$/.test(s)) return null;          // not an integer string — refuse

  const negative = s.startsWith('-');
  const digits = (negative ? s.slice(1) : s).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const minorPart = digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = SYMBOLS[currency] || '';
  return `${negative ? '-' : ''}${symbol}${grouped}.${minorPart}`;
}

/**
 * Percentages ARE numbers upstream — already derived and rounded — so
 * they're safe to treat as numbers. null means no baseline yet (a fresh
 * agent, or no prior close), which is not the same as 0%.
 */
export function formatPct(pct) {
  if (pct === null || pct === undefined || typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** Sign class for colouring, with 'flat' kept distinct from unknown. */
export function pctTone(pct) {
  if (pct === null || pct === undefined || typeof pct !== 'number' || !Number.isFinite(pct)) return 'unknown';
  if (pct > 0) return 'up';
  if (pct < 0) return 'down';
  return 'flat';
}

/** "4.00000000" → "4"; "0.50000000" → "0.5". String in, string out. */
export function trimQty(qty) {
  const s = String(qty ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;      // unexpected shape — show as-is
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

export const STATUS_LABEL = {
  idle: 'Idle',
  running: 'Running',
  halted: 'Halted',
  killed: 'Killed',
};

/**
 * Is every number in this payload trustworthy?
 *
 * reconciliation.status is the single most important field: it says
 * whether the trading app's ledger still agrees with the broker. When
 * it doesn't, every figure below it is suspect and the widget must say
 * so rather than rendering a calm, normal-looking card over it.
 *
 * Treats a MISSING reconciliation block as untrustworthy — an older or
 * partial payload shouldn't quietly read as healthy.
 */
export function reconciliationOk(report) {
  return report?.reconciliation?.status === 'ok';
}

/** Short relative age for the asOf stamp, so a stale widget looks stale. */
export function relativeAge(iso, now = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const secs = Math.max(0, Math.round((now - t) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

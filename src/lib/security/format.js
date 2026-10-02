/**
 * Number, byte, duration and "how long ago" formatting for the owner's
 * Security console (Upgrade → Security).
 *
 * Every input may be missing, a string, NaN or negative — the console
 * reads a function whose panels fail soft one at a time, and a field the
 * backend could not fill arrives as null. Each formatter answers with an
 * em dash for "no value" rather than "NaN", "0" or a throw, because a
 * zero that is really "unknown" is the most misleading thing a health
 * screen can show.
 *
 * Pure: format.test.mjs pins it (npm run check:secformat).
 */

export const NONE = '—';

/** A finite number, or null. Accepts numeric strings ("42", "3.5"). */
export function num(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 1234 → "1,234". Rounds to `dp` places (default 0). */
export function fmtInt(v, dp = 0) {
  const n = num(v);
  if (n == null) return NONE;
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Compact count: 950 → "950", 1234 → "1.2k", 4_560_000 → "4.6M". */
export function fmtCompact(v) {
  const n = num(v);
  if (n == null) return NONE;
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const one = (x, unit) => {
    const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
    return `${sign}${String(r).replace(/\.0$/, '')}${unit}`;
  };
  if (a < 1000) return `${sign}${Math.round(a)}`;
  if (a < 999_950) return one(a / 1e3, 'k');
  if (a < 999_950_000) return one(a / 1e6, 'M');
  return one(a / 1e9, 'B');
}

/** 0.4567 or 45.67 → "45.7%". Values ≤ 1 are NOT treated as fractions —
 *  the spec's fields are already percentages (cpuPct, cacheHitPct). */
export function fmtPct(v, dp = 1) {
  const n = num(v);
  if (n == null) return NONE;
  const r = Math.round(n * 10 ** dp) / 10 ** dp;
  return `${r.toFixed(dp).replace(/\.0+$/, '')}%`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
/** Binary-scaled bytes, one decimal under 100: 1536 → "1.5 KB". */
export function fmtBytes(v) {
  const n = num(v);
  if (n == null || n < 0) return NONE;
  let x = n, i = 0;
  while (x >= 1024 && i < BYTE_UNITS.length - 1) { x /= 1024; i++; }
  const r = i === 0 || x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
  return `${String(r).replace(/\.0$/, '')} ${BYTE_UNITS[i]}`;
}

/** Seconds → the two largest units: 42 → "42s", 3725 → "1h 2m", 266400 → "3d 2h". */
export function fmtDuration(sec) {
  const n = num(sec);
  if (n == null || n < 0) return NONE;
  const s = Math.round(n);
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return r ? `${m}m ${r}s` : `${m}m`;
}

/** Milliseconds → "640 ms" / "2.4 s". */
export function fmtMs(v) {
  const n = num(v);
  if (n == null || n < 0) return NONE;
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '')} s`;
}

/** ISO/epoch → epoch ms, or null. */
export function toMs(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How long ago, short: "just now", "12s ago", "5m ago", "3h ago",
 * "2d ago", then a date ("14 Sep"). Future times (clock skew) read as
 * "just now" rather than "-3s ago".
 */
export function ago(t, now = Date.now()) {
  const ms = toMs(t);
  if (ms == null) return NONE;
  const s = Math.floor((now - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Age, compact like Sentry's column: "45s", "12m", "5h", "3d", "4mo", "2y". */
export function fmtAge(t, now = Date.now()) {
  const ms = toMs(t);
  if (ms == null) return NONE;
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** "14:26" (24 h, local). */
export function clock(t) {
  const ms = toMs(t);
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "14 Sep, 09:41" — a stamp to hover for the exact time behind `ago`. */
export function stamp(t) {
  const ms = toMs(t);
  if (ms == null) return '';
  return new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Short commit sha: "a1b2c3d". */
export function shortSha(s) {
  return typeof s === 'string' && s ? s.slice(0, 7) : '';
}

/** "1 ticket" / "3 tickets". */
export function plural(n, word, many = `${word}s`) {
  const v = num(n) ?? 0;
  return `${fmtInt(v)} ${v === 1 ? word : many}`;
}

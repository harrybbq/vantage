/**
 * Upgrade → Books: the view-side arithmetic the screens share — period
 * ranges, the dense month axis for the chart, the monthly running cost,
 * cost-by-category rows, and reading what the books function answers.
 *
 * The ledger maths itself (summarise, money, importers) is src/lib/books/
 * — this file only shapes its output for the screens. Pure: no React, no
 * network, `today` is always a parameter. booksView.test.mjs pins it
 * (run with npm run check:homelines). Invented data only — public repo.
 */
import { CATEGORIES, categoryLabel as libLabel } from '../books/categories.js';
import { calendarPeriod, customPeriod } from '../books/reports.js';

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local 'YYYY-MM-DD' for a Date. */
export const isoOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM' shifted by n months. */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Last day of a 'YYYY-MM' as 'YYYY-MM-DD'. */
export function monthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** 'YYYY-MM' → 'Oct 26' (short axis label) or 'Oct 2026' (long). */
export function monthLabel(ym, long = false) {
  const [y, m] = ym.split('-').map(Number);
  return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

/** '2026-10-05' → '5 Oct 2026' */
export function dateLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// 'This year' is the library's 'ytd' (1 Jan → today), so the chart ends
// on the current month instead of drawing November and December empty.
export const PERIODS = [
  { id: 'month', label: 'This month', kind: 'month' },
  { id: 'last-month', label: 'Last month', kind: 'last-month' },
  { id: 'year', label: 'This year', kind: 'ytd' },
  { id: 'last-year', label: 'Last year', kind: 'last-year' },
  { id: 'custom', label: 'Custom' },
];

/**
 * { from, to, label } for a period id — the library's calendarPeriod /
 * customPeriod (calendar months and years only; no company year). A
 * custom range that arrives backwards is swapped rather than refused.
 */
export function periodRange(id, today, custom = {}) {
  const p = PERIODS.find(x => x.id === id);
  if (id === 'custom') {
    const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    let from = ok(custom.from) ? custom.from : `${today.slice(0, 7)}-01`;
    let to = ok(custom.to) ? custom.to : today;
    if (from > to) [from, to] = [to, from];
    return customPeriod(from, to) || calendarPeriod('month', today);
  }
  return calendarPeriod(p ? p.kind : 'month', today) || calendarPeriod('month', today);
}

/** Every 'YYYY-MM' from the month of `from` to the month of `to`, inclusive. */
export function monthsBetween(from, to) {
  const out = [];
  let m = from.slice(0, 7);
  const end = to.slice(0, 7);
  for (let i = 0; m <= end && i < 600; i++) { out.push(m); m = addMonths(m, 1); }
  return out;
}

/**
 * The window the Overview fetches: the period, widened back so the chart
 * always has twelve months and the running cost its three full months
 * before the period's last month. → { from, to }
 */
export function fetchWindow(period) {
  const back = `${addMonths(period.to.slice(0, 7), -11)}-01`;
  return { from: back < period.from ? back : period.from, to: period.to };
}

/**
 * The chart's months: the period's own months if it spans twelve or
 * more, otherwise the twelve months ending with the period's last month.
 * Missing months are zero rows, so the time axis never compresses.
 */
export function chartMonths(byMonth, period) {
  const end = period.to.slice(0, 7);
  const span = monthsBetween(period.from, period.to);
  const months = span.length >= 12 ? span : monthsBetween(`${addMonths(end, -11)}-01`, period.to);
  const at = Object.fromEntries((byMonth || []).map(r => [r.month, r]));
  return months.map(m => ({
    month: m,
    income: Math.max(0, Number(at[m] && at[m].income) || 0),
    expense: Math.max(0, Number(at[m] && at[m].expense) || 0),
    inPeriod: m >= period.from.slice(0, 7) && m <= end,
  }));
}

/**
 * Monthly running cost: the average of the last three COMPLETE months'
 * expenses before `refMonth` (the month a part-month would distort).
 * Months with nothing logged count as £0 — a quiet month is real.
 * → { pence, months: ['YYYY-MM' ×3] }
 */
export function runningCost(byMonth, refMonth) {
  const months = [addMonths(refMonth, -3), addMonths(refMonth, -2), addMonths(refMonth, -1)];
  const at = Object.fromEntries((byMonth || []).map(r => [r.month, Number(r.expense) || 0]));
  const sum = months.reduce((s, m) => s + (at[m] || 0), 0);
  return { pence: Math.round(sum / 3), months };
}

/** Which month the running cost is measured before: the period's end month, or this month if that's later. */
export function runningRef(period, today) {
  const end = period.to.slice(0, 7);
  const now = today.slice(0, 7);
  if (end >= now) return now;
  return period.to === monthEnd(end) ? addMonths(end, 1) : end;
}

/** Display label for a category of a kind (the library's; unknown ids are humanised, not hidden). */
export const categoryLabel = (kind, id) => libLabel(kind, id);

/** Categories offered for a kind (income · expense · transfer). */
export const categoriesFor = kind => CATEGORIES[kind] || CATEGORIES.expense;

/**
 * summarise().byCategory ({ income:{id:pence}, expense:{id:pence} }) →
 * sorted rows of one kind: [{ id, label, pence, share }] — share of that
 * kind's total.
 */
export function categoryRows(byCategory, kind = 'expense') {
  const src = (byCategory && byCategory[kind]) || {};
  const rows = [];
  let total = 0;
  for (const [id, v] of Object.entries(src)) {
    const pence = Number(v) || 0;
    if (pence <= 0) continue;
    total += pence;
    rows.push({ id, pence });
  }
  rows.sort((a, b) => b.pence - a.pence || a.id.localeCompare(b.id));
  return rows.map(r => ({ ...r, label: categoryLabel(kind, r.id), share: total ? r.pence / total : 0 }));
}

/** Signed GBP value of an entry for display: income +, expense −, transfer ±0 (shown unsigned). */
export function signedPence(e) {
  const v = Number(e && e.gbp_pence);
  const n = Number.isFinite(v) ? v : 0;
  return e && e.kind === 'expense' ? -n : n;
}

export const SOURCE_LABEL = {
  manual: 'Manual', bank_csv: 'Bank', apple: 'Apple', google: 'Google', revenuecat: 'RevenueCat', recurring: 'Bill',
};

export const FORMAT_LABEL = {
  'bank-generic': 'Bank statement', 'apple-financial': 'App Store financial report',
  'google-earnings': 'Google Play earnings report', 'books-native': 'Books export',
};

/** The server takes at most this many rows per import request. */
export const IMPORT_CHUNK = 2000;

/** Split rows into request-sized parts. */
export function chunks(rows, size = IMPORT_CHUNK) {
  const out = [];
  for (let i = 0; i < (rows || []).length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Currencies among imported entries still waiting for a GBP rate (importers mark them needs_fx). */
export function currenciesNeedingRate(entries) {
  const set = new Set();
  for (const e of entries || []) if (e && e.needs_fx && e.currency) set.add(e.currency);
  return [...set].sort();
}

/** The rate boxes' text → applyFx's { USD: 0.79 } (blank or bad entries left out). */
export function ratesFrom(text = {}) {
  const out = {};
  for (const [k, v] of Object.entries(text)) { const n = Number(v); if (/^[A-Z]{3}$/.test(k) && n > 0 && n < 10000) out[k] = n; }
  return out;
}

/**
 * A money figure from RevenueCat (major units, its own currency) →
 * '$1,234' / '£980'. RevenueCat is information only: never booked.
 */
export function fmtMajor(v, currency = 'GBP') {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/**
 * Read the books function's answers, after readPanel (lib/security/status)
 * has turned HTTP into { state, data }. The function's payloads are
 * documented in netlify/functions/books.js; these only pick arrays out
 * defensively so a missing key reads as empty, never as a crash.
 */
export function readOverview(data) {
  const d = data && typeof data === 'object' ? data : {};
  return {
    entries: Array.isArray(d.entries) ? d.entries : [],
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : {},
  };
}

/** ?view=recurring → { bills } (overview carries the same list as `recurring`). */
export function readBills(data) {
  const d = data && typeof data === 'object' ? data : {};
  return Array.isArray(d.bills) ? d.bills : Array.isArray(d.recurring) ? d.recurring : [];
}

export function readPage(data) {
  const d = data && typeof data === 'object' ? data : {};
  const entries = Array.isArray(d.entries) ? d.entries : [];
  const next = d.next ?? d.nextBefore ?? null;
  return { entries, next: next == null || next === '' ? null : next };
}

export function readPreview(data) {
  const d = data && typeof data === 'object' ? data : {};
  const arr = x => (Array.isArray(x) ? x : []);
  return { add: arr(d.add), duplicates: arr(d.duplicates), invalid: arr(d.invalid) };
}

/** Merge chunked preview answers into one. */
export function mergePreviews(list) {
  return (list || []).reduce((m, p) => ({
    add: [...m.add, ...p.add], duplicates: [...m.duplicates, ...p.duplicates], invalid: [...m.invalid, ...p.invalid],
  }), { add: [], duplicates: [], invalid: [] });
}

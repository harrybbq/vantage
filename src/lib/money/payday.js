/**
 * Pay day — marked on the Track calendar, and what's still to pay before
 * the next one (owner, Nov 2026).
 *
 * ── What is stored ───────────────────────────────────────────────────
 * One schedule, as a NEW key (additive; nothing else in S is touched):
 *   S.pay = { anchor: 'YYYY-MM-DD', freq, weekendEarly, setAt }
 *   freq          'month' | '4week' | '2week' | 'week' | 'once'
 *   weekendEarly  monthly only: a pay date on a Saturday or Sunday is
 *                 paid the Friday before, as most UK payrolls do
 * Every pay day is DERIVED from the anchor at read time, never written
 * out one by one, for the same reason trips are not copied onto the
 * calendar: a copy has to be kept in step forever.
 * `S.pay = null` means no pay day set.
 *
 * ── The indicator ────────────────────────────────────────────────────
 * `beforePay(S, today)` → the next pay day after today and the
 * subscription renewals that fall from today up to (not including) it,
 * with their total. A renewal ON pay day is paid out of that pay, so it
 * belongs to the next period. Renewals use the same rolling rule as
 * the subscriptions widget (money/recurring.nextRenewal).
 *
 * Vantage has no bank connection: this is arithmetic on the user's own
 * subscription list and pay schedule, not a balance.
 *
 * Pure — no React, no DOM, no network.
 */
import { nextRenewal } from './recurring.js';

export const PAY_FREQS = Object.freeze([
  { id: 'month', label: 'Monthly', hint: 'same date each month' },
  { id: '4week', label: 'Every 4 weeks', hint: '' },
  { id: '2week', label: 'Every 2 weeks', hint: '' },
  { id: 'week', label: 'Weekly', hint: '' },
  { id: 'once', label: 'Just this day', hint: '' },
]);
const FREQ_IDS = PAY_FREQS.map(f => f.id);
const STEP_DAYS = { week: 7, '2week': 14, '4week': 28 };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAt = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.round((dayAt(b) - dayAt(a)) / DAY_MS);

/** The schedule, cleaned, or null. */
export function payOf(S) {
  const p = S && S.pay;
  if (!p || typeof p !== 'object' || !ISO_RE.test(p.anchor || '')) return null;
  const freq = FREQ_IDS.includes(p.freq) ? p.freq : 'month';
  return { anchor: p.anchor, freq, weekendEarly: freq === 'month' && p.weekendEarly !== false };
}

export const freqLabel = id => (PAY_FREQS.find(f => f.id === id) || PAY_FREQS[0]).label;

/** A monthly date on a weekend → the Friday before. */
function weekendToFriday(d) {
  const wd = d.getDay();
  return wd === 6 ? addDays(d, -1) : wd === 0 ? addDays(d, -2) : d;
}

/** Day `dom` of a month, clamped to its length (31 → 30 Nov, 28/29 Feb). */
function monthDay(y, m, dom) {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dom, last));
}

/** Pay days from `fromIso` to `toIso` (inclusive), in order, as ISO dates. */
export function payDaysBetween(S, fromIso, toIso) {
  const p = payOf(S);
  if (!p || !ISO_RE.test(fromIso || '') || !ISO_RE.test(toIso || '') || toIso < fromIso) return [];
  const out = [];
  if (p.freq === 'once') return p.anchor >= fromIso && p.anchor <= toIso ? [p.anchor] : [];
  if (p.freq === 'month') {
    const a = dayAt(p.anchor);
    const dom = a.getDate();
    const from = dayAt(fromIso);
    // Start a month early: a weekend shift can pull the 1st into the
    // previous month's last days.
    let y = from.getFullYear(), m = from.getMonth() - 1;
    for (let guard = 0; guard < 400; guard++) {
      let d = monthDay(y, m, dom);
      if (p.weekendEarly) d = weekendToFriday(d);
      const iso = isoOf(d);
      if (iso > toIso) break;
      if (iso >= fromIso) out.push(iso);
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }
  const step = STEP_DAYS[p.freq];
  // First occurrence on or after fromIso, stepping from the anchor in
  // either direction (a schedule set today still shows last month's).
  const k = Math.ceil(daysBetween(p.anchor, fromIso) / step);
  for (let d = addDays(dayAt(p.anchor), k * step), guard = 0; guard < 400; d = addDays(d, step), guard++) {
    const iso = isoOf(d);
    if (iso > toIso) break;
    out.push(iso);
  }
  return out;
}

export const isPayDay = (S, iso) => payDaysBetween(S, iso, iso).length > 0;

/** The first pay day strictly after `todayIso`, within ~13 months, or null. */
export function nextPayDay(S, todayIso) {
  if (!ISO_RE.test(todayIso || '')) return null;
  const from = isoOf(addDays(dayAt(todayIso), 1));
  const to = isoOf(addDays(dayAt(todayIso), 400));
  return payDaysBetween(S, from, to)[0] || null;
}

/**
 * Subscription renewals from `todayIso` up to (not including) the next
 * pay day → { next, days, paidToday, total, items: [{ iso, id, name, amount }] },
 * or null when no pay day is set (or none is coming).
 */
export function beforePay(S, todayIso) {
  const next = nextPayDay(S, todayIso);
  if (!next) return null;
  const end = isoOf(addDays(dayAt(next), -1));
  const items = [];
  const subs = S && Array.isArray(S.subscriptions) ? S.subscriptions : [];
  for (const sub of subs) {
    if (!sub || !sub.nextDate) continue;
    let occ = nextRenewal(sub, dayAt(todayIso));
    for (let guard = 0; occ && guard < 60; guard++) {
      const iso = isoOf(occ);
      if (iso > end) break;
      items.push({ iso, id: sub.id, name: sub.name || 'Subscription', amount: Number(sub.amount) || 0 });
      const after = nextRenewal(sub, addDays(occ, 1));
      if (!after || after <= occ) break;
      occ = after;
    }
  }
  items.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.name.localeCompare(b.name)));
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  return { next, days: daysBetween(todayIso, next), paidToday: isPayDay(S, todayIso), total, items };
}

// ── Updaters (additive: only S.pay) ──

/** Set (or replace) the schedule from a marked date. */
export function setPayDay(prev, iso, freq = 'month', { weekendEarly = true, now = Date.now() } = {}) {
  if (!ISO_RE.test(iso || '')) return prev;
  const f = FREQ_IDS.includes(freq) ? freq : 'month';
  return { ...prev, pay: { anchor: iso, freq: f, weekendEarly: f === 'month' ? !!weekendEarly : false, setAt: now } };
}

/** "Remove pay day". */
export function clearPayDay(prev) {
  return prev && prev.pay ? { ...prev, pay: null } : prev;
}

/** "in 9 days", "tomorrow", "today". */
export function inDays(n) {
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

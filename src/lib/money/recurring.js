/**
 * Recurring outgoings that keep their own diary.
 *
 * ── The rot this fixes ───────────────────────────────────────────────
 * A subscription is entered once with a renewal date and then never
 * touched again. The widget has always rolled that date forward for
 * DISPLAY — `nextRenewal` walks it by the cadence until it lands in the
 * future — but the stored value was left where the user typed it. So a
 * Netflix row entered in January still says `nextDate: 2026-01-14` in
 * September, and everything that reads the state without going through
 * the widget (the export, a future reminder, the next feature that
 * needs a bill date) sees a date eight months stale.
 *
 * The rule is already known: the app can work out that a renewal has
 * happened. Persisting what it works out is the whole change.
 *
 * ── What it is careful about ─────────────────────────────────────────
 * It only ever moves a date FORWARD, and only past dates. It never
 * touches the amount, the name or the cadence — the parts the user
 * decided. It records `lastCharged` so the roll is visible rather than
 * silent, which is the difference between a date that maintains itself
 * and a date that changed while you weren't looking.
 *
 * It does NOT create a transaction, adjust a balance or move money.
 * Vantage has no bank connection and no purchase history; a subscription
 * row is a statement of intent, and rolling its date is bookkeeping on
 * that statement, not a claim that a payment left an account.
 *
 * Pure. No React, no network.
 */
import { toMonthly } from '../savings/derive.js';

export { toMonthly };

const ROLL = {
  week: d => d.setDate(d.getDate() + 7),
  month: d => d.setMonth(d.getMonth() + 1),
  year: d => d.setFullYear(d.getFullYear() + 1),
};

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Midnight at the start of `from`'s day. Renewals are dates, not
 *  instants: a bill due today is due today all day. Comparing against
 *  the clock made one due today flip to "in 30 days" at noon. */
const startOfDay = from => new Date(from.getFullYear(), from.getMonth(), from.getDate());

/**
 * The next renewal on or after `from`, rolling a past date forward by
 * the cadence. Moved here from LifeWidgets so the roll has one
 * definition and can be checked without a browser.
 */
export function nextRenewal(sub, from = new Date()) {
  if (!sub || !sub.nextDate) return null;
  const d = new Date(sub.nextDate + 'T12:00');
  if (isNaN(d)) return null;
  const roll = ROLL[sub.freq || 'month'];
  if (!roll) return d;
  const floor = startOfDay(from);
  // 400 iterations covers a weekly bill left untouched for seven years.
  let guard = 0;
  while (d < floor && guard++ < 400) roll(d);
  return d;
}

/**
 * The most recent occurrence strictly before `from`, or null when the
 * first one has not happened yet. This is what "last charged" means:
 * the renewal the stored date has just been carried past.
 */
export function lastRenewal(sub, from = new Date()) {
  if (!sub || !sub.nextDate) return null;
  const start = new Date(sub.nextDate + 'T12:00');
  if (isNaN(start)) return null;
  const roll = ROLL[sub.freq || 'month'];
  if (!roll) return null;
  const floor = startOfDay(from);
  if (start >= floor) return null;
  const d = new Date(start);
  let prev = null;
  let guard = 0;
  while (d < floor && guard++ < 400) { prev = new Date(d); roll(d); }
  return prev;
}

/** Days until a renewal, floored at zero. */
export const daysUntil = (due, from = new Date()) =>
  Math.max(0, Math.ceil((due - from) / 86400000));

/**
 * Everything the subscriptions surfaces read.
 *
 * `all` exists because a row with no renewal date must still be listed
 * and removable — dropping it from the manager would strand it.
 */
export function subsStats(S, now = new Date()) {
  const subs = (S && S.subscriptions) || [];
  const monthly = subs.reduce((s, x) => s + toMonthly(x.amount, x.freq), 0);
  const withDue = subs.map(x => ({ ...x, due: nextRenewal(x, now) }));
  const upcoming = withDue.filter(x => x.due).sort((a, b) => a.due - b.due);
  const all = [...upcoming, ...withDue.filter(x => !x.due)];
  return { subs, monthly, upcoming, all };
}

/**
 * Carry every past renewal date forward to the next one that has not
 * happened yet.
 *
 * Returns `prev` UNCHANGED when every date is already in the future,
 * which is the usual case — this runs on open, and building a fresh
 * state object for nothing would queue a save of the whole ~1MB blob.
 */
export function rollSubscriptions(prev, now = new Date()) {
  const subs = (prev && prev.subscriptions) || [];
  if (!subs.length) return prev;

  let changed = false;
  const next = subs.map(sub => {
    if (!sub || !sub.nextDate || !ROLL[sub.freq || 'month']) return sub;
    const due = nextRenewal(sub, now);
    if (!due) return sub;
    const nextDate = iso(due);
    if (nextDate === sub.nextDate) return sub;      // already in the future
    const last = lastRenewal(sub, now);
    changed = true;
    return { ...sub, nextDate, ...(last ? { lastCharged: iso(last) } : {}) };
  });

  return changed ? { ...prev, subscriptions: next } : prev;
}

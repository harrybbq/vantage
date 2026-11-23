/**
 * The record that does not reset (owner, Nov 2026: "less like a chore").
 *
 * A Quit habit's clock goes to zero at every slip, and for a habit that
 * slips often the clock is then the worst possible summary of the
 * effort: five hours, again, with 24 clean days out of the last 30
 * nowhere to be seen. This is the other number. A slip dents it by one
 * day; it never goes to nothing.
 *
 *   Quit      the last 30 calendar days, today included: clean unless a
 *             run ended in that day. Days before the habit's history
 *             begins are not counted either way, so a week-old habit
 *             reads "7 of the last 7", not "7 of 30".
 *   Cut down  the last 12 CLOSED periods against the budget: on budget
 *             or over. Using a day inside the budget is the plan, not a
 *             slip, so days are the wrong unit here.
 *
 * Derived from what the habit already stores (`runs`, `startTime`,
 * `useDays`); nothing is written. A slip older than the 60 kept runs
 * cannot be seen, which only matters past 60 slips in 30 days.
 *
 * It also grows the runner's scenery (view.js sceneryLevel): after a
 * slip he walks again, but through what has already been grown.
 *
 * Pure. No React, no DOM.
 */
import { isCut, periods, budgetOf, isoDay, addDays } from './cutdown.js';
import { runsOf } from './progress.js';

export const RECORD_DAYS = 30;
export const RECORD_PERIODS = 12;

/** The first instant this habit has any history for: its earliest kept run, else its current start. */
function historyStart(h) {
  const starts = runsOf(h).map(r => r.start);
  const cur = Number(h && h.startTime);
  if (Number.isFinite(cur) && cur > 0) starts.push(cur);
  return starts.length ? Math.min(...starts) : null;
}

/**
 * → { kind: 'days' | 'periods', per?, marks: [{ ok, iso?, dry? }], good, of }
 * `marks` run oldest → newest; `good` of `of` were clean / on budget.
 */
export function recordOf(h, now = Date.now()) {
  if (!h) return { kind: 'days', marks: [], good: 0, of: 0 };
  if (isCut(h)) {
    const ps = periods(h, now).filter(p => p.tracked && !p.current).slice(-RECORD_PERIODS);
    const marks = ps.map(p => ({ ok: !!p.onTarget, dry: !!p.dry, iso: p.start }));
    return { kind: 'periods', per: budgetOf(h).per, marks, good: marks.filter(m => m.ok).length, of: marks.length };
  }
  const begin = historyStart(h);
  const first = begin != null ? isoDay(Math.min(begin, now)) : isoDay(now);
  const slips = new Set(runsOf(h).map(r => isoDay(r.end)));
  const today = isoDay(now);
  const marks = [];
  for (let i = RECORD_DAYS - 1; i >= 0; i--) {
    const iso = addDays(today, -i);
    if (iso < first) continue;
    marks.push({ ok: !slips.has(iso), iso });
  }
  return { kind: 'days', marks, good: marks.filter(m => m.ok).length, of: marks.length };
}

/** "24 of the last 30 days clean" / "7 of the last 8 weeks on budget". Empty before there is anything to say. */
export function recordLabel(rec) {
  if (!rec || !rec.of) return rec && rec.kind === 'periods' ? `First ${rec.per === 'month' ? 'month' : 'week'} in progress` : '';
  if (rec.kind === 'periods') {
    const unit = rec.per === 'month' ? (rec.of === 1 ? 'month' : 'months') : (rec.of === 1 ? 'week' : 'weeks');
    return rec.of === 1 ? `Last ${unit} ${rec.good ? 'on budget' : 'over budget'}` : `${rec.good} of the last ${rec.of} ${unit} on budget`;
  }
  if (rec.of === 1) return rec.good ? 'Clean today' : 'Day one';
  return `${rec.good} of the last ${rec.of} days clean`;
}

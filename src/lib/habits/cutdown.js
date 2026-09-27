/**
 * Cut-down habits — a budget, not a timer.
 *
 * A Quit habit counts up from the last relapse. That is the wrong shape
 * for "drink on at most two days a week": the plan itself contains the
 * drinks, so a timer that restarts on each one can never get past three
 * and a half days however well the plan is kept. The strike allowance
 * only coloured the clock; the runner still tripped twice a week.
 *
 * A Cut-down habit (`kind: 'cut'`) keeps a list of the days it was used
 * and a budget per week or month. Nothing restarts when a day is logged.
 * Progress is the run of CLOSED periods that stayed within budget, and
 * that run is what the runner, the ladder and the milestones read.
 *
 * Stored on the habit (all additive — a habit without `kind` is Quit):
 *   kind        'cut'
 *   budget      { max: 2, per: 'week' | 'month' }
 *   budgetSince 'YYYY-MM-DD' — the first day the budget applied. Periods
 *               before it are "not tracked", never counted as on target.
 *   useDays     ['YYYY-MM-DD', …] — one entry per day used, sorted
 *   dryPaid     ['YYYY-MM-DD', …] — period starts whose dry bonus is paid
 *
 * Everything else is derived, so there is no counter that can drift from
 * the days it counts. Dates are LOCAL calendar days: a drink at 23:30 is
 * that day's, whatever the UTC clock says.
 *
 * Pure. No React, no DOM.
 */

export const DAY = 86400000;
/** Milliseconds one on-target period is worth on the milestone ladder. */
export const PERIOD_MS = { week: 7 * DAY, month: 30 * DAY };
/** Coins for a closed period with no use at all. */
export const DRY_BONUS = 10;
/** How far back useDays are kept. Two years covers every view. */
const KEEP_DAYS = 730;

const pad = n => String(n).padStart(2, '0');
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const isCut = h => !!h && h.kind === 'cut';

/** Local calendar day of a timestamp. */
export function isoDay(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);            // noon: DST never moves it a day
}
const fromDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(iso, n) {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

export function budgetOf(h) {
  const b = (h && h.budget) || {};
  const max = Math.max(0, Math.floor(Number(b.max)));
  return { max: Number.isFinite(max) ? max : 0, per: b.per === 'month' ? 'month' : 'week' };
}

/** First day of the period `iso` falls in: the Monday, or the 1st. */
export function periodStart(iso, per) {
  const d = toDate(iso);
  if (per === 'month') d.setDate(1);
  else d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fromDate(d);
}
export function nextPeriod(startIso, per) {
  const d = toDate(startIso);
  if (per === 'month') { d.setDate(1); d.setMonth(d.getMonth() + 1); } else d.setDate(d.getDate() + 7);
  return fromDate(d);
}
function prevPeriod(startIso, per) {
  const d = toDate(startIso);
  if (per === 'month') { d.setDate(1); d.setMonth(d.getMonth() - 1); } else d.setDate(d.getDate() - 7);
  return fromDate(d);
}

function usesOf(h) {
  return (h && Array.isArray(h.useDays) ? h.useDays : []).filter(isIso);
}
function sinceOf(h, now) {
  return isIso(h && h.budgetSince) ? h.budgetSince : isoDay(now);
}

/**
 * Every period from the first tracked one (or `limit` back, whichever is
 * later for display) to the current one, oldest first.
 *   { start, end (exclusive), used, days[], over, dry, onTarget, tracked, current }
 * `tracked` is false for periods that ended before the budget began.
 */
export function periods(h, now = Date.now(), limit = null) {
  const { max, per } = budgetOf(h);
  const today = isoDay(now);
  const cur = periodStart(today, per);
  const first = periodStart(sinceOf(h, now), per);
  const uses = usesOf(h);
  const out = [];
  let s = cur;
  let guard = 0;
  // Walk back from now: to the first tracked period, or `limit` periods.
  while (guard++ < 800) {
    const tracked = s >= first;
    if (limit == null ? !tracked : out.length >= limit) break;
    const e = nextPeriod(s, per);
    const days = uses.filter(d => d >= s && d < e);
    const used = days.length;
    out.push({
      start: s, end: e, used, days,
      over: used > max,
      dry: tracked && used === 0 && s !== cur,
      onTarget: tracked && used <= max,
      tracked,
      current: s === cur,
    });
    s = prevPeriod(s, per);
  }
  return out.reverse();
}

/** Closed, tracked periods only — the ones that have a verdict. */
function closed(h, now) {
  return periods(h, now).filter(p => !p.current && p.tracked);
}

/** Consecutive on-target closed periods, counting back from the last one. */
export function streak(h, now = Date.now()) {
  const c = closed(h, now);
  let n = 0;
  for (let i = c.length - 1; i >= 0 && c[i].onTarget; i--) n++;
  return n;
}
export function bestStreak(h, now = Date.now()) {
  let best = 0, run = 0;
  for (const p of closed(h, now)) { run = p.onTarget ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
/** Best run that has already ENDED — the one the current run is chasing. */
export function bestBefore(h, now = Date.now()) {
  const c = closed(h, now);
  let i = c.length - 1;
  while (i >= 0 && c[i].onTarget) i--;          // skip the run still going
  let best = 0, run = 0;
  for (let k = 0; k <= i; k++) { run = c[k].onTarget ? run + 1 : 0; best = Math.max(best, run); }
  return best;
}
export function onTargetTotal(h, now = Date.now()) { return closed(h, now).filter(p => p.onTarget).length; }
export function dryTotal(h, now = Date.now()) { return closed(h, now).filter(p => p.dry).length; }

/** The streak as ladder time: what milestones and the runner's stage read. */
export function streakMs(h, now = Date.now()) {
  return streak(h, now) * PERIOD_MS[budgetOf(h).per];
}

/**
 * This period so far.
 *   state 'dry' nothing used · 'ok' within budget · 'at' budget spent · 'over'
 */
export function current(h, now = Date.now()) {
  const { max, per } = budgetOf(h);
  const today = isoDay(now);
  const start = periodStart(today, per);
  const end = nextPeriod(start, per);
  const days = usesOf(h).filter(d => d >= start && d < end);
  const used = days.length;
  const state = used > max ? 'over' : used === max && max > 0 ? 'at' : used === 0 ? 'dry' : 'ok';
  return { start, end, days, used, max, per, left: Math.max(0, max - used), state, today, usedToday: days.includes(today) };
}

/**
 * The days of the current period, for the tap-to-log strip. Future days
 * are there but not tappable; days before the budget began are marked.
 */
export function periodDays(h, now = Date.now()) {
  const c = current(h, now);
  const since = sinceOf(h, now);
  const used = new Set(c.days);
  const out = [];
  for (let d = c.start; d < c.end; d = addDays(d, 1)) {
    out.push({ iso: d, used: used.has(d), future: d > c.today, today: d === c.today, before: d < since });
  }
  // Mark which used days went past the budget, in date order.
  let n = 0;
  for (const x of out) if (x.used) { n++; x.over = n > c.max; }
  return out;
}

/** Which closed period's dry bonus is due now, if any: the last one only. */
export function dryBonusDue(h, now = Date.now()) {
  const c = closed(h, now);
  const last = c[c.length - 1];
  if (!last || !last.dry) return null;
  if ((h.dryPaid || []).includes(last.start)) return null;
  return last.start;
}

const trim = (days, now) => {
  const cutoff = addDays(isoDay(now), -KEEP_DAYS);
  return [...new Set(days.filter(isIso))].filter(d => d >= cutoff).sort();
};

function patchHabit(prev, id, fn) {
  const habits = (prev && prev.habits) || [];
  const h = habits.find(x => x && x.id === id);
  if (!h) return prev;
  const next = fn(h);
  if (next === h) return prev;
  return { ...prev, habits: habits.map(x => (x && x.id === id ? next : x)) };
}

/**
 * Log or un-log a day. Future days and non-cut habits are refused, and
 * `prev` comes back BY IDENTITY so a misfire costs no write.
 */
export function toggleUse(prev, id, iso, now = Date.now()) {
  if (!isIso(iso) || iso > isoDay(now)) return prev;
  return patchHabit(prev, id, h => {
    if (!isCut(h)) return h;
    const uses = usesOf(h);
    const next = uses.includes(iso) ? uses.filter(d => d !== iso) : [...uses, iso];
    return { ...h, useDays: trim(next, now) };
  });
}

/** Log a day if it isn't logged (the hub's quick button — never un-logs). */
export function addUse(prev, id, iso, now = Date.now()) {
  if (!isIso(iso) || iso > isoDay(now)) return prev;
  return patchHabit(prev, id, h => {
    if (!isCut(h) || usesOf(h).includes(iso)) return h;
    return { ...h, useDays: trim([...usesOf(h), iso], now) };
  });
}

/**
 * Quit → Cut down. The allowance becomes the budget ('ever' has no
 * period, so it becomes weekly), strikes already banked this period
 * become logged days, and the budget starts today. The timer, the
 * relapse count and the run history are left exactly as they are, so
 * switching back finds them.
 *
 * Milestones are re-armed WITHOUT paying: the week count starts at zero,
 * and they pay again as it climbs, as after a relapse.
 */
export function toCut(h, { max, per } = {}, now = Date.now()) {
  if (!h) return h;
  const fromStrikes = (h.strikeTimes || []).map(Number).filter(t => Number.isFinite(t) && t > 0 && t <= now).map(t => isoDay(t));
  const budget = {
    max: Math.max(0, Math.floor(Number(max ?? h.strikesAllowed ?? 2)) || 0),
    per: (per ?? h.strikesPeriod) === 'month' ? 'month' : 'week',
  };
  const since = isIso(h.budgetSince) ? h.budgetSince : isoDay(now);
  const cs = periodStart(isoDay(now), budget.per);
  return {
    ...h,
    kind: 'cut',
    budget,
    budgetSince: since,
    useDays: trim([...usesOf(h), ...fromStrikes.filter(d => d >= cs)], now),
    milestones: (h.milestones || []).map(m => ({ ...m, awarded: false })),
  };
}

/**
 * Cut down → Quit. The timer picks up from where it was; milestones it
 * has already passed are marked awarded WITHOUT paying, so flipping the
 * type back and forth can never be a coin machine. The budget and the
 * logged days stay on the habit, unused, in case it is switched back.
 */
export function toQuit(h, now = Date.now()) {
  if (!h) return h;
  const el = now - (Number(h.startTime) || now);
  return {
    ...h,
    kind: 'quit',
    milestones: (h.milestones || []).map(m => ({ ...m, awarded: m.duration <= el })),
  };
}

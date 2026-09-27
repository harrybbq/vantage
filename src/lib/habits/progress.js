/**
 * How far along a habit is, for either kind — the one place every
 * surface asks, so the Habits page, the hub widgets, visions and the
 * coach cannot disagree about a Cut-down habit.
 *
 *   Quit      time since the last relapse
 *   Cut down  the run of periods kept within budget, as ladder time
 *             (6 weeks on target = 42 days on the ladder)
 *
 * Runs: a Quit habit's ended streaks, `runs: [{ start, end }]`, appended
 * by applyRelapse from the day this shipped (no earlier history was
 * kept). `bestManualMs` is an optional "best so far" the user can enter
 * for the time before that. Best and odometer are derived from these.
 *
 * Pure. No React, no DOM.
 */
import { isCut, streak, streakMs, bestBefore, onTargetTotal, budgetOf, PERIOD_MS, DAY } from './cutdown.js';

export const MAX_RUNS = 60;

export function runsOf(h) {
  return (Array.isArray(h && h.runs) ? h.runs : [])
    .filter(r => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
}

/** Ladder time for any habit. */
export function habitElapsed(h, now = Date.now()) {
  if (isCut(h)) return streakMs(h, now);
  return Math.max(0, now - (Number(h && h.startTime) || now));
}

/** Weeks on target → the runner's day stage: 2 wk jog, 4 wk run, 8 wk vault, 13 wk parkour. */
export function weeksToDays(wk) {
  const W = [0, 1, 2, 4, 8, 13], D = [0, 1, 4, 7, 14, 30];
  if (!(wk > 0)) return 0;
  if (wk >= 13) return 30 + (wk - 13) * 3;
  let i = 0;
  while (wk >= W[i + 1]) i++;
  return D[i] + ((D[i + 1] - D[i]) * (wk - W[i])) / (W[i + 1] - W[i]);
}

/** Days that drive the runner's gait. */
export function runnerDays(h, now = Date.now()) {
  if (!isCut(h)) return habitElapsed(h, now) / DAY;
  const n = streak(h, now);
  return weeksToDays(budgetOf(h).per === 'month' ? (n * 30) / 7 : n);
}

/**
 * The run to beat, in ladder ms, or null when there is nothing to chase.
 *   { bestMs, passed }  passed = the current run is already longer
 */
export function ghostOf(h, now = Date.now()) {
  if (isCut(h)) {
    const best = bestBefore(h, now);
    if (!best) return null;
    const unit = PERIOD_MS[budgetOf(h).per];
    return { bestMs: best * unit, passed: streak(h, now) > best };
  }
  const best = bestRunMs(h);
  if (!best) return null;
  return { bestMs: best, passed: habitElapsed(h, now) > best };
}

/** Longest ended Quit run, or the user's own "best so far". */
export function bestRunMs(h) {
  const manual = Math.max(0, Number(h && h.bestManualMs) || 0);
  return runsOf(h).reduce((m, r) => Math.max(m, r.end - r.start), manual);
}

/** Total clean time across every recorded run plus this one. */
export function odometerMs(h, now = Date.now()) {
  return runsOf(h).reduce((s, r) => s + (r.end - r.start), 0) + habitElapsed(h, now);
}

/** "6 wk on target" / "3 mo on target" — the Cut-down headline. */
export function cutHeadline(h, now = Date.now(), short = true) {
  const n = streak(h, now);
  const per = budgetOf(h).per;
  if (short) return `${n} ${per === 'month' ? 'mo' : 'wk'} on target`;
  return `${n} ${per === 'month' ? (n === 1 ? 'month' : 'months') : (n === 1 ? 'week' : 'weeks')} on target`;
}

export { onTargetTotal };

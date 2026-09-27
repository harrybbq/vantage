/**
 * Everything a habit card draws, for either kind, worked out once — so
 * the desktop card and the mobile card cannot disagree about where the
 * runner is, where the ghost is, or how much scenery has grown.
 *
 * Pure. No React, no DOM.
 */
import { ladderProgress, sortedMilestones, allMilestonesDone } from './ladder.js';
import { isCut, current, budgetOf, periods, streak, DAY, PERIOD_MS } from './cutdown.js';
import { habitElapsed, runnerDays, weeksToDays, ghostOf, bestRunMs, odometerMs, runsOf, cutHeadline } from './progress.js';

/**
 * Scenery level, in days. Quit: the days of this run. Cut down: on-target
 * periods in the last year MINUS over-budget ones, so a bad week takes a
 * week of growth away instead of clearing the lane.
 */
export function sceneryLevel(h, now = Date.now()) {
  if (!isCut(h)) return habitElapsed(h, now) / DAY;
  const ps = periods(h, now).filter(p => p.tracked && !p.current).slice(-(budgetOf(h).per === 'month' ? 12 : 52));
  const net = ps.filter(p => p.onTarget).length - ps.filter(p => p.over).length;
  return Math.max(0, net) * (PERIOD_MS[budgetOf(h).per] / DAY);
}

export function habitView(h, now = Date.now()) {
  const cut = isCut(h);
  const elapsed = habitElapsed(h, now);
  const sorted = sortedMilestones(h);
  const nextIdx = sorted.findIndex(m => elapsed < m.duration);
  const g = ghostOf(h, now);
  const ghostProgress = g ? ladderProgress(h, g.bestMs) : null;
  const ghostDays = g
    ? (cut ? weeksToDays(g.bestMs / (7 * DAY)) : g.bestMs / DAY)
    : 0;
  return {
    cut,
    elapsed,
    ladder: ladderProgress(h, elapsed),
    sorted,
    nextIdx,
    allDone: allMilestonesDone(h),
    runnerDays: runnerDays(h, now),
    ghost: g && !g.passed ? { progress: ghostProgress, days: ghostDays } : null,
    pbAt: g && g.passed ? ghostProgress : null,
    bestMs: g ? g.bestMs : 0,
    scenery: sceneryLevel(h, now),
    // Cut down
    cur: cut ? current(h, now) : null,
    streak: cut ? streak(h, now) : 0,
    headline: cut ? cutHeadline(h, now, false) : '',
    // Quit history
    hasHistory: !cut && (runsOf(h).length > 0 || bestRunMs(h) > 0),
    odometer: cut ? 0 : odometerMs(h, now),
    best: cut ? 0 : bestRunMs(h),
  };
}

/** "41 d", "5 h", "12 min" — for best/odometer lines. */
export function shortSpan(ms) {
  if (!(ms > 0)) return '0 d';
  if (ms >= DAY) return `${Math.floor(ms / DAY)} d`;
  if (ms >= 3600000) return `${Math.floor(ms / 3600000)} h`;
  return `${Math.max(1, Math.floor(ms / 60000))} min`;
}

/** "resets Mon" / "resets 1 Nov" */
export function resetsLabel(cur) {
  if (!cur) return '';
  const [y, m, d] = cur.end.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  if (cur.per === 'month') return `resets ${d} ${dt.toLocaleDateString('en-GB', { month: 'short' })}`;
  return 'resets Mon';
}

/**
 * "7 d" / "3 wk" — how long until the ladder reaches `targetMs`, in the
 * habit's own units (Cut down counts whole periods; a week only counts
 * when it closes). null when it is already reached.
 */
export function etaLabel(h, v, targetMs) {
  const left = targetMs - v.elapsed;
  if (!(left > 0)) return null;
  if (v.cut) {
    const per = budgetOf(h).per;
    const n = Math.max(1, Math.ceil(left / PERIOD_MS[per]));
    return `${n} ${per === 'month' ? 'mo' : 'wk'}`;
  }
  return shortSpan(left);
}

/** The gap to the ghost (or past it), in the habit's units. */
export function gapLabel(h, v) {
  const d = Math.abs(v.bestMs - v.elapsed);
  if (v.cut) {
    const per = budgetOf(h).per;
    return `${Math.max(1, Math.round(d / PERIOD_MS[per]))} ${per === 'month' ? 'mo' : 'wk'}`;
  }
  return shortSpan(d);
}

/** Week thresholds matching the runner's day stages (see weeksToDays). */
export const STAGE_WEEKS = [0, 1, 2, 4, 8, 13];

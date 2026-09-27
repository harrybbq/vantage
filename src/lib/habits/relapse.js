/**
 * Logging a relapse, in one place.
 *
 * This used to live inside the relapse modal's handler, which was fine
 * while the modal was the only way to log one. It isn't any more — the
 * hub's habit widget can now do it without leaving the page — and a
 * second copy of "restart the timer, bank the strike, re-arm the
 * milestones" would drift the first time one of those rules changed.
 *
 * What it does, and why each part:
 *   · `startTime` moves to the moment of the relapse, so the timer
 *     counts from when it actually happened rather than from when it
 *     was admitted. Back-dating is the whole reason the modal exists.
 *   · the strike is BANKED against the current period (so a card with a
 *     one-a-week allowance reads 1/1, not 0/1), and strikes from earlier
 *     periods are dropped — they can never count again, and keeping them
 *     grows a list inside a state blob that is already about a megabyte.
 *   · every milestone is re-armed. A milestone pays coins once per
 *     streak; leaving them awarded would mean passing a week clean again
 *     paid nothing.
 *
 *   · the run that just ended is appended to `runs` (the newest 60), so
 *     the best run and the total clean time survive the reset. Before
 *     this, a relapse took every visible sign of progress with it.
 *
 * It does NOT touch `name`, `milestones`' definitions, or the strikes
 * allowance — the parts the user decided.
 *
 * A Cut-down habit has no timer to restart: a "relapse" from any of the
 * quick buttons (hub widget, prime card) logs that DAY against the
 * budget instead, via cutdown.addUse.
 *
 * Returns `prev` BY IDENTITY when there is nothing to do: no such habit,
 * or a timestamp that is not a usable instant. The save pipeline treats
 * an identical object as a no-op, so a misfired click costs nothing
 * rather than queueing a write of the whole state.
 *
 * Pure. No React, no DOM.
 */
import { periodStart } from './strikes.js';
import { isCut, addUse, isoDay } from './cutdown.js';
import { MAX_RUNS } from './progress.js';

export function applyRelapse(prev, id, whenTs) {
  const habits = (prev && prev.habits) || [];
  if (!id || !habits.some(h => h && h.id === id)) return prev;

  const ts = Number(whenTs);
  if (!Number.isFinite(ts) || ts <= 0) return prev;

  const target = habits.find(h => h && h.id === id);
  if (isCut(target)) return addUse(prev, id, isoDay(ts), Math.max(Date.now(), ts));

  return {
    ...prev,
    habits: habits.map(h => {
      if (!h || h.id !== id) return h;
      // The period is the one we are in NOW, not the one the relapse
      // fell in: a slip back-dated to last week still spends this
      // week's allowance, because that is the allowance being tracked.
      const start = periodStart(h.strikesPeriod, Date.now());
      const recent = [...(h.strikeTimes || []).filter(t => t >= start), ts];
      const began = Number(h.startTime);
      const ended = Number.isFinite(began) && ts > began
        ? [...(Array.isArray(h.runs) ? h.runs : []), { start: began, end: ts }].slice(-MAX_RUNS)
        : h.runs;
      return {
        ...h,
        ...(ended ? { runs: ended } : {}),
        startTime: ts,
        strikeTimes: recent,
        relapseCount: (h.relapseCount || 0) + 1,
        milestones: (h.milestones || []).map(m => ({ ...m, awarded: false })),
      };
    }),
  };
}

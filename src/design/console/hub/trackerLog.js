/**
 * Logging a tracker from the console Today widget.
 *
 * The same state change the classic QuickLog makes (components/
 * QuickLog.jsx handleChange), so a tick here is indistinguishable from a
 * tick there: the day's log entry, the manual-provenance mark, the streak
 * recalculation, and the symmetric weekly coin award / refund (crossing
 * back below the target reverses the award — the anti-scam rule from
 * 2026-06). Side effects (toast, confetti) are passed in as callbacks and
 * fired from inside the updater, exactly where QuickLog fires them.
 *
 * QuickLog is a classic component and is not edited; if its rule ever
 * changes, change this with it.
 */
import { getWeekKey, countWeekLogs, trackerWeeklyCoins } from '../../../utils/helpers';
import { recalcStreaks } from '../../../utils/streaks';
import { markManual } from '../../../lib/trackers/autoLog';

export function applyTrackerChange(prev, trackerId, newVal, today, fx = {}) {
  const tracker = (prev.trackers || []).find(t => t.id === trackerId);
  if (!tracker) return prev;
  const newLogs = { ...prev.logs };
  const dayLog = { ...(newLogs[today] || {}) };
  if (newVal === false || newVal === 0) delete dayLog[trackerId];
  else dayLog[trackerId] = newVal;
  if (Object.keys(dayLog).length) newLogs[today] = dayLog;
  else delete newLogs[today];

  let next = { ...prev, logs: newLogs };
  next = markManual(next, today, [trackerId]);
  const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {});
  next = { ...next, streaks: newStreaks };

  (prev.trackers || []).forEach(t => {
    const reward = trackerWeeklyCoins(t);
    if (!t.weeklyTarget || !reward) return;
    const awardKey = 'awarded_' + t.id + '_' + getWeekKey(today);
    const count = countWeekLogs(newLogs, t.id, today, t);
    const already = !!next[awardKey];
    if (count >= t.weeklyTarget && !already) {
      const coinHistory = [
        { type: 'earn', label: t.name + ' weekly goal (' + t.weeklyTarget + 'x)', amount: reward, ts: Date.now() },
        ...(next.coinHistory || []),
      ];
      fx.onToast?.('+' + reward + ' ⬡ — ' + t.name + ' weekly goal!', true);
      fx.onGoal?.();
      next = { ...next, [awardKey]: true, coins: (next.coins || 0) + reward, coinHistory };
    } else if (count < t.weeklyTarget && already) {
      const coinHistory = [
        { type: 'refund', label: t.name + ' weekly goal reversed', amount: -reward, ts: Date.now() },
        ...(next.coinHistory || []),
      ];
      const reversed = { ...next, coins: Math.max(0, (next.coins || 0) - reward), coinHistory };
      delete reversed[awardKey];
      next = reversed;
    }
  });

  if (tracker.type === 'boolean' && newVal === true) {
    const s = newStreaks[trackerId]?.current;
    if (s === 7) { fx.onStreak7?.(); fx.onToast?.(`🔥 7 day streak on ${tracker.name}!`, true); }
    else if (s === 30) { fx.onStreak30?.(); fx.onToast?.('🔥 30 day streak — incredible consistency!', true); }
  }
  return next;
}

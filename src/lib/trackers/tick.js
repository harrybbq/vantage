/**
 * Ticking a tracker: one pure updater for every surface that ticks outside
 * the classic Track page (the console calendar's day agenda, and the
 * Trackers prime card's Today checklist on both hubs).
 *
 * Nothing classic exports a composed "tick" — QuickLog.handleChange
 * (hub) and TrackSection's saveLog (calendar day editor) each compose
 * the same library calls inline. This is that composition as ONE pure
 * updater, step for step in QuickLog.handleChange's order, so the
 * console writes exactly the state classic does:
 *
 *   1. the log cell (false / 0 deletes it; an emptied day is deleted)
 *   2. markManual — the cell is the user's; no auto-fill rule refills it
 *   3. recalcStreaks over the new logs
 *   4. the weekly coin challenge, SYMMETRIC (award on reaching the
 *      target, refund on dropping back under it), keyed
 *      'awarded_<id>_<ISO week of the ticked day>' — QuickLog's
 *      anti-scam rule, so a tick/untick pair nets zero
 *   5. streak milestones (7, 30) — only for today's log, only on a tick
 *
 * Parameterised by `day` (QuickLog is today-only; saveLog takes any
 * day and keys the award on that day's week — this does the same).
 *
 * Side effects (coin toast, confetti) are RETURNED as `effects`, not
 * fired, so this stays pure and testable; the component fires them the
 * same way classic does.
 *
 * Writes only: logs, logsAuto, streaks, coins, coinHistory and
 * awarded_* keys — the keys classic's tick already writes.
 */
import { markManual } from './autoLog.js';
import { recalcStreaks } from '../../utils/streaks.js';
import { countWeekLogs, getWeekKey, trackerWeeklyCoins } from '../../utils/helpers.js';

/**
 * @param prev   state
 * @param opts   { day: 'YYYY-MM-DD', trackerId, value, today: 'YYYY-MM-DD', now?: ms }
 *               value: boolean for a yes/no tracker, a number for a count
 *               (false or 0 clears the cell, as in QuickLog)
 * @returns { next, effects: [{ type: 'award'|'refund'|'streak7'|'streak30', … }] }
 */
export function applyTick(prev, { day, trackerId, value, today, now = Date.now() }) {
  const effects = [];
  const tracker = (prev.trackers || []).find(t => t.id === trackerId);
  if (!tracker || !day) return { next: prev, effects };

  // 1. The log cell.
  const newLogs = { ...(prev.logs || {}) };
  const dayLog = { ...(newLogs[day] || {}) };
  if (value === false || value === 0 || value == null) delete dayLog[trackerId];
  else dayLog[trackerId] = value;
  if (Object.keys(dayLog).length) newLogs[day] = dayLog;
  else delete newLogs[day];

  let next = { ...prev, logs: newLogs };

  // 2. The cell is the user's now.
  next = markManual(next, day, [trackerId]);

  // 3. Streaks.
  const newStreaks = recalcStreaks(newLogs, prev.trackers || [], prev.streaks || {}, today);
  next = { ...next, streaks: newStreaks };

  // 4. Weekly coin challenge — symmetric award/refund.
  (prev.trackers || []).forEach(t => {
    const reward = trackerWeeklyCoins(t);
    if (!t.weeklyTarget || !reward) return;
    const weekKey = getWeekKey(day);
    const awardKey = 'awarded_' + t.id + '_' + weekKey;
    const count = countWeekLogs(newLogs, t.id, day, t);
    const alreadyAwarded = !!next[awardKey];
    if (count >= t.weeklyTarget && !alreadyAwarded) {
      const coins = (next.coins || 0) + reward;
      const coinHistory = [
        { type: 'earn', label: t.name + ' weekly goal (' + t.weeklyTarget + 'x)', amount: reward, ts: now },
        ...(next.coinHistory || []),
      ];
      effects.push({ type: 'award', tracker: t, amount: reward });
      next = { ...next, [awardKey]: true, coins, coinHistory };
    } else if (count < t.weeklyTarget && alreadyAwarded) {
      const coins = Math.max(0, (next.coins || 0) - reward);
      const coinHistory = [
        { type: 'refund', label: t.name + ' weekly goal reversed', amount: -reward, ts: now },
        ...(next.coinHistory || []),
      ];
      const reversed = { ...next, coins, coinHistory };
      delete reversed[awardKey];
      next = reversed;
      effects.push({ type: 'refund', tracker: t, amount: reward });
    }
  });

  // 5. Streak milestones — today's tick only.
  if (day === today && tracker.type === 'boolean' && value === true) {
    const s = newStreaks[trackerId]?.current;
    if (s === 7) effects.push({ type: 'streak7', tracker });
    else if (s === 30) effects.push({ type: 'streak30', tracker });
  }

  return { next, effects };
}

/**
 * The next value for a tap on a tracker's control, mirroring the classic
 * controls: a yes/no tracker toggles; a number tracker's ring adds one
 * step (TrackersList.logToday — `trackerStep`, a twentieth of the daily
 * target, else 1). `step` is passed in so this file needs no source table.
 */
export function tapValue(tracker, current, step = 1) {
  if (tracker.type === 'boolean') return !current;
  return (typeof current === 'number' ? current : 0) + step;
}

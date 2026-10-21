/**
 * Fire a tick's effects (lib/trackers/tick.js returns them) the way
 * classic QuickLog does: a coin toast and confetti for a weekly award,
 * confetti and a toast for 7- and 30-day streaks. `onShowCoinToast` is
 * optional; without it only the confetti fires.
 */
import { fireGoal, fireStreak7, fireStreak30 } from '../../utils/confetti';
import { applyTick } from './tick.js';
import { getTodayStr } from '../../utils/helpers';

export function fireTickEffects(effects, onShowCoinToast) {
  for (const e of effects || []) {
    if (e.type === 'award') {
      onShowCoinToast?.('+' + e.amount + ' ⬡ — ' + e.tracker.name + ' weekly goal!', true);
      fireGoal();
    } else if (e.type === 'streak7') {
      fireStreak7();
      onShowCoinToast?.(`🔥 7 day streak on ${e.tracker.name}!`, true);
    } else if (e.type === 'streak30') {
      fireStreak30();
      onShowCoinToast?.('🔥 30 day streak — incredible consistency!', true);
    }
  }
}

/**
 * Toggle a yes/no tracker for today from a hub card (the Trackers prime
 * card's Today checklist). Same updater, same effects, as every other
 * tick, so coins, streaks and auto-fill marks match the Track page.
 */
export function toggleTrackerToday(update, trackerId, onShowCoinToast) {
  const today = getTodayStr();
  update(prev => {
    const cur = ((prev.logs || {})[today] || {})[trackerId];
    const r = applyTick(prev, { day: today, trackerId, value: !cur, today });
    fireTickEffects(r.effects, onShowCoinToast);
    return r.next;
  });
}

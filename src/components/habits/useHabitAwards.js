/**
 * Coins and celebrations for a habit card — shared by the desktop and
 * mobile cards, which used to carry identical copies of the milestone
 * loop.
 *
 *   · Milestones pay once each as the habit's ladder time passes them.
 *     Quit: time since the last relapse (unchanged). Cut down: the run
 *     of weeks/months on target.
 *   · Cut down only: when an over-budget period breaks the run, the
 *     milestones the run no longer reaches are re-armed, as a relapse
 *     re-arms a Quit habit's. Nothing is taken back.
 *   · Cut down only: a closed period with no use at all pays a small dry
 *     bonus, for the LAST closed period only — never a backlog.
 *   · Passing your best previous run while you watch fires the confetti.
 *     That is session-only: no state is written for it.
 *
 * Every write re-checks the latest state inside `update`, so two cards
 * (or two tabs) racing to pay the same milestone pay it once.
 */
import { useEffect, useRef } from 'react';
import { fireGoal } from '../../utils/confetti';
import { isCut, streakMs, dryBonusDue, DRY_BONUS } from '../../lib/habits/cutdown';
import { habitElapsed, ghostOf } from '../../lib/habits/progress';

export default function useHabitAwards(habit, now, update, onShowCoinToast) {
  const pending = useRef(new Set());
  const armKey = (habit.milestones || []).filter(m => m.awarded).map(m => m.id).join(',');

  // Mirror what the state says is paid; a re-arm (relapse, broken run)
  // shrinks it so those milestones can pay again.
  useEffect(() => {
    pending.current = new Set((habit.milestones || []).filter(m => m.awarded).map(m => m.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit.startTime, armKey]);

  const bestRef = useRef(null);

  useEffect(() => {
    const cut = isCut(habit);
    const metric = habitElapsed(habit, now);

    if (cut && (habit.milestones || []).some(m => m.awarded && m.duration > metric)) {
      update(prev => {
        const h = (prev.habits || []).find(x => x.id === habit.id);
        if (!h || !isCut(h)) return prev;
        const run = streakMs(h, Date.now());
        if (!(h.milestones || []).some(m => m.awarded && m.duration > run)) return prev;
        return {
          ...prev,
          habits: prev.habits.map(x => (x.id !== habit.id ? x : {
            ...x, milestones: x.milestones.map(m => (m.awarded && m.duration > run ? { ...m, awarded: false } : m)),
          })),
        };
      });
      return;
    }

    (habit.milestones || []).forEach(m => {
      if (metric >= m.duration && !pending.current.has(m.id)) {
        pending.current.add(m.id);
        update(prev => {
          const h = (prev.habits || []).find(x => x.id === habit.id);
          if (!h) return prev;
          const ms = (h.milestones || []).find(x => x.id === m.id);
          if (!ms || ms.awarded) return prev;
          if (habitElapsed(h, Date.now()) < ms.duration) return prev;
          const habits = prev.habits.map(x => (x.id !== habit.id ? x : {
            ...x, milestones: x.milestones.map(y => (y.id === m.id ? { ...y, awarded: true } : y)),
          }));
          const coins = (prev.coins || 0) + m.coins;
          const coinHistory = [
            { type: 'earn', label: `${habit.name} — ${m.label}${cut ? ' on target' : ''}`, amount: m.coins, ts: Date.now() },
            ...(prev.coinHistory || []),
          ];
          return { ...prev, habits, coins, coinHistory };
        });
        onShowCoinToast(`+${m.coins} ⬡ — ${habit.name} ${m.label}${cut ? ' on target' : ''}!`, true);
        fireGoal();
      }
    });

    if (cut) {
      const due = dryBonusDue(habit, now);
      if (due && !pending.current.has('dry:' + due)) {
        pending.current.add('dry:' + due);
        update(prev => {
          const h = (prev.habits || []).find(x => x.id === habit.id);
          if (!h || dryBonusDue(h, Date.now()) !== due) return prev;
          return {
            ...prev,
            habits: prev.habits.map(x => (x.id !== habit.id ? x : { ...x, dryPaid: [...(x.dryPaid || []), due].slice(-24) })),
            coins: (prev.coins || 0) + DRY_BONUS,
            coinHistory: [
              { type: 'earn', label: `${habit.name} — dry ${habit.budget?.per === 'month' ? 'month' : 'week'}`, amount: DRY_BONUS, ts: Date.now() },
              ...(prev.coinHistory || []),
            ],
          };
        });
        onShowCoinToast(`+${DRY_BONUS} ⬡ — ${habit.name}: a dry ${habit.budget?.per === 'month' ? 'month' : 'week'}!`, true);
      }
    }

    // Passing the ghost, live.
    const g = ghostOf(habit, now);
    const passed = !!(g && g.passed);
    if (bestRef.current === false && passed) {
      onShowCoinToast(`▲ ${habit.name}: new personal best`, true);
      fireGoal();
    }
    bestRef.current = g ? passed : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);
}

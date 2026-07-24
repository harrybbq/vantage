/**
 * MobileHabitsSection
 *
 * Mobile-only Habits view — purpose-built for the operator-console
 * aesthetic. Reuses the same milestone/award pipeline as HabitCard
 * (so coin awards still fire when a user logs back in on mobile after
 * crossing a milestone) but ditches the desktop's vertical pill+label
 * gauge in favor of a cleaner card layout that reads at phone scale:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  Alcohol                              ⋯     │
 *   │  ───────                                    │
 *   │                          ⏳ 1 week  ⬡ 10    │
 *   │  ▮ 3d 01h 26m                               │
 *   │  ▮ SINCE LAST RELAPSE                       │
 *   │  ─────────────────────────────────────       │
 *   │  10 relapses                ↻ RELAPSE        │
 *   └─────────────────────────────────────────────┘
 *
 * The pill on the left is a vertical capsule that fills upward in
 * the habit's color as elapsed/maxDuration approaches 1.
 */

import { useState, useEffect, useRef } from 'react';
import { fireGoal } from '../../utils/confetti';
import { strikeState, replenishLabel } from '../../lib/habits/strikes';
import Icon from '../Icon';
function formatElapsedShort(ms) {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function nextMilestone(habit) {
  if (!habit.milestones?.length) return null;
  const remaining = habit.milestones.filter(m => !m.awarded);
  if (!remaining.length) return null;
  return remaining.reduce((a, b) => a.duration < b.duration ? a : b);
}

function MobileHabitCard({ habit, update, onShowCoinToast, onOpenModal }) {
  const [now, setNow] = useState(Date.now());
  const pendingAwards = useRef(new Set());

  useEffect(() => {
    pendingAwards.current = new Set(
      (habit.milestones || []).filter(m => m.awarded).map(m => m.id)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit.startTime]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Mirror desktop HabitCard: award milestones as they cross
  useEffect(() => {
    const elapsed = now - habit.startTime;
    (habit.milestones || []).forEach(m => {
      if (elapsed >= m.duration && !pendingAwards.current.has(m.id)) {
        pendingAwards.current.add(m.id);
        update(prev => {
          const h = (prev.habits || []).find(h => h.id === habit.id);
          if (!h) return prev;
          const ms = h.milestones.find(ms => ms.id === m.id);
          if (!ms || ms.awarded) return prev;
          const habits = prev.habits.map(hh => hh.id !== habit.id ? hh : {
            ...hh,
            milestones: hh.milestones.map(ms => ms.id === m.id ? { ...ms, awarded: true } : ms),
          });
          const coins = (prev.coins || 0) + m.coins;
          const coinHistory = [
            { type: 'earn', label: `${habit.name} — ${m.label}`, amount: m.coins, ts: Date.now() },
            ...(prev.coinHistory || []),
          ];
          return { ...prev, habits, coins, coinHistory };
        });
        onShowCoinToast(`+${m.coins} ⬡ — ${habit.name} ${m.label}!`, true);
        fireGoal();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const elapsed = now - habit.startTime;
  const strikes = strikeState(habit, now);
  const maxDuration = habit.milestones?.length
    ? Math.max(...habit.milestones.map(m => m.duration))
    : 7 * 24 * 3600 * 1000;
  const progress = Math.min(1, elapsed / maxDuration);
  const allDone = habit.milestones?.length > 0 && habit.milestones.every(m => m.awarded);
  const fillColor = allDone ? 'var(--gold, #d4a017)' : (habit.color || 'var(--em)');
  const next = nextMilestone(habit);

  return (
    <div className="m-habit-card">
      {/* Top row — name + kebab */}
      <div className="m-habit-top">
        <div className="m-habit-name">{habit.name}</div>
        <button
          className="m-habit-kebab"
          onClick={() => onOpenModal('editHabitModal:' + habit.id)}
          aria-label="Habit options"
        ><Icon name="ellipsis" size={16} /></button>
      </div>

      {/* Meta row — next milestone + coins */}
      <div className="m-habit-meta-row">
        <span className="m-habit-meta-line" />
        {next ? (
          <>
            <span className="m-habit-meta-pill">⏳ {next.label}</span>
            <span className="m-habit-meta-pill">⬡ {next.coins}</span>
          </>
        ) : (
          <span className="m-habit-meta-pill">All milestones cleared</span>
        )}
      </div>

      {/* Body — pill + time */}
      <div className="m-habit-body">
        <div className="m-habit-pill" aria-hidden="true">
          <div
            className="m-habit-pill-fill"
            style={{ height: `${progress * 100}%`, background: fillColor }}
          />
        </div>
        <div className="m-habit-time-block">
          <div className={`m-habit-time${strikes.state === 'struck' ? ' is-struck' : ''}${strikes.state === 'maxed' ? ' is-maxed' : ''}`}>{formatElapsedShort(elapsed)}</div>
          <div className="m-habit-time-eyebrow">Since last relapse</div>
        </div>
      </div>

      {/* Footer — relapse count + button */}
      <div className="m-habit-footer">
        <div className={`m-habit-count${strikes.state !== 'off' ? ` habit-strikes strikes-${strikes.state}` : ''}`}>
          {strikes.state !== 'off'
            ? `${strikes.state === 'clean' ? '✦ ' : ''}${strikes.used}/${strikes.allowed} strikes${replenishLabel(strikes, now) ? ` · ${replenishLabel(strikes, now)}` : ''}`
            : `${habit.relapseCount || 0} relapse${habit.relapseCount === 1 ? '' : 's'}`}
        </div>
        <button
          className="m-habit-relapse-btn"
          onClick={() => onOpenModal('relapseModal:' + habit.id)}
        ><span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="rotate-ccw" size={13} /> Relapse</span></button>
      </div>
    </div>
  );
}

export default function MobileHabitsSection({ S, update, onOpenModal, onShowCoinToast }) {
  const habits = S.habits || [];

  return (
    <section className="section m-habits-wrap">
      <div className="m-habits">
        {/* Header */}
        <div className="m-section-header-block">
          <div className="m-section-eyebrow">// BREAK THE CYCLE</div>
          <div className="m-section-title-row">
            <div className="m-section-title">Habits</div>
            <button
              className="m-add-btn"
              onClick={() => onOpenModal('addHabitModal')}
            >+ Add Habit</button>
          </div>
        </div>

        {/* List */}
        {!habits.length ? (
          <div className="m-hub-empty">
            No habits tracked yet. Add a bad habit to break — your streak
            timer starts immediately.
          </div>
        ) : (
          <div className="m-habits-list">
            {habits.map(h => (
              <MobileHabitCard
                key={h.id}
                habit={h}
                update={update}
                onShowCoinToast={onShowCoinToast}
                onOpenModal={onOpenModal}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

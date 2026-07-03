import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { fireGoal } from '../utils/confetti';
import SectionHelp from './SectionHelp';
import { strikeState, replenishLabel } from '../lib/habits/strikes';
function formatElapsed(ms) {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d} day${d !== 1 ? 's' : ''} ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function HabitCard({ habit, update, onShowCoinToast, onOpenModal }) {
  const [now, setNow] = useState(Date.now());
  const pendingAwards = useRef(new Set());

  // Reset awarded tracking when streak resets (relapse)
  useEffect(() => {
    pendingAwards.current = new Set(
      habit.milestones.filter(m => m.awarded).map(m => m.id)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habit.startTime]);

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Check and award milestones
  useEffect(() => {
    const elapsed = now - habit.startTime;
    habit.milestones.forEach(m => {
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
  const maxDuration = habit.milestones.length > 0
    ? Math.max(...habit.milestones.map(m => m.duration))
    : 7 * 24 * 3600 * 1000; // default 1-week reference if no milestones
  const progress = Math.min(1, elapsed / maxDuration);
  const allDone = habit.milestones.length > 0 && habit.milestones.every(m => m.awarded);
  const fillColor = allDone ? 'var(--gold)' : habit.color;

  function handleRelapse() {
    onOpenModal('relapseModal:' + habit.id);
  }

  function handleEdit() {
    onOpenModal('editHabitModal:' + habit.id);
  }

  return (
    <div className="habit-card">
      <div className="habit-card-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <div className="habit-name">{habit.name}</div>
          {habit.endless && <span className="habit-endless-badge">∞</span>}
        </div>
        <button className="habit-edit-btn" onClick={handleEdit} title="Edit habit">✎</button>
      </div>

      <div className="habit-bar-area">
        <div className="habit-bar-track">
          <div
            className="habit-bar-fill"
            style={{ height: `${progress * 100}%`, background: fillColor }}
          />
        </div>
        {habit.milestones.map(m => {
          const pct = Math.min(94, Math.max(4, (m.duration / maxDuration) * 100));
          return (
            <div
              key={m.id}
              className={`habit-ms${m.awarded ? ' awarded' : ''}`}
              style={{ bottom: `${pct}%` }}
            >
              <span className="habit-ms-label">{m.label}</span>
              <span className="habit-ms-coins">⬡ {m.coins}</span>
            </div>
          );
        })}
      </div>

      <div className={`habit-elapsed${strikes.state === 'struck' ? ' is-struck' : ''}${strikes.state === 'maxed' ? ' is-maxed' : ''}`}>{formatElapsed(elapsed)}</div>

      {strikes.state !== 'off' ? (
        <div className={`habit-relapse-count habit-strikes strikes-${strikes.state}`}>
          {strikes.state === 'clean' ? '✦ unscathed · ' : ''}{strikes.used}/{strikes.allowed} strikes · {habit.strikesPeriod === 'ever' ? 'total' : 'this ' + habit.strikesPeriod}
          {replenishLabel(strikes, now) ? ` · ${replenishLabel(strikes, now)}` : ''}
        </div>
      ) : habit.relapseCount > 0 && (
        <div className="habit-relapse-count">
          {habit.relapseCount} relapse{habit.relapseCount !== 1 ? 's' : ''}
        </div>
      )}

      <button className="habit-relapse-btn" onClick={handleRelapse}>
        ↺ Relapse
      </button>
    </div>
  );
}

export default function HabitsSection({ S, update, active, onOpenModal, onShowCoinToast }) {
  const habits = S.habits || [];

  return (
    <section id="habits" className={`section${active ? ' active' : ''}`}>
      <motion.div
        style={{ marginBottom: '28px' }}
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="eyebrow">Break the Cycle</div>
        <div className="sec-title">Habits <SectionHelp text="Track long-term habits with a live streak timer. Set milestones at intervals (e.g. 1 week, 1 month) and earn coin rewards when you hit them." /></div>
      </motion.div>

      <div style={{ marginBottom: '28px' }}>
        <motion.button
          className="btn btn-primary"
          onClick={() => onOpenModal('addHabitModal')}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        >
          + Add Habit
        </motion.button>
      </div>

      {!habits.length ? (
        <div className="habits-empty">
          <div className="habits-empty-icon">🎯</div>
          <div>No habits tracked yet</div>
          <div style={{ fontSize: '12px', marginTop: '6px', opacity: 0.6 }}>
            Add a bad habit to break — your streak timer starts immediately
          </div>
        </div>
      ) : (
        <div className="habits-grid">
          {habits.map((habit, i) => (
            <motion.div
              key={habit.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.07, ease: 'easeOut' }}
            >
              <HabitCard
                habit={habit}
                update={update}
                onShowCoinToast={onShowCoinToast}
                onOpenModal={onOpenModal}
              />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

import { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import HabitRunner, { stageForDays } from './habits/HabitRunner';
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
  const allDone = habit.milestones.length > 0 && habit.milestones.every(m => m.awarded);
  const fillColor = allDone ? 'var(--gold)' : habit.color;

  // Milestones ascending — the ladder the runner works along.
  const sortedMs = [...habit.milestones].sort((a, b) => a.duration - b.duration);
  const nextMsIdx = sortedMs.findIndex(m => elapsed < m.duration);

  // Even-interval progress: each milestone owns an equal slice of the
  // bar, and we interpolate within the current slice. Falls back to a
  // plain 1-week ratio when a habit has no milestones at all.
  const ladderProgress = (() => {
    const n = sortedMs.length;
    if (!n) return Math.min(1, elapsed / maxDuration);
    let cleared = 0;
    while (cleared < n && elapsed >= sortedMs[cleared].duration) cleared++;
    if (cleared >= n) return 1;
    const prev = cleared === 0 ? 0 : sortedMs[cleared - 1].duration;
    const span = sortedMs[cleared].duration - prev;
    const frac = span > 0 ? (elapsed - prev) / span : 0;
    return (cleared + Math.max(0, Math.min(1, frac))) / n;
  })();

  const stageLabel = allDone
    ? (habit.endless ? 'All milestones cleared — still running' : 'All milestones cleared')
    : stageForDays(elapsed / 86400000).label;

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
        <button className="habit-edit-btn" onClick={handleEdit} title="Edit habit"><Icon name="pencil" size={13} /></button>
      </div>

      {/* Runner lane + horizontal track. Milestones are spaced EVENLY
          rather than by true duration: on a real ladder (1 week → 1 year)
          a time-linear bar leaves the runner pinned near zero for months,
          so early days — when the streak is most fragile — would show no
          movement at all. */}
      <div className="habit-lane">
        <HabitRunner
          progress={ladderProgress}
          days={elapsed / 86400000}
          colour={fillColor}
          done={allDone}
          endless={!!habit.endless}
          stumbleKey={habit.startTime}
        />
      </div>
      <div className="habit-track">
        <div
          className="habit-track-fill"
          style={{ width: `${ladderProgress * 100}%`, background: fillColor }}
        />
        {sortedMs.map((m, i) => (
          <div
            key={m.id}
            className={`habit-pip${m.awarded ? ' awarded' : ''}`}
            style={{ left: `${((i + 1) / sortedMs.length) * 100}%` }}
            title={`${m.label} · ⬡ ${m.coins}`}
          />
        ))}
      </div>
      {sortedMs.length > 0 && (
        <div className="habit-ladder">
          {sortedMs.map((m, i) => (
            <span key={m.id} className={m.awarded ? 'is-clear' : (i === nextMsIdx ? 'is-next' : '')}>
              {m.label}
            </span>
          ))}
        </div>
      )}
      <div className="habit-stage">{stageLabel}</div>

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
        <span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="rotate-ccw" size={13} /> Relapse</span>
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
        <div className="sec-title">Habits <SectionHelp
          title="Habits"
          rows={[
            { term: 'Timer', def: 'Counts up from your last relapse.' },
            { term: 'Milestones', def: 'A week, a month, a year — each pays coins as you pass it.' },
            { term: 'Strikes', def: 'A weekly allowance, so one slip need not reset the streak.' },
          ]}
        /></div>
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
          <div className="habits-empty-icon"><Icon name="target" size={32} strokeWidth={1.5} /></div>
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

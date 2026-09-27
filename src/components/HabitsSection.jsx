import { useState, useEffect } from 'react';
import Icon from './Icon';
import HabitRunner, { stageForDays } from './habits/HabitRunner';
import { motion } from 'framer-motion';
import SectionHelp from './SectionHelp';
import { strikeState, replenishLabel } from '../lib/habits/strikes';
import { toggleUse } from '../lib/habits/cutdown';
import { habitView, shortSpan, resetsLabel } from '../lib/habits/view';
import useHabitAwards from './habits/useHabitAwards';
import useTrailView from './habits/useTrailView';
import CutWeek from './habits/CutWeek';
import HabitTrail from './habits/HabitTrail';
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
  const [trail, toggleTrail] = useTrailView(habit.id);

  // Tick every second
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Milestone coins, the cut-down dry bonus, and the live PB moment —
  // shared with the mobile card (habits/useHabitAwards).
  useHabitAwards(habit, now, update, onShowCoinToast);

  const v = habitView(habit, now);
  const strikes = strikeState(habit, now);
  const fillColor = v.allDone ? 'var(--gold)' : habit.color;
  const sortedMs = v.sorted;
  const nextMsIdx = v.nextIdx;
  const ladder = v.ladder;

  const stageLabel = v.allDone
    ? (habit.endless ? 'All milestones cleared — still running' : 'All milestones cleared')
    : stageForDays(v.runnerDays).label;

  function handleRelapse() {
    onOpenModal('relapseModal:' + habit.id);
  }

  function handleEdit() {
    onOpenModal('editHabitModal:' + habit.id);
  }

  const toggleDay = iso => update(prev => toggleUse(prev, habit.id, iso));
  const cur = v.cur;
  // Over-budget days trip the runner; planned days plant a flag.
  const overKey = cur ? (cur.used > cur.max ? `${cur.start}:${cur.used - cur.max}` : null) : habit.startTime;
  const flagKey = cur ? Math.min(cur.used, cur.max) : 0;

  return (
    <div className={`habit-card${v.cut ? ' is-cut' : ''}`}>
      <div className="habit-card-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <div className="habit-name">{habit.name}</div>
          {habit.endless && <span className="habit-endless-badge">∞</span>}
          {v.cut && <span className="habit-kind-badge">up to {cur.max}/{cur.per === 'month' ? 'mo' : 'wk'}</span>}
        </div>
        <div className="habit-card-tools">
          <button className={`habit-view-btn${trail ? ' is-on' : ''}`} onClick={toggleTrail} aria-pressed={trail}
                  title={trail ? 'Show the runner' : 'Show the trail'}>
            <Icon name={trail ? 'activity' : 'chart-column'} size={13} /><span>{trail ? 'Runner' : 'Trail'}</span>
          </button>
          <button className="habit-edit-btn" onClick={handleEdit} title="Edit habit"><Icon name="pencil" size={13} /></button>
        </div>
      </div>

      {trail ? <HabitTrail habit={habit} now={now} cut={v.cut} /> : (
        <>
          {/* Runner lane + horizontal track. Milestones are spaced EVENLY
              rather than by true duration: on a real ladder (1 week → 1 year)
              a time-linear bar leaves the runner pinned near zero for months,
              so early days — when the streak is most fragile — would show no
              movement at all. */}
          <div className="habit-lane">
            <HabitRunner
              progress={ladder}
              days={v.runnerDays}
              colour={fillColor}
              done={v.allDone}
              endless={!!habit.endless}
              stumbleKey={overKey}
              ghost={v.ghost}
              pbAt={v.pbAt}
              flagKey={flagKey}
              scenery={v.scenery}
            />
          </div>
          <div className="habit-track">
            <div
              className="habit-track-fill"
              style={{ width: `${ladder * 100}%`, background: fillColor }}
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
        </>
      )}

      {v.cut ? (
        <>
          <div className="habit-cut-head">
            <span className="habit-cut-big">{v.streak}</span>
            <span className="habit-cut-unit">{cur.per === 'month' ? (v.streak === 1 ? 'month' : 'months') : (v.streak === 1 ? 'week' : 'weeks')} on target</span>
            {v.ghost && <span className="habit-cut-best">best {Math.round(v.bestMs / (cur.per === 'month' ? 2592000000 : 604800000))}</span>}
          </div>
          <div className={`habit-cut-status is-${cur.state}`}>
            <span className="habit-tokens" aria-hidden="true">
              {Array.from({ length: Math.max(cur.max, cur.used) }, (_, i) => (
                <i key={i} className={i >= cur.max ? 'is-over' : i < cur.used ? 'is-used' : ''} />
              ))}
            </span>
            <span>{cur.used} of {cur.max} this {cur.per}{cur.state === 'over' ? ' · over budget' : ''} · {resetsLabel(cur)}</span>
          </div>
          <CutWeek habit={habit} now={now} onToggle={toggleDay} />
          <button className={`habit-relapse-btn habit-use-btn${cur.usedToday ? ' is-done' : ''}`}
                  onClick={() => toggleDay(cur.today)} aria-pressed={cur.usedToday}>
            {cur.usedToday ? '✓ Logged today · tap to undo' : '+ Had one today'}
          </button>
        </>
      ) : (
        <>
          <div className={`habit-elapsed${strikes.state === 'struck' ? ' is-struck' : ''}${strikes.state === 'maxed' ? ' is-maxed' : ''}`}>{formatElapsed(v.elapsed)}</div>

          {v.hasHistory && (
            <div className="habit-odo">
              <span>best <b>{shortSpan(Math.max(v.best, v.elapsed))}</b></span>
              <span>total clean <b>{shortSpan(v.odometer)}</b></span>
            </div>
          )}

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
        </>
      )}
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
            { term: 'Quit', def: 'A timer that counts up from your last relapse.' },
            { term: 'Cut down', def: 'A budget, such as 2 days a week. Logging a day resets nothing; weeks kept within budget are the streak.' },
            { term: 'Ghost', def: 'Your best previous run. Pass it for a personal best.' },
            { term: 'Trail', def: 'Your history on one strip. Switch to it on any card.' },
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

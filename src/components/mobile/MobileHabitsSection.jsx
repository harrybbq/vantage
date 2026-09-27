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
 *   │  ───────                     ⏳ 1 week  ⬡ 10 │
 *   │  3d 01h 26m                                 │
 *   │  SINCE LAST RELAPSE                         │
 *   │        🏃  ▭      ▭                         │  ← runner lane
 *   │  ▬▬▬▬▬▬▬│▬▬▬▬▬▬▬▬│▬▬▬▬▬▬▬▬▬▬▬               │  ← ladder + pips
 *   │  RUNNING · DAY 9                       23%  │
 *   │  ─────────────────────────────────────      │
 *   │  10 relapses                ↻ RELAPSE       │
 *   └─────────────────────────────────────────────┘
 *
 * The lane is the same HabitRunner canvas the desktop card uses: a
 * stick figure walks, then jogs, then runs and vaults obstacles as the
 * streak grows, and the distance it has covered IS the progress. It
 * replaced a vertical capsule that filled upward — which said the same
 * thing far more quietly, and said it differently from desktop.
 *
 * 64px is the lane height, not a round number: sampling the worst frame
 * of an 8-second run at 390px wide, a vault clears the figure's head by
 * 6px at 64 and clips it at 56.
 */

import { useState, useEffect } from 'react';
import { strikeState, replenishLabel } from '../../lib/habits/strikes';
import { toggleUse } from '../../lib/habits/cutdown';
import { habitView, shortSpan, resetsLabel } from '../../lib/habits/view';
import HabitRunner, { stageForDays } from '../habits/HabitRunner';
import useHabitAwards from '../habits/useHabitAwards';
import useTrailView from '../habits/useTrailView';
import CutWeek from '../habits/CutWeek';
import HabitTrail from '../habits/HabitTrail';
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
  const [trail, toggleTrail] = useTrailView(habit.id);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Same coin/milestone pipeline as the desktop card, so awards still
  // fire when a user comes back on mobile after crossing one.
  useHabitAwards(habit, now, update, onShowCoinToast);

  const v = habitView(habit, now);
  const strikes = strikeState(habit, now);
  // Same ladder as desktop: milestones get equal slices, so the runner
  // is somewhere visible on day two rather than pinned at the start
  // line until the one-month mark.
  const sortedMs = v.sorted;
  const progress = v.ladder;
  const fillColor = v.allDone ? 'var(--gold, #d4a017)' : (habit.color || 'var(--em)');
  const next = nextMilestone(habit);
  const cur = v.cur;
  const stageLabel = v.allDone
    ? (habit.endless ? 'Cleared — still running' : 'All milestones cleared')
    : v.cut
      ? `${stageForDays(v.runnerDays).label} · ${v.streak} ${cur.per === 'month' ? 'mo' : 'wk'}`
      : `${stageForDays(v.runnerDays).label} · day ${Math.floor(v.runnerDays)}`;
  const toggleDay = iso => update(prev => toggleUse(prev, habit.id, iso));
  const overKey = cur ? (cur.used > cur.max ? `${cur.start}:${cur.used - cur.max}` : null) : habit.startTime;

  return (
    <div className={`m-habit-card${v.cut ? ' is-cut' : ''}`}>
      {/* Top row — name + view switch + kebab */}
      <div className="m-habit-top">
        <div className="m-habit-name">{habit.name}</div>
        <div className="habit-card-tools">
          <button className={`habit-view-btn${trail ? ' is-on' : ''}`} onClick={toggleTrail} aria-pressed={trail}
                  aria-label={trail ? 'Show the runner' : 'Show the trail'}>
            <Icon name={trail ? 'activity' : 'chart-column'} size={13} /><span>{trail ? 'Runner' : 'Trail'}</span>
          </button>
          <button
            className="m-habit-kebab"
            onClick={() => onOpenModal('editHabitModal:' + habit.id)}
            aria-label="Habit options"
          ><Icon name="ellipsis" size={16} /></button>
        </div>
      </div>

      {/* Meta row — next milestone + coins */}
      <div className="m-habit-meta-row">
        <span className="m-habit-meta-line" />
        {v.cut && <span className="m-habit-meta-pill">up to {cur.max}/{cur.per === 'month' ? 'mo' : 'wk'}</span>}
        {next ? (
          <>
            <span className="m-habit-meta-pill">⏳ {next.label}</span>
            <span className="m-habit-meta-pill">⬡ {next.coins}</span>
          </>
        ) : (habit.milestones || []).length > 0 && (
          <span className="m-habit-meta-pill">All milestones cleared</span>
        )}
      </div>

      {/* The clock (Quit) or the run of weeks on target (Cut down). */}
      <div className="m-habit-time-block">
        {v.cut ? (
          <>
            <div className="m-habit-time">{v.streak} <small>{cur.per === 'month' ? (v.streak === 1 ? 'month' : 'months') : (v.streak === 1 ? 'week' : 'weeks')}</small></div>
            <div className="m-habit-time-eyebrow">On target{v.ghost ? ` · best ${Math.round(v.bestMs / (cur.per === 'month' ? 2592000000 : 604800000))}` : ''}</div>
          </>
        ) : (
          <>
            <div className={`m-habit-time${strikes.state === 'struck' ? ' is-struck' : ''}${strikes.state === 'maxed' ? ' is-maxed' : ''}`}>{formatElapsedShort(v.elapsed)}</div>
            <div className="m-habit-time-eyebrow">
              Since last relapse{v.hasHistory ? ` · best ${shortSpan(Math.max(v.best, v.elapsed))} · total ${shortSpan(v.odometer)}` : ''}
            </div>
          </>
        )}
      </div>

      {trail ? <HabitTrail habit={habit} now={now} cut={v.cut} /> : (
        <>
          {/* Runner lane + ladder. The canvas pauses itself when it scrolls
              off screen or the tab is hidden, and freezes to a static stance
              under prefers-reduced-motion — the bar below always carries the
              value, so nothing is said by movement alone. */}
          <div className="m-habit-lane">
            <HabitRunner
              progress={progress}
              days={v.runnerDays}
              colour={fillColor}
              done={v.allDone}
              endless={!!habit.endless}
              stumbleKey={overKey}
              ghost={v.ghost}
              pbAt={v.pbAt}
              flagKey={cur ? Math.min(cur.used, cur.max) : 0}
              scenery={v.scenery}
            />
          </div>
          <div className="habit-track m-habit-track">
            <div className="habit-track-fill" style={{ width: `${progress * 100}%`, background: fillColor }} />
            {sortedMs.map((m, i) => (
              <div
                key={m.id}
                className={`habit-pip${m.awarded ? ' awarded' : ''}`}
                style={{ left: `${((i + 1) / sortedMs.length) * 100}%` }}
                title={m.label}
              />
            ))}
          </div>
          <div className="m-habit-stage">
            <span>{stageLabel}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
        </>
      )}

      {v.cut && <CutWeek habit={habit} now={now} onToggle={toggleDay} />}

      {/* Footer — allowance/count + the action */}
      <div className="m-habit-footer">
        {v.cut ? (
          <>
            <div className={`m-habit-count habit-cut-status is-${cur.state}`}>
              <span className="habit-tokens" aria-hidden="true">
                {Array.from({ length: Math.max(cur.max, cur.used) }, (_, i) => (
                  <i key={i} className={i >= cur.max ? 'is-over' : i < cur.used ? 'is-used' : ''} />
                ))}
              </span>
              {cur.used}/{cur.max} · {resetsLabel(cur)}
            </div>
            <button className={`m-habit-relapse-btn${cur.usedToday ? ' is-done' : ''}`} onClick={() => toggleDay(cur.today)} aria-pressed={cur.usedToday}>
              {cur.usedToday ? '✓ Today' : '+ Had one today'}
            </button>
          </>
        ) : (
          <>
            <div className={`m-habit-count${strikes.state !== 'off' ? ` habit-strikes strikes-${strikes.state}` : ''}`}>
              {strikes.state !== 'off'
                ? `${strikes.state === 'clean' ? '✦ ' : ''}${strikes.used}/${strikes.allowed} strikes${replenishLabel(strikes, now) ? ` · ${replenishLabel(strikes, now)}` : ''}`
                : `${habit.relapseCount || 0} relapse${habit.relapseCount === 1 ? '' : 's'}`}
            </div>
            <button
              className="m-habit-relapse-btn"
              onClick={() => onOpenModal('relapseModal:' + habit.id)}
            ><span style={{display:'inline-flex',alignItems:'center',gap:5}}><Icon name="rotate-ccw" size={13} /> Relapse</span></button>
          </>
        )}
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

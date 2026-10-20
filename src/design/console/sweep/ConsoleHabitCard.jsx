/**
 * A habit on the phone, console-drawn. The console counterpart of the
 * card inside classic mobile/MobileHabitsSection (which isn't exported).
 *
 * Same behaviour, same calls:
 *   - useHabitAwards(habit, now, update, onShowCoinToast): the coin and
 *     milestone pipeline. It MUST stay here, or awards stop firing for
 *     anyone who only opens Habits on a phone.
 *   - the HabitRunner lane (the one illustration with a job, kept), the
 *     ladder with milestone pips, and the Runner / Trail switch
 *   - Cut-down habits: CutWeek and toggleUse for "had one today"
 *   - Quit habits: strikes, and the relapse modal (relapseModal:<id>)
 *   - the ⋯ button opens editHabitModal:<id>
 * Mono for numbers only; labels sentence case; no ⏳ / ⬡ / ✦ glyphs.
 */
import { useEffect, useState } from 'react';
import { strikeState, replenishLabel } from '../../../lib/habits/strikes';
import { toggleUse } from '../../../lib/habits/cutdown';
import { habitView, shortSpan, resetsLabel } from '../../../lib/habits/view';
import HabitRunner, { stageForDays } from '../../../components/habits/HabitRunner';
import useHabitAwards from '../../../components/habits/useHabitAwards';
import useTrailView from '../../../components/habits/useTrailView';
import CutWeek from '../../../components/habits/CutWeek';
import HabitTrail from '../../../components/habits/HabitTrail';
import Icon from '../../../components/Icon';

function clock(ms) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  const p = n => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${p(h)}h ${p(m)}m`;
  if (h > 0) return `${h}h ${p(m)}m ${p(s)}s`;
  if (m > 0) return `${m}m ${p(s)}s`;
  return `${s}s`;
}

function readVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function nextMilestone(habit) {
  const left = (habit.milestones || []).filter(m => !m.awarded);
  return left.length ? left.reduce((a, b) => (a.duration < b.duration ? a : b)) : null;
}

export default function ConsoleHabitCard({ habit, update, onShowCoinToast, onOpenModal }) {
  const [now, setNow] = useState(Date.now());
  const [trail, toggleTrail] = useTrailView(habit.id);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useHabitAwards(habit, now, update, onShowCoinToast);

  const v = habitView(habit, now);
  const strikes = strikeState(habit, now);
  const cur = v.cur;
  const progress = v.ladder;
  const fill = v.allDone ? 'var(--cx-gold)' : (habit.color || 'var(--cx-accent-fill)');
  // The runner draws on a canvas, which can't read var(): give it a colour.
  const runnerColour = v.allDone ? readVar('--cx-gold', '#E3B341') : (habit.color || readVar('--em', '#1a7a4a'));
  const next = nextMilestone(habit);
  const per = cur?.per === 'month' ? 'month' : 'week';
  const stage = v.allDone
    ? (habit.endless ? 'Every milestone cleared, still running' : 'Every milestone cleared')
    : v.cut
      ? `${stageForDays(v.runnerDays).label} · ${v.streak} ${per === 'month' ? 'mo' : 'wk'}`
      : `${stageForDays(v.runnerDays).label} · day ${Math.floor(v.runnerDays)}`;
  const toggleDay = iso => update(prev => toggleUse(prev, habit.id, iso));
  const overKey = cur ? (cur.used > cur.max ? `${cur.start}:${cur.used - cur.max}` : null) : habit.startTime;
  const replenish = strikes.state !== 'off' ? replenishLabel(strikes, now) : null;

  return (
    <article className={`cx-panel cx-sweep-habit${v.cut ? ' is-cut' : ''}`} style={{ '--cx-sweep-hc': habit.color || 'var(--cx-accent-fill)' }}>
      <header className="cx-sweep-habit-top">
        <span className="cx-sweep-habit-dot" aria-hidden="true" />
        <h2 className="cx-sweep-habit-name">{habit.name}</h2>
        <button type="button" className="cx-chip" aria-pressed={trail} onClick={toggleTrail}
                aria-label={trail ? 'Show the runner' : 'Show the trail'}>
          <Icon name={trail ? 'activity' : 'chart-column'} size={14} strokeWidth={1.75} />{trail ? 'Runner' : 'Trail'}
        </button>
        <button type="button" className="cx-btn cx-btn--ghost cx-btn--icon cx-sweep-habit-more" aria-label="Habit options"
                onClick={() => onOpenModal('editHabitModal:' + habit.id)}>
          <Icon name="ellipsis" size={18} strokeWidth={1.75} />
        </button>
      </header>

      <div className="cx-sweep-habit-clock">
        {v.cut ? (
          <>
            <span className="cx-num cx-t28">{v.streak} <small>{per === 'month' ? (v.streak === 1 ? 'month' : 'months') : (v.streak === 1 ? 'week' : 'weeks')}</small></span>
            <span className="cx-t12 cx-muted">on target{v.ghost ? <> · best <span className="cx-num">{Math.round(v.bestMs / (per === 'month' ? 2592000000 : 604800000))}</span></> : ''}</span>
          </>
        ) : (
          <>
            <span className={`cx-num cx-t28${strikes.state === 'maxed' ? ' cx-danger' : ''}`}>{clock(v.elapsed)}</span>
            <span className="cx-t12 cx-muted">
              since your last relapse{v.hasHistory ? <> · best <span className="cx-num">{shortSpan(Math.max(v.best, v.elapsed))}</span> · total <span className="cx-num">{shortSpan(v.odometer)}</span></> : ''}
            </span>
          </>
        )}
        <span className="cx-sweep-habit-next cx-t12 cx-mid">
          {v.cut && <span>Up to <span className="cx-num">{cur.max}</span> a {per}</span>}
          {next
            ? <span>Next: {next.label} <span className="cx-sweep-coin"><Icon name="coin" size={12} strokeWidth={1.75} /><span className="cx-num">{next.coins}</span></span></span>
            : (habit.milestones || []).length > 0 && <span>Every milestone cleared</span>}
        </span>
      </div>

      {trail ? <HabitTrail habit={habit} now={now} cut={v.cut} /> : (
        <>
          <div className="cx-sweep-habit-lane">
            <HabitRunner
              progress={progress}
              days={v.runnerDays}
              colour={runnerColour}
              done={v.allDone}
              endless={!!habit.endless}
              stumbleKey={overKey}
              ghost={v.ghost}
              pbAt={v.pbAt}
              flagKey={cur ? Math.min(cur.used, cur.max) : 0}
              scenery={v.scenery}
            />
          </div>
          <div className="cx-sweep-ladder" aria-hidden="true">
            <i style={{ width: `${progress * 100}%`, background: fill }} />
            {v.sorted.map((m, j) => (
              <b key={m.id} className={m.awarded ? 'is-done' : ''} style={{ left: `${((j + 1) / v.sorted.length) * 100}%` }} />
            ))}
          </div>
          <div className="cx-sweep-habit-stage cx-t12 cx-muted">
            <span>{stage}</span>
            <span className="cx-num">{Math.round(progress * 100)}%</span>
          </div>
        </>
      )}

      {v.cut && <div className="cx-sweep-scope cx-sweep-cutweek"><CutWeek habit={habit} now={now} onToggle={toggleDay} /></div>}

      <footer className="cx-sweep-habit-foot">
        {v.cut ? (
          <>
            <span className={`cx-t13 cx-mid${cur.state === 'over' ? ' cx-danger' : ''}`}>
              <span className="cx-num">{cur.used}</span> of <span className="cx-num">{cur.max}</span> this {per} · {resetsLabel(cur)}
            </span>
            <button type="button" className={`cx-btn${cur.usedToday ? ' cx-sweep-on' : ''}`} onClick={() => toggleDay(cur.today)} aria-pressed={cur.usedToday}>
              {cur.usedToday ? <><Icon name="check" size={16} strokeWidth={2} />Logged today</> : 'Had one today'}
            </button>
          </>
        ) : (
          <>
            <span className="cx-t13 cx-mid">
              {strikes.state !== 'off'
                ? <><span className="cx-num">{strikes.used}</span> of <span className="cx-num">{strikes.allowed}</span> strikes used{replenish ? ` · ${replenish}` : ''}</>
                : <><span className="cx-num">{habit.relapseCount || 0}</span> relapse{habit.relapseCount === 1 ? '' : 's'}</>}
            </span>
            <button type="button" className="cx-btn" onClick={() => onOpenModal('relapseModal:' + habit.id)}>
              <Icon name="rotate-ccw" size={16} strokeWidth={1.75} />Log a relapse
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

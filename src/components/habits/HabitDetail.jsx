/**
 * The Habits page's right side: the selected habit in full.
 *
 *   hero   the same runner as every card, drawn 1.6× in a tall lane,
 *          then the race against the best run and the stage ladder
 *   side   the clock, four facts, the action (Relapse, or the week strip
 *          for Cut down) and the milestones with coins and timing
 *   trail  the habit's history
 *
 * Laid out to fit a laptop screen without scrolling; below ~1240px the
 * side panel moves under the hero.
 */
import { useEffect, useState } from 'react';
import Icon from '../Icon';
import HabitRunner, { STAGES, paramsForDays } from './HabitRunner';
import CutWeek from './CutWeek';
import HabitTrail from './HabitTrail';
import { laneProps, stageName } from './HabitRoster';
import { habitView, shortSpan, resetsLabel, etaLabel, gapLabel, STAGE_WEEKS } from '../../lib/habits/view';
import { strikeState, replenishLabel } from '../../lib/habits/strikes';
import { toggleUse, dryTotal, periods, bestStreak, budgetOf } from '../../lib/habits/cutdown';
import { runsOf } from '../../lib/habits/progress';

const DAY = 86400000;

function RaceBar({ habit, v }) {
  const pct = v.ladder * 100;
  const ghostAt = v.ghost ? v.ghost.progress * 100 : v.pbAt != null ? v.pbAt * 100 : null;
  const lo = ghostAt == null ? null : Math.min(pct, ghostAt), hi = ghostAt == null ? null : Math.max(pct, ghostAt);
  const n = v.sorted.length;
  let title, sub;
  if (v.ghost) { title = 'Racing your best run'; sub = `Your best is ${gapLabel(habit, v)} ahead. Pass it for a personal best.`; }
  else if (v.pbAt != null) { title = 'Ahead of your best'; sub = `A new personal best by ${gapLabel(habit, v)}. Every day from here extends it.`; }
  else { title = 'No best to race yet'; sub = v.cut ? 'Your longest run of weeks on target becomes the ghost.' : 'The run a relapse ends is kept, and your longest becomes the ghost.'; }
  return (
    <div className="hb-race">
      <div className="hb-race-head"><span className="hb-eyebrow">{title}</span><span className={v.pbAt != null ? 'is-pb' : ''}>{sub}</span></div>
      <div className="hb-race-bar" style={{ '--hc': v.allDone ? 'var(--gold)' : habit.color }}>
        <i className="hb-race-fill" style={{ width: `${pct}%` }} />
        {ghostAt != null && hi - lo > 0.4 && (
          <i className={`hb-race-gap${v.pbAt != null ? ' is-pb' : ''}`} style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        )}
        {v.sorted.map((m, i) => (
          <i key={m.id} className={`hb-race-pip${v.elapsed >= m.duration ? ' is-on' : ''}`} style={{ left: `${((i + 1) / n) * 100}%` }} title={m.label} />
        ))}
        {v.ghost && <i className="hb-race-ghost" style={{ left: `${ghostAt}%` }} title="Your best run" />}
        {v.pbAt != null && <i className="hb-race-pb" style={{ left: `${ghostAt}%` }} title="Your old best" />}
        <i className="hb-race-you" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

function StageSteps({ habit, v }) {
  const days = v.runnerDays;
  let ci = 0;
  STAGES.forEach((st, i) => { if (days >= st.at) ci = i; });
  const frac = paramsForDays(days).frac;
  const per = v.cut ? budgetOf(habit).per : null;
  const weeksNow = v.cut ? (per === 'month' ? (v.streak * 30) / 7 : v.streak) : 0;
  return (
    <ol className="hb-stages" aria-label="Runner stages">
      {STAGES.map((st, i) => {
        const past = i < ci || v.allDone, cur = i === ci && !v.allDone, next = i === ci + 1 && !v.allDone;
        const at = v.cut ? (STAGE_WEEKS[i] ? `${STAGE_WEEKS[i]} wk` : 'start') : (st.at ? `day ${st.at}` : 'start');
        const eta = next ? (v.cut ? `in ${Math.max(1, Math.ceil(STAGE_WEEKS[i] - weeksNow))} wk` : `in ${shortSpan((st.at - days) * DAY)}`) : null;
        return (
          <li key={st.label} className={past ? 'is-past' : cur ? 'is-cur' : ''} aria-current={cur ? 'step' : undefined}>
            <span className="hb-stage-bar"><i style={{ width: past ? '100%' : cur ? `${Math.round(frac * 100)}%` : 0 }} /></span>
            <b>{st.label}</b>
            <span>{eta || at}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Side({ habit, v, now, update, onOpenModal }) {
  const cur = v.cur;
  const strikes = strikeState(habit, now);
  const toggleDay = iso => update(prev => toggleUse(prev, habit.id, iso));
  let big, unit, eb, sub;
  if (v.cut) {
    eb = 'On target for';
    big = String(v.streak);
    unit = cur.per === 'month' ? (v.streak === 1 ? 'month' : 'months') : (v.streak === 1 ? 'week' : 'weeks');
    sub = `this ${cur.per} counts once it closes`;
  } else {
    const s = Math.floor(v.elapsed / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    eb = 'Clean for';
    if (d > 0) { big = String(d); unit = d === 1 ? 'day' : 'days'; sub = `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`; }
    else { big = String(h); unit = h === 1 ? 'hour' : 'hours'; sub = `${m}m ${String(sec).padStart(2, '0')}s`; }
  }
  const facts = v.cut
    ? [['Best run', `${bestStreak(habit, now)} ${cur.per === 'month' ? 'mo' : 'wk'}`],
       ['On target', (ps => `${ps.filter(p => p.onTarget).length} / ${ps.length}`)(periods(habit, now).filter(p => p.tracked && !p.current))],
       [cur.per === 'month' ? 'Dry months' : 'Dry weeks', String(dryTotal(habit, now))],
       ['Budget', `${cur.max} / ${cur.per}`]]
    : [['Best run', shortSpan(Math.max(v.best, v.elapsed))],
       ['Total clean', shortSpan(v.odometer)],
       ['Runs', String(runsOf(habit).length + 1)],
       ['Relapses', String(habit.relapseCount || 0)]];
  const clockCls = v.allDone ? 'is-gold' : !v.cut && strikes.state === 'maxed' ? 'is-over' : '';
  return (
    <aside className="hb-card hb-side">
      <div className="hb-clock">
        <span className="hb-eyebrow">{eb}</span>
        <div className={`hb-clock-big ${clockCls}`}><b>{big}</b><span>{unit}</span></div>
        <span className="hb-clock-sub">{sub}</span>
      </div>
      <dl className="hb-facts">
        {facts.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
      </dl>

      {v.cut ? (
        <div className="hb-act">
          <div className="hb-act-head">
            <span className="hb-eyebrow">This {cur.per} · tap a day</span>
            <span className={`hb-act-note is-${cur.state}`}>{cur.used} of {cur.max}{cur.state === 'over' ? ' · over budget' : ''} · {resetsLabel(cur)}</span>
          </div>
          <CutWeek habit={habit} now={now} onToggle={toggleDay} />
          <button type="button" className={`hb-btn is-use${cur.usedToday ? ' is-done' : ''}`} onClick={() => toggleDay(cur.today)} aria-pressed={cur.usedToday}>
            {cur.usedToday ? '✓ Logged today · tap to undo' : '+ Had one today'}
          </button>
        </div>
      ) : (
        <div className="hb-act">
          {strikes.state !== 'off' && (
            <div className="hb-act-head">
              <span className="hb-eyebrow">Strikes this {habit.strikesPeriod === 'ever' ? 'run' : habit.strikesPeriod}</span>
              <span className={`hb-act-note strikes-${strikes.state}`}>
                <span className="hb-strike-pips" aria-hidden="true">
                  {Array.from({ length: strikes.allowed }, (_, i) => <i key={i} className={i < strikes.used ? 'is-used' : ''} />)}
                </span>
                {strikes.state === 'clean' ? 'unscathed' : `${strikes.used}/${strikes.allowed}`}{replenishLabel(strikes, now) ? ` · ${replenishLabel(strikes, now)}` : ''}
              </span>
            </div>
          )}
          <button type="button" className="hb-btn is-relapse" onClick={() => onOpenModal('relapseModal:' + habit.id)}>
            <Icon name="rotate-ccw" size={13} /> Relapse · keep this run on the trail
          </button>
        </div>
      )}

      {v.sorted.length > 0 && (
        <div className="hb-ms">
          <span className="hb-eyebrow">Milestones · coins</span>
          <ul>
            {v.sorted.map((m, i) => {
              const done = v.elapsed >= m.duration;
              const next = i === v.nextIdx;
              const eta = !done ? etaLabel(habit, v, m.duration) : null;
              return (
                <li key={m.id} className={done ? 'is-done' : next ? 'is-next' : ''}>
                  <i aria-hidden="true">{done ? '✓' : ''}</i>
                  <span>{m.label}{v.cut ? ' on target' : ''}</span>
                  <em>⬡ {m.coins}</em>
                  <b>{done ? 'cleared' : next ? `in ${eta}` : 'later'}</b>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}

export default function HabitDetail({ habit, update, onOpenModal }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const v = habitView(habit, now);
  const cur = v.cur;
  const nextMs = v.nextIdx >= 0 ? v.sorted[v.nextIdx] : null;
  const where = v.cut ? `${cur.per === 'month' ? 'Month' : 'Week'} ${v.streak + 1} of the run` : `Day ${Math.floor(v.elapsed / DAY)}`;

  return (
    <div className="hb-detail" style={{ '--hc': habit.color }}>
      <section className="hb-card hb-hero" aria-label={`${habit.name} in detail`}>
        <header className="hb-hero-head">
          <i className="hb-dot" aria-hidden="true" />
          <h2>{habit.name}</h2>
          {v.cut && <span className="hb-kind">up to {cur.max}/{cur.per === 'month' ? 'mo' : 'wk'}</span>}
          {!v.cut && habit.endless && <span className="hb-kind is-inf">∞ endless</span>}
          <span className={`hb-stage-chip${v.allDone ? ' is-gold' : ''}`}>{stageName(habit, v)}</span>
          <button type="button" className="hb-icon-btn" onClick={() => onOpenModal('editHabitModal:' + habit.id)} title="Edit habit" aria-label={`Edit ${habit.name}`}>
            <Icon name="pencil" size={13} />
          </button>
        </header>
        <div className="hb-hero-caption">
          <span>{where}{cur && cur.state === 'over' ? ' · over budget this week' : ''}</span>
          <span>{nextMs ? <>Next: <b>{nextMs.label}</b> in {etaLabel(habit, v, nextMs.duration)}</> : v.sorted.length ? 'Every milestone cleared' : 'No milestones set'}</span>
        </div>
        <div className="hb-hero-lane">
          <HabitRunner key={habit.id} {...laneProps(habit, v)} scale={1.6} />
        </div>
        <RaceBar habit={habit} v={v} />
        <StageSteps habit={habit} v={v} />
      </section>

      <Side habit={habit} v={v} now={now} update={update} onOpenModal={onOpenModal} />

      <section className="hb-card hb-trail-card" aria-label="Trail">
        <span className="hb-eyebrow">Trail · {v.cut ? `the last ${cur.per === 'month' ? '12 months' : '26 weeks'} against the budget` : 'every run, end to end'}</span>
        <HabitTrail habit={habit} now={now} cut={v.cut} />
      </section>
    </div>
  );
}

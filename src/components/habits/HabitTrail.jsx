/**
 * The trail — a habit's history on one strip, the card's other view.
 *
 *   Cut down  the last 26 weeks (or 12 months) as bars of days used
 *             against the budget line: gold dot = dry, green = on
 *             target, red = over. Periods before the budget began are
 *             faint ticks, never counted.
 *   Quit      every recorded run laid end to end in proportion, the
 *             longest in gold, relapses as the gaps between, and the
 *             runner at the tip of the current one.
 *
 * HTML rather than SVG so labels stay a readable size on a phone.
 */
import { periods, budgetOf, bestStreak, streak, onTargetTotal, dryTotal } from '../../lib/habits/cutdown';
import { runsOf, habitElapsed, runnerDays } from '../../lib/habits/progress';
import { shortSpan } from '../../lib/habits/view';
import MiniRunner from '../widgets/prime/MiniRunner';

function CutTrail({ habit, now }) {
  const { max, per } = budgetOf(habit);
  const n = per === 'month' ? 12 : 26;
  const ps = periods(habit, now, n);
  const top = Math.max(max + 2, ...ps.map(p => p.used), 3);
  const unit = per === 'month' ? 'mo' : 'wk';
  const tracked = ps.filter(p => p.tracked && !p.current).length;
  const stats = [
    ['On target', `${ps.filter(p => p.onTarget && !p.current).length} / ${tracked}`],
    [per === 'month' ? 'Dry months' : 'Dry weeks', dryTotal(habit, now)],
    ['Best run', `${bestStreak(habit, now)} ${unit}`],
    ['Current', `${streak(habit, now)} ${unit}`],
  ];
  const label = p => {
    const d = new Date(p.start + 'T12:00:00');
    const when = per === 'month'
      ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : `w/c ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    if (!p.tracked) return `${when}: before the budget`;
    return `${when}: ${p.used} day${p.used === 1 ? '' : 's'}${p.current ? ' so far' : p.over ? ', over budget' : p.dry ? ', dry' : ', on target'}`;
  };
  return (
    <div className="habit-trail">
      <div className="habit-trail-stats">
        {stats.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <div className="habit-trail-bars" style={{ '--n': ps.length }} role="img"
           aria-label={`${onTargetTotal(habit, now)} ${per === 'month' ? 'months' : 'weeks'} on target of the last ${ps.length}`}>
        <i className="habit-trail-budget" style={{ bottom: `${(max / top) * 100}%` }}><span>budget {max}</span></i>
        {ps.map(p => {
          const cls = !p.tracked ? 'is-off' : p.current ? 'is-now' : p.over ? 'is-over' : p.dry ? 'is-dry' : 'is-ok';
          return (
            <div key={p.start} className={`habit-trail-col ${cls}`} title={label(p)}>
              {p.tracked && p.used === 0 ? <em /> : <b style={{ height: `${(Math.max(p.used, p.tracked ? 0 : 0.15) / top) * 100}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="habit-trail-axis"><span>{n} {per === 'month' ? 'months' : 'weeks'} ago</span><span>this {per}</span></div>
      <div className="habit-trail-legend">
        <span><i className="is-dry" />dry</span><span><i className="is-ok" />on target</span><span><i className="is-over" />over</span>
      </div>
    </div>
  );
}

function QuitTrail({ habit, now }) {
  const runs = runsOf(habit).map(r => r.end - r.start);
  const cur = habitElapsed(habit, now);
  const all = [...runs, cur];
  const total = all.reduce((a, b) => a + b, 0) || 1;
  const best = Math.max(...runs, 0);
  const manual = Number(habit.bestManualMs) || 0;
  const stats = [
    ['Runs', all.length],
    ['Longest', shortSpan(Math.max(best, cur, manual))],
    ['Total clean', shortSpan(total)],
  ];
  return (
    <div className="habit-trail">
      <div className="habit-trail-stats">
        {stats.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
      </div>
      <div className="habit-trail-ribbon">
        {all.map((ms, i) => {
          const last = i === all.length - 1;
          const isBest = !last && ms === best && best > 0;
          return (
            <div key={i} className={`habit-trail-run${last ? ' is-now' : ''}${isBest ? ' is-best' : ''}`} style={{ flexGrow: Math.max(ms / total, 0.02) }}
                 title={`${last ? 'This run' : `Run ${i + 1}`}: ${shortSpan(ms)}`}>
              {last && (
                <span className="habit-trail-tip">
                  <MiniRunner days={runnerDays(habit, now)} height={22} colour={habit.color || '#1a7a4a'} className="habit-trail-runner" />
                </span>
              )}
              <b />
              <span className="habit-trail-len">{shortSpan(ms)}{isBest ? ' · best' : ''}</span>
            </div>
          );
        })}
      </div>
      {!runs.length && (
        <p className="habit-trail-note">
          Earlier runs weren’t recorded. From now on, each relapse closes a run and adds it here{manual ? '; your best so far is ' + shortSpan(manual) : ''}.
        </p>
      )}
    </div>
  );
}

export default function HabitTrail({ habit, now, cut }) {
  return cut ? <CutTrail habit={habit} now={now} /> : <QuitTrail habit={habit} now={now} />;
}

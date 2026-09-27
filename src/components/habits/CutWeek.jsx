/**
 * The current week (or month) of a Cut-down habit, one cell a day. Tap a
 * day to log it, tap again to take it back. Days inside the budget go
 * amber, days past it red; future days can't be tapped.
 *
 * A month budget shows the month as a small calendar, Monday first.
 */
import { periodDays } from '../../lib/habits/cutdown';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CutWeek({ habit, now, onToggle }) {
  const days = periodDays(habit, now);
  const month = (habit.budget && habit.budget.per) === 'month';
  const lead = month && days.length ? (new Date(days[0].iso + 'T12:00:00').getDay() + 6) % 7 : 0;
  return (
    <div className={`cut-week${month ? ' is-month' : ''}`} role="group" aria-label={month ? 'This month' : 'This week'}>
      {month && DOW.map(d => <span key={d} className="cut-week-dow" aria-hidden="true">{d[0]}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={'x' + i} aria-hidden="true" />)}
      {days.map((d, i) => {
        const dayNum = Number(d.iso.slice(8));
        const label = month ? String(dayNum) : DOW[i];
        const cls = ['cut-day', d.used ? (d.over ? 'is-over' : 'is-used') : '', d.today ? 'is-today' : '', d.future ? 'is-future' : '', d.before ? 'is-before' : '']
          .filter(Boolean).join(' ');
        const when = new Date(d.iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        return (
          <button
            key={d.iso}
            type="button"
            className={cls}
            disabled={d.future}
            aria-pressed={d.used}
            aria-label={`${when}${d.used ? ', logged' + (d.over ? ', over budget' : '') : ''}`}
            onClick={() => onToggle(d.iso)}
          >
            <span>{label}</span>
            {!month && <i aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

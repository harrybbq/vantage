import { PAY_FREQS } from '../../lib/money/payday';
import './PayIndicator.css';

const long = iso => (iso ? new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '');

/**
 * The pay-day form's fields, shared by classic's PayDayModal and the
 * console's Add sheet. Controlled: the caller owns the values and saves
 * through lib/money/payday.setPayDay.
 */
export default function PayDayFields({ date, onDate, freq, onFreq, weekendEarly, onWeekendEarly, dateInputClass = '' }) {
  return (
    <div className="payday-form">
      <label className="payday-date">
        <span className="payday-note">Pay day</span>
        <input type="date" className={dateInputClass} value={date} onChange={e => onDate(e.target.value)} />
      </label>
      <fieldset className="payday-freqs">
        <legend>Repeats</legend>
        {PAY_FREQS.map(f => (
          <label key={f.id} className={`payday-opt${freq === f.id ? ' is-on' : ''}`}>
            <input type="radio" name="payday-freq" value={f.id} checked={freq === f.id} onChange={() => onFreq(f.id)} />
            <span>{f.label}</span>
            {f.id === 'month' && date && <span className="payday-opt-hint">on the {new Date(date + 'T12:00').getDate()}{ordinal(new Date(date + 'T12:00').getDate())}</span>}
          </label>
        ))}
      </fieldset>
      {freq === 'month' && (
        <label className="payday-check">
          <input type="checkbox" checked={weekendEarly} onChange={e => onWeekendEarly(e.target.checked)} />
          <span>If it lands on a weekend, I’m paid the Friday before</span>
        </label>
      )}
      <p className="payday-note">
        {date ? `First pay: ${long(date)}. ` : ''}Your pay days show on the calendar, and Track tells you what subscriptions are still to come out before the next one.
      </p>
    </div>
  );
}

function ordinal(n) {
  const s = n % 100;
  if (s >= 11 && s <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
}

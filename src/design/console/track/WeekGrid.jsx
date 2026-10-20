/**
 * Track › Calendar › Week — seven columns with the same items as the
 * month (bars, timed events, itinerary, £ renewals, the tracker line),
 * with room to read them. On a phone the seven columns stack as seven
 * day rows, so nothing has to shrink below legibility.
 */
import { useMemo } from 'react';
import { eventColour } from '../../../lib/calendar/events';
import { isBarEvent } from '../../../lib/calendar/spans';
import { weekDays, eventsForDays, rowBands, billsInRange, itineraryOn, trackerCompletion, money } from './model';
import { Band } from './MonthGrid';
import TIcon from './icons';

export default function WeekGrid({ S, monday, today, selected, onSelect, onOpenTrip, onOpenSpan, onEditEvent, wide, shiftChipsFor }) {
  const days = useMemo(() => weekDays(monday), [monday]);
  const { events, layout } = useMemo(() => eventsForDays(S, days.map(d => d.iso)), [S, days]);
  const bills = useMemo(() => billsInRange(S, days[0].iso, days[6].iso), [S, days]);
  const tripsById = useMemo(() => Object.fromEntries((S.holidays || []).filter(t => t && t.id).map(t => [t.id, t])), [S.holidays]);
  const bands = wide ? rowBands(days, layout) : [];
  const lanes = bands.reduce((n, b) => Math.max(n, b.lane + 1), 0);

  return (
    <div className={`cx-track-week${wide ? ' is-wide' : ' is-compact'}`} style={{ '--lanes': lanes }}>
      {days.map(d => {
        const all = events[d.iso] || [];
        const singles = all.filter(ev => !isBarEvent(ev));
        const bars = all.filter(isBarEvent);
        const items = itineraryOn(S, d.iso);
        const dayBills = bills[d.iso] || [];
        const comp = d.iso <= today ? trackerCompletion(S, d.iso) : null;
        const shift = shiftChipsFor ? shiftChipsFor(d.iso) : null;
        const label = new Date(d.iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' });
        return (
          <section key={d.iso} className={`cx-track-wday${d.iso === today ? ' is-today' : ''}${d.iso === selected ? ' is-sel' : ''}`}>
            <button type="button" className="cx-track-wday-h" onClick={() => onSelect(d.iso)} aria-label={new Date(d.iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}>
              <span className="cx-track-wday-dow">{label}</span>
              <span className="cx-track-d cx-num">{d.day}</span>
              {shift && <span className={`cx-track-shift is-${shift.shift}`} title={shift.label}>{shift.chip}</span>}
            </button>
            <div className="cx-track-wday-b">
              {!wide && bars.map(ev => (
                <button key={ev.id} type="button" className="cx-track-wi is-bar" style={{ '--k': eventColour(ev) }}
                        onClick={() => (ev.source === 'holiday' ? onOpenTrip(ev.tripId) : onOpenSpan(ev))}>
                  <TIcon name={ev.source === 'holiday' ? 'plane' : 'calendar-days'} size={13} />
                  <span className="cx-track-wi-t">{ev.title}</span>
                  <span className="cx-track-wi-m">{ev.span}</span>
                </button>
              ))}
              {singles.map(ev => (
                <button key={ev.id} type="button" className="cx-track-wi" style={{ '--k': eventColour(ev) }} onClick={() => onEditEvent(ev, d.iso)}>
                  {ev.time && <span className="cx-track-wi-tm cx-num">{ev.time}</span>}
                  <span className="cx-track-wi-t">{ev.title}</span>
                </button>
              ))}
              {items.map(it => (
                <button key={it.trip.id + it.id} type="button" className="cx-track-wi is-itin" onClick={() => onOpenTrip(it.trip.id)}>
                  {it.time && <span className="cx-track-wi-tm cx-num">{it.time}</span>}
                  <span className="cx-track-wi-t">{it.title || it.note}</span>
                </button>
              ))}
              {dayBills.map(b => (
                <span key={b.id} className="cx-track-wi is-bill">
                  <span className="cx-track-wi-tm cx-num">{money(b.amount)}</span>
                  <span className="cx-track-wi-t">{b.name}</span>
                </span>
              ))}
              {!all.length && !items.length && !dayBills.length && !wide && <span className="cx-track-wi-none">Nothing on</span>}
            </div>
            {comp && comp.total > 0 && (
              <span className="cx-track-prog" title={`${comp.done} of ${comp.total} trackers`}><i style={{ width: `${Math.round((comp.done / comp.total) * 100)}%` }} /></span>
            )}
          </section>
        );
      })}
      {bands.map(b => (
        <Band key={b.key + '@' + b.lane} b={b} tripsById={tripsById} wide onOpenTrip={onOpenTrip} onOpenSpan={onOpenSpan} />
      ))}
    </div>
  );
}

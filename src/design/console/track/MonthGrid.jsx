/**
 * Track › Calendar › Month — the console month grid.
 *
 * Monday-first whole weeks. Per week row, multi-day things (trips and
 * spans) are drawn ONCE as bars across the cells they cover, in the
 * lanes lib/calendar/spans.js `barLayout` assigns; trips carry their
 * cover photo (planning trips dashed). Single events are chips on wide
 * screens and dots on phones; subscription renewals are small grey £
 * chips/dots; a line under each past day shows how many trackers were
 * ticked. Today is a filled badge; the selected day is outlined.
 *
 * Read-only: every number comes through eventsInMonth/barLayout,
 * billsInRange and trackerCompletion (model.js). The owner's shift chips
 * (Upgrade › Rotation) are passed in already gated.
 */
import { useMemo } from 'react';
import { eventColour, isDerivedId } from '../../../lib/calendar/events';
import { isBarEvent } from '../../../lib/calendar/spans';
import { monthMatrix, eventsForDays, rowBands, billsInRange, trackerCompletion, MONTHS, DOW } from './model';
import { photoOf } from './trips';
import TIcon from './icons';

const fullDate = iso => new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export function Band({ b, tripsById, onOpenTrip, onOpenSpan, wide }) {
  const ev = b.ev;
  const isTrip = ev.source === 'holiday';
  const trip = isTrip ? tripsById[ev.tripId] : null;
  const photo = trip ? photoOf(trip) : '';
  const cls = ['cx-track-band', isTrip ? 'is-trip' : 'is-span', photo ? 'has-photo' : '',
    ev.status === 'planning' ? 'is-plan' : '', b.isStart ? 'is-start' : '', b.isEnd ? 'is-end' : ''].filter(Boolean).join(' ');
  const style = { '--from': b.from, '--span': b.to - b.from + 1, '--lane': b.lane, '--k': eventColour(ev) };
  if (photo) style.backgroundImage = `url("${photo}")`;
  const label = isTrip ? `${ev.title}, trip${ev.status === 'planning' ? ' (planning)' : ''}` : `${ev.title}, ${ev.span}`;
  return (
    <button type="button" className={cls} style={style} aria-label={label} title={label}
            onClick={e => { e.stopPropagation(); if (isTrip) onOpenTrip(ev.tripId); else onOpenSpan(ev); }}>
      {isTrip && <TIcon name="plane" size={12} strokeWidth={2} />}
      <span className="cx-track-band-t">{ev.title}</span>
      {wide && isTrip && ev.status === 'planning' && <span className="cx-track-band-tag">Planning</span>}
    </button>
  );
}

export default function MonthGrid({ S, year, month, today, selected, onSelect, onOpenTrip, onOpenSpan, wide, shiftChips }) {
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const allIsos = useMemo(() => weeks.flat().map(d => d.iso), [weeks]);
  const { events, layout } = useMemo(() => {
    // Only this month's events and lanes: spill-over days stay quiet, as
    // in the mockup, so a bar never appears to start twice.
    const r = eventsForDays(S, allIsos.filter(iso => iso.slice(0, 7) === `${year}-${String(month + 1).padStart(2, '0')}`));
    return r;
  }, [S, allIsos, year, month]);
  const bills = useMemo(() => billsInRange(S, allIsos[0], allIsos[allIsos.length - 1]), [S, allIsos]);
  const tripsById = useMemo(() => Object.fromEntries((S.holidays || []).filter(t => t && t.id).map(t => [t.id, t])), [S.holidays]);
  const maxLanes = wide ? 3 : 2;

  return (
    <div className={`cx-track-month${wide ? ' is-wide' : ' is-compact'}`} role="grid" aria-label={`${MONTHS[month]} ${year}`}>
      <div className="cx-track-dow" role="row">
        {DOW.map(d => <span key={d} role="columnheader" aria-label={d}>{wide ? d : d[0]}</span>)}
      </div>
      {weeks.map((days, wi) => {
        const bands = rowBands(days, layout).filter(b => b.lane < maxLanes);
        const lanes = bands.reduce((n, b) => Math.max(n, b.lane + 1), 0);
        return (
          <div key={wi} className="cx-track-wk" role="row" style={{ '--lanes': lanes }}>
            {days.map(d => {
              const dayEvents = d.inMonth ? (events[d.iso] || []) : [];
              const dayLanes = d.inMonth ? ((layout[d.iso] && layout[d.iso].lanes) || []) : [];
              const hiddenBars = dayLanes.filter((l, i) => l && i >= maxLanes).length;
              const singles = dayEvents.filter(ev => !isBarEvent(ev));
              const dayBills = d.inMonth ? (bills[d.iso] || []) : [];
              const isToday = d.iso === today;
              const past = d.inMonth && d.iso <= today;
              const comp = past ? trackerCompletion(S, d.iso) : null;
              const shift = d.inMonth && shiftChips ? shiftChips[d.iso] : null;
              const room = Math.max(1, 3 - lanes);
              const chips = [
                ...singles.map(ev => ({ key: ev.id, ev })),
                ...dayBills.map(b => ({ key: 'bill:' + b.id, bill: b })),
              ];
              const shown = wide ? chips.slice(0, room) : [];
              const more = (wide ? chips.length - shown.length : 0) + hiddenBars;
              const count = singles.length + dayBills.length + dayEvents.filter(isBarEvent).length;
              const cls = ['cx-track-cell', d.inMonth ? '' : 'is-out', isToday ? 'is-today' : '', selected === d.iso ? 'is-sel' : ''].filter(Boolean).join(' ');
              return (
                <button key={d.iso} type="button" role="gridcell" className={cls}
                        aria-selected={selected === d.iso}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={`${fullDate(d.iso)}${count ? `, ${count} item${count === 1 ? '' : 's'}` : ''}${comp && comp.total ? `, ${comp.done} of ${comp.total} trackers` : ''}`}
                        onClick={() => onSelect(d.iso)}>
                  <span className="cx-track-d cx-num">{d.day}</span>
                  {shift && <span className={`cx-track-shift is-${shift.shift}`} title={shift.label}>{wide ? shift.chip : shift.tiny}</span>}
                  <span className="cx-track-cellbody">
                    {wide ? (
                      <>
                        {shown.map(c => (c.bill ? (
                          <span key={c.key} className="cx-track-chip is-bill"><span className="cx-track-chip-t">£ {c.bill.name}</span></span>
                        ) : (
                          <span key={c.key} className="cx-track-chip" style={{ '--k': eventColour(c.ev) }}>
                            {c.ev.time && <span className="cx-track-chip-tm cx-num">{c.ev.time}</span>}
                            <span className="cx-track-chip-t">{c.ev.title}</span>
                          </span>
                        )))}
                        {more > 0 && <span className="cx-track-more">+{more} more</span>}
                      </>
                    ) : (
                      (singles.length > 0 || dayBills.length > 0 || hiddenBars > 0) && (
                        <span className="cx-track-dots" aria-hidden="true">
                          {singles.slice(0, 4).map(ev => <i key={ev.id} style={{ background: eventColour(ev) }} className={isDerivedId(ev.id) ? 'is-trip' : ''} />)}
                          {dayBills.slice(0, 2).map(b => <i key={b.id} className="is-bill" />)}
                        </span>
                      )
                    )}
                  </span>
                  {comp && comp.total > 0 && (
                    <span className="cx-track-prog" aria-hidden="true"><i style={{ width: `${Math.round((comp.done / comp.total) * 100)}%` }} /></span>
                  )}
                </button>
              );
            })}
            {bands.map(b => (
              <Band key={b.key + '@' + b.lane + '@' + b.from} b={b} tripsById={tripsById} wide={wide}
                    onOpenTrip={onOpenTrip} onOpenSpan={onOpenSpan} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

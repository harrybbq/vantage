/**
 * A trip's cover: the photo (trip.imageUrl), its status, name, dates and
 * countdown. Used by the next-trip card (Month, Year) and the trip sheet.
 * No photo → a quiet tinted ground in the trip's colour.
 * Spans throughout (display: block in CSS) so it can sit inside a button.
 */
import { countdown, dayAt, fmt, STATUS_LABEL } from '../../../lib/holiday/timeline';
import { tripSavings } from '../../../lib/holiday/savings';
import { photoOf } from './trips';
import { tripHue, money } from './model';
import TIcon from './icons';

export const statusLabel = s => (s === 'completed' ? 'Done' : STATUS_LABEL[s] || 'Planning');

export function tripDates(trip) {
  if (!trip.from) return 'No dates yet';
  const sameYear = trip.to && trip.from.slice(0, 4) === trip.to.slice(0, 4);
  const a = fmt(trip.from, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear || !trip.to ? {} : { year: 'numeric' }) });
  const b = trip.to ? fmt(trip.to, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return b && trip.to !== trip.from ? `${a} – ${b}` : a;
}

export function Cover({ trip, height = 120, children, className = '' }) {
  const photo = photoOf(trip);
  const style = { height, '--k': tripHue(trip) };
  if (photo) style.backgroundImage = `url("${photo}")`;
  return (
    <span className={`cx-track-cover${photo ? ' has-photo' : ''} ${className}`} style={style}>
      <span className="cx-track-cover-ov" />
      {children}
    </span>
  );
}

export function StatusTag({ status, onClick }) {
  const cls = `cx-track-status is-${status || 'planning'}`;
  if (!onClick) return <span className={cls}>{statusLabel(status)}</span>;
  return (
    <button type="button" className={cls} onClick={onClick} title="Change status" aria-label={`Status: ${statusLabel(status)}. Change status`}>
      {statusLabel(status)}
    </button>
  );
}

export function CountTag({ trip, now }) {
  const c = countdown(trip, now);
  return (
    <span className="cx-track-cover-count">
      <span className="cx-num">{c.big}</span>
      <span className="cx-track-cover-unit">{c.unit.replace(' to go', '')}</span>
    </span>
  );
}

export default function NextTripCard({ trip, S, today, onOpen, compact }) {
  if (!trip) return null;
  const now = dayAt(today) || new Date();
  const c = countdown(trip, now);
  const sav = tripSavings(S, trip);
  return (
    <section className="cx-panel cx-track-next">
      <button type="button" className="cx-track-next-btn" onClick={() => onOpen(trip.id)} aria-label={`${trip.dest || 'Trip'}, ${c.big} ${c.unit}. Open trip`}>
        <Cover trip={trip} height={compact ? 104 : 120}>
          <StatusTag status={trip.status} />
          <span className="cx-track-cover-foot">
            <span className="cx-track-cover-name">
              <span className="cx-track-cover-t">{trip.dest || 'Untitled trip'}</span>
              <span className="cx-track-cover-s">{tripDates(trip)}</span>
            </span>
            <CountTag trip={trip} now={now} />
          </span>
        </Cover>
        <span className="cx-track-next-row">
          <TIcon name="plane" size={14} className="cx-mid" />
          <span className="cx-track-next-l">{trip.flight ? 'Flights booked' : 'No flights yet'}</span>
          {sav ? (
            <span className="cx-track-next-m"><span className="cx-muted">Saved</span> <span className="cx-num">{money(Math.round(sav.current))}</span> <span className="cx-muted">of {money(Math.round(sav.target))}</span></span>
          ) : trip.budget ? (
            <span className="cx-track-next-m"><span className="cx-muted">Budget</span> {trip.budget}</span>
          ) : null}
        </span>
      </button>
    </section>
  );
}

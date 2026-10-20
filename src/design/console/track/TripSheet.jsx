/**
 * One trip, in a sheet — the Holiday section's boarding pass, merged
 * into Track. Everything BoardingPass / DestinationPanel / the trip
 * modals offer is here: cover photo (change it in place), status
 * cycling, countdown, dates and nights, flight, stay, budget against a
 * linked savings pot, the itinerary by day (each item also shows on its
 * day in the calendar), notes, the travel-policy flag and the
 * destination guide (DestinationPanel itself, re-skinned by track.css).
 * Edit and delete go to TripEditSheet.
 *
 * Writes go through trips.js — the Holiday section's own updaters.
 */
import { useMemo, useRef } from 'react';
import { Sheet, Button } from '../ui';
import DestinationPanel from '../../../components/holiday/DestinationPanel';
import { COUNTRY_BY_ISO, countryForTrip } from '../../../lib/holiday/destinations';
import { getPolicy, levelFor, POLICY_LEVELS } from '../../../lib/holiday/policy';
import { tripSavings, parseBudget } from '../../../lib/holiday/savings';
import { dayAt, fmt, nightsOf } from '../../../lib/holiday/timeline';
import { cycleTripStatus, editTrip } from './trips';
import { resizePhoto } from './photo';
import { Cover, StatusTag, CountTag, tripDates } from './TripCard';
import { money, cityOf } from './model';
import TIcon from './icons';

const ITEM_ICON = { travel: 'plane', stay: 'bed', food: 'utensils', activity: 'ticket', other: 'circle-dot' };

export default function TripSheet({ trip, S, update, today, onClose, onEdit, onShowOnCalendar }) {
  const fileRef = useRef(null);
  const now = dayAt(today) || new Date();
  const iso2 = countryForTrip(trip);
  const country = COUNTRY_BY_ISO[iso2]?.name || '';
  const level = levelFor(getPolicy(S), iso2);
  const sav = tripSavings(S, trip);
  const nights = nightsOf(trip);
  const budget = parseBudget(trip.budget);
  const items = useMemo(() => [...(trip.items || [])]
    .filter(i => i && (i.title || i.note))
    .sort((a, b) => (a.day || '~').localeCompare(b.day || '~') || (a.time || '~').localeCompare(b.time || '~')), [trip.items]);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const it of items) { const k = it.day || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.entries()];
  }, [items]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await resizePhoto(file, 900);
      update(prev => editTrip(prev, trip.id, { imageUrl: url }));
    } catch { /* not an image: leave the trip as it was */ }
  }

  const city = cityOf(trip.dest, country);
  const place = [city, country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');

  return (
    <Sheet title={trip.dest || 'Untitled trip'} eyebrow="Trip" onClose={onClose} className="cx-track-tripsheet" testId="track-trip"
           footer={(
             <div className="cx-track-foot2">
               <Button icon="pencil" onClick={() => onEdit(trip.id, 'basics')}>Edit trip</Button>
               <Button icon="calendar-days" onClick={() => onShowOnCalendar(trip)} disabled={!trip.from}>On the calendar</Button>
             </div>
           )}>
      <Cover trip={trip} height={176} className="cx-track-hero">
        <StatusTag status={trip.status} onClick={() => update(prev => cycleTripStatus(prev, trip.id, trip.status))} />
        <button type="button" className="cx-track-photo-btn" onClick={() => fileRef.current?.click()}>
          <TIcon name="camera" size={14} />{trip.imageUrl ? 'Change photo' : 'Add photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <span className="cx-track-cover-foot">
          <span className="cx-track-cover-name">
            {place && <span className="cx-track-cover-s cx-track-place"><TIcon name="pin" size={13} />{place}</span>}
          </span>
          <CountTag trip={trip} now={now} />
        </span>
      </Cover>

      <div className="cx-track-stats">
        <div><span className="cx-track-stat-l">Dates</span><span className="cx-track-stat-v">{tripDates(trip)}</span></div>
        <div><span className="cx-track-stat-l">Nights</span><span className="cx-track-stat-v cx-num">{nights || '–'}</span></div>
        <div><span className="cx-track-stat-l">Plans</span><span className="cx-track-stat-v cx-num">{items.length}</span></div>
      </div>

      {level && level !== 'cleared' && (
        <p className={`cx-track-flag is-${level}`}>
          <TIcon name={level === 'restricted' ? 'octagon-alert' : 'triangle-alert'} size={14} />
          {country || iso2}: {POLICY_LEVELS[level].short}
        </p>
      )}

      <div className="cx-track-budget">
        <div className="cx-track-budget-top">
          <span className="cx-track-budget-l">Budget</span>
          {sav ? (
            <span className="cx-track-budget-v"><span className="cx-num">{money(Math.round(sav.current))}</span> <span className="cx-muted">of {money(Math.round(sav.target))} · {sav.goal.name}</span></span>
          ) : (
            <span className="cx-track-budget-v">{trip.budget || <span className="cx-muted">Not set</span>}</span>
          )}
        </div>
        {sav && <span className="cx-track-meter"><i style={{ width: `${sav.pct}%` }} /></span>}
        <span className="cx-track-budget-n">
          {sav
            ? (sav.current >= sav.target ? 'Fully saved.'
              : sav.perMonthNeeded != null ? `${money(Math.round(sav.target - sav.current))} to go. ${money(sav.perMonthNeeded)} a month covers it by departure.`
                : `${money(Math.round(sav.target - sav.current))} still to go.`)
            : <button type="button" className="cx-track-inline" onClick={() => onEdit(trip.id, 'budget')}>Link a savings pot</button>}
          {sav && budget != null && Number(sav.target) > 0 && budget > Number(sav.target) && ' The budget is more than the pot’s target.'}
        </span>
      </div>

      <div className="cx-panel cx-track-rows">
        {[['plane', 'Flight', trip.flight], ['bed', 'Stay', trip.accom]].map(([icon, label, val]) => (
          <button key={label} type="button" className="cx-track-row" onClick={() => onEdit(trip.id, 'basics')}>
            <TIcon name={icon} size={18} className="cx-mid" />
            <span className="cx-track-row-main"><span className="cx-track-row-l">{label}</span><span className={`cx-track-row-v${val ? '' : ' cx-muted'}`}>{val || 'Not booked'}</span></span>
            <TIcon name="chevron-right" size={16} className="cx-muted" />
          </button>
        ))}
      </div>

      <section className="cx-track-itin" aria-label="Itinerary">
        <div className="cx-track-itin-head">
          <h3>Itinerary</h3>
          <span className="cx-muted">Each item shows on its day in the calendar</span>
        </div>
        {!items.length && <p className="cx-track-empty">Nothing planned yet.</p>}
        {byDay.map(([day, list]) => (
          <div key={day || 'none'} className="cx-track-itin-day">
            <span className="cx-track-itin-d cx-num">{day ? fmt(day, { weekday: 'short', day: 'numeric' }) : 'No day'}</span>
            <ul>
              {list.map(it => (
                <li key={it.id}>
                  <TIcon name={ITEM_ICON[it.kind] || 'circle-dot'} size={14} className="cx-muted" />
                  {it.time && <span className="cx-num cx-muted">{it.time}</span>}
                  <span>{it.title || it.note}{it.title && it.note ? <span className="cx-muted"> · {it.note}</span> : null}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Button variant="ghost" icon="plus" onClick={() => onEdit(trip.id, 'itinerary')}>Add plans</Button>
      </section>

      {trip.notes && (
        <section className="cx-track-notes">
          <h3>Notes</h3>
          <p>{trip.notes}</p>
        </section>
      )}

      {trip.status !== 'completed' && trip.dest && (
        <section className="cx-track-guide" aria-label="Guide">
          <h3><TIcon name="globe" size={16} />Guide</h3>
          <DestinationPanel dest={trip.dest} from={trip.from} />
        </section>
      )}
    </Sheet>
  );
}

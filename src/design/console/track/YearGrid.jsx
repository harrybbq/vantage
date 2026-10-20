/**
 * Track › Calendar › Year — twelve mini months. Each trip's days are
 * painted in that trip's own plain colour (dashed while it is still
 * being planned); multi-day events in theirs. Today is outlined. A day
 * opens it in the Month view; a month's name opens that month.
 */
import { useMemo } from 'react';
import { COUNTRY_BY_ISO, countryForTrip } from '../../../lib/holiday/destinations';
import { monthMatrix, yearMarks, tripsInMonth, tripHue, cityOf, MONTHS } from './model';

export default function YearGrid({ S, year, today, onOpenDay, onOpenMonth }) {
  const marks = useMemo(() => yearMarks(S, year), [S, year]);
  return (
    <div className="cx-track-year">
      <div className="cx-track-year-grid">
        {MONTHS.map((name, m) => {
          const weeks = monthMatrix(year, m);
          const trips = tripsInMonth(S, year, m);
          return (
            <section key={name} className="cx-track-mini" aria-label={`${name} ${year}`}>
              <header>
                <button type="button" className="cx-track-mini-t" onClick={() => onOpenMonth(m)}>{name}</button>
                {trips.length > 0 && (
                  <span className="cx-track-mini-trips">
                    {trips.slice(0, 2).map(t => (
                      <span key={t.id} style={{ '--k': tripHue(t) }}>{cityOf(t.dest, COUNTRY_BY_ISO[countryForTrip(t)]?.name) || 'Trip'}</span>
                    ))}
                  </span>
                )}
              </header>
              <div className="cx-track-mini-days">
                {weeks.flat().map(d => {
                  if (!d.inMonth) return <i key={d.iso} className="is-out" aria-hidden="true" />;
                  const mk = marks[d.iso];
                  const cls = [mk ? `is-${mk.kind}` : '', mk && mk.planning ? 'is-plan' : '', d.iso === today ? 'is-today' : ''].filter(Boolean).join(' ');
                  return (
                    <button key={d.iso} type="button" className={cls} style={mk ? { '--k': mk.colour } : undefined}
                            onClick={() => onOpenDay(d.iso)}
                            aria-label={`${d.day} ${name}${mk ? `, ${mk.title}` : ''}`} title={mk ? mk.title : undefined} />
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="cx-track-legend">
        <span><i className="is-trip" />Trips, each in its own colour (dashed while planning)</span>
        <span><i className="is-span" />Multi-day events</span>
      </div>
    </div>
  );
}

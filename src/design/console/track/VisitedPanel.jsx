/**
 * Visited — the old Holiday › Visited tab, folded into the Year view.
 * Countries (completed trips plus anywhere ticked by hand), cities,
 * nights away this year, and the list; "Open the map" opens the classic
 * VisitedTab (and its WorldMap) whole, in a sheet, where countries can
 * still be ticked by hand.
 */
import { useMemo } from 'react';
import { COUNTRY_BY_ISO, countryForTrip } from '../../../lib/holiday/destinations';
import { visitedSummary } from './model';
import TIcon from './icons';

export default function VisitedPanel({ S, year, onOpenMap }) {
  const v = useMemo(() => visitedSummary(S, year, countryForTrip, c => COUNTRY_BY_ISO[c]?.name || null), [S, year]);
  return (
    <section className="cx-panel cx-track-visited" aria-label="Visited">
      <header className="cx-track-visited-h">
        <h2>Visited</h2>
        <span className="cx-muted">{v.rows.filter(r => r.planned).length ? `${v.rows.filter(r => r.planned).length} planned` : ''}</span>
      </header>
      <div className="cx-track-kpis">
        <div><span className="cx-num">{v.countries}</span><span>countries</span></div>
        <div><span className="cx-num">{v.cities}</span><span>{v.cities === 1 ? 'city' : 'cities'}</span></div>
        <div><span className="cx-num">{v.nights}</span><span>nights away in {year}</span></div>
      </div>
      {v.rows.length > 0 ? (
        <ul className="cx-track-vlist">
          {v.rows.slice(0, 8).map(r => (
            <li key={r.iso2}>
              <TIcon name="pin" size={15} className="cx-mid" />
              <span className="cx-track-vmain">
                <span className="cx-track-vname">{r.name}</span>
                <span className="cx-track-vmeta">
                  {r.planned ? 'Planned' : r.trips ? `${r.trips} trip${r.trips === 1 ? '' : 's'}` : 'Added by hand'}
                  {r.cities.length ? ` · ${r.cities.join(', ')}` : ''}
                </span>
              </span>
              {r.year > 0 && <span className="cx-muted cx-num">{r.year}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="cx-track-empty">Finished trips fill this in. Tick anywhere else on the map.</p>}
      <button type="button" className="cx-track-link" onClick={onOpenMap}>
        <span>Open the map</span>
        <TIcon name="chevron-right" size={16} />
      </button>
    </section>
  );
}

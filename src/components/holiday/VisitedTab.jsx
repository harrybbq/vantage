import { useMemo, useState } from 'react';
import Icon from '../Icon';
import WorldMap from './WorldMap';
import { visitedCountries, visitedPct, ALL_COUNTRIES, COUNTRY_BY_ISO } from '../../lib/holiday/destinations';

/**
 * Countries visited — the third use of the shared WorldMap.
 *
 * Auto-derived from COMPLETED trips (so marking a trip complete on the
 * Trips tab fills the map in for free), plus manual ticks for anywhere
 * you went before you started logging trips here. The two are stored
 * separately: deleting a trip must never silently erase a country you
 * added by hand.
 */
export default function VisitedTab({ S, update }) {
  const [region, setRegion] = useState('all');
  const [picked, setPicked] = useState(null);

  const visited = useMemo(() => visitedCountries(S), [S]);
  const isoList = useMemo(() => Object.keys(visited), [visited]);

  const fills = useMemo(() => {
    const f = {};
    for (const iso2 of isoList) f[iso2] = 'accent';
    return f;
  }, [isoList]);

  const regions = useMemo(() => {
    const set = new Set(ALL_COUNTRIES.map(c => c.region).filter(Boolean));
    return ['all', ...[...set].sort()];
  }, []);

  const byRegion = useMemo(() => {
    const counts = {};
    for (const c of ALL_COUNTRIES) {
      if (!c.region) continue;
      counts[c.region] = counts[c.region] || { total: 0, been: 0 };
      counts[c.region].total++;
      if (visited[c.iso2]) counts[c.region].been++;
    }
    return counts;
  }, [visited]);

  const listed = useMemo(() => {
    const all = region === 'all' ? ALL_COUNTRIES : ALL_COUNTRIES.filter(c => c.region === region);
    return [...all].sort((a, b) => {
      const av = visited[a.iso2] ? 0 : 1, bv = visited[b.iso2] ? 0 : 1;
      return av - bv || a.name.localeCompare(b.name);
    });
  }, [region, visited]);

  function toggleManual(iso2) {
    if (!COUNTRY_BY_ISO[iso2]) return;
    const entry = visited[iso2];
    // A country earned by a completed trip can't be un-ticked here —
    // it belongs to the trip, and the trip is the source of truth.
    if (entry && entry.trips.length) { setPicked(iso2); return; }
    update(prev => {
      const cur = prev.visitedExtra || [];
      const next = cur.includes(iso2) ? cur.filter(c => c !== iso2) : [...cur, iso2];
      return { ...prev, visitedExtra: next };
    });
    setPicked(iso2);
  }

  const count = isoList.length;
  const detail = picked ? visited[picked] : null;

  return (
    <div className="hol-visited">
      <div className="hol-visited-stats">
        <div className="hol-visited-stat"><b>{count}</b><span>countries</span></div>
        <div className="hol-visited-stat"><b>{visitedPct(count)}%</b><span>of the world</span></div>
        <div className="hol-visited-stat">
          <b>{Object.values(visited).reduce((s, v) => s + v.trips.length, 0)}</b><span>logged trips</span>
        </div>
        <div className="hol-visited-regions">
          {Object.entries(byRegion).map(([r, v]) => (
            <span key={r} className="hol-visited-region">{r} <b>{v.been}/{v.total}</b></span>
          ))}
        </div>
      </div>

      <WorldMap view="world" fills={fills} onPick={toggleManual} height={430} />

      {detail && (
        <div className="hol-visited-detail">
          <b>{detail.name}</b>
          {detail.trips.length > 0
            ? <> — {detail.trips.length} trip{detail.trips.length > 1 ? 's' : ''}
                {detail.years.length ? ` (${detail.years.join(', ')})` : ''}</>
            : <> — marked visited manually</>}
          {detail.trips.length > 0 && <span className="hol-visited-detail-note">From completed trips — edit on the Trips tab.</span>}
        </div>
      )}
      {picked && !detail && (
        <div className="hol-visited-detail">
          <b>{COUNTRY_BY_ISO[picked]?.name}</b> — not visited. Tap again on the map to mark it.
        </div>
      )}

      <div className="hol-visited-listwrap">
        <div className="hol-visited-filter">
          {regions.map(r => (
            <button
              key={r}
              type="button"
              className={`hol-chip${region === r ? ' is-active' : ''}`}
              onClick={() => setRegion(r)}
            >{r === 'all' ? 'All' : r}</button>
          ))}
        </div>
        <div className="hol-visited-list">
          {listed.map(c => {
            const v = visited[c.iso2];
            return (
              <button
                key={c.iso2}
                type="button"
                className={`hol-visited-item${v ? ' is-been' : ''}`}
                onClick={() => toggleManual(c.iso2)}
                title={v?.trips.length ? 'From a completed trip' : 'Tap to toggle'}
              >
                {v && <Icon name="check" size={12} />}
                <span>{c.name}</span>
                {v?.trips.length > 0 && <em>{v.trips.length}</em>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="hol-visited-hint">
        Countries fill in automatically when a trip is marked <strong>Completed</strong>.
        Tap any country to add somewhere you went before you started logging trips.
      </div>
    </div>
  );
}

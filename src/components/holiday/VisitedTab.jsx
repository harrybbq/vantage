import { Fragment, useMemo, useState } from 'react';
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
  // Region chips alone can't find one country among 195 on a phone —
  // "Vietnam" is a long way down Asia. Not persisted: it's a way of
  // looking at the list for a moment, not a setting.
  const [query, setQuery] = useState('');

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
    const q = query.trim().toLowerCase();
    let all = region === 'all' ? ALL_COUNTRIES : ALL_COUNTRIES.filter(c => c.region === region);
    if (q) all = all.filter(c => c.name.toLowerCase().includes(q) || c.iso2.toLowerCase() === q);
    return [...all].sort((a, b) => {
      const av = visited[a.iso2] ? 0 : 1, bv = visited[b.iso2] ? 0 : 1;
      return av - bv || a.name.localeCompare(b.name);
    });
  }, [region, visited, query]);

  // The list is sorted visited-first, so one divider is enough to say
  // where "been" ends and "not been" begins — clearer than reading tick
  // marks down a two-column grid.
  const beenCount = useMemo(() => listed.filter(c => visited[c.iso2]).length, [listed, visited]);

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
      </div>

      {/* Region progress as bars rather than a run-on line of counts —
          "3/59 Africa" means little until you can see it against the
          others. */}
      <div className="hol-visited-regions">
        {Object.entries(byRegion).map(([r, v]) => (
          <button
            key={r}
            type="button"
            className={`hol-visited-region${region === r ? ' is-active' : ''}`}
            onClick={() => setRegion(region === r ? 'all' : r)}
            aria-pressed={region === r}
          >
            <span className="hol-visited-region-name">{r}</span>
            <span className="hol-visited-region-bar">
              <i style={{ width: `${v.total ? (v.been / v.total) * 100 : 0}%` }} />
            </span>
            <b>{v.been}<em>/{v.total}</em></b>
          </button>
        ))}
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
        <div className="hol-visited-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Find a country…"
            aria-label="Search countries"
          />
          {query && (
            <button type="button" className="hol-visited-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
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
        {listed.length === 0 ? (
          <div className="hol-visited-none">No country matches “{query}”.</div>
        ) : (
          <div className="hol-visited-list">
            {listed.map((c, i) => {
              const v = visited[c.iso2];
              return (
                <Fragment key={c.iso2}>
                  {i === beenCount && beenCount > 0 && (
                    <div className="hol-visited-divider">Not been yet</div>
                  )}
                  <button
                    type="button"
                    className={`hol-visited-item${v ? ' is-been' : ''}`}
                    onClick={() => toggleManual(c.iso2)}
                    title={v?.trips.length ? 'From a completed trip' : 'Tap to toggle'}
                  >
                    {v ? <Icon name="check" size={12} /> : <span className="hol-visited-item-dot" aria-hidden="true" />}
                    <span>{c.name}</span>
                    {v?.trips.length > 0 && <em>{v.trips.length}</em>}
                  </button>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="hol-visited-hint">
        Countries fill in automatically when a trip is marked <strong>Completed</strong>.
        Tap any country to add somewhere you went before you started logging trips.
      </div>
    </div>
  );
}

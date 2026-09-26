import { useMemo, useState } from 'react';
import Icon from '../Icon';
import WorldMap from './WorldMap';
import { visitedCountries, visitedPct, countryForTrip, ALL_COUNTRIES, COUNTRY_BY_ISO } from '../../lib/holiday/destinations';
import { upcomingNew } from '../../lib/holiday/visited';
import { fmt } from '../../lib/holiday/timeline';

/**
 * Countries visited — the third use of the shared WorldMap.
 *
 * Auto-derived from COMPLETED trips (so marking a trip complete on the
 * Trips tab fills the map in for free), plus manual ticks for anywhere
 * you went before you started logging trips here. The two are stored
 * separately: deleting a trip must never silently erase a country you
 * added by hand.
 *
 * ── Layout (26 Sep cleanup) ─────────────────────────────────────────
 * Three blocks, each saying one thing:
 *   1. The count — how much of the world, with the regions beside it.
 *      The regions are also the filter; the old second row of region
 *      chips said the same thing twice and is gone.
 *   2. The map — the picked country's card sits ON the map, so tapping
 *      a country no longer shoves the list down the page.
 *   3. The list — where you've been, always. The ~200 places you
 *      haven't are folded away until you search, pick a region or ask
 *      for them: on a phone they made this tab six thousand pixels long.
 *
 * Countries a planned trip is heading to, that you have not been yet,
 * are tinted in the accent green — the map shows where you are about to
 * add, not only where you have. They are not counted as visited until
 * the trip is marked Completed.
 */
export default function VisitedTab({ S, update }) {
  const [region, setRegion] = useState('all');
  const [picked, setPicked] = useState(null);
  // Not persisted: a way of looking at the list for a moment, not a setting.
  const [query, setQuery] = useState('');
  const [showRest, setShowRest] = useState(false);

  const visited = useMemo(() => visitedCountries(S), [S]);
  const isoList = useMemo(() => Object.keys(visited), [visited]);

  const upcoming = useMemo(
    () => upcomingNew(S.holidays, visited, countryForTrip, new Date()),
    [S.holidays, visited],
  );
  const upcomingN = Object.keys(upcoming).length;

  const fills = useMemo(() => {
    const f = {};
    for (const iso2 of Object.keys(upcoming)) f[iso2] = 'upcoming';
    for (const iso2 of isoList) f[iso2] = 'accent';
    return f;
  }, [isoList, upcoming]);

  const byRegion = useMemo(() => {
    const counts = {};
    for (const c of ALL_COUNTRIES) {
      if (!c.region) continue;
      counts[c.region] = counts[c.region] || { total: 0, been: 0 };
      counts[c.region].total++;
      if (visited[c.iso2]) counts[c.region].been++;
    }
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visited]);

  const { been, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let all = region === 'all' ? ALL_COUNTRIES : ALL_COUNTRIES.filter(c => c.region === region);
    if (q) all = all.filter(c => c.name.toLowerCase().includes(q) || c.iso2.toLowerCase() === q);
    const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
    return { been: sorted.filter(c => visited[c.iso2]), rest: sorted.filter(c => !visited[c.iso2]) };
  }, [region, visited, query]);

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
  const pct = visitedPct(count);
  const tripCount = Object.values(visited).reduce((s, v) => s + v.trips.length, 0);
  const detail = picked ? visited[picked] : null;
  const pickedName = picked ? COUNTRY_BY_ISO[picked]?.name : '';
  const narrowed = !!query.trim() || region !== 'all';
  const restOpen = showRest || narrowed;

  const item = (c, isBeen) => {
    const v = visited[c.iso2];
    const next = !isBeen && upcoming[c.iso2];
    return (
      <button
        key={c.iso2}
        type="button"
        className={`hv-item${isBeen ? ' is-been' : ''}${next ? ' is-next' : ''}${picked === c.iso2 ? ' is-picked' : ''}`}
        onClick={() => toggleManual(c.iso2)}
        title={v?.trips.length ? 'From a completed trip' : isBeen ? 'Tap to remove' : 'Tap to mark visited'}
      >
        {isBeen ? <Icon name="check" size={12} /> : <Icon name="plus" size={12} />}
        <span className="hv-item-name">{c.name}</span>
        {v?.years.length > 0 && <em>{v.years[v.years.length - 1]}</em>}
        {next && <em className="hv-item-next">Coming up</em>}
      </button>
    );
  };

  return (
    <div className="hol-visited">
      {/* ── 1. The count ── */}
      <section className="hv-summary">
        <div className="hv-headline">
          <span className="hv-eyebrow">Countries visited</span>
          <div className="hv-big">
            <b>{count}</b>
            <span>of {ALL_COUNTRIES.length}</span>
          </div>
          <div className="hv-world" aria-hidden="true"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
          <div className="hv-sub">
            <span><b>{pct}%</b> of the world</span>
            <span><b>{tripCount}</b> trip{tripCount === 1 ? '' : 's'} logged</span>
            {upcomingN > 0 && (
              <span className="hv-sub-new"><b>+{upcomingN}</b> on the way</span>
            )}
          </div>
        </div>

        <div className="hv-regions" role="group" aria-label="Filter by region">
          {byRegion.map(([r, v]) => (
            <button
              key={r}
              type="button"
              className={`hv-region${region === r ? ' is-active' : ''}${v.been ? '' : ' is-none'}`}
              onClick={() => setRegion(region === r ? 'all' : r)}
              aria-pressed={region === r}
            >
              <span className="hv-region-top">
                <span className="hv-region-name">{r}</span>
                <b>{v.been}<em>/{v.total}</em></b>
              </span>
              <span className="hv-region-bar">
                <i style={{ width: `${v.total ? (v.been / v.total) * 100 : 0}%` }} />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── 2. The map, with the picked country on it ── */}
      <div className="hv-mapcard">
        {/* A tap on the map picks; the card's button changes the data.
            Tapping used to toggle outright, so a stray tap while panning
            added a country you had never been to. */}
        <WorldMap view="world" fills={fills} onPick={iso2 => COUNTRY_BY_ISO[iso2] && setPicked(iso2)} height={430} />
        <div className="hv-legend" aria-hidden="true">
          <span className="is-been">Been</span>
          {upcomingN > 0 && <span className="is-next">Coming up</span>}
        </div>
        {picked && (
          <div className="hv-picked" role="status">
            <span className={`hv-picked-dot${detail ? ' is-been' : upcoming[picked] ? ' is-next' : ''}`} aria-hidden="true" />
            <span className="hv-picked-text">
              <b>{pickedName}</b>
              <span>
                {detail
                  ? detail.trips.length
                    ? `${detail.trips.length} trip${detail.trips.length > 1 ? 's' : ''}${detail.years.length ? ' · ' + detail.years.join(', ') : ''} — from the Trips tab`
                    : 'Added by you'
                  : upcoming[picked]
                    ? `Coming up — ${upcoming[picked].next.dest || 'a trip'}${upcoming[picked].next.from ? ', ' + fmt(upcoming[picked].next.from, { day: 'numeric', month: 'short' }) : ''}`
                    : 'Not visited'}
              </span>
            </span>
            {!(detail && detail.trips.length) && (
              <button type="button" className="hv-picked-act" onClick={() => toggleManual(picked)}>
                {detail ? 'Remove' : 'Mark visited'}
              </button>
            )}
            <button type="button" className="hv-picked-x" onClick={() => setPicked(null)} aria-label="Close">
              <Icon name="x" size={13} />
            </button>
          </div>
        )}
      </div>

      {/* ── 3. The list ── */}
      <section className="hv-list">
        <div className="hv-list-head">
          <div className="hv-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a country…"
              aria-label="Search countries"
            />
            {query && (
              <button type="button" className="hv-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          {region !== 'all' && (
            <button type="button" className="hv-scope" onClick={() => setRegion('all')}>
              {region} <Icon name="x" size={11} />
            </button>
          )}
        </div>

        {been.length === 0 && rest.length === 0 ? (
          <div className="hv-none">No country matches “{query}”.</div>
        ) : (
          <>
            {been.length > 0 && (
              <>
                <div className="hv-group"><span>Been</span><em>{been.length}</em></div>
                <div className="hv-grid">{been.map(c => item(c, true))}</div>
              </>
            )}
            {rest.length > 0 && (restOpen ? (
              <>
                <div className="hv-group">
                  <span>Not yet</span><em>{rest.length}</em>
                  {showRest && !narrowed && (
                    <button type="button" className="hv-group-act" onClick={() => setShowRest(false)}>Hide</button>
                  )}
                </div>
                <div className="hv-grid is-rest">{rest.map(c => item(c, false))}</div>
              </>
            ) : (
              <button type="button" className="hv-more" onClick={() => setShowRest(true)}>
                <Icon name="plus" size={13} />
                Add somewhere else
                <em>{rest.length} not visited yet</em>
              </button>
            ))}
          </>
        )}

        <p className="hv-hint">
          Countries fill in when a trip is marked <strong>Completed</strong>. To add somewhere you went before
          you started logging trips, pick it on the map or tap it in the list.
        </p>
      </section>
    </div>
  );
}

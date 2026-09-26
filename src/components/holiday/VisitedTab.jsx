import { useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * ── Motion (approved from the Visited Motion Preview, 26 Sep) ────────
 *   arrival  — the count rolls up, the bars fill, the map inks in west
 *              to east and the list settles in behind it. Once a mount.
 *   stamp    — marking a country thumps it down with a ring (WorldMap
 *              `stamp`), rolls the count and pops the new list row.
 *   fly      — picking a region flies the map to it and dims the rest.
 *   breathe  — coming-up countries glow slowly (CSS).
 *   card     — the country card rises; its text swaps in place.
 *   unfold   — "Add somewhere else" cascades the rows in.
 * All of it stands down under prefers-reduced-motion.
 */

/* Map framing per region, as [lonW, latN, lonE, latS]. Hand-set rather
   than derived: Oceania's Pacific islands straddle the date line, and a
   bounding box of Russia would put all of Europe in a corner. */
const REGION_VIEW = {
  Africa: [-20, 38, 55, -36],
  Americas: [-170, 72, -30, -56],
  Asia: [25, 56, 150, -11],
  Europe: [-25, 71, 45, 34],
  Oceania: [110, 0, 180, -48],
  Antarctic: [-70, -40, 180, -60],
};

const reduced = () => typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that rolls to its new value: from 0 on first mount (the
 *  arrival), from the old value after (a stamp). */
function RollNumber({ value }) {
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return undefined; }
    const a = from.current, ms = a === 0 ? 700 : 400, t0 = performance.now();
    let raf = 0;
    const step = t => {
      const k = Math.min(1, (t - t0) / ms);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <b>{shown}</b>;
}

export default function VisitedTab({ S, update }) {
  const [region, setRegion] = useState('all');
  const [picked, setPicked] = useState(null);
  // Not persisted: a way of looking at the list for a moment, not a setting.
  const [query, setQuery] = useState('');
  const [showRest, setShowRest] = useState(false);
  // Motion state. `arriving` scopes the arrival cascade to the first
  // moments of the mount; `stamp` is bumped to thump a country on the map.
  const [arriving, setArriving] = useState(() => !reduced());
  const [stamp, setStamp] = useState(null);
  const [justAdded, setJustAdded] = useState(null);
  const [unfolding, setUnfolding] = useState(false);
  useEffect(() => {
    if (!arriving) return undefined;
    const tm = setTimeout(() => setArriving(false), 1600);
    return () => clearTimeout(tm);
  }, [arriving]);

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
    if (!entry) {
      const c = COUNTRY_BY_ISO[iso2];
      setStamp(st => ({ iso2, lat: c.lat, lon: c.lon, n: (st?.n || 0) + 1 }));
      setJustAdded(iso2);
    } else if (justAdded === iso2) setJustAdded(null);
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

  const highlight = useMemo(() => (region === 'all' ? null
    : new Set(ALL_COUNTRIES.filter(c => c.region === region).map(c => c.iso2))), [region]);
  const focus = region === 'all' ? null : REGION_VIEW[region] || null;

  function unfold() {
    setShowRest(true);
    if (!reduced()) {
      setUnfolding(true);
      setTimeout(() => setUnfolding(false), 900);
    }
  }

  const item = (c, isBeen, i) => {
    const v = visited[c.iso2];
    const next = !isBeen && upcoming[c.iso2];
    return (
      <button
        key={c.iso2}
        type="button"
        className={`hv-item${isBeen ? ' is-been' : ''}${next ? ' is-next' : ''}${picked === c.iso2 ? ' is-picked' : ''}${
          isBeen && justAdded === c.iso2 ? ' is-stamped' : ''}`}
        style={{ '--i': Math.min(i, 40) }}
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
    <div className={`hol-visited${arriving ? ' is-arriving' : ''}`}>
      {/* ── 1. The count ── */}
      <section className="hv-summary">
        <div className="hv-headline">
          <span className="hv-eyebrow">Countries visited</span>
          <div className="hv-big">
            <RollNumber value={count} />
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
          {byRegion.map(([r, v], i) => (
            <button
              key={r}
              style={{ '--i': i }}
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
        <WorldMap
          view="world" fills={fills} height={430}
          onPick={iso2 => COUNTRY_BY_ISO[iso2] && setPicked(iso2)}
          focus={focus} highlight={highlight} stamp={stamp} inkIn
        />
        <div className="hv-legend" aria-hidden="true">
          <span className="is-been">Been</span>
          {upcomingN > 0 && <span className="is-next">Coming up</span>}
        </div>
        {picked && (
          <div className="hv-picked" role="status">
            <span className={`hv-picked-dot${detail ? ' is-been' : upcoming[picked] ? ' is-next' : ''}`} aria-hidden="true" />
            <span className="hv-picked-text" key={picked}>
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
                <div className="hv-grid">{been.map((c, i) => item(c, true, i))}</div>
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
                <div className={`hv-grid is-rest${unfolding ? ' is-unfold' : ''}`}>{rest.map((c, i) => item(c, false, i))}</div>
              </>
            ) : (
              <button type="button" className="hv-more" onClick={unfold}>
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

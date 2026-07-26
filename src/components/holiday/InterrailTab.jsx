import { useMemo, useState } from 'react';
import Icon from '../Icon';
import ProGate from '../ProGate';
import WorldMap from './WorldMap';
import { STATIONS, STATION_BY_ID } from '../../data/rail';
import { buildRoute, fmtMinutes, routeCountries, searchStations } from '../../lib/holiday/rail';
import { getPolicy, levelMap, flagsFor, POLICY_LEVELS } from '../../lib/holiday/policy';

/**
 * Interrail route planner.
 *
 * You pick stops in order; the graph solves the fastest path between
 * each consecutive pair, so you think in destinations and it works out
 * the changes. Routing is local (see src/lib/holiday/rail.js) — no
 * network call, so it works on a train with no signal, which is rather
 * the point.
 *
 * The clearance overlay is the same country-fill mechanism the Visited
 * tab uses, driven by the user's own S.travelPolicy lists.
 */

const TONE_FOR_LEVEL = { restricted: 'red', notify: 'amber', cleared: 'green' };

function RoutePlanner({ S, update }) {
  const [picks, setPicks] = useState([]);
  const [search, setSearch] = useState('');
  const [showPolicy, setShowPolicy] = useState(false);
  const [name, setName] = useState('');

  const policy = useMemo(() => getPolicy(S), [S]);
  const policyFills = useMemo(() => {
    if (!showPolicy) return {};
    const lm = levelMap(policy);
    const out = {};
    for (const [iso2, level] of Object.entries(lm)) out[iso2] = TONE_FOR_LEVEL[level];
    return out;
  }, [showPolicy, policy]);

  const route = useMemo(() => buildRoute(picks), [picks]);
  const countries = useMemo(() => routeCountries(route), [route]);
  const flags = useMemo(() => flagsFor(policy, countries), [policy, countries]);

  const results = useMemo(() => (search.trim() ? searchStations(search).slice(0, 8) : []), [search]);

  const pins = useMemo(() => STATIONS.map(s => ({
    id: s.id, lat: s.lat, lon: s.lon, label: s.name, active: picks.includes(s.id),
  })), [picks]);

  const lines = useMemo(() => route.legs.map(l => {
    const a = STATION_BY_ID[l.from], b = STATION_BY_ID[l.to];
    return { from: { lat: a.lat, lon: a.lon }, to: { lat: b.lat, lon: b.lon }, dashed: l.res };
  }), [route]);

  function addStop(id) {
    if (!STATION_BY_ID[id]) return;
    setPicks(p => (p[p.length - 1] === id ? p : [...p, id]));
    setSearch('');
  }
  function removeStop(i) {
    setPicks(p => p.filter((_, idx) => idx !== i));
  }

  function saveRoute() {
    if (picks.length < 2) return;
    const trip = {
      id: `rail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || `${STATION_BY_ID[picks[0]].name} → ${STATION_BY_ID[picks[picks.length - 1]].name}`,
      stops: picks,
      createdAt: new Date().toISOString(),
    };
    // Additive: appends to railTrips, touches nothing else in S.
    update(prev => ({ ...prev, railTrips: [...(prev.railTrips || []), trip] }));
    setName('');
  }

  function loadRoute(trip) {
    setPicks(trip.stops || []);
  }
  function deleteRoute(id) {
    update(prev => ({ ...prev, railTrips: (prev.railTrips || []).filter(t => t.id !== id) }));
  }

  const saved = S.railTrips || [];
  const nights = picks.length > 1 ? picks.length - 1 : 0;

  return (
    <div className="hol-rail">
      <div className="hol-rail-side">
        <div className="hol-rail-search">
          <Icon name="search" size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Add a stop — e.g. Ljubljana"
            aria-label="Search stations"
          />
        </div>
        {results.length > 0 && (
          <div className="hol-rail-results">
            {results.map(s => (
              <button key={s.id} type="button" className="hol-rail-result" onClick={() => addStop(s.id)}>
                <span>{s.name}</span><span className="hol-rail-result-c">{s.c}</span>
              </button>
            ))}
          </div>
        )}

        <div className="hol-rail-stops">
          {picks.length === 0 && (
            <div className="hol-rail-empty">
              Search above or tap a station on the map to start building a route.
            </div>
          )}
          {picks.map((id, i) => {
            const st = STATION_BY_ID[id];
            const segLegs = route.legs.filter(l => l.segment === i - 1);
            const segMin = segLegs.reduce((s, l) => s + l.min, 0);
            const changes = Math.max(0, segLegs.length - 1);
            return (
              <div key={`${id}-${i}`} className="hol-rail-stop">
                {i > 0 && (
                  <div className="hol-rail-leg">
                    <span className="hol-rail-leg-time">{segMin ? fmtMinutes(segMin) : '—'}</span>
                    {changes > 0 && <span className="hol-rail-leg-ch">{changes} change{changes > 1 ? 's' : ''}</span>}
                    {segLegs.some(l => l.res) && <span className="hol-rail-leg-res">reservation</span>}
                  </div>
                )}
                <div className="hol-rail-stop-row">
                  <span className="hol-rail-stop-n">{i + 1}</span>
                  <span className="hol-rail-stop-name">{st?.name || id}</span>
                  <span className="hol-rail-stop-c">{st?.c}</span>
                  <button type="button" className="hol-rail-stop-x" onClick={() => removeStop(i)} aria-label={`Remove ${st?.name}`}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {route.gaps.length > 0 && (
          <div className="hol-rail-gap">
            No rail link in the map data for{' '}
            {route.gaps.map(([a, b]) => `${STATION_BY_ID[a]?.name} → ${STATION_BY_ID[b]?.name}`).join(', ')}.
            You'll need a bus or ferry for that hop.
          </div>
        )}

        {flags.length > 0 && (
          <div className="hol-rail-flags">
            {flags.map(f => (
              <div key={f.iso2} className={`hol-flag hol-flag-${TONE_FOR_LEVEL[f.level]}`}>
                <Icon name={f.level === 'restricted' ? 'octagon-alert' : 'triangle-alert'} size={13} />
                {f.iso2} — {POLICY_LEVELS[f.level].short}
              </div>
            ))}
            <div className="hol-rail-flags-note">Your own list — confirm with vetting before booking.</div>
          </div>
        )}

        {picks.length > 1 && (
          <div className="hol-rail-save">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name this route (optional)"
              aria-label="Route name"
            />
            <button type="button" className="btn btn-primary" onClick={saveRoute}>Save route</button>
          </div>
        )}

        {saved.length > 0 && (
          <div className="hol-rail-saved">
            <div className="hol-rail-saved-title">Saved routes</div>
            {saved.map(t => (
              <div key={t.id} className="hol-rail-saved-row">
                <button type="button" className="hol-rail-saved-load" onClick={() => loadRoute(t)}>
                  {t.name}<span>{(t.stops || []).length} stops</span>
                </button>
                <button type="button" className="hol-rail-saved-x" onClick={() => deleteRoute(t.id)} aria-label={`Delete ${t.name}`}>
                  <Icon name="trash-2" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hol-rail-main">
        <div className="hol-rail-stats">
          <div className="hol-rail-stat"><b>{picks.length}</b><span>stops</span></div>
          <div className="hol-rail-stat"><b>{fmtMinutes(route.minutes)}</b><span>on trains</span></div>
          <div className="hol-rail-stat"><b>{route.legs.length}</b><span>legs</span></div>
          <div className="hol-rail-stat"><b>{route.reservations}</b><span>reservations</span></div>
          <div className="hol-rail-stat"><b>{countries.length}</b><span>countries</span></div>
          <div className="hol-rail-stat"><b>{nights}</b><span>min nights</span></div>
          <label className={`hol-rail-toggle${showPolicy ? ' is-on' : ''}`}>
            <input type="checkbox" checked={showPolicy} onChange={e => setShowPolicy(e.target.checked)} />
            Clearance
          </label>
        </div>

        <WorldMap
          view="europe"
          fills={policyFills}
          pins={pins}
          lines={lines}
          onPickPin={addStop}
          height={480}
        />

        {showPolicy && (
          <div className="hol-map-legend">
            {Object.values(POLICY_LEVELS).map(l => (
              <span key={l.key} className={`hol-legend-item hol-legend-${l.tone}`}>{l.label}</span>
            ))}
            <span className="hol-legend-item hol-legend-none">Unlisted</span>
            <span className="hol-legend-note">From your list in Settings → Travel policy.</span>
          </div>
        )}

        <div className="hol-rail-disclaimer">
          Journey times are typical direct-service estimates for planning, not live timetables.
          Check the operator before booking.
        </div>
      </div>
    </div>
  );
}

function RailTeaser() {
  return (
    <div className="hol-rail-teaser">
      <div className="hol-rail-teaser-icon"><Icon name="train-front" size={26} strokeWidth={1.5} /></div>
      <div className="hol-rail-teaser-title">Interrail planner</div>
      <p>
        Chain European cities into a rail route on the map — fastest connections, changes,
        which legs need a compulsory reservation, and how many countries you'd cross.
      </p>
      <p className="hol-rail-teaser-pro">Coming with Pro.</p>
    </div>
  );
}

export default function InterrailTab({ S, update }) {
  return (
    <ProGate teaser={<RailTeaser />} upgradeCta={<RailTeaser />}>
      <RoutePlanner S={S} update={update} />
    </ProGate>
  );
}

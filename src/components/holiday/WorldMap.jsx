import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Shared SVG world map.
 *
 * Renders three different features (Interrail routing, the clearance
 * overlay, and countries-visited) from one component — building it once
 * and reusing it is what justifies carrying map geometry at all.
 *
 * Why SVG over Leaflet/MapLibre: no tile requests, no external host, it
 * inherits the app's theme variables like any other element, and the
 * main bundle already trips Vite's 500 kB warning. The geometry itself
 * is lazy-loaded on first render (~40 kB gzipped), so the Holiday page
 * only pays for it when a map tab is actually opened.
 *
 * Props:
 *   fills      — { ISO2: 'red'|'amber'|'green'|'accent' } country tints
 *   pins       — [{ id, lat, lon, label, active }]
 *   lines      — [{ from: {lat,lon}, to: {lat,lon}, dashed }]
 *   view       — 'europe' | 'world'
 *   onPick     — (iso2) => void, country click
 *   onPickPin  — (id) => void
 */

// Equirectangular. Fine for this: no area/route computation depends on
// the projection, and it keeps the inverse trivial for hit-testing.
const LON_MIN = -180, LON_MAX = 180, LAT_MAX = 84, LAT_MIN = -60;
const SRC_W = 1000;
const SRC_H = SRC_W * ((LAT_MAX - LAT_MIN) / (LON_MAX - LON_MIN));

export function project(lat, lon) {
  return [
    ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * SRC_W,
    ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * SRC_H,
  ];
}

// Framing per view, in projected units.
const VIEWS = {
  europe: (() => {
    const [x1, y1] = project(72, -12);
    const [x2, y2] = project(34, 42);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  })(),
  world: { x: 0, y: 0, w: SRC_W, h: SRC_H },
};

const TONE_VAR = {
  red:    'var(--holiday-map-red, #e5484d)',
  amber:  'var(--holiday-map-amber, #f5a524)',
  green:  'var(--holiday-map-green, #2fa96b)',
  accent: 'var(--gold, #d4af37)',
};

export default function WorldMap({
  fills = {},
  pins = [],
  lines = [],
  view = 'europe',
  onPick,
  onPickPin,
  height = 460,
  children,
}) {
  const [geo, setGeo] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const svgRef = useRef(null);

  // Lazy-load the geometry so it never lands in the initial bundle.
  useEffect(() => {
    let alive = true;
    import('../../data/worldLow.json')
      .then(m => { if (alive) setGeo(m.default || m); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Reset framing when the caller switches view.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [view]);

  const base = VIEWS[view] || VIEWS.europe;
  const box = useMemo(() => {
    const w = base.w / zoom, h = base.h / zoom;
    const cx = base.x + base.w / 2 + pan.x;
    const cy = base.y + base.h / 2 + pan.y;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [base, zoom, pan]);

  // One "screen unit" in viewBox coordinates. The Europe view is only
  // ~150 units wide but renders ~800px, so anything sized in raw
  // viewBox units comes out ~5x too big — and would also change size
  // when zooming. Scaling by the box width keeps pins, labels and
  // strokes visually constant at every view and zoom level.
  const u = box.w / 900;

  const paths = useMemo(() => {
    if (!geo) return [];
    return geo.polys.map(country => {
      let d = '';
      for (const poly of country.polys) {
        for (const ring of poly) {
          d += 'M' + ring.map(([lon, lat]) => project(lat, lon).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
        }
      }
      return { iso2: country.iso2, name: country.name, d };
    });
  }, [geo]);

  function onWheel(e) {
    e.preventDefault();
    setZoom(z => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
  }
  function onDown(e) {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { x: p.clientX, y: p.clientY, pan, moved: false };
  }
  function onMove(e) {
    if (!drag.current) return;
    const p = e.touches ? e.touches[0] : e;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (p.clientX - drag.current.x) * (box.w / rect.width);
    const dy = (p.clientY - drag.current.y) * (box.h / rect.height);
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.current.moved = true;
    setPan({ x: drag.current.pan.x - dx, y: drag.current.pan.y - dy });
  }
  function onUp() { drag.current = null; }

  // A drag that ends over a country must not also select it.
  function pick(iso2) {
    if (drag.current?.moved) return;
    onPick?.(iso2);
  }

  if (failed) {
    return <div className="hol-map-fallback">Map unavailable offline — the planner still works without it.</div>;
  }

  return (
    <div className="hol-map-wrap" style={{ height }}>
      <svg
        ref={svgRef}
        className="hol-map"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid slice"
        onWheel={onWheel}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        role="img"
        aria-label="World map"
      >
        {paths.map(p => {
          const tone = fills[p.iso2];
          return (
            <path
              key={p.iso2}
              d={p.d}
              className={`hol-map-country${tone ? ' is-filled' : ''}${onPick ? ' is-pickable' : ''}`}
              /* Inline style, not a `fill` attribute: presentation
                 attributes lose to the class's own fill rule. */
              style={tone ? { fill: TONE_VAR[tone] || tone } : undefined}
              strokeWidth={0.5 * u}
              onClick={() => pick(p.iso2)}
            >
              <title>{p.name}</title>
            </path>
          );
        })}

        {lines.map((l, i) => {
          const [x1, y1] = project(l.from.lat, l.from.lon);
          const [x2, y2] = project(l.to.lat, l.to.lon);
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              className={`hol-map-line${l.dashed ? ' is-dashed' : ''}`}
              strokeWidth={2.6 * u}
            />
          );
        })}

        {pins.map(p => {
          const [x, y] = project(p.lat, p.lon);
          return (
            <g
              key={p.id}
              className={`hol-map-pin${p.active ? ' is-active' : ''}`}
              onClick={e => { e.stopPropagation(); if (!drag.current?.moved) onPickPin?.(p.id); }}
            >
              {/* Invisible fat target — the dot itself is too small to tap. */}
              <circle cx={x} cy={y} r={10 * u} fill="transparent" />
              <circle cx={x} cy={y} r={(p.active ? 4.4 : 2.6) * u} className="hol-map-pin-dot" />
              {(p.active || zoom > 2.4) && (
                <text x={x} y={y - 8 * u} fontSize={11 * u} className="hol-map-pin-label">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="hol-map-zoom">
        <button type="button" onClick={() => setZoom(z => Math.min(8, z * 1.4))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setZoom(z => Math.max(1, z / 1.4))} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset view">⟲</button>
      </div>
      {!geo && <div className="hol-map-loading">Loading map…</div>}
      {children}
    </div>
  );
}

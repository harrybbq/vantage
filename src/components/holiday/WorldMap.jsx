import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
 * ── Touch contract ──────────────────────────────────────────────────
 * The map lives mid-column on a page that scrolls, so it cannot own
 * every gesture:
 *
 *   one finger, drag   → the PAGE scrolls (touch-action: pan-y). A hint
 *                        appears saying to use two fingers, the way an
 *                        embedded Google map does.
 *   one finger, tap    → selects the nearest station, or the country
 *                        under the finger.
 *   two fingers        → pan and pinch-zoom the map, anchored on the
 *                        midpoint between them.
 *   double tap         → zoom in on the tapped point.
 *   mouse              → unchanged: drag to pan, wheel to zoom at the
 *                        cursor.
 *
 * It used to be touch-action:none with a single-finger pan, which meant
 * a thumb landing anywhere on a 320px-tall map trapped the page scroll,
 * and pinch did nothing at all (the old handler read touches[0] only,
 * so a second finger just made the map lurch).
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

const MIN_ZOOM = 1, MAX_ZOOM = 12;
// How far from a station a tap still counts, in SCREEN pixels. The old
// per-pin hit circle worked out at ~8px across on a phone — 105 stations
// share the Europe view, so a finger could not reliably land on one.
// Nearest-within-radius gives a target you can actually hit without the
// shapes overlapping each other.
const TAP_SLOP_PX = 24;
// Movement past this (screen px) is a drag, not a tap.
const DRAG_SLOP_PX = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
  // zoom + pan travel together: every gesture changes both, and keeping
  // them in one object makes each update atomic and clampable.
  const [t, setT] = useState({ zoom: 1, x: 0, y: 0 });
  const [hint, setHint] = useState(false);
  const [pinching, setPinching] = useState(false);
  const svgRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(0);
  const hintTimer = useRef(null);

  // Lazy-load the geometry so it never lands in the initial bundle.
  useEffect(() => {
    let alive = true;
    import('../../data/worldLow.json')
      .then(m => { if (alive) setGeo(m.default || m); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Reset framing when the caller switches view.
  useEffect(() => { setT({ zoom: 1, x: 0, y: 0 }); }, [view]);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const base = VIEWS[view] || VIEWS.europe;

  /** Visible window in projected units for a given transform. */
  const boxFor = useCallback((tr) => {
    const w = base.w / tr.zoom, h = base.h / tr.zoom;
    return { x: base.x + base.w / 2 + tr.x - w / 2, y: base.y + base.h / 2 + tr.y - h / 2, w, h };
  }, [base]);

  const box = useMemo(() => boxFor(t), [boxFor, t]);

  /** Keep the visible window on the planet. Panning used to be
   *  unbounded, so a flick could leave you looking at empty space with
   *  no way back but the reset button. */
  const clampT = useCallback((tr) => {
    const zoom = clamp(tr.zoom, MIN_ZOOM, MAX_ZOOM);
    const w = base.w / zoom, h = base.h / zoom;
    const cx = base.x + base.w / 2, cy = base.y + base.h / 2;
    const loX = w / 2 - cx, hiX = SRC_W - w / 2 - cx;
    const loY = h / 2 - cy, hiY = SRC_H - h / 2 - cy;
    return {
      zoom,
      x: w >= SRC_W ? (SRC_W / 2 - cx) : clamp(tr.x, loX, hiX),
      y: h >= SRC_H ? (SRC_H / 2 - cy) : clamp(tr.y, loY, hiY),
    };
  }, [base]);

  // One "screen unit" in viewBox coordinates. The Europe view is only
  // ~150 units wide but renders ~800px, so anything sized in raw
  // viewBox units comes out ~5x too big — and would also change size
  // when zooming. Scaling by the box width keeps pins, labels and
  // strokes visually constant at every view and zoom level.
  const u = box.w / 900;

  /** Client coords → projected coords. preserveAspectRatio is
   *  "xMidYMid slice", so the viewBox COVERS the element and one axis is
   *  cropped — the naive rect.width/box.w ratio would be wrong on the
   *  cropped axis, and that error is exactly what a tap-to-select needs
   *  to not have. */
  const toMap = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    const scale = Math.max(rect.width / box.w, rect.height / box.h);
    const offX = (rect.width - box.w * scale) / 2;
    const offY = (rect.height - box.h * scale) / 2;
    return {
      x: box.x + (clientX - rect.left - offX) / scale,
      y: box.y + (clientY - rect.top - offY) / scale,
      scale,
    };
  }, [box]);

  /** Zoom by `factor`, keeping whatever sits under (clientX, clientY)
   *  under it — anchored zoom, which is what makes pinch feel attached
   *  to your fingers rather than to the middle of the box. */
  const zoomAt = useCallback((factor, clientX, clientY) => {
    setT(prev => {
      const b = boxFor(prev);
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return prev;
      const scale = Math.max(rect.width / b.w, rect.height / b.h);
      const offX = (rect.width - b.w * scale) / 2;
      const offY = (rect.height - b.h * scale) / 2;
      const px = b.x + (clientX - rect.left - offX) / scale;
      const py = b.y + (clientY - rect.top - offY) / scale;
      const fx = (px - b.x) / b.w, fy = (py - b.y) / b.h;

      const zoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const nw = base.w / zoom, nh = base.h / zoom;
      const nx = px - fx * nw, ny = py - fy * nh;
      return clampT({
        zoom,
        x: nx + nw / 2 - (base.x + base.w / 2),
        y: ny + nh / 2 - (base.y + base.h / 2),
      });
    });
  }, [base, boxFor, clampT]);

  const flashHint = useCallback(() => {
    setHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 1900);
  }, []);

  // ── Gestures ──────────────────────────────────────────────────────
  const touchPoints = () => [...pointers.current.values()].filter(p => p.type !== 'mouse');

  function onPointerDown(e) {
    pointers.current.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY });
    const touches = touchPoints();

    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      svgRef.current?.setPointerCapture?.(e.pointerId);
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, t, moved: 0 };
      return;
    }

    if (touches.length === 2) {
      // Second finger: take over from the page and start a pinch.
      const [a, b] = touches;
      gesture.current = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        t, moved: 0,
      };
      setPinching(true);
      setHint(false);
    } else if (touches.length === 1) {
      // Stay out of the way: the page may want to scroll. Only remember
      // enough to tell a tap from a drag later.
      gesture.current = { kind: 'tap', x: e.clientX, y: e.clientY, moved: 0 };
    }
  }

  function onPointerMove(e) {
    const rec = pointers.current.get(e.pointerId);
    if (rec) { rec.x = e.clientX; rec.y = e.clientY; }
    const g = gesture.current;
    if (!g) return;

    if (g.kind === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = (e.clientX - g.x) * (box.w / rect.width);
      const dy = (e.clientY - g.y) * (box.h / rect.height);
      g.moved = Math.max(g.moved, Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y));
      setT(clampT({ zoom: g.t.zoom, x: g.t.x - dx, y: g.t.y - dy }));
      return;
    }

    if (g.kind === 'pinch') {
      const touches = touchPoints();
      if (touches.length < 2) return;
      const [a, b] = touches;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Zoom about the midpoint, then translate by how far the midpoint
      // itself moved — so a two-finger drag pans and a spread zooms,
      // and doing both at once works.
      const ratio = dist / g.dist;
      const bx = base.w / g.t.zoom, by = base.h / g.t.zoom;
      const zoom = clamp(g.t.zoom * ratio, MIN_ZOOM, MAX_ZOOM);
      const nw = base.w / zoom, nh = base.h / zoom;

      const scale = Math.max(rect.width / bx, rect.height / by);
      const b0 = boxFor(g.t);
      const offX = (rect.width - bx * scale) / 2;
      const offY = (rect.height - by * scale) / 2;
      const px = b0.x + (g.mid.x - rect.left - offX) / scale;
      const py = b0.y + (g.mid.y - rect.top - offY) / scale;
      const fx = (px - b0.x) / bx, fy = (py - b0.y) / by;

      const dragX = (mid.x - g.mid.x) * (nw / rect.width);
      const dragY = (mid.y - g.mid.y) * (nh / rect.height);
      const nx = px - fx * nw - dragX, ny = py - fy * nh - dragY;

      g.moved = Math.max(g.moved, Math.abs(dist - g.dist));
      setT(clampT({
        zoom,
        x: nx + nw / 2 - (base.x + base.w / 2),
        y: ny + nh / 2 - (base.y + base.h / 2),
      }));
      return;
    }

    if (g.kind === 'tap') {
      g.moved = Math.max(g.moved, Math.abs(e.clientX - g.x) + Math.abs(e.clientY - g.y));
      // A one-finger drag is the page's to handle. Say so once, rather
      // than silently doing nothing.
      if (g.moved > DRAG_SLOP_PX * 2) flashHint();
    }
  }

  /** Nearest station within TAP_SLOP_PX of the tap, in screen pixels. */
  function nearestPin(clientX, clientY) {
    if (!onPickPin || !pins.length) return null;
    const m = toMap(clientX, clientY);
    if (!m) return null;
    let best = null, bestD = Infinity;
    for (const p of pins) {
      const [px, py] = project(p.lat, p.lon);
      const d = Math.hypot(px - m.x, py - m.y) * m.scale;
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD <= TAP_SLOP_PX ? best : null;
  }

  function endGesture(e) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (e.pointerType === 'mouse') svgRef.current?.releasePointerCapture?.(e.pointerId);

    if (touchPoints().length < 2 && pinching) setPinching(false);

    if (g && (g.kind === 'tap' || g.kind === 'pan') && g.moved <= DRAG_SLOP_PX) {
      // Double tap zooms in on the spot, like every other map.
      const now = Date.now();
      if (e.pointerType !== 'mouse' && now - lastTap.current < 300) {
        lastTap.current = 0;
        zoomAt(1.8, e.clientX, e.clientY);
      } else {
        lastTap.current = now;
        const pin = nearestPin(e.clientX, e.clientY);
        if (pin) {
          onPickPin(pin.id);
        } else if (onPick) {
          // Hit-testing by element, so small countries stay selectable
          // without inventing a second geometry for touch.
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const iso2 = el?.closest?.('[data-iso2]')?.getAttribute('data-iso2');
          if (iso2) onPick(iso2);
        }
      }
    }
    if (touchPoints().length === 0 || g?.kind !== 'pinch') gesture.current = null;
  }

  function onPointerCancel(e) {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setPinching(false);
  }

  function onWheel(e) {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }

  const zoomButton = (factor) => () => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

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
        /* pan-y hands vertical swipes back to the page so the map can't
           trap the scroll; once a second finger lands we take the whole
           gesture for the pinch. */
        style={{ touchAction: pinching ? 'none' : 'pan-y' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerLeave={e => { if (e.pointerType === 'mouse') endGesture(e); }}
        onPointerCancel={onPointerCancel}
        role="img"
        aria-label="World map"
      >
        {paths(geo).map(p => {
          const tone = fills[p.iso2];
          return (
            <path
              key={p.iso2}
              d={p.d}
              data-iso2={p.iso2}
              className={`hol-map-country${tone ? ' is-filled' : ''}${onPick ? ' is-pickable' : ''}`}
              /* Inline style, not a `fill` attribute: presentation
                 attributes lose to the class's own fill rule. */
              style={tone ? { fill: TONE_VAR[tone] || tone } : undefined}
              strokeWidth={0.5 * u}
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
            <g key={p.id} className={`hol-map-pin${p.active ? ' is-active' : ''}`} pointerEvents="none">
              {/* Selection is done by nearest-within-radius in the tap
                  handler, so the dot is purely visual now. Active pins
                  are drawn larger — they're the ones you reach for. */}
              <circle cx={x} cy={y} r={(p.active ? 5 : 3) * u} className="hol-map-pin-dot" />
              {(p.active || t.zoom > 2.4) && (
                <text x={x} y={y - 9 * u} fontSize={11 * u} className="hol-map-pin-label">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="hol-map-zoom">
        <button type="button" onClick={zoomButton(1.5)} aria-label="Zoom in">+</button>
        <button type="button" onClick={zoomButton(1 / 1.5)} aria-label="Zoom out">−</button>
        <button type="button" onClick={() => setT({ zoom: 1, x: 0, y: 0 })} aria-label="Reset view">⟲</button>
      </div>
      <div className={`hol-map-hint${hint ? ' is-on' : ''}`} aria-hidden={!hint}>
        Use two fingers to move the map
      </div>
      {!geo && <div className="hol-map-loading">Loading map…</div>}
      {children}
    </div>
  );
}

/** Country outlines. Memoised by identity of `geo` via the module-level
 *  cache — the geometry is loaded once and never changes, so rebuilding
 *  the path strings on every transform would be pure waste. */
let _pathCache = { geo: null, out: [] };
function paths(geo) {
  if (!geo) return [];
  if (_pathCache.geo === geo) return _pathCache.out;
  const out = geo.polys.map(country => {
    let d = '';
    for (const poly of country.polys) {
      for (const ring of poly) {
        d += 'M' + ring.map(([lon, lat]) => project(lat, lon).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
      }
    }
    return { iso2: country.iso2, name: country.name, d };
  });
  _pathCache = { geo, out };
  return out;
}

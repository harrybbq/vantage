import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { wheelPixels } from '../../lib/holiday/railMotion';

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
 *   mouse              → drag to pan, wheel to zoom at the cursor,
 *                        double-click to zoom in. At full zoom-out the
 *                        wheel goes back to the page (see onWheel).
 *   trackpad           → pinch zooms; a sideways swipe pans once zoomed.
 *
 * It used to be touch-action:none with a single-finger pan, which meant
 * a thumb landing anywhere on a 320px-tall map trapped the page scroll,
 * and pinch did nothing at all (the old handler read touches[0] only,
 * so a second finger just made the map lurch).
 *
 * Props:
 *   fills      — { ISO2: 'red'|'amber'|'green'|'accent'|'upcoming' } country tints
 *   pins       — [{ id, lat, lon, label, active }]
 *   lines      — [{ from: {lat,lon}, to: {lat,lon}, dashed }]
 *   view       — 'europe' | 'world'
 *   onPick     — (iso2) => void, country click
 *   onPickPin  — (id) => void
 *   focus      — [lonW, latN, lonE, latS] to fly to, or null to fly back
 *                out to the whole view. Any gesture cancels a flight.
 *   highlight  — Set of ISO2; everything else is dimmed. null = none.
 *   stamp      — { iso2, lat, lon, n }: bumping `n` thumps that country
 *                and spreads a ring from it (the Visited tab's "mark
 *                visited").
 *   inkIn      — sweep the filled countries in from west to east once the
 *                geometry arrives.
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
  // Somewhere a planned trip is going that you have not been yet.
  upcoming: 'var(--em)',
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
  focus = null,
  highlight = null,
  stamp = null,
  inkIn = false,
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

  const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tRef = useRef(t);
  tRef.current = t;

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

  /* ── Flight ────────────────────────────────────────────────────────
     Eases the transform to a target: zoom in log space (1→4 feels like
     4→16), centre linearly, 650ms ease-in-out. Any gesture of the hand
     cancels it, so the map never fights the person using it. */
  const flight = useRef(0);
  const cancelFlight = () => { cancelAnimationFrame(flight.current); flight.current = 0; };
  const flyTo = useCallback((target) => {
    cancelAnimationFrame(flight.current);
    const to = clampT(target);
    if (reduceMotion()) { setT(to); return; }
    const from = tRef.current, t0 = performance.now();
    const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const lz0 = Math.log(from.zoom), lz1 = Math.log(to.zoom);
    const step = now => {
      const k = Math.min(1, (now - t0) / 650), e = ease(k);
      setT({ zoom: Math.exp(lz0 + (lz1 - lz0) * e), x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      flight.current = k < 1 ? requestAnimationFrame(step) : 0;
    };
    flight.current = requestAnimationFrame(step);
  }, [clampT]);
  useEffect(() => () => cancelAnimationFrame(flight.current), []);

  /* Where `focus` asks to be. The box has to fit the part of the view
     that is actually drawn: with `slice` one axis is cropped, so the
     usable width is min(box width, box height × element aspect). */
  const focusKey = focus ? focus.join(',') : '';
  const hadFocus = useRef(false);
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!focus) {
      if (hadFocus.current) flyTo({ zoom: 1, x: 0, y: 0 });
      hadFocus.current = false;
      return;
    }
    if (!rect || !rect.width || !rect.height) return;
    hadFocus.current = true;
    const [lonW, latN, lonE, latS] = focus;
    const [x1, y1] = project(latN, lonW), [x2, y2] = project(latS, lonE);
    const A = rect.width / rect.height;
    const vw1 = Math.min(base.w, base.h * A), vh1 = Math.min(base.h, base.w / A);
    const zoom = Math.min(vw1 / ((x2 - x1) * 1.08), vh1 / ((y2 - y1) * 1.08));
    flyTo({
      zoom,
      x: (x1 + x2) / 2 - (base.x + base.w / 2),
      y: (y1 + y2) / 2 - (base.y + base.h / 2),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  const flashHint = useCallback(() => {
    setHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 1900);
  }, []);

  // ── Gestures ──────────────────────────────────────────────────────
  const touchPoints = () => [...pointers.current.values()].filter(p => p.type !== 'mouse');

  function onPointerDown(e) {
    cancelFlight();
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

  /* ── Wheel ────────────────────────────────────────────────────────
     A native, non-passive listener. React's onWheel is passive, so its
     preventDefault was ignored and every wheel click over the map zoomed
     it AND scrolled the page. Now:
       wheel / two-finger swipe up-down → zoom at the cursor, by how far
         it moved (a trackpad no longer races: one event, one step, was
         15% per event however small the event)
       pinch (ctrlKey)                  → zoom, always kept from the page
       sideways swipe, zoomed in        → pan
       fully zoomed out and scrolling on → the page scrolls, so a map in
         the middle of a long page never traps the wheel. Same rule as
         the timeline (lib/holiday/railMotion). */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = e => {
      const { dx, dy } = wheelPixels(e);
      const cur = tRef.current;
      if (e.ctrlKey) {
        e.preventDefault(); cancelFlight();
        zoomAt(Math.exp(-dy * 0.011), e.clientX, e.clientY);
        return;
      }
      if (Math.abs(dx) > Math.abs(dy)) {
        if (cur.zoom <= MIN_ZOOM * 1.0005) return;
        e.preventDefault(); cancelFlight();
        const rect = el.getBoundingClientRect();
        const w = base.w / cur.zoom;
        setT(prev => clampT({ ...prev, x: prev.x + dx * (w / rect.width) }));
        return;
      }
      if (!dy) return;
      if (dy > 0 && cur.zoom <= MIN_ZOOM * 1.0005) return;   // the page's
      if (dy < 0 && cur.zoom >= MAX_ZOOM * 0.9995) return;
      e.preventDefault(); cancelFlight();
      zoomAt(Math.exp(-dy * 0.0016), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt, clampT, base, !!geo]);

  /* ── Stamp: a country just marked visited thumps down, and a ring
     spreads from it. The ring is drawn in screen-constant units. */
  const [ripples, setRipples] = useState([]);
  useEffect(() => {
    if (!stamp || !stamp.n || reduceMotion()) return undefined;
    const el = svgRef.current?.querySelector(`[data-iso2="${stamp.iso2}"]`);
    if (el?.animate) {
      el.style.transformBox = 'fill-box';
      el.style.transformOrigin = 'center';
      el.animate(
        [{ transform: 'scale(1.35)', filter: 'brightness(1.5)' }, { transform: 'scale(.94)', offset: 0.55 }, { transform: 'none', filter: 'none' }],
        { duration: 420, easing: 'cubic-bezier(.32,1.28,.5,1)' },
      );
    }
    if (Number.isFinite(stamp.lat) && Number.isFinite(stamp.lon)) {
      const [x, y] = project(stamp.lat, stamp.lon);
      const id = stamp.n;
      setRipples(r => [...r, { id, x, y }]);
      const tm = setTimeout(() => setRipples(r => r.filter(q => q.id !== id)), 760);
      return () => clearTimeout(tm);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp && stamp.n]);

  /* ── Ink-in: the first time the countries are drawn, the filled ones
     sweep in from west to east, like a stamp going across a page. The
     colours are read from the DOM so the theme's own tokens are what
     animates. `fill: backwards` — nothing is left half-painted. */
  const inked = useRef(false);
  useLayoutEffect(() => {
    if (!inkIn || inked.current || !geo || reduceMotion()) return;
    const svg = svgRef.current;
    if (!svg) return;
    inked.current = true;
    const blank = svg.querySelector('.hol-map-country:not(.is-filled)');
    const land = blank ? getComputedStyle(blank).fill : 'rgba(127,127,127,.1)';
    svg.querySelectorAll('.hol-map-country.is-filled').forEach(el => {
      if (!el.animate) return;
      const b = el.getBBox();
      const delay = 120 + ((b.x + b.width / 2) / SRC_W) * 900;
      el.animate([{ fill: land }, { fill: getComputedStyle(el).fill }],
        { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }, [geo, inkIn]);

  const zoomButton = (factor) => () => {
    cancelFlight();
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
        onDoubleClick={e => { cancelFlight(); zoomAt(1.8, e.clientX, e.clientY); }}
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
              className={`hol-map-country${tone ? ' is-filled is-' + tone : ''}${onPick ? ' is-pickable' : ''}${
                highlight && !highlight.has(p.iso2) ? ' is-dim' : ''}`}
              /* Inline style, not a `fill` attribute: presentation
                 attributes lose to the class's own fill rule. */
              style={tone ? { fill: TONE_VAR[tone] || tone } : undefined}
              strokeWidth={0.5 * u}
            >
              <title>{p.name}</title>
            </path>
          );
        })}

        {ripples.map(r => (
          <circle key={r.id} cx={r.x} cy={r.y} r={46 * u} className="hol-map-ripple" strokeWidth={2 * u} />
        ))}

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
        <button type="button" onClick={() => { cancelFlight(); setT({ zoom: 1, x: 0, y: 0 }); }} aria-label="Reset view">⟲</button>
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

/* ── MiniWorld ──────────────────────────────────────────────────────
   The same countries, drawn once and still: no gestures, no controls,
   no hit-testing. For the Holidays prime card, where the map is a
   picture of where you have been rather than a thing you work in.
   Shares the lazy geometry and the path cache with the full map, so a
   visit to the Visited tab and a hub with this block pay for it once. */
let _geoLoad = null;
const loadGeo = () => (_geoLoad ||= import('../../data/worldLow.json').then(m => m.default || m));

export function MiniWorld({ fills = {} }) {
  const [geo, setGeo] = useState(_pathCache.geo);
  useEffect(() => {
    if (geo) return undefined;
    let alive = true;
    loadGeo().then(g => { if (alive) setGeo(g); }).catch(() => {});
    return () => { alive = false; };
  }, [geo]);
  // Antarctica's strip is 16% of the height and nobody's visited it here.
  const [, yTop] = project(84, 0), [, yBot] = project(-56, 0);
  return (
    <svg className="mini-world" viewBox={`0 ${yTop} ${SRC_W} ${yBot - yTop}`}
         preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of countries visited">
      {paths(geo).map(p => {
        const tone = fills[p.iso2];
        return (
          <path key={p.iso2} d={p.d} className={`mini-world-c${tone ? ' is-' + tone : ''}`}
                style={tone ? { fill: TONE_VAR[tone] || tone } : undefined} />
        );
      })}
    </svg>
  );
}

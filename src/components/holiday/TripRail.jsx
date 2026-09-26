/**
 * The trip timeline.
 *
 * Horizontal across the page on desktop, vertical down it on a phone —
 * the same geometry, mapped to whichever axis has the room.
 *
 * ── Bands, not markers ───────────────────────────────────────────────
 * Each trip is drawn as a band covering the dates it spans, filled with
 * its own photo. Earlier versions used a fixed-width thumbnail on a dot,
 * which meant two trips a week apart overlapped by 100px; shrinking them
 * lost the photo and clustering them lost the trip. Bands make the
 * collision impossible rather than managing it — two trips cannot share
 * dates, so two bands cannot share pixels — and they put duration on
 * screen for the first time. A weekend and a fortnight were the same
 * dot; now one is seven times the width of the other.
 *
 * ── The controls ─────────────────────────────────────────────────────
 * Drag to pan, and let go mid-drag to fling. Sideways swipe or
 * Shift+wheel pans; pinch or the plain wheel zooms, toward the cursor,
 * gliding rather than stepping (lib/holiday/railMotion). At full zoom
 * the wheel goes back to the page. Arrows, + − and T from the keys. The
 * rail spans the whole page because it is the one element that gets
 * better with width, and it opens with today about three-quarters
 * across: flush right would put every upcoming trip off-screen,
 * including the next one, which is the trip the page exists for.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  PX_PER_DAY, TODAY_ANCHOR, TODAY_ANCHOR_V, ZOOM_STEP, clampZoom, dayAt, daysUntil, fmt,
  nightsOf, railBands, railGeometry, railTicks,
} from '../../lib/holiday/timeline';
import {
  classifyWheel, zoomTarget, atZoomLimit, approachZoom, approach, releaseVelocity, glideStep,
} from '../../lib/holiday/railMotion';

/** Behind us? Status OR dates, so a trip nobody marked completed still
 *  greys out once it is over. */
const isPast = (trip, now) =>
  trip.status === 'completed' || (dayAt(trip.to || trip.from) && daysUntil(trip.to || trip.from, now) < 0);

const zoomLabel = px => {
  const daysPerTick = 44 / px;
  if (daysPerTick <= 2.5) return 'Days';
  if (daysPerTick <= 16) return 'Weeks';
  if (daysPerTick <= 70) return 'Months';
  return 'Years';
};

export default function TripRail({ trips, selectedId, onSelect, now = new Date() }) {
  const isMobile = useIsMobile();
  const scroller = useRef(null);
  const [zoom, setZoom] = useState(PX_PER_DAY);
  // The viewport along the time axis — width on desktop, height on a
  // phone. Feeds the geometry's padding so today can always reach its
  // anchor instead of clamping against the end of the rail.
  /* null until measured. A guessed default is worse than none: the
     placement effect would run against it on the first commit, and the
     real width arriving a frame later shifts every pixel on the rail —
     which left today at 82% instead of 72%. */
  const [viewport, setViewport] = useState(null);

  const geo = railGeometry(trips, now, zoom, viewport || 0);
  const bands = railBands(trips, geo, selectedId, { vertical: isMobile });
  const ticks = railTicks(geo);
  const undated = trips.filter(t => !dayAt(t.from));

  /* Which axis the time runs along. Everything below is written once in
     terms of `pos` (scrollLeft/scrollTop) and `len` (clientWidth/Height)
     so the two orientations cannot drift apart. */
  const axis = isMobile
    ? { pos: 'scrollTop', len: 'clientHeight', client: 'clientY', start: 'top', size: 'height' }
    : { pos: 'scrollLeft', len: 'clientWidth', client: 'clientX', start: 'left', size: 'width' };

  const measured = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const v = el[axis.len];
      if (v) { measured.current = true; setViewport(prev => (prev === v ? prev : v)); }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis.len]);

  const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The geometry the DOM is showing right now, for turning a scroll
     position back into a date between renders. */
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const maxPos = () => {
    const el = scroller.current;
    return el ? Math.max(0, (isMobile ? el.scrollHeight : el.scrollWidth) - el[axis.len]) : 0;
  };

  /* ── Motion loops ─────────────────────────────────────────────────
     Three things can move the rail on their own: a fling gliding after
     the pointer lets go, a pan easing to a target (keys, a mouse notch,
     Today), and a zoom easing to a target. Any new input stops the
     first two, so the rail never fights the hand that is on it. */
  const glide = useRef({ raf: 0, v: 0, last: 0 });
  const pan = useRef({ raf: 0, target: 0, last: 0 });
  const za = useRef({ raf: 0, z: zoom, target: zoom, tau: 60, last: 0 });
  const anchor = useRef(null);        // { ms, offset } — the date held under a point while zooming

  function stopGlide() { cancelAnimationFrame(glide.current.raf); glide.current.raf = 0; glide.current.v = 0; }
  function stopPan() { cancelAnimationFrame(pan.current.raf); pan.current.raf = 0; }

  function glideFrame(t) {
    const g = glide.current, el = scroller.current;
    if (!el || !g.v) { g.raf = 0; return; }
    const dt = Math.max(0, Math.min(48, t - g.last)); g.last = Math.max(g.last, t);
    const step = glideStep(g.v, dt);
    el[axis.pos] = el[axis.pos] - step.dist;
    g.v = step.v;
    // Hit an end: stop rather than keep pushing against it.
    const pos = el[axis.pos];
    if (!g.v || (g.v > 0 && pos <= 0) || (g.v < 0 && pos >= maxPos() - 0.5)) { g.raf = 0; g.v = 0; return; }
    g.raf = requestAnimationFrame(glideFrame);
  }

  /** Ease the scroll position to `target` (clamped to the rail). */
  const panTo = useCallback(target => {
    const el = scroller.current;
    if (!el) return;
    stopGlide();
    const tgt = Math.max(0, Math.min(maxPos(), target));
    if (reducedMotion()) { stopPan(); el[axis.pos] = tgt; return; }
    pan.current.target = tgt;
    if (pan.current.raf) return;
    pan.current.last = performance.now();
    const frame = t => {
      const pa = pan.current, e2 = scroller.current;
      if (!e2) { pa.raf = 0; return; }
      const dt = Math.max(0, Math.min(48, t - pa.last)); pa.last = Math.max(pa.last, t);
      const next = approach(e2[axis.pos], pa.target, dt, 90);
      e2[axis.pos] = next;
      pa.raf = next === pa.target ? 0 : requestAnimationFrame(frame);
    };
    pan.current.raf = requestAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis.pos, axis.len, isMobile]);
  const panBy = useCallback(dist => {
    const el = scroller.current;
    if (!el) return;
    const from = pan.current.raf ? pan.current.target : el[axis.pos];
    panTo(from + dist);
  }, [panTo, axis.pos]);

  /* ── Zoom ─────────────────────────────────────────────────────────
     Anchored on a point: the cursor for a wheel or pinch, the middle
     for the buttons and keys. The date under that point stays under it.

     The scroll position is corrected in a layout effect — after React
     has laid the rail out at its new length, BEFORE the browser paints.
     It used to be corrected a frame later, so every zoom step painted
     one frame at the wrong position and the view flickered between two
     places as you scrolled. */
  const zoomTo = useCallback((nextPx, anchorOffset, tau = 60) => {
    const el = scroller.current, g = geoRef.current;
    if (!el || !g) return;
    stopGlide(); stopPan();
    anchor.current = { ms: g.dateAt(el[axis.pos] + anchorOffset).getTime(), offset: anchorOffset };
    const target = clampZoom(nextPx);
    const z = za.current;
    z.target = target;
    z.tau = reducedMotion() ? 0 : tau;
    if (z.raf) return;
    z.last = performance.now();
    const frame = t => {
      const q = za.current;
      const dt = Math.max(0, Math.min(48, t - q.last)); q.last = Math.max(q.last, t);
      q.z = q.tau ? approachZoom(q.z, q.target, dt, q.tau) : q.target;
      q.raf = q.z === q.target ? 0 : requestAnimationFrame(frame);
      setZoom(q.z);
    };
    z.raf = requestAnimationFrame(frame);
  }, [axis.pos]);

  useLayoutEffect(() => {
    const a = anchor.current, el = scroller.current;
    if (!a || !el || !geo) return;
    el[axis.pos] = Math.max(0, geo.at(a.ms) - a.offset);
    if (!za.current.raf) anchor.current = null;
  }, [zoom, geo, axis.pos]);

  useEffect(() => () => { stopGlide(); stopPan(); cancelAnimationFrame(za.current.raf); }, []);

  /* ── Pan by dragging ──────────────────────────────────────────────
     No "not from a button" guard: the bands ARE buttons and cover the
     rail, so refusing to pan from one would mean the drag only worked
     in the gaps. The 4px threshold is what keeps a click a click.
     Let go while moving and the rail carries on and slows, like a list
     on a phone; press again to catch it. */
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const el = scroller.current;
    if (!el) return;
    // Catching a glide is a stop, not a click on whatever is under it.
    const caught = !!glide.current.raf || !!pan.current.raf;
    stopGlide(); stopPan();
    drag.current = { at: e[axis.client], pos: el[axis.pos], id: e.pointerId, captured: false, samples: [{ t: e.timeStamp, x: e[axis.client] }] };
    movedRef.current = caught;
    /* Capture is NOT taken here. It retargets the pointerup, and a click
       fires on the nearest common ancestor of down and up — capturing on
       every press made every band unselectable. Taken below, once a real
       drag has begun. */
  }
  function onPointerMove(e) {
    const d = drag.current, el = scroller.current;
    if (!d || !el) return;
    const delta = e[axis.client] - d.at;
    if (!d.captured && Math.abs(delta) > 4) {
      movedRef.current = true;
      setDragging(true);
      el.setPointerCapture?.(e.pointerId);
      d.captured = true;
    }
    d.samples.push({ t: e.timeStamp, x: e[axis.client] });
    if (d.samples.length > 12) d.samples.shift();
    if (d.captured) el[axis.pos] = d.pos - delta;
  }
  function endDrag(e) {
    const el = scroller.current, d = drag.current;
    if (d?.captured && el) el.releasePointerCapture?.(d.id);
    if (d?.captured && e && e.type === 'pointerup' && !reducedMotion()) {
      const v = releaseVelocity(d.samples, e.timeStamp);
      if (Math.abs(v) > 0.15) {
        glide.current.v = v;
        glide.current.last = performance.now();
        glide.current.raf = requestAnimationFrame(glideFrame);
      }
    }
    drag.current = null;
    // Next frame, so the click that follows this pointerup can still see
    // that a drag happened and swallow itself.
    requestAnimationFrame(() => { movedRef.current = false; setDragging(false); });
  }

  /* ── Wheel ────────────────────────────────────────────────────────
     Sideways trackpad swipes and Shift+wheel pan; pinch zooms; a plain
     wheel zooms (as asked) — except at the limit in that direction,
     where it goes back to the page. The rail is the full width of the
     page, so without that a wheel over it could never scroll past it.
     Non-passive, or preventDefault is ignored. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const onWheel = e => {
      const w = classifyWheel(e);
      if (!w.kind) return;
      if (w.kind === 'pan') {
        if (isMobile) return;
        e.preventDefault();
        stopGlide();
        if (w.notched) panBy(w.delta * 1.6);
        else { stopPan(); el[axis.pos] += w.delta; }
        return;
      }
      const base = za.current.raf ? za.current.target : zoom;
      if (w.kind === 'zoom' && atZoomLimit(base, w.delta)) return;   // hand it to the page
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const offset = isMobile ? e.clientY - r.top : e.clientX - r.left;
      zoomTo(zoomTarget(base, w.delta, w.kind === 'pinch'), offset, w.notched ? 60 : 0);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo, panBy, isMobile, axis.pos]);

  /** Put today at its anchor. Also the "jump to today" action. */
  const goToToday = useCallback((smooth = true) => {
    const el = scroller.current;
    if (!el || !geo) return;
    const target = Math.max(0, geo.today - el[axis.len] * (isMobile ? TODAY_ANCHOR_V : TODAY_ANCHOR));
    if (smooth) panTo(target);
    else el[axis.pos] = target;
  }, [geo, axis.len, axis.pos, isMobile, panTo]);

  /* ── Keys ─────────────────────────────────────────────────────────
     The rail takes focus. Arrows pan a third of the view, + and − zoom
     about the middle, T (or Home) goes to today. */
  function onKeyDown(e) {
    const el = scroller.current;
    if (!el || e.metaKey || e.ctrlKey || e.altKey) return;
    const len = el[axis.len];
    const back = isMobile ? 'ArrowUp' : 'ArrowLeft', fwd = isMobile ? 'ArrowDown' : 'ArrowRight';
    if (e.key === back || e.key === fwd) { e.preventDefault(); panBy((e.key === fwd ? 1 : -1) * len * 0.33); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo((za.current.raf ? za.current.target : zoom) * ZOOM_STEP, len / 2); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo((za.current.raf ? za.current.target : zoom) / ZOOM_STEP, len / 2); }
    else if (e.key === 't' || e.key === 'T' || e.key === 'Home') { e.preventDefault(); goToToday(); }
  }

  /* Once per mount, and only AFTER the viewport has been measured.
     Placing on the first render used the 1200px guess; the real 1328
     arrived a frame later, which moved every pixel on the rail and left
     today at 82% instead of 72%. Depending on `viewport` waits for the
     real number. */
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !geo || viewport == null || !scroller.current) return;
    placed.current = true;
    goToToday(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!geo, viewport]);

  const select = id => { if (!movedRef.current) onSelect(id); };

  if (!trips.length) return null;

  const vertical = isMobile;

  return (
    <div className={`hol-rail-card${vertical ? ' is-vertical' : ''}`}
         data-hub-module="holiday-rail" data-hub-module-label="Timeline">
      <div className="hol-rail-head">
        <span className="hol-rail-eyebrow">Timeline</span>
        {!vertical && <span className="hol-rail-line" aria-hidden="true" />}
        <span className="hol-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" className="hol-zoom-btn"
                  onClick={() => zoomTo((za.current.raf ? za.current.target : zoom) / ZOOM_STEP, (scroller.current?.[axis.len] || 0) / 2)}
                  aria-label="Zoom out">−</button>
          <span className="hol-zoom-level" aria-live="polite">{zoomLabel(zoom)}</span>
          <button type="button" className="hol-zoom-btn"
                  onClick={() => zoomTo((za.current.raf ? za.current.target : zoom) * ZOOM_STEP, (scroller.current?.[axis.len] || 0) / 2)}
                  aria-label="Zoom in">+</button>
        </span>
        <button type="button" className="hol-rail-jump" onClick={() => goToToday()}>Today</button>
      </div>

      <div
        className={`hol-rail-scroll${dragging ? ' is-dragging' : ''}`}
        ref={scroller}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="group"
        aria-label={vertical
          ? 'Trip timeline. Up and down arrows pan, plus and minus zoom, T goes to today.'
          : 'Trip timeline. Left and right arrows pan, plus and minus zoom, T goes to today.'}
      >
        {geo ? (
          <div className="hol-rail-inner" style={{ [axis.size]: geo.width + 'px' }}>
            <div className="hol-rail-track" aria-hidden="true" />

            {ticks.map(t => (
              <div key={t.key} className={`hol-tick${t.isYear ? ' is-year' : ''}`}
                   style={{ [axis.start]: t.left + 'px' }} aria-hidden="true">
                <i />
                <span>{t.label}</span>
              </div>
            ))}

            <div className="hol-today" style={{ [axis.start]: geo.today + 'px' }} aria-hidden="true">
              <span>Today</span>
            </div>

            {bands.map(band => {
              const t = band.trip;
              const past = isPast(t, now);
              const nights = nightsOf(t);
              const when = `${fmt(t.from, { day: 'numeric', month: 'short' })}${
                nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}`;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`hol-band${band.selected ? ' is-sel' : ''}${past ? ' is-past' : ''}${
                    band.depth ? ' is-nested' : ''}`}
                  style={{
                    [axis.start]: band.start + 'px',
                    [axis.size]: band.size + 'px',
                    // A trip booked inside a longer one insets and draws
                    // over it rather than disappearing underneath.
                    ...(band.depth ? { '--band-inset': band.depth * 10 + 'px', zIndex: 3 + band.depth } : null),
                    ...(t.imageUrl ? { '--band-photo': `url("${String(t.imageUrl).replace(/["\\]/g, '')}")` } : null),
                  }}
                  aria-current={band.selected ? 'true' : undefined}
                  title={`${t.dest || 'Untitled'} — ${when}`}
                  aria-label={`${t.dest || 'Untitled'}, ${when}`}
                  onClick={() => select(t.id)}
                >
                  <span className="hol-band-scrim" aria-hidden="true" />
                  {band.labelInside && (
                    <span className="hol-band-label">
                      <span className="hol-band-name">{t.dest || 'Untitled'}</span>
                      <span className="hol-band-when">{when}</span>
                    </span>
                  )}
                </button>
              );
            })}

            {/* Labels for bands too narrow to hold their own. Anchored to
                the band's leading edge and packed into rows, with a
                leader rule down onto the band so a name a row up is
                still unambiguously that band's name.

                Not on the phone: the strip is 100px wide and a name
                laid across it covers the photos either side of it. A
                short trip there is a band you tap, and the pass beside
                it says which one you tapped. */}
            {!vertical && bands.filter(b => !b.labelInside).map(band => (
              <button
                key={'l' + band.trip.id}
                type="button"
                className={`hol-band-out${band.selected ? ' is-sel' : ''}${isPast(band.trip, now) ? ' is-past' : ''}`}
                style={{
                  [axis.start]: band.outAt + 'px',
                  '--out-row': band.outRow || 0,
                  '--out-lead': (band.lead || 0) + 'px',
                }}
                onClick={() => select(band.trip.id)}
                tabIndex={-1}
                aria-hidden="true"
              >{band.trip.dest || 'Untitled'}</button>
            ))}
          </div>
        ) : (
          <div className="hol-rail-nodates">No trip has dates yet — add one and it lands on the timeline.</div>
        )}
      </div>

      <div className="hol-rail-foot">
        <span className="hol-rail-hint">
          {vertical ? 'Drag to pan · scroll to zoom' : 'Drag or swipe to pan · scroll or pinch to zoom · ← → + − T'}
        </span>
        {undated.length > 0 && (
          <span className="hol-undated">
            <span className="hol-rail-eyebrow">No dates yet</span>
            {undated.map(t => (
              <button key={t.id} type="button"
                      className={`hol-undated-chip${t.id === selectedId ? ' is-sel' : ''}`}
                      onClick={() => onSelect(t.id)}>{t.dest || 'Untitled'}</button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

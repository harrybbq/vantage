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
 * Drag to pan. Plain scroll wheel to zoom, toward the cursor, on a
 * continuous scale rather than in notches so the gesture is smooth. The
 * rail spans the whole page because it is the one element that gets
 * better with width, and it opens with today about three-quarters
 * across: flush right would put every upcoming trip off-screen,
 * including the next one, which is the trip the page exists for.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  PX_PER_DAY, TODAY_ANCHOR, TODAY_ANCHOR_V, ZOOM_STEP, clampZoom, dayAt, daysUntil, fmt,
  nightsOf, railBands, railGeometry, railTicks, wheelZoom,
} from '../../lib/holiday/timeline';

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

  /* ── Pan ──────────────────────────────────────────────────────────
     No "not from a button" guard: the bands ARE buttons and cover the
     rail, so refusing to pan from one would mean the drag only worked
     in the gaps. The 4px threshold is what keeps a click a click. */
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const el = scroller.current;
    if (!el) return;
    drag.current = { at: e[axis.client], pos: el[axis.pos], id: e.pointerId, captured: false };
    movedRef.current = false;
    /* Capture is NOT taken here. It retargets the pointerup, and a click
       fires on the nearest common ancestor of down and up — capturing on
       every press made every band unselectable. Taken below, once a real
       drag has begun. */
  }
  function onPointerMove(e) {
    const d = drag.current, el = scroller.current;
    if (!d || !el) return;
    const delta = e[axis.client] - d.at;
    if (!movedRef.current && Math.abs(delta) > 4) {
      movedRef.current = true;
      setDragging(true);
      el.setPointerCapture?.(e.pointerId);
      d.captured = true;
    }
    if (movedRef.current) el[axis.pos] = d.pos - delta;
  }
  function endDrag() {
    const el = scroller.current;
    if (drag.current?.captured && el) el.releasePointerCapture?.(drag.current.id);
    drag.current = null;
    // Next frame, so the click that follows this pointerup can still see
    // that a drag happened and swallow itself.
    requestAnimationFrame(() => { movedRef.current = false; setDragging(false); });
  }

  /* ── Zoom ─────────────────────────────────────────────────────────
     Anchored on a point: the cursor for a wheel, the middle for the
     buttons. Whatever date is under that point stays under it, which is
     the difference between a lens and a jump cut. */
  const zoomAround = useCallback((nextPx, anchorOffset) => {
    const el = scroller.current;
    const next = clampZoom(nextPx);
    setZoom(prev => {
      if (Math.abs(next - prev) < 1e-6) return prev;
      if (el && geo) {
        const held = geo.dateAt(el[axis.pos] + anchorOffset);
        // Re-place after paint, when the rail has its new length.
        requestAnimationFrame(() => {
          const g2 = railGeometry(trips, now, next, viewport || 0);
          const el2 = scroller.current;
          if (g2 && el2) el2[axis.pos] = Math.max(0, g2.at(held.getTime()) - anchorOffset);
        });
      }
      return next;
    });
  }, [geo, trips, now, viewport, axis.pos]);

  /* Plain wheel — no modifier, as asked. preventDefault only while the
     pointer is over the rail, so the page scrolls normally everywhere
     else. Non-passive, or preventDefault is ignored. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = e => {
      const primary = isMobile ? e.deltaY : (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      if (!primary) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const offset = isMobile ? e.clientY - r.top : e.clientX - r.left;
      zoomAround(wheelZoom(zoom, primary), offset);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomAround, isMobile]);

  /** Put today at its anchor. Also the "jump to today" action. */
  const goToToday = useCallback((smooth = true) => {
    const el = scroller.current;
    if (!el || !geo) return;
    const target = Math.max(0, geo.today - el[axis.len] * (isMobile ? TODAY_ANCHOR_V : TODAY_ANCHOR));
    el.scrollTo({ [axis.start]: target, behavior: smooth ? 'smooth' : 'auto' });
  }, [geo, axis.len, axis.start, isMobile]);

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
                  onClick={() => zoomAround(zoom / ZOOM_STEP, (scroller.current?.[axis.len] || 0) / 2)}
                  aria-label="Zoom out">−</button>
          <span className="hol-zoom-level" aria-live="polite">{zoomLabel(zoom)}</span>
          <button type="button" className="hol-zoom-btn"
                  onClick={() => zoomAround(zoom * ZOOM_STEP, (scroller.current?.[axis.len] || 0) / 2)}
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
        <span className="hol-rail-hint">Drag to pan · scroll to zoom</span>
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

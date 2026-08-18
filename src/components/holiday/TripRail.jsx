/**
 * The trip timeline.
 *
 * Horizontal on desktop, vertical on a phone — the same information laid
 * along whichever axis has the room.
 *
 * ── Why a timeline rather than a grid of cards ───────────────────────
 * The old page was a card per trip, newest first. A card grid answers
 * "what trips do I have"; it cannot answer "how long until the next one"
 * or "how big is the gap after Tokyo", which are the questions you
 * actually have when you look at a holiday planner. Stops are spaced by
 * REAL elapsed days, so the wait between two trips is drawn to scale and
 * an empty year looks like an empty year.
 *
 * ── Panning and zoom ─────────────────────────────────────────────────
 * Spacing by real dates has a cost: two trips a week apart are 10px
 * apart at the default scale, and a stop is 132px wide. They piled up.
 *
 * Two things fix it together. Zoom changes the pixels per day, so you
 * can pull a crowded fortnight apart; and each stop renders at one of
 * three densities depending on how much room it actually has, so even
 * the widest zoom-out stays readable rather than becoming a heap.
 * railStops() decides the density — thumbnail, then name, then a bare
 * dot, giving things up in the order you would.
 *
 * Panning is a drag, because a horizontal scrollbar is a poor target and
 * a trackpad's horizontal gesture is not something every mouse has. A
 * drag under 4px is still a click, so tapping a stop keeps working.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  DEFAULT_ZOOM, ZOOM_LEVELS, dayAt, daysUntil, fmt, railGeometry, railStops, railTicks,
} from '../../lib/holiday/timeline';

/** Is this trip behind us? Status OR dates, so a trip nobody remembered
 *  to mark completed still greys out once it is over. */
const isPast = (trip, now) =>
  trip.status === 'completed' || (dayAt(trip.to || trip.from) && daysUntil(trip.to || trip.from, now) < 0);

function Thumb({ trip, selected, past }) {
  return (
    <span
      className={`hol-thumb${selected ? ' is-sel' : ''}${past ? ' is-past' : ''}`}
      style={trip.imageUrl ? { backgroundImage: `url(${trip.imageUrl})` } : undefined}
    >
      {!trip.imageUrl && <span className="hol-thumb-ph">trip photo</span>}
    </span>
  );
}

export default function TripRail({ trips, selectedId, onSelect, now = new Date() }) {
  const isMobile = useIsMobile();
  const scroller = useRef(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const geo = railGeometry(trips, now, ZOOM_LEVELS[zoom]);

  /* ── Panning ──────────────────────────────────────────────────────
     Pointer events rather than mouse, so a stylus and a trackpad drag
     work the same way. The threshold is what keeps a click a click:
     without it, the 1px of movement in any real press swallowed every
     tap on a stop. */
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  function onPointerDown(e) {
    /* Left button only. Note there is NO "not from a button" guard: the
       stops ARE buttons and cover most of the rail, so refusing to pan
       from one meant the drag only worked in the gaps. The zoom
       controls live outside this scroller, so nothing needs protecting;
       the 4px threshold below is what keeps a click a click. */
    if (e.button !== 0) return;
    const el = scroller.current;
    if (!el) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, id: e.pointerId, captured: false };
    movedRef.current = false;
    /* Deliberately NOT capturing the pointer here. Capture retargets the
       pointerup to this element, and a click fires on the nearest common
       ancestor of down and up — so capturing on every press meant the
       click landed on the scroller and no stop was ever selectable.
       Capture is taken below, only once a real drag has begun. */
  }
  function onPointerMove(e) {
    const d = drag.current, el = scroller.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!movedRef.current && Math.abs(dx) > 4) {
      movedRef.current = true;
      setDragging(true);
      // Now it is a pan, so keep the pointer even if it leaves the rail.
      el.setPointerCapture?.(e.pointerId);
      d.captured = true;
    }
    if (movedRef.current) el.scrollLeft = d.left - dx;
  }
  function endDrag(e) {
    const el = scroller.current;
    if (drag.current?.captured && el) el.releasePointerCapture?.(drag.current.id);
    drag.current = null;
    // Cleared on the next frame, so the click that follows this pointerup
    // can still see that a drag happened and swallow itself.
    requestAnimationFrame(() => { movedRef.current = false; setDragging(false); });
  }

  /* ── Zoom ─────────────────────────────────────────────────────────
     Anchored on the middle of the view. Without that, zooming walks
     the rail sideways and you lose the thing you were looking at —
     which is the difference between a zoom that feels like a lens and
     one that feels like a jump cut. */
  const zoomTo = useCallback(next => {
    const el = scroller.current;
    const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next));
    if (clamped === zoom) return;
    if (!el || !geo) { setZoom(clamped); return; }
    const centreDate = geo.dateAt(el.scrollLeft + el.clientWidth / 2);
    setZoom(clamped);
    // After the re-render, put that date back under the middle.
    requestAnimationFrame(() => {
      const g2 = railGeometry(trips, now, ZOOM_LEVELS[clamped]);
      const el2 = scroller.current;
      if (!g2 || !el2) return;
      el2.scrollLeft = Math.max(0, g2.at(centreDate.getTime()) - el2.clientWidth / 2);
    });
  }, [zoom, geo, trips, now]);

  // Ctrl/⌘ + wheel is the zoom gesture every map and canvas uses.
  // A bare wheel is left alone so the page keeps scrolling normally.
  useEffect(() => {
    const el = scroller.current;
    if (!el || isMobile) return;
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoom + (e.deltaY < 0 ? 1 : -1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo, isMobile]);

  // Open centred on today. Once per mount, or scrolling by hand would
  // keep snapping back.
  const centred = useRef(false);
  useEffect(() => {
    if (isMobile || centred.current || !geo || !scroller.current) return;
    centred.current = true;
    centreOnToday(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, !!geo]);

  function centreOnToday(smooth = true) {
    const el = scroller.current;
    if (!el || !geo) return;
    el.scrollTo({ left: Math.max(0, geo.today - el.clientWidth / 2), behavior: smooth ? 'smooth' : 'auto' });
  }

  /** A click that followed a drag is a pan, not a selection. */
  const selectIfNotDragging = id => { if (!movedRef.current) onSelect(id); };

  if (!trips.length) return null;

  /* ── Phone: a vertical spine ── */
  if (isMobile) {
    let lastYear = null;
    return (
      <div className="hol-vrail">
        <div className="hol-vrail-line" aria-hidden="true" />
        {trips.map(trip => {
          const year = dayAt(trip.from) ? dayAt(trip.from).getFullYear() : null;
          const showYear = year && year !== lastYear;
          if (year) lastYear = year;
          const past = isPast(trip, now);
          const sel = trip.id === selectedId;
          return (
            <div key={trip.id} className="hol-vrail-item">
              {showYear && <div className="hol-vrail-year">{year}</div>}
              <button
                type="button"
                className={`hol-vstop${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`}
                aria-current={sel ? 'true' : undefined}
                onClick={() => onSelect(trip.id)}
              >
                <span className={`hol-dot${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`} aria-hidden="true" />
                <span className="hol-vstop-body">
                  <Thumb trip={trip} selected={sel} past={past} />
                  <span className="hol-vstop-name">{trip.dest || 'Untitled'}</span>
                  <span className="hol-vstop-when">
                    {trip.from ? fmt(trip.from, { day: 'numeric', month: 'short' }) : 'TBC'}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  /* ── Desktop: a horizontal rail ── */
  const ticks = railTicks(geo);
  const stops = railStops(trips, geo, selectedId);
  const undated = trips.filter(t => !dayAt(t.from));

  return (
    <div className="hol-rail-card" data-hub-module="holiday-rail" data-hub-module-label="Timeline">
      <div className="hol-rail-head">
        <span className="hol-rail-eyebrow">Timeline</span>
        <span className="hol-rail-line" aria-hidden="true" />
        <span className="hol-rail-key">
          <span><i className="hol-key-dot is-up" />Upcoming</span>
          <span><i className="hol-key-dot is-past" />Archived</span>
        </span>

        <span className="hol-zoom" role="group" aria-label="Timeline zoom">
          <button type="button" className="hol-zoom-btn" onClick={() => zoomTo(zoom - 1)}
                  disabled={zoom === 0} aria-label="Zoom out">−</button>
          <span className="hol-zoom-level" aria-live="polite">{zoomLabel(ZOOM_LEVELS[zoom])}</span>
          <button type="button" className="hol-zoom-btn" onClick={() => zoomTo(zoom + 1)}
                  disabled={zoom === ZOOM_LEVELS.length - 1} aria-label="Zoom in">+</button>
        </span>

        <button type="button" className="hol-rail-jump" onClick={() => centreOnToday()}>Jump to today</button>
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
          <div className="hol-rail-inner" style={{ width: geo.width + 'px' }}>
            <div className="hol-rail-track" aria-hidden="true" />

            {ticks.map(t => (
              <div key={t.key} className={`hol-tick${t.isYear ? ' is-year' : ''}`} style={{ left: t.left + 'px' }} aria-hidden="true">
                <i />
                <span>{t.label}</span>
              </div>
            ))}

            <div className="hol-today" style={{ left: geo.today + 'px' }} aria-hidden="true">
              <span>Today</span>
            </div>

            {stops.map(mark => {
              /* A pile-up too tight to draw as separate targets. One
                 marker with a count; clicking it zooms in, which pulls
                 the trips apart — the move you were going to make. At
                 the tightest zoom there is nowhere further to go, so it
                 selects the first of them instead of doing nothing. */
              if (mark.kind === 'cluster') {
                const names = mark.trips.map(t => t.dest || 'Untitled').join(', ');
                const anySel = mark.trips.some(t => t.id === selectedId);
                return (
                  <button
                    key={'c' + mark.left}
                    type="button"
                    className={`hol-cluster${anySel ? ' is-sel' : ''}`}
                    style={{ left: mark.left + 'px' }}
                    title={`${mark.count} trips close together — ${names}. Click to zoom in.`}
                    aria-label={`${mark.count} trips close together: ${names}. Zoom in to separate them.`}
                    onClick={() => {
                      if (movedRef.current) return;
                      if (zoom < ZOOM_LEVELS.length - 1) zoomTo(zoom + 1);
                      else onSelect(mark.trips[0].id);
                    }}
                  >{mark.count}</button>
                );
              }

              const { trip, left, tier, showName } = mark;
              const past = isPast(trip, now);
              const sel = trip.id === selectedId;
              return (
                <button
                  key={trip.id}
                  type="button"
                  className={`hol-stop is-${tier}${showName ? ' is-named' : ''}${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`}
                  style={{ left: left + 'px' }}
                  aria-current={sel ? 'true' : undefined}
                  /* The full label is on the button whatever the density,
                     so a stop shown as a bare dot is still reachable and
                     still says what it is. */
                  title={`${trip.dest || 'Untitled'} — ${fmt(trip.from, { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  aria-label={`${trip.dest || 'Untitled'}, ${fmt(trip.from, { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  onClick={() => selectIfNotDragging(trip.id)}
                >
                  {tier === 'full' && <Thumb trip={trip} selected={sel} past={past} />}
                  {(tier !== 'dot' || showName) && <span className="hol-stop-name">{trip.dest || 'Untitled'}</span>}
                  <span className={`hol-dot${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`} aria-hidden="true" />
                  {tier === 'full' && (
                    <span className="hol-stop-when">
                      {fmt(trip.from, { day: 'numeric', month: 'short' })} ’{String(dayAt(trip.from).getFullYear()).slice(2)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="hol-rail-nodates">No trip has dates yet — add one and it lands on the timeline.</div>
        )}
      </div>

      <div className="hol-rail-foot">
        <span className="hol-rail-hint">Drag to pan · ⌘/Ctrl + scroll to zoom</span>
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

/** "1 day" / "1 week" per ~44px — a scale you can reason about, rather
 *  than a raw px-per-day figure nobody can picture. */
function zoomLabel(pxPerDay) {
  const daysPerTick = 44 / pxPerDay;
  if (daysPerTick <= 5) return 'Days';
  if (daysPerTick <= 20) return 'Weeks';
  if (daysPerTick <= 75) return 'Months';
  return 'Years';
}

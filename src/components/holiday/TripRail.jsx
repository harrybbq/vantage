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
 * The horizontal rail scrolls, and it opens centred on today rather than
 * at the left edge — the left edge is 2025, which is nobody's question.
 */
import { useEffect, useRef } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { fmt, railGeometry, railTicks, dayAt, daysUntil } from '../../lib/holiday/timeline';

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
  const geo = railGeometry(trips, now);

  // Open centred on today. Done once per mount rather than on every
  // render, or scrolling the rail by hand would keep snapping back.
  const centred = useRef(false);
  useEffect(() => {
    if (isMobile || centred.current || !geo || !scroller.current) return;
    centred.current = true;
    centreOnToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, !!geo]);

  function centreOnToday() {
    const el = scroller.current;
    if (!el || !geo) return;
    el.scrollTo({ left: Math.max(0, geo.today - el.clientWidth / 2), behavior: centred.current ? 'smooth' : 'auto' });
  }

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
  return (
    <div className="hol-rail-card" data-hub-module="holiday-rail" data-hub-module-label="Timeline">
      <div className="hol-rail-head">
        <span className="hol-rail-eyebrow">Timeline</span>
        <span className="hol-rail-line" aria-hidden="true" />
        <span className="hol-rail-key">
          <span><i className="hol-key-dot is-up" />Upcoming</span>
          <span><i className="hol-key-dot is-past" />Archived</span>
        </span>
        <button type="button" className="hol-rail-jump" onClick={centreOnToday}>Jump to today</button>
      </div>

      <div className="hol-rail-scroll" ref={scroller}>
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

            {trips.map(trip => {
              const left = geo.atIso(trip.from);
              if (left == null) return null;      // undated trips have no place on a timeline
              const past = isPast(trip, now);
              const sel = trip.id === selectedId;
              return (
                <button
                  key={trip.id}
                  type="button"
                  className={`hol-stop${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`}
                  style={{ left: left + 'px' }}
                  aria-current={sel ? 'true' : undefined}
                  onClick={() => onSelect(trip.id)}
                >
                  <Thumb trip={trip} selected={sel} past={past} />
                  <span className="hol-stop-name">{trip.dest || 'Untitled'}</span>
                  <span className={`hol-dot${sel ? ' is-sel' : ''}${past ? ' is-past' : ''}`} aria-hidden="true" />
                  <span className="hol-stop-when">
                    {fmt(trip.from, { day: 'numeric', month: 'short' })} ’{String(dayAt(trip.from).getFullYear()).slice(2)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="hol-rail-nodates">No trip has dates yet — add one and it lands on the timeline.</div>
        )}
      </div>

      {/* Undated trips still need a way in. They cannot sit on a
          timeline, so they queue underneath it rather than vanishing. */}
      {trips.some(t => !dayAt(t.from)) && (
        <div className="hol-undated">
          <span className="hol-rail-eyebrow">No dates yet</span>
          {trips.filter(t => !dayAt(t.from)).map(t => (
            <button key={t.id} type="button"
                    className={`hol-undated-chip${t.id === selectedId ? ' is-sel' : ''}`}
                    onClick={() => onSelect(t.id)}>{t.dest || 'Untitled'}</button>
          ))}
        </div>
      )}
    </div>
  );
}

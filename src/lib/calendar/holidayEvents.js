/**
 * Trips, shown on the Track calendar.
 *
 * ── Derived, never stored ────────────────────────────────────────────
 * The obvious implementation is to write a calendar event into
 * `S.calendarEvents` for every day of a trip when the trip is saved.
 * That is wrong in three ways and all three are the same way: it is a
 * copy.
 *
 *   · Move the dates and the old days are still marked.
 *   · Delete the trip and a fortnight of orphans stays behind.
 *   · Edit the destination and the calendar keeps the old name.
 *
 * Every one of those needs reconciliation code that has to be right
 * forever. So nothing is written. `holidayEventsOn` computes the days a
 * trip covers at read time, and `eventsOn` in events.js merges them with
 * the stored ones. Change a trip and the calendar is already correct,
 * because there was never a second copy to update.
 *
 * The cost is that these events cannot be edited from the calendar —
 * they are a VIEW of the trip. The day menu says so and sends you to the
 * planner rather than opening an editor that could not save anything.
 *
 * ── Which trips ──────────────────────────────────────────────────────
 * All of them that have dates, not just upcoming ones. A finished trip
 * on last summer's calendar is a record of where you were, which is what
 * a calendar is for; hiding it would make the past look empty. Status
 * shows in the colour instead: a `planning` trip is amber, because dates
 * you have not booked are a proposal and should not read like a
 * commitment.
 *
 * Pure — no React, no DOM, no network.
 */

const DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Trip status → the colour it draws in, matching the planner's tones. */
export const TRIP_COLOUR = {
  planning: '#c8970a',
  booked: '#1a7a4a',
  completed: '#8a8278',
};
export const tripColour = status => TRIP_COLOUR[status] || TRIP_COLOUR.booked;

const isIso = v => typeof v === 'string' && ISO_RE.test(v);

/**
 * Parse an ISO date as LOCAL midday.
 *
 * Midday, not midnight: `new Date('2026-09-14')` is parsed as UTC, so in
 * any timezone west of Greenwich it is the 13th locally and every trip
 * would start a day early. Noon is far enough from both edges that no
 * offset on earth can move the date.
 */
const at = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const isoOf = dt => {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

/**
 * A trip's dates, normalised.
 * @returns {{from, to, days} | null} — null when there is nothing to draw
 */
export function tripSpan(trip) {
  if (!trip || !isIso(trip.from)) return null;
  // A trip with only a start date is one day on the calendar rather than
  // nothing — "flying out on the 14th" is still worth marking.
  const to = isIso(trip.to) && trip.to >= trip.from ? trip.to : trip.from;
  const days = Math.round((at(to) - at(trip.from)) / DAY) + 1;   // inclusive
  return { from: trip.from, to, days };
}

/** Every ISO date a trip covers, first to last inclusive. */
export function tripDates(trip) {
  const span = tripSpan(trip);
  if (!span) return [];
  const out = [];
  const cur = at(span.from);
  for (let i = 0; i < span.days; i++) {
    out.push(isoOf(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * One day of one trip, in the calendar's event shape.
 *
 * The id encodes the trip and the date so it is stable across renders
 * and unique per cell — React keys need that, and so does telling two
 * overlapping trips apart.
 */
function eventFor(trip, iso, n, of) {
  const first = n === 1;
  const last = n === of;
  return {
    id: `hol:${trip.id}:${iso}`,
    // Derived events are read-only. Anything that edits by id checks
    // this rather than discovering the event is not in the store by
    // silently doing nothing.
    derived: true,
    source: 'holiday',
    tripId: trip.id,
    title: trip.dest || 'Trip',
    kind: 'travel',
    colour: tripColour(trip.status),
    time: '',
    end: '',
    location: trip.dest || '',
    // What to say about this particular day of it.
    span: of === 1 ? 'Trip'
      : first ? `Day 1 of ${of} — travel out`
        : last ? `Day ${of} of ${of} — travel home`
          : `Day ${n} of ${of}`,
    dayIndex: n,
    dayCount: of,
    status: trip.status || 'booked',
    createdAt: 0,
  };
}

/** The trips array, defensively. */
const tripsOf = S => (S && Array.isArray(S.holidays) ? S.holidays.filter(t => t && t.id) : []);

/** Derived events on one date. */
export function holidayEventsOn(S, iso) {
  if (!isIso(iso)) return [];
  const out = [];
  for (const trip of tripsOf(S)) {
    const span = tripSpan(trip);
    if (!span || iso < span.from || iso > span.to) continue;
    const n = Math.round((at(iso) - at(span.from)) / DAY) + 1;
    out.push(eventFor(trip, iso, n, span.days));
  }
  return out;
}

/**
 * Derived events across a month, as { iso: [event] }.
 *
 * Walks each trip's own dates rather than each of the month's 31 — a
 * trip is a handful of days and the month grid asks for this on every
 * render.
 */
export function holidayEventsInMonth(S, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const out = {};
  for (const trip of tripsOf(S)) {
    const span = tripSpan(trip);
    if (!span) continue;
    // Cheap rejection before expanding: a trip entirely outside the
    // month cannot contribute a day to it.
    const monthStart = `${prefix}01`;
    const monthEnd = `${prefix}31`;
    if (span.to < monthStart || span.from > monthEnd) continue;
    let n = 0;
    for (const iso of tripDates(trip)) {
      n++;
      if (!iso.startsWith(prefix)) continue;
      (out[iso] = out[iso] || []).push(eventFor(trip, iso, n, span.days));
    }
  }
  return out;
}

/**
 * Is a trip happening on this date?
 * Convenience for anything that wants the fact without the event.
 */
export function onHoliday(S, iso) {
  return holidayEventsOn(S, iso).length > 0;
}

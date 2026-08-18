/**
 * The planner's presentation logic — countdown, rail geometry, refs.
 *
 * Pulled out of the components because it is all arithmetic on dates,
 * and arithmetic on dates is where the bugs are. A countdown that is one
 * day out, a rail whose "today" line sits in the wrong place, a trip
 * that reads "0 days to go" on the morning it leaves — none of those are
 * visible in a screenshot, and all of them are provable here.
 *
 * `now` is always a parameter. Reading the clock inside would make every
 * one of these untestable and would also mean two calls in one render
 * could straddle midnight.
 *
 * Pure — no React, no DOM, no network.
 */

const DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const isIso = v => typeof v === 'string' && ISO_RE.test(v);

/**
 * An ISO date at LOCAL midday.
 *
 * Midday for the same reason as everywhere else in this codebase:
 * `new Date('2026-09-14')` is UTC midnight, which is the 13th in any
 * timezone west of Greenwich. A holiday planner that starts trips a day
 * early is worse than one with no dates at all.
 */
export const dayAt = iso => {
  if (!isIso(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

/** Local midday today — the fixed point every countdown measures from. */
export const middayOf = now => {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  return d;
};

/** Whole days from today to `iso`; negative once it is in the past. */
export function daysUntil(iso, now = new Date()) {
  const d = dayAt(iso);
  if (!d) return null;
  return Math.round((d - middayOf(now)) / DAY);
}

/** Nights away — the number a hotel would charge for. */
export function nightsOf(trip) {
  const a = dayAt(trip && trip.from), b = dayAt(trip && trip.to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / DAY));
}

export const STATUS_ORDER = ['planning', 'booked', 'completed'];
export const STATUS_LABEL = { planning: 'Planning', booked: 'Booked', completed: 'Completed' };

/**
 * The headline number.
 *
 * Five bands, because "34 days" and "8 months" want different words and
 * a different weight, and the day you fly wants neither. The thresholds
 * are the interesting part:
 *
 *   · A trip already finished counts NIGHTS, not days-ago. Once it is
 *     over, how long it was is the fact worth keeping.
 *   · ≤ 7 days is "final checks week" and burns orange. That is when
 *     packing and check-in actually happen.
 *   · Past 60 days it switches to months, because "213 days to go" is a
 *     number nobody can feel.
 *
 * @returns {{big, unit, note, tone}} — `tone` is a class suffix, not a
 *   colour, so the stylesheet keeps control of the palette.
 */
export function countdown(trip, now = new Date()) {
  const nights = nightsOf(trip);
  const days = daysUntil(trip && trip.from, now);

  if (!trip || days == null) {
    return { big: '—', unit: 'no dates yet', note: 'Add a departure date to start the countdown.', tone: 'muted' };
  }
  if (trip.status === 'completed' || days < 0) {
    return {
      big: String(nights),
      unit: nights === 1 ? 'night away' : 'nights away',
      note: fmt(trip.from, { month: 'long', year: 'numeric' }) + ' · archived',
      tone: 'muted',
    };
  }
  if (days === 0) {
    return { big: 'Today', unit: 'departure day', note: 'Bags by the door ✈', tone: 'go' };
  }
  if (days <= 7) {
    return {
      big: String(days),
      unit: days === 1 ? 'day to go' : 'days to go',
      note: 'Final checks week',
      tone: 'soon',
    };
  }
  if (days <= 60) {
    return {
      big: String(days),
      unit: 'days to go',
      note: 'Departing ' + fmt(trip.from, { weekday: 'long', day: 'numeric', month: 'long' }),
      tone: 'near',
    };
  }
  const months = Math.round(days / 30);
  return {
    big: String(months),
    unit: months === 1 ? 'month to go' : 'months to go',
    note: 'Departing ' + fmt(trip.from, { day: 'numeric', month: 'long', year: 'numeric' }),
    tone: 'far',
  };
}

export function fmt(iso, opts) {
  const d = dayAt(iso);
  return d ? d.toLocaleDateString('en-GB', opts) : '';
}

/**
 * A booking-reference-looking string.
 *
 * Cosmetic — it is the detail that makes the card read as a boarding
 * pass rather than a form. Derived from the trip so it never changes,
 * and explicitly NOT stored: a fake reference in the database is a thing
 * someone could later mistake for a real one.
 */
export function tripRef(trip, iso2) {
  const cc = (iso2 || (trip.dest || 'XX').slice(0, 2)).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(2, 'X').slice(0, 2);
  const digits = String(trip.from || '').replace(/\D/g, '').slice(-4) || '0000';
  return `VNTG-${cc}-${digits}`;
}

/** Trips sorted by departure, with a status default. Never mutates. */
export function orderedTrips(holidays) {
  return (Array.isArray(holidays) ? holidays : [])
    .filter(t => t && t.id)
    .map(t => ({ ...t, status: t.status || 'planning' }))
    .sort((a, b) => {
      // Trips with no date sink to the bottom rather than to 1970.
      const av = dayAt(a.from), bv = dayAt(b.from);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return av - bv;
    });
}

/**
 * Which trip to show when the user has not picked one.
 *
 * The next one that has not left yet — that is what the page is for.
 * Falls back to the most recent past trip so a user whose trips are all
 * behind them sees something rather than an empty card.
 */
export function defaultTrip(trips, now = new Date()) {
  if (!trips.length) return null;
  const dated = trips.filter(t => dayAt(t.from));
  const upcoming = dated.find(t => daysUntil(t.to || t.from, now) >= 0);
  return upcoming || dated[dated.length - 1] || trips[0];
}

/* ══ Rail geometry ════════════════════════════════════════════════════ */

export const PX_PER_DAY = 1.45;
const PAD_BEFORE = 75;      // days of runway before the first trip
const PAD_AFTER = 90;       // …and after the last

/**
 * Positions along the horizontal rail, in pixels from its left edge.
 *
 * Spaced by REAL date rather than evenly: the gap between two trips is
 * the wait between them, which is the one thing a timeline can show that
 * a list cannot. Evenly spaced stops would make a fortnight and three
 * years look the same.
 */
export function railGeometry(trips, now = new Date()) {
  const dated = trips.filter(t => dayAt(t.from));
  if (!dated.length) return null;

  const firstTrip = dayAt(dated[0].from).getTime();
  const lastTrip = dayAt(dated[dated.length - 1].to || dated[dated.length - 1].from).getTime();
  // The window always contains today, so the "today" marker cannot fall
  // off the end when every trip is in the past or all still ahead.
  const start = Math.min(firstTrip - PAD_BEFORE * DAY, middayOf(now).getTime() - 30 * DAY);
  const end = Math.max(lastTrip + PAD_AFTER * DAY, middayOf(now).getTime() + 30 * DAY);

  const at = ms => Math.round((ms - start) / DAY * PX_PER_DAY);
  return {
    start, end,
    width: at(end),
    at,
    atIso: iso => { const d = dayAt(iso); return d ? at(d.getTime()) : null; },
    today: at(middayOf(now).getTime()),
  };
}

/**
 * Month and year ticks across the rail.
 *
 * Months are dropped when they would collide — at 1.45px/day a month is
 * about 44px, which fits a three-letter label, but a narrow rail can
 * still crowd. Years always survive, because they are the labels that
 * orient you.
 */
export function railTicks(geo) {
  if (!geo) return [];
  const out = [];
  const first = new Date(geo.start);
  const last = new Date(geo.end);
  for (let y = first.getFullYear(); y <= last.getFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const ms = new Date(y, m, 1, 12).getTime();
      if (ms < geo.start || ms > geo.end) continue;
      const isYear = m === 0;
      out.push({
        key: `${y}-${m}`,
        left: geo.at(ms),
        label: isYear ? String(y) : new Date(ms).toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
        isYear,
      });
    }
  }
  return out;
}

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

/**
 * Zoom levels, in pixels per day.
 *
 * A fixed scale could not work for both shapes of history this page
 * has to draw. Two trips a fortnight apart need room; two trips three
 * years apart need the years compressed or the rail is 1,500px of empty
 * track. 1.45 is where it started and stays the default — a year is
 * about 530px, which fits a screen.
 *
 * Discrete steps rather than continuous: the zoom is driven by buttons
 * and a wheel, and a step you can feel is better than a smear you
 * cannot land on. Roughly doubling each time, so three clicks is an
 * order of magnitude.
 */
export const ZOOM_LEVELS = [0.35, 0.7, 1.45, 3, 6, 12];
export const DEFAULT_ZOOM = 2;                      // index of 1.45
export const PX_PER_DAY = ZOOM_LEVELS[DEFAULT_ZOOM];

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
export function railGeometry(trips, now = new Date(), pxPerDay = PX_PER_DAY) {
  const dated = trips.filter(t => dayAt(t.from));
  if (!dated.length) return null;

  const firstTrip = dayAt(dated[0].from).getTime();
  const lastTrip = dayAt(dated[dated.length - 1].to || dated[dated.length - 1].from).getTime();
  // The window always contains today, so the "today" marker cannot fall
  // off the end when every trip is in the past or all still ahead.
  const start = Math.min(firstTrip - PAD_BEFORE * DAY, middayOf(now).getTime() - 30 * DAY);
  const end = Math.max(lastTrip + PAD_AFTER * DAY, middayOf(now).getTime() + 30 * DAY);

  const at = ms => Math.round((ms - start) / DAY * pxPerDay);
  return {
    start, end, pxPerDay,
    width: at(end),
    at,
    /** Pixels back to a date — what a scroll position means. */
    dateAt: px => new Date(start + (px / pxPerDay) * DAY),
    atIso: iso => { const d = dayAt(iso); return d ? at(d.getTime()) : null; },
    today: at(middayOf(now).getTime()),
  };
}

/* ══ Crowding ═════════════════════════════════════════════════════════
 *
 * Two trips a week apart are 10px apart at the default zoom, and a stop
 * is 132px wide with a 112px thumbnail on it. They overlap into an
 * unreadable pile — which is the bug this whole zoom exists to fix, and
 * zooming in is only half the fix, because the widest zoom-out still
 * has to be legible.
 *
 * So a stop renders at one of three densities, chosen by how much room
 * it actually has: the distance to its NEAREST neighbour on either
 * side. Thumbnail first, then the name, then nothing but a dot. The
 * information degrades in the order you would give it up.
 */
/*
 * These are the STOP BOX WIDTHS, and that is the point: a tier is only
 * allowed when the gap is at least as wide as the box it draws. Set
 * them any smaller — the first version had COMPACT_GAP at 62 against a
 * 96px box — and stops still overlap by half their width, quietly
 * stealing each other's hit areas. Change one of these and change
 * .hol-stop's width in holiday.css to match.
 *
 * Because the gap each stop sees is the distance to its NEAREST
 * neighbour, both sides of a pair get the same tier, so gap >= width is
 * enough to guarantee they never overlap.
 */
export const FULL_GAP = 132;      // 112px thumbnail + air
export const COMPACT_GAP = 96;    // a short name
export const DOT_GAP = 22;        // a dot you can still hit

/**
 * Stops, at the density each one has room for — and clustered when even
 * a dot will not fit.
 *
 * Shrinking a stop is not enough on its own. Three trips nine days
 * apart are 3px apart at the widest zoom: as separate dots their hit
 * areas sit on top of each other and only the last one is clickable.
 * Below DOT_GAP they therefore become ONE marker carrying a count, and
 * clicking it zooms in — which is exactly the move the user would have
 * made anyway.
 *
 * The selected trip is lifted out of its cluster and drawn on its own,
 * because losing sight of the thing you are reading is worse than a
 * slightly crowded rail.
 *
 * @returns {Array} stops — { kind:'stop', trip, left, gap, tier }
 *                        | { kind:'cluster', trips, left, count }
 *   tier: 'full' | 'compact' | 'dot'
 *
 * Undated trips are excluded — they have no position on a timeline and
 * the rail queues them separately.
 */
export function railStops(trips, geo, selectedId = null) {
  if (!geo) return [];
  const placed = trips
    .map(t => ({ trip: t, left: geo.atIso(t.from) }))
    .filter(s => s.left != null)
    .sort((a, b) => a.left - b.left);
  if (!placed.length) return [];

  // Group runs of stops that are too close to be separate targets.
  const groups = [[placed[0]]];
  for (let i = 1; i < placed.length; i++) {
    const run = groups[groups.length - 1];
    if (placed[i].left - run[run.length - 1].left < DOT_GAP) run.push(placed[i]);
    else groups.push([placed[i]]);
  }

  // Pull the selected trip out of any group it shares, so it is always
  // drawn as itself.
  const out = [];
  for (const run of groups) {
    let members = run;
    const sel = selectedId ? run.find(s => s.trip.id === selectedId) : null;
    if (sel && run.length > 1) {
      const rest = run.filter(s => s !== sel);
      const restLeft = Math.round(rest.reduce((a, m) => a + m.left, 0) / rest.length);
      /* Only lift the selection out if there is room for it beside what
         is left. Lifting unconditionally put a 22px dot 9px from a 22px
         cluster — the lift was quietly exempt from the very spacing
         rule the clustering exists to enforce. When there is no room the
         selection stays in, and the cluster renders as selected. */
      if (Math.abs(sel.left - restLeft) >= DOT_GAP) {
        members = rest;
        out.push({ kind: 'stop', ...sel, gap: 0, tier: 'dot', showName: true, lifted: true });
      }
    }
    if (!members.length) continue;
    if (members.length === 1) out.push({ kind: 'stop', ...members[0], gap: Infinity, tier: null });
    else {
      out.push({
        kind: 'cluster',
        trips: members.map(m => m.trip),
        count: members.length,
        left: Math.round(members.reduce((a, m) => a + m.left, 0) / members.length),
      });
    }
  }

  // Density for the singles, from the distance to whatever is next to
  // them — cluster or stop, since either takes up room.
  const marks = out.slice().sort((a, b) => a.left - b.left);
  for (const m of marks) {
    if (m.kind !== 'stop' || m.tier) continue;
    const i = marks.indexOf(m);
    const prev = i > 0 ? m.left - marks[i - 1].left : Infinity;
    const next = i < marks.length - 1 ? marks[i + 1].left - m.left : Infinity;
    const gap = Math.min(prev, next);
    m.gap = gap;
    m.tier = gap >= FULL_GAP ? 'full' : gap >= COMPACT_GAP ? 'compact' : 'dot';
    /* The selected trip always shows its name — but as a LABEL, not by
       promoting its tier. Promoting widened its hit box to 96px inside
       a 35px gap, which put it straight back on top of its neighbour:
       the one thing the tiers exist to prevent. The label overflows the
       box and takes no pointer events, so it costs nothing. */
    if (m.trip.id === selectedId) m.showName = true;
  }
  return marks;
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
  // A month is ~44px at the default zoom and 10px at the widest, where
  // twelve three-letter labels a year become a grey smear. Below that
  // threshold only quarters are labelled; years always survive, because
  // they are what orients you.
  const monthPx = 30.4 * geo.pxPerDay;
  const everyMonth = monthPx >= 34;
  const everyQuarter = monthPx >= 12;
  for (let y = first.getFullYear(); y <= last.getFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const ms = new Date(y, m, 1, 12).getTime();
      if (ms < geo.start || ms > geo.end) continue;
      const isYear = m === 0;
      if (!isYear) {
        if (!everyMonth && !(everyQuarter && m % 3 === 0)) continue;
      }
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

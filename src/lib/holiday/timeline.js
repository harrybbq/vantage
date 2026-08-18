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
/*
 * Zoom is a CONTINUOUS px-per-day, not one of a few steps.
 *
 * The wheel drives it now, and a wheel delivers a stream of small
 * deltas — quantising those to six stops turns a smooth gesture into a
 * series of jumps. The buttons multiply by a fixed ratio so they still
 * have a notch you can feel.
 *
 * The default moved IN, from 1.45 to 6. Bands only read as photographs
 * once a trip is about 60px wide, and at 1.45 a fortnight was 20px — a
 * sliver. At 6 a fortnight is 84px and a season fits the screen, which
 * is the right window for a planner anyway.
 */
export const PX_PER_DAY = 6;
export const MIN_PX_DAY = 0.15;
export const MAX_PX_DAY = 48;
export const ZOOM_STEP = 1.8;                        // one button press
/* Number.isFinite, not `||` — `0 || PX_PER_DAY` is 6, so a zoom of zero
   silently became the default instead of clamping to the minimum. */
export const clampZoom = v =>
  (Number.isFinite(v) ? Math.min(MAX_PX_DAY, Math.max(MIN_PX_DAY, v)) : PX_PER_DAY);

/**
 * A wheel delta → a new scale.
 *
 * Exponential, so one notch feels the same at 0.2 px/day as at 20 — a
 * linear step would crawl when zoomed out and leap when zoomed in.
 */
export const wheelZoom = (pxPerDay, deltaY) => clampZoom(pxPerDay * Math.exp(-deltaY * 0.0016));

/** Where today sits across the rail on first paint.
 *  Not 1.0: flush right puts every upcoming trip off-screen, including
 *  the next one, which is the trip the page mostly exists for. */
export const TODAY_ANCHOR = 0.72;

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
export function railGeometry(trips, now = new Date(), pxPerDay = PX_PER_DAY, padPx = 0) {
  const dated = trips.filter(t => dayAt(t.from));
  if (!dated.length) return null;

  const firstTrip = dayAt(dated[0].from).getTime();
  const lastTrip = dayAt(dated[dated.length - 1].to || dated[dated.length - 1].from).getTime();
  /* The window always contains today, so the marker cannot fall off the
     end when every trip is behind or all still ahead. `padPx` is a
     viewport width in pixels, converted to days at the current scale:
     without it there is not always enough rail to the left of today to
     put today at TODAY_ANCHOR, and the anchor silently clamps. */
  const padDays = padPx / Math.max(0.01, pxPerDay);
  const start = Math.min(firstTrip - PAD_BEFORE * DAY, middayOf(now).getTime() - 30 * DAY) - padDays * DAY;
  const end = Math.max(lastTrip + PAD_AFTER * DAY, middayOf(now).getTime() + 30 * DAY) + padDays * DAY;

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

/* ══ Bands ════════════════════════════════════════════════════════════
 *
 * A trip is drawn as a band covering the dates it actually spans, with
 * its own photo as the fill.
 *
 * The versions before this drew a fixed-width thumbnail on a dot, which
 * meant two trips a week apart overlapped by 100px. Shrinking them lost
 * the photo; hiding them behind a cluster marker lost the trip. Bands
 * make the collision impossible instead of managing it: two trips cannot
 * occupy the same dates, so two bands cannot occupy the same pixels. The
 * thing that was colliding no longer exists.
 *
 * It also puts duration on screen for the first time. A weekend and a
 * fortnight were the same dot; now one is seven times wider than the
 * other, and the gaps between bands are the waits between trips.
 *
 * Axis-neutral on purpose — `start` and `size` are along the time axis,
 * whichever way the component draws it. Desktop maps them to left/width,
 * the phone to top/height.
 */

/** A band this narrow is still a visible sliver rather than nothing. */
export const MIN_BAND = 14;
/** Rough width of a character in the band's label font, for deciding
 *  whether the name fits inside. An estimate is fine: it only chooses
 *  inside vs outside, and the CSS ellipsises either way. */
export const LABEL_CHAR_W = 6.7;
export const LABEL_PAD = 20;
/** Rows available above the bands for names that will not fit inside. */
export const OUT_ROWS = 3;
/** Clear space demanded between two labels sharing a row. */
export const OUT_GAP = 8;
/** How far a label may be dragged off its band before it stops being
 *  worth drawing a leader to — past this it is lying about which band it
 *  belongs to, so the band keeps the label and the row moves instead. */
export const OUT_LEAD_MAX = 90;
/** A vertical band needs this much of the time axis to hold one line. */
export const V_INSIDE = 26;
/** …and this much room along the axis for an outside chip. */
export const V_OUT_EXTENT = 19;

/**
 * Every dated trip as a band.
 *
 * @returns {Array<{trip, start, size, end, labelInside, outRow, outAt, lead, depth, selected}>}
 *   `outAt` is where an outside label starts along the axis and `lead`
 *   the distance from there back to the band, for the leader rule.
 *   `depth` is how many earlier bands this one sits inside — nearly
 *   always 0, but a day trip booked inside a longer stay is real, and
 *   the shorter band insets and draws on top rather than vanishing
 *   under the longer one.
 */
export function railBands(trips, geo, selectedId = null, opts = {}) {
  if (!geo) return [];
  const minBand = opts.minBand || MIN_BAND;
  const charW = opts.charW || LABEL_CHAR_W;
  /* The phone draws the same bands rotated: full-width strips whose
     size along the axis is height. A name fits inside one of those when
     the band is TALL enough, not wide enough — the same question asked
     of a different dimension, which is why it is a flag here and not a
     second function. */
  const vertical = !!opts.vertical;

  const placed = trips
    .map(t => {
      const a = dayAt(t.from);
      if (!a) return null;
      const b = dayAt(t.to && t.to >= t.from ? t.to : t.from);
      // +1 day: a trip that ends on the 27th occupies the whole of the
      // 27th, so the band runs to the start of the 28th.
      const s0 = geo.at(a.getTime());
      const s1 = geo.at(b.getTime() + DAY);
      return { trip: t, start: s0, raw: Math.max(1, s1 - s0), size: Math.max(1, s1 - s0) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || b.size - a.size);

  /* The minimum width only grows into space that is actually free.
     Applying it unconditionally pushed a one-day band 14px wide over the
     trip three days after it — reintroducing the overlap that bands
     exist to make impossible. A band never grows past the next one's
     start; where there is no room it stays its true width, which is
     honest and still visible. */
  for (let i = 0; i < placed.length; i++) {
    const room = i < placed.length - 1 ? placed[i + 1].start - placed[i].start - 1 : Infinity;
    placed[i].size = Math.max(placed[i].raw, Math.min(minBand, room));
  }

  // Depth: how many already-open bands this one begins inside.
  const open = [];
  for (const band of placed) {
    while (open.length && open[open.length - 1].end <= band.start) open.pop();
    band.depth = open.length;
    band.end = band.start + band.size;
    open.push(band);
    open.sort((a, b) => a.end - b.end);
  }

  /* ── Labels ───────────────────────────────────────────────────────
     Inside the band when the name fits and nothing is drawn over it;
     otherwise on a row above, anchored to the band's LEFT EDGE.

     Centring them was the mistake in the first cut. A centred label
     floats between its band and the next one with nothing to say which
     it belongs to, and near the ends of the rail half of it is outside
     the inner and gets clipped. Left-anchored, the label starts exactly
     where its band starts and a leader rule drops from its first
     character onto the band's corner, so the association is drawn
     rather than inferred. */
  const rows = vertical ? 1 : (opts.rows || OUT_ROWS);
  const rowEnd = new Array(rows).fill(-Infinity);

  for (const band of placed) {
    const name = band.trip.dest || 'Untitled';
    band.selected = band.trip.id === selectedId;
    const textW = name.length * charW;

    /* A day trip booked inside a fortnight draws on top of the longer
       band — including over the longer band's name. Whoever is covered
       loses the inside label rather than keeping an unreadable one. */
    const labelZone = vertical
      ? [band.end - V_INSIDE, band.end]
      : [band.start, band.start + textW + LABEL_PAD];
    const covered = placed.some(o => o !== band && o.depth > band.depth
      && o.start < labelZone[1] && o.start + o.size > labelZone[0]);

    band.labelInside = !covered
      && (vertical ? band.size >= V_INSIDE : band.size >= textW + LABEL_PAD);
    if (band.labelInside) { band.outRow = null; band.outAt = null; band.lead = 0; continue; }

    /* Extent along the time axis: a horizontal label is as long as its
       text, a vertical chip is one line tall whatever it says. */
    const extent = vertical ? V_OUT_EXTENT : textW + 12;
    // Clamped into the rail so no label is half-drawn at either end.
    const wanted = Math.max(0, Math.min(band.start, geo.width - extent));

    /* First row with clear space. Sorted by start, so a row's last
       label is always the one to the left of this one. */
    let row = rowEnd.findIndex(e => wanted >= e + OUT_GAP);
    let at = wanted;
    if (row < 0) {
      /* Every row is busy here. Prefer nudging along the axis on the
         emptiest row over stacking a fourth row nobody can trace — but
         only while the leader still reaches the band. */
      row = rowEnd.reduce((best, e, i) => (e < rowEnd[best] ? i : best), 0);
      at = rowEnd[row] + OUT_GAP;
      if (at - band.start > OUT_LEAD_MAX) at = wanted;   // overlap beats lying
    }
    rowEnd[row] = at + extent;
    band.outRow = row;
    band.outAt = at;
    band.lead = band.start - at;   // where the leader meets the band
  }
  return placed;
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

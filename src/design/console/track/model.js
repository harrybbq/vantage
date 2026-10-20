/**
 * The console calendar's view model — date arithmetic and read-only
 * projections of S. Pure: no React, no DOM, no clock (today is passed in).
 *
 * Every read goes through the existing seams:
 *   events / trips / spans   lib/calendar/events.js (eventsInMonth, eventsOn)
 *   bar lanes                lib/calendar/spans.js  (barLayout)
 *   bills                    lib/money/recurring.js (nextRenewal)
 *   tracker done             lib/trackers/done.js   (trackerDone)
 *   trips                    lib/holiday/*          (timeline, holidayEvents)
 * Nothing here writes, and nothing copies a trip into the calendar store.
 */
import { eventsInMonth, eventColour } from '../../../lib/calendar/events.js';
import { barLayout, spansOf, addDays } from '../../../lib/calendar/spans.js';
import { tripSpan, tripDates } from '../../../lib/calendar/holidayEvents.js';
import { nextRenewal } from '../../../lib/money/recurring.js';
import { trackerDone } from '../../../lib/trackers/done.js';
import { orderedTrips, daysUntil, dayAt, nightsOf } from '../../../lib/holiday/timeline.js';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const p2 = n => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${p2(m + 1)}-${p2(d)}`;
export const partsOf = iso => { const [y, m, d] = iso.split('-').map(Number); return { y, m: m - 1, d }; };
export { addDays };

/** Monday of the week containing `iso`. */
export function mondayOf(iso) {
  const { y, m, d } = partsOf(iso);
  const dow = (new Date(y, m, d, 12).getDay() + 6) % 7;
  return addDays(iso, -dow);
}

/**
 * The month grid, Monday-first, whole weeks: [[{ iso, day, inMonth, col }×7]…].
 * Days from the neighbouring months fill the first and last rows.
 */
export function monthMatrix(year, month) {
  const first = isoOf(year, month, 1);
  const start = mondayOf(first);
  const dim = new Date(year, month + 1, 0).getDate();
  const last = isoOf(year, month, dim);
  const end = addDays(mondayOf(last), 6);
  const weeks = [];
  for (let iso = start, i = 0; iso <= end; iso = addDays(iso, 1), i++) {
    if (i % 7 === 0) weeks.push([]);
    const { m, d } = partsOf(iso);
    weeks[weeks.length - 1].push({ iso, day: d, inMonth: m === month, col: i % 7 });
  }
  return weeks;
}

/** The seven days of the week starting Monday `monday`. */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(monday, i);
    return { iso, day: partsOf(iso).d, col: i, inMonth: true };
  });
}

/**
 * Bars (trips and multi-day events) for one row of days, from barLayout's
 * per-day lanes: [{ key, ev, lane, from, to, isStart, isEnd }], one per
 * bar per lane run. `layout` is barLayout(...)'s output for the month(s)
 * the row's days belong to.
 */
export function rowBands(days, layout) {
  const runs = new Map();
  for (const { iso, col } of days) {
    const lanes = (layout[iso] && layout[iso].lanes) || [];
    lanes.forEach((seg, lane) => {
      if (!seg) return;
      const k = seg.key + '@' + lane;
      const r = runs.get(k);
      if (r && r.to === col - 1) { r.to = col; r.isEnd = seg.isEnd; }
      else if (!r) runs.set(k, { key: seg.key, ev: seg.ev, lane, from: col, to: col, isStart: seg.isStart, isEnd: seg.isEnd });
    });
  }
  return [...runs.values()].sort((a, b) => a.lane - b.lane || a.from - b.from);
}

/**
 * Events and bar lanes for any run of dates (a month grid with its
 * spill-over days, or a week crossing a month end): { events: {iso:[…]},
 * layout: {iso:{lanes}} }, built from eventsInMonth/barLayout per month.
 * Lanes are per month (barLayout's unit), so a week straddling a month
 * end keeps each side's own lane order — acceptable; it matches classic.
 */
export function eventsForDays(S, isos) {
  const months = new Set(isos.map(iso => iso.slice(0, 7)));
  const events = {}, layout = {};
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number);
    const evs = eventsInMonth(S, y, m - 1);
    Object.assign(events, evs);
    Object.assign(layout, barLayout(evs, y, m - 1));
  }
  return { events, layout };
}

/**
 * Subscription renewals between two dates inclusive: { iso: [{ id, name, amount }] }.
 * Forward from each stored renewal date only (nextRenewal rolls a past
 * anchor forward); past charges are not invented.
 */
export function billsInRange(S, fromIso, toIso) {
  const out = {};
  const subs = (S && Array.isArray(S.subscriptions)) ? S.subscriptions : [];
  const from = dayAt(fromIso), to = dayAt(toIso);
  if (!from || !to) return out;
  for (const sub of subs) {
    if (!sub || !sub.nextDate) continue;
    let occ = nextRenewal(sub, from);
    let guard = 0;
    while (occ && occ <= to && guard++ < 60) {
      const iso = isoOf(occ.getFullYear(), occ.getMonth(), occ.getDate());
      (out[iso] = out[iso] || []).push({ id: sub.id, name: sub.name || 'Subscription', amount: Number(sub.amount) || 0 });
      const after = new Date(occ.getFullYear(), occ.getMonth(), occ.getDate() + 1);
      const nxt = nextRenewal(sub, after);
      if (!nxt || nxt <= occ) break;
      occ = nxt;
    }
  }
  return out;
}

/** £11.99 / £239 */
export function money(n) {
  const v = Number(n) || 0;
  return '£' + (Number.isInteger(v) ? v.toLocaleString('en-GB') : v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

/** How many trackers were done on a day: { done, total }. */
export function trackerCompletion(S, iso) {
  const trackers = (S && S.trackers) || [];
  const day = (S && S.logs && S.logs[iso]) || {};
  let done = 0;
  for (const t of trackers) if (trackerDone(t, day[t.id])) done++;
  return { done, total: trackers.length };
}

/** Itinerary items of every trip on a date, with their trip. */
export function itineraryOn(S, iso) {
  const out = [];
  for (const trip of (S && Array.isArray(S.holidays) ? S.holidays : [])) {
    if (!trip || !Array.isArray(trip.items)) continue;
    for (const it of trip.items) if (it && it.day === iso && (it.title || it.note)) out.push({ ...it, trip });
  }
  return out.sort((a, b) => (a.time || '~').localeCompare(b.time || '~'));
}

/** The next trip that has not finished (by return date), or null. */
export function nextTrip(S, today) {
  const trips = orderedTrips(S && S.holidays).filter(t => t.status !== 'completed');
  return trips.find(t => {
    const span = tripSpan(t);
    return span && span.to >= today;
  }) || null;
}

/** Days until a trip leaves from `today` (an ISO date). */
export function daysToTrip(trip, today) {
  const n = daysUntil(trip && trip.from, dayAt(today));
  return n;
}

/**
 * One plain colour per trip for the Year view (the owner accepted plain
 * colours there; photos are for the Month view). Stable per trip id,
 * from the calendar's own palette so it holds up on both grounds.
 */
const TRIP_HUES = ['#4d9ec4', '#c47a4d', '#a44dc4', '#3aa79b', '#c44d8f', '#c4504d', '#1a7a4a'];
export function tripHue(trip) {
  const id = String((trip && trip.id) || '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TRIP_HUES[h % TRIP_HUES.length];
}

/**
 * What the Year view paints: { iso: { kind: 'trip'|'span', colour, planning, title, tripId? } }.
 * A trip wins over a span on the same day (it frames it).
 */
export function yearMarks(S, year) {
  const out = {};
  const lo = `${year}-01-01`, hi = `${year}-12-31`;
  for (const sp of spansOf(S)) {
    if (sp.end < lo || sp.start > hi) continue;
    for (let iso = sp.start < lo ? lo : sp.start; iso <= sp.end && iso <= hi; iso = addDays(iso, 1)) {
      if (!out[iso]) out[iso] = { kind: 'span', colour: eventColour({ colour: sp.colour, kind: sp.kind }), planning: false, title: sp.title };
    }
  }
  for (const trip of orderedTrips(S && S.holidays)) {
    for (const iso of tripDates(trip)) {
      if (iso < lo || iso > hi) continue;
      out[iso] = { kind: 'trip', colour: tripHue(trip), planning: trip.status === 'planning', title: trip.dest || 'Trip', tripId: trip.id };
    }
  }
  return out;
}

/** Trips touching a month (for the Year view's month labels). */
export function tripsInMonth(S, year, month) {
  const lo = isoOf(year, month, 1), hi = isoOf(year, month, new Date(year, month + 1, 0).getDate());
  return orderedTrips(S && S.holidays).filter(t => { const s = tripSpan(t); return s && s.to >= lo && s.from <= hi; });
}

/**
 * Visited, for the Year view panel. `countryFor(trip)` → ISO2 or null
 * and `nameOf(iso2)` are passed in (lib/holiday/destinations), so this
 * stays free of the JSON country table.
 *
 * countries: completed trips' countries plus manual ticks (S.visitedExtra)
 * cities:    distinct trip destinations ("Lisbon, Portugal" → "Lisbon")
 *            over completed trips
 * nights:    nights away on completed trips leaving in `year`
 * rows:      one per country, newest first, then planned countries not
 *            yet visited
 */
export function visitedSummary(S, year, countryFor, nameOf) {
  const trips = orderedTrips(S && S.holidays);
  const done = trips.filter(t => t.status === 'completed');
  const byCountry = new Map();
  const cities = new Set();
  let nights = 0;
  const cityOf = t => String(t.dest || '').split(',')[0].trim();
  for (const t of done) {
    const c = countryFor(t);
    const city = cityOf(t);
    if (city) cities.add(city.toLowerCase());
    if (t.from && t.from.startsWith(String(year))) nights += nightsOf(t);
    if (!c) continue;
    const row = byCountry.get(c) || { iso2: c, name: nameOf(c) || c, trips: 0, cities: [], year: 0, planned: false };
    row.trips++;
    if (city && !row.cities.includes(city)) row.cities.push(city);
    row.year = Math.max(row.year, Number((t.from || '').slice(0, 4)) || 0);
    byCountry.set(c, row);
  }
  for (const c of (S && Array.isArray(S.visitedExtra) ? S.visitedExtra : [])) {
    if (!byCountry.has(c) && nameOf(c)) byCountry.set(c, { iso2: c, name: nameOf(c), trips: 0, cities: [], year: 0, planned: false });
  }
  const visitedCount = byCountry.size;
  const planned = [];
  for (const t of trips) {
    if (t.status === 'completed') continue;
    const c = countryFor(t);
    if (!c || byCountry.has(c) || planned.some(p => p.iso2 === c)) continue;
    planned.push({ iso2: c, name: nameOf(c) || c, trips: 1, cities: [cityOf(t)].filter(Boolean), year: Number((t.from || '').slice(0, 4)) || 0, planned: true });
  }
  const rows = [...byCountry.values()].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));
  return { countries: visitedCount, cities: cities.size, nights, rows: [...rows, ...planned] };
}

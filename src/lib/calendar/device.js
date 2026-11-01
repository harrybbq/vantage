/**
 * The phone's own calendar (Apple Calendar on iOS), shown read-only on
 * Vantage's calendar surfaces. Owner decision 2026-11-01: native iOS
 * only, Pro only, no subscription links.
 *
 * ── Read on the device, never stored ─────────────────────────────────
 * Events come from EventKit through the Capacitor calendar plugin
 * (lib/calendar/deviceSource.js) and are held in memory only. They never
 * go into S: state is already ~1 MB and synced, and these events are the
 * phone's, not the account's — another device has its own calendar.
 * That also keeps them on the phone: nothing here is saved, synced or
 * sent to a Netlify function.
 *
 * ── How they reach the calendar surfaces ─────────────────────────────
 * Every surface reads events through eventsOn / eventsInMonth (events.js)
 * with the S prop it was given. App hands those surfaces a VIEW of S
 * (`withDeviceEvents`) carrying the events under a symbol key that is
 * non-enumerable: `{...S}` drops it and JSON.stringify skips it, so a
 * component that copied its S prop into a write could not persist them.
 * Writes always go through `update(prev => …)` on the real state anyway.
 *
 * Shape, matching the stored events plus what derived ones carry:
 *   { id: 'dev:<eventId>:<iso>', source: 'device', derived: true,
 *     deviceId, calendarId, title, time, end, location, colour,
 *     allDay, span, dayIndex, dayCount, startMs, createdAt: 0 }
 * `derived` makes the writers in events.js refuse the id, and the day
 * menus treat it as a view, not something to edit.
 *
 * Pure — no React, no DOM, no network, no plugin.
 */

export const DEVICE_PREFIX = 'dev:';
export const isDeviceEventId = id => typeof id === 'string' && id.startsWith(DEVICE_PREFIX);

/** Where the view keeps the events. A symbol, set non-enumerable. */
export const DEVICE_EVENTS = Symbol.for('vantage.deviceEvents');

/** Hard caps: a phone with years of shared calendars should not stall a render. */
export const MAX_EVENTS = 2000;
const MAX_DAYS_PER_EVENT = 62;

const HEX6 = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i;
const FALLBACK_COLOUR = '#4d9ec4';

const pad = n => String(n).padStart(2, '0');
/** Local calendar date of a timestamp, as ISO. */
export const isoOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const midnight = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** '#RRGGBB' from whatever the platform gave ('#rrggbb', 'rrggbbaa', null). */
export function colourOf(c) {
  const m = typeof c === 'string' ? HEX6.exec(c.trim()) : null;
  return m ? `#${m[1].toLowerCase()}` : FALLBACK_COLOUR;
}

/**
 * The local days an event covers, first to last.
 * All-day events end at midnight after their last day (EventKit) or a
 * moment before it (some Android providers); either way the last day is
 * the one holding `end - 1ms`. A timed event that ends exactly at
 * midnight does not spill into the next day either.
 */
export function daysOf(ev) {
  const start = Number(ev && ev.startDate);
  let end = Number(ev && ev.endDate);
  if (!Number.isFinite(start)) return [];
  if (!Number.isFinite(end) || end < start) end = start;
  const lastMs = end > start ? end - 1 : start;
  const out = [];
  for (let t = midnight(start); t <= lastMs && out.length < MAX_DAYS_PER_EVENT; ) {
    out.push(isoOf(t));
    const d = new Date(t); d.setDate(d.getDate() + 1); t = d.getTime();
  }
  return out;
}

/**
 * Plugin events → { iso: [event] }, filtered to the chosen calendars.
 * @param list      CalendarEvent[] from listEventsInRange
 * @param calendarIds  ids to keep, or null for every calendar
 */
export function deviceEventsByDate(list, calendarIds = null) {
  const keep = Array.isArray(calendarIds) ? new Set(calendarIds) : null;
  const out = {};
  let n = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object' || !raw.id) continue;
    if (keep && !keep.has(raw.calendarId)) continue;
    const days = daysOf(raw);
    if (!days.length) continue;
    const allDay = !!raw.isAllDay;
    const startMs = Number(raw.startDate);
    const endMs = Number(raw.endDate);
    const title = String(raw.title || '').trim().slice(0, 120) || 'Busy';
    const location = String(raw.location || '').trim().slice(0, 120);
    const colour = colourOf(raw.color);
    days.forEach((iso, i) => {
      if (n >= MAX_EVENTS) return;
      const first = i === 0;
      const lastDay = i === days.length - 1;
      const timed = !allDay && first;
      const ev = {
        id: `${DEVICE_PREFIX}${raw.id}:${iso}`,
        source: 'device',
        derived: true,
        deviceId: String(raw.id),
        calendarId: raw.calendarId || null,
        title,
        // Times only where they mean something: the start on the first
        // day, the end when it lands on that same day.
        time: timed ? hhmm(startMs) : '',
        end: timed && lastDay && Number.isFinite(endMs) && endMs > startMs ? hhmm(endMs) : '',
        location,
        colour,
        allDay: allDay || !first,
        span: days.length > 1 ? `Day ${i + 1} of ${days.length}` : (allDay ? 'All day' : ''),
        dayIndex: i + 1,
        dayCount: days.length,
        startMs,
        createdAt: 0,
      };
      (out[iso] || (out[iso] = [])).push(ev);
      n++;
    });
  }
  return out;
}

/** The device events the view carries for a date (always an array). */
export function deviceEventsOn(S, iso) {
  const byDate = S && S[DEVICE_EVENTS];
  const day = byDate && byDate[iso];
  return Array.isArray(day) ? day : [];
}

/** Dates in a month that have device events. @param month 0-based */
export function deviceDatesInMonth(S, year, month) {
  const byDate = S && S[DEVICE_EVENTS];
  if (!byDate) return [];
  const prefix = `${year}-${pad(month + 1)}-`;
  return Object.keys(byDate).filter(iso => iso.startsWith(prefix));
}

/**
 * S with the device events attached, for the calendar surfaces. Returns
 * S itself when there are none, so nothing re-renders for a feature
 * that is off. The events ride on a non-enumerable symbol: spreading or
 * serialising the view drops them.
 */
export function withDeviceEvents(S, byDate) {
  if (!S || !byDate || !Object.keys(byDate).length) return S;
  const view = { ...S };
  Object.defineProperty(view, DEVICE_EVENTS, { value: byDate, enumerable: false, writable: false, configurable: false });
  return view;
}

/** The read window: from the first of last month to six months ahead. */
export function readWindow(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const to = new Date(now.getFullYear(), now.getMonth() + 7, 1).getTime() - 1;
  return { from, to };
}


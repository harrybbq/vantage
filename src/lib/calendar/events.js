/**
 * Calendar events — the foundation, deliberately ahead of the UI.
 *
 * The Track calendar is about to become the biggest thing on the page,
 * and a big calendar invites marking things on it. The idea is not
 * ironed out yet, so this file exists to make sure the SHAPE is decided
 * before any screen depends on it — because the expensive mistake with
 * a store like this is not the UI, it is picking a data model that
 * later has to be migrated out of a million-key JSON blob.
 *
 * ── Where it lives, and why ──────────────────────────────────────────
 * `S.calendarEvents` — a new key in the synced state, keyed by ISO date:
 *
 *   S.calendarEvents = {
 *     '2026-08-16': [
 *       { id: 'ev_...', title: 'Chiro', kind: 'appointment',
 *         time: '14:30', end: '15:00', location: 'Kings Rd',
 *         colour: '#4d9ec4', note: '', createdAt: 1755… },
 *     ],
 *   }
 *
 * `time` is the START. It kept its old name when `end` was added rather
 * than being renamed to `start`, because renaming it would have orphaned
 * every event already written — and events live in the same synced JSON
 * as everything else, where a rename is a migration.
 *
 * Keyed by DATE rather than a flat list, because every read this app
 * does is "what is on this day" — the month grid asks it 42 times per
 * render. A flat array would mean scanning it 42 times or building an
 * index on every render.
 *
 * State is already ~967kB and items 25–26 of the startup checklist are
 * about getting big things OUT of it, so this stays deliberately small:
 * no attachments, no recurrence expansion, no descriptions beyond a
 * short note. If events ever grow past that, they want their own table
 * with the same date-keyed read shape, and `eventsOn()` is the seam
 * that swap would happen behind.
 *
 * ── What is NOT decided ──────────────────────────────────────────────
 * Recurrence, reminders, and whether events feed the ratings. All three
 * are deliberately absent rather than half-built: a half-built
 * recurrence rule is worse than none, because data written under it has
 * to be migrated when the real one arrives.
 *
 * ── Trips are merged in on read ──────────────────────────────────────
 * A holiday covers a stretch of days, and those days belong on the
 * calendar. They are DERIVED from S.holidays rather than written into
 * this store — see lib/calendar/holidayEvents.js for why — and merged
 * here, so every surface that already reads through `eventsOn` gets them
 * without knowing they exist.
 *
 * Pure — no React, no DOM, no network.
 */
import { holidayEventsInMonth, holidayEventsOn } from './holidayEvents.js';

/** The kinds an event can be. `id` is stored; `label`/`colour` are display. */
export const EVENT_KINDS = [
  { id: 'appointment', label: 'Appointment', colour: '#4d9ec4' },
  { id: 'social',      label: 'Social',      colour: '#a44dc4' },
  { id: 'work',        label: 'Work',        colour: '#c47a4d' },
  { id: 'training',    label: 'Training',    colour: '#1a7a4a' },
  { id: 'admin',       label: 'Admin',       colour: '#8a8478' },
  { id: 'other',       label: 'Other',       colour: '#6b665d' },
];

export const DEFAULT_KIND = 'other';

export function eventKind(id) {
  return EVENT_KINDS.find(k => k.id === id) || EVENT_KINDS[EVENT_KINDS.length - 1];
}

/** Colour for a kind id, falling through to the "other" grey. */
export function kindColour(id) {
  return eventKind(id).colour;
}

/**
 * The palette the colour picker offers.
 *
 * A fixed set rather than a free colour input, for two reasons. A month
 * grid full of arbitrary hexes stops being readable — the whole value of
 * colour here is telling two things apart at a glance, and thirty
 * near-identical blues do the opposite. And every one of these is picked
 * to hold up against both the cream and the dark surfaces, which a
 * user-chosen `#f5f2e8` would not.
 */
export const EVENT_COLOURS = [
  { id: 'blue',   hex: '#4d9ec4' },
  { id: 'green',  hex: '#1a7a4a' },
  { id: 'purple', hex: '#a44dc4' },
  { id: 'amber',  hex: '#c47a4d' },
  { id: 'red',    hex: '#c4504d' },
  { id: 'teal',   hex: '#3aa79b' },
  { id: 'pink',   hex: '#c44d8f' },
  { id: 'grey',   hex: '#6b665d' },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * What colour to draw an event in.
 *
 * The user's own choice wins; the kind's colour is the fallback, so
 * events written before the picker existed still come out sensibly
 * instead of all grey.
 */
export function eventColour(ev) {
  if (ev && typeof ev.colour === 'string' && HEX_RE.test(ev.colour)) return ev.colour;
  return kindColour(ev && ev.kind);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = v => typeof v === 'string' && ISO_RE.test(v);

/**
 * Events on a date, oldest-created first, always an array.
 *
 * Every consumer goes through this rather than reaching into
 * S.calendarEvents directly — it is the seam a move to a table would
 * happen behind, and it is what makes a malformed blob (an object where
 * a list should be, a stray null) render as "no events" instead of
 * taking the calendar down.
 */
export function eventsOn(S, iso) {
  if (!isIsoDate(iso)) return [];
  const all = (S && S.calendarEvents) || {};
  const day = (all && typeof all === 'object' && Array.isArray(all[iso])) ? all[iso] : [];
  const stored = day.filter(e => e && typeof e === 'object');
  // Trips first: an all-day thing that frames the whole date belongs
  // above the 09:30 that sits inside it. sortEvents puts untimed events
  // last, which is right for "call Mum some time" and wrong for "you
  // are in Lisbon", so trips are prepended rather than merged into it.
  return [...holidayEventsOn(S, iso), ...sortEvents(stored)];
}

/**
 * Chronological, with untimed events last.
 *
 * Sorted on read rather than on write so the order is right for events
 * added before this existed, and so editing a start time reorders the
 * day without anyone having to remember to re-sort the array.
 */
export function sortEvents(list) {
  return list.slice().sort((a, b) => {
    const at = a.time || '', bt = b.time || '';
    if (at && bt && at !== bt) return at < bt ? -1 : 1;
    if (at && !bt) return -1;                  // timed before untimed
    if (!at && bt) return 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/** "14:30 – 15:15", "14:30", or "" — whatever the event actually has. */
export function eventWhen(ev) {
  if (!ev || !ev.time) return '';
  return ev.end ? `${ev.time} – ${ev.end}` : ev.time;
}

/** Whether a date has anything on it — the month grid's hot path. */
export function hasEvents(S, iso) {
  return eventsOn(S, iso).length > 0;
}

/**
 * Every event in a month, as { iso: [events] }. One pass over the store
 * rather than 42 lookups, for the grid.
 *
 * @param year full year, @param month 0-based, as everywhere else here
 */
export function eventsInMonth(S, year, month) {
  const all = (S && S.calendarEvents) || {};
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const out = {};
  const trips = holidayEventsInMonth(S, year, month);

  // Union of the dates either source has something on. Iterating only
  // the stored keys would have dropped a trip on a day with no stored
  // event, which is most days of most trips.
  const dates = new Set([...Object.keys(typeof all === 'object' ? all : {}), ...Object.keys(trips)]);
  for (const iso of dates) {
    if (!iso.startsWith(prefix)) continue;
    const list = eventsOn(S, iso);
    if (list.length) out[iso] = list;
  }
  return out;
}

/** Ids of derived events. Nothing in this store owns them, so the
 *  writers below refuse them rather than quietly doing nothing. */
export const isDerivedId = id => typeof id === 'string' && id.startsWith('hol:');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = v => typeof v === 'string' && TIME_RE.test(v);

/**
 * A new event object. Not persisted — the caller decides that.
 *
 * Everything is normalised HERE rather than trusted from the form,
 * because this is also what an import or a future quick-add would go
 * through, and a bad `time` reaching the store is a bad time in the
 * month grid forever.
 *
 * An end time earlier than the start is dropped rather than kept or
 * swapped: "14:00–09:00" is a typo, and silently reordering it into
 * 09:00–14:00 would invent a two-hour-longer event nobody asked for.
 */
export function makeEvent({
  title, kind = DEFAULT_KIND, time = '', end = '', location = '', colour = '', note = '',
} = {}) {
  const start = isTime(time) ? time : '';
  const finish = isTime(end) && start && end > start ? end : '';
  return {
    id: 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    title: String(title || '').slice(0, 120).trim(),
    kind: EVENT_KINDS.some(k => k.id === kind) ? kind : DEFAULT_KIND,
    time: start,
    end: finish,
    location: String(location || '').slice(0, 120).trim(),
    colour: HEX_RE.test(colour) ? colour : '',
    note: String(note || '').slice(0, 500),
    createdAt: Date.now(),
  };
}

/** The same normalisation, for an edit. Returns only the touched keys. */
export function cleanPatch(patch = {}) {
  const out = {};
  if ('title' in patch) out.title = String(patch.title || '').slice(0, 120).trim();
  if ('kind' in patch) out.kind = EVENT_KINDS.some(k => k.id === patch.kind) ? patch.kind : DEFAULT_KIND;
  if ('time' in patch) out.time = isTime(patch.time) ? patch.time : '';
  if ('end' in patch) out.end = isTime(patch.end) ? patch.end : '';
  if ('location' in patch) out.location = String(patch.location || '').slice(0, 120).trim();
  if ('colour' in patch) out.colour = HEX_RE.test(patch.colour) ? patch.colour : '';
  if ('note' in patch) out.note = String(patch.note || '').slice(0, 500);
  return out;
}

/*
 * The three writers below are STATE UPDATERS: each takes the previous
 * state and returns the next, so they drop straight into the existing
 * `update(prev => …)` calls and cannot be misused to mutate in place.
 *
 * All three are additive against the rest of S — they only ever touch
 * the `calendarEvents` key, and removing the last event on a date
 * deletes the key rather than leaving an empty array behind, so the
 * store does not accumulate dead dates forever.
 */

export function addEvent(prev, iso, event) {
  if (!isIsoDate(iso) || !event || !event.title) return prev;
  const all = (prev && prev.calendarEvents) || {};
  const day = Array.isArray(all[iso]) ? all[iso] : [];
  return { ...prev, calendarEvents: { ...all, [iso]: [...day, event] } };
}

export function removeEvent(prev, iso, eventId) {
  if (!isIsoDate(iso) || isDerivedId(eventId)) return prev;
  const all = (prev && prev.calendarEvents) || {};
  const day = Array.isArray(all[iso]) ? all[iso] : [];
  const next = day.filter(e => e && e.id !== eventId);
  const events = { ...all };
  if (next.length) events[iso] = next;
  else delete events[iso];           // no empty arrays left lying about
  return { ...prev, calendarEvents: events };
}

export function updateEvent(prev, iso, eventId, patch) {
  if (!isIsoDate(iso) || isDerivedId(eventId)) return prev;
  const all = (prev && prev.calendarEvents) || {};
  const day = Array.isArray(all[iso]) ? all[iso] : [];
  if (!day.some(e => e && e.id === eventId)) return prev;
  const next = day.map(e => {
    if (!e || e.id !== eventId) return e;
    const merged = { ...e, ...patch, id: e.id, createdAt: e.createdAt };  // id and birth are not patchable
    // Re-check the pair after the merge, not just the incoming key:
    // editing the START can invalidate an end time that was fine before.
    if (merged.end && (!merged.time || merged.end <= merged.time)) merged.end = '';
    return merged;
  });
  return { ...prev, calendarEvents: { ...all, [iso]: next } };
}

/* ── Today, for the hub ───────────────────────────────────────────────
 *
 * The hub asks a different question from the calendar: not "what is on
 * this date" but "what is still coming". Both live here so the two
 * surfaces cannot drift on what counts as over.
 */

/** Local ISO date — NOT toISOString(), which is UTC and gets yesterday
 *  wrong for anyone west of Greenwich late in the evening. */
export function todayIso(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function eventsToday(S, now = new Date()) {
  return eventsOn(S, todayIso(now));
}

/**
 * Today's events, each marked `past` once it is over.
 *
 * An event with an end time is over when the end passes; one with only a
 * start is over when the start does. An untimed event is never past —
 * "dentist, some time today" is still outstanding at 4pm, and greying it
 * out would say otherwise.
 */
export function todayAgenda(S, now = new Date()) {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return eventsToday(S, now).map(ev => {
    const over = ev.end ? ev.end < hhmm : (ev.time ? ev.time < hhmm : false);
    return { ...ev, past: over };
  });
}

/** Total events stored — for a future "you have N events" surface. */
export function eventCount(S) {
  const all = (S && S.calendarEvents) || {};
  if (typeof all !== 'object') return 0;
  return Object.keys(all).reduce((n, iso) => n + eventsOn(S, iso).length, 0);
}

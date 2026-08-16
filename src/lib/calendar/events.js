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
 *         time: '14:30', note: '', createdAt: 1755… },
 *     ],
 *   }
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
 * Pure — no React, no DOM, no network.
 */

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
  const all = S && S.calendarEvents;
  if (!all || typeof all !== 'object') return [];
  const day = all[iso];
  return Array.isArray(day) ? day.filter(e => e && typeof e === 'object') : [];
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
  if (typeof all !== 'object') return {};
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const out = {};
  for (const iso of Object.keys(all)) {
    if (!iso.startsWith(prefix)) continue;
    const list = eventsOn(S, iso);
    if (list.length) out[iso] = list;
  }
  return out;
}

/** A new event object. Not persisted — the caller decides that. */
export function makeEvent({ title, kind = DEFAULT_KIND, time = '', note = '' } = {}) {
  return {
    id: 'ev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    title: String(title || '').slice(0, 120).trim(),
    kind: EVENT_KINDS.some(k => k.id === kind) ? kind : DEFAULT_KIND,
    time: /^\d{2}:\d{2}$/.test(time) ? time : '',
    note: String(note || '').slice(0, 500),
    createdAt: Date.now(),
  };
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
  if (!isIsoDate(iso)) return prev;
  const all = (prev && prev.calendarEvents) || {};
  const day = Array.isArray(all[iso]) ? all[iso] : [];
  const next = day.filter(e => e && e.id !== eventId);
  const events = { ...all };
  if (next.length) events[iso] = next;
  else delete events[iso];           // no empty arrays left lying about
  return { ...prev, calendarEvents: events };
}

export function updateEvent(prev, iso, eventId, patch) {
  if (!isIsoDate(iso)) return prev;
  const all = (prev && prev.calendarEvents) || {};
  const day = Array.isArray(all[iso]) ? all[iso] : [];
  if (!day.some(e => e && e.id === eventId)) return prev;
  const next = day.map(e => (e && e.id === eventId
    ? { ...e, ...patch, id: e.id, createdAt: e.createdAt }   // id and birth are not patchable
    : e));
  return { ...prev, calendarEvents: { ...all, [iso]: next } };
}

/** Total events stored — for a future "you have N events" surface. */
export function eventCount(S) {
  const all = (S && S.calendarEvents) || {};
  if (typeof all !== 'object') return 0;
  return Object.keys(all).reduce((n, iso) => n + eventsOn(S, iso).length, 0);
}

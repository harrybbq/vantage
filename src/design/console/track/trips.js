/**
 * Trip writers for the console (Holiday merged into Track).
 *
 * These are the Holiday section's own writes, as state updaters, with
 * nothing added — the classic paths they mirror are inline in
 * components/Modals.jsx (handleAddHoliday / handleEditHoliday /
 * handleDeleteHoliday) and HolidaySection.jsx (cycleStatus), so a trip
 * written here is byte-for-byte the record classic would write:
 *
 *   add     { id: 'h' + Date.now(), ...emptyHolidayForm(), ...fields } appended
 *   edit    { ...trip, ...form } — the form spreads over the record
 *   delete  filtered out
 *   status  planning → booked → completed → planning (STATUS_ORDER)
 *
 * Each touches only `holidays`. Trips are never copied into the calendar
 * store (lib/calendar/holidayEvents.js derives their days on read).
 */
import { STATUS_ORDER } from '../../../lib/holiday/timeline.js';

const list = prev => (prev && Array.isArray(prev.holidays) ? prev.holidays : []);

/** A new trip record from the add form. `base` is emptyHolidayForm(). */
export function tripFromForm(base, fields, now = Date.now()) {
  return { id: 'h' + now, ...base, ...fields };
}

export function addTrip(prev, trip) {
  if (!trip || !trip.id || !String(trip.dest || '').trim()) return prev;
  return { ...prev, holidays: [...list(prev), trip] };
}

export function editTrip(prev, id, data) {
  if (!id || !list(prev).some(h => h && h.id === id)) return prev;
  return { ...prev, holidays: list(prev).map(h => (h && h.id === id ? { ...h, ...data } : h)) };
}

export function deleteTrip(prev, id) {
  if (!id || !list(prev).some(h => h && h.id === id)) return prev;
  return { ...prev, holidays: list(prev).filter(h => !h || h.id !== id) };
}

export function nextStatus(current) {
  return STATUS_ORDER[(STATUS_ORDER.indexOf(current) + 1) % STATUS_ORDER.length];
}

export function cycleTripStatus(prev, id, current) {
  return editTrip(prev, id, { status: nextStatus(current) });
}

/** Strip what would break a CSS url("…") — the value is user-typed
 *  (BoardingPass does the same). Empty when there is no photo. */
export function photoOf(trip) {
  return trip && typeof trip.imageUrl === 'string' && trip.imageUrl.trim()
    ? trip.imageUrl.trim().replace(/["\\]/g, '')
    : '';
}

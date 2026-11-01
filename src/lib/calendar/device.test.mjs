// node src/lib/calendar/device.test.mjs — the phone's calendar, read-only (Nov 2026).
import assert from 'node:assert/strict';
import {
  deviceEventsByDate, deviceEventsOn, withDeviceEvents, daysOf, colourOf, isDeviceEventId,
  DEVICE_EVENTS, MAX_EVENTS, readWindow,
} from './device.js';
import { eventsOn, eventsInMonth, makeEvent, addEvent, updateEvent, removeEvent } from './events.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const ev = (o) => ({ id: 'e1', calendarId: 'home', title: 'Dentist', color: '#FF2D55', isAllDay: false, location: 'High St', ...o });

t('a timed event lands on its day with start and end', () => {
  const by = deviceEventsByDate([ev({ startDate: at(2026, 11, 3, 14, 30), endDate: at(2026, 11, 3, 15, 15) })]);
  const [e] = by['2026-11-03'];
  assert.equal(e.id, 'dev:e1:2026-11-03');
  assert.deepEqual([e.time, e.end, e.allDay, e.source, e.derived], ['14:30', '15:15', false, 'device', true]);
  assert.equal(e.colour, '#ff2d55');
  assert.equal(e.location, 'High St');
});

t('all-day events: EventKit end-at-midnight does not spill into the next day', () => {
  assert.deepEqual(daysOf({ startDate: at(2026, 11, 3), endDate: at(2026, 11, 4) }), ['2026-11-03']);
  assert.deepEqual(daysOf({ startDate: at(2026, 11, 3), endDate: at(2026, 11, 3, 23, 59) }), ['2026-11-03']);
  const by = deviceEventsByDate([ev({ isAllDay: true, startDate: at(2026, 11, 3), endDate: at(2026, 11, 6) })]);
  assert.deepEqual(Object.keys(by), ['2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(by['2026-11-04'][0].span, 'Day 2 of 3');
  assert.equal(by['2026-11-03'][0].time, '', 'all day has no time');
});

t('a timed event past midnight: start time on day one, all-day after', () => {
  const by = deviceEventsByDate([ev({ startDate: at(2026, 11, 3, 22), endDate: at(2026, 11, 4, 2) })]);
  assert.deepEqual([by['2026-11-03'][0].time, by['2026-11-03'][0].end], ['22:00', '']);
  assert.deepEqual([by['2026-11-04'][0].time, by['2026-11-04'][0].allDay], ['', true]);
  assert.deepEqual(daysOf({ startDate: at(2026, 11, 3, 23), endDate: at(2026, 11, 4) }), ['2026-11-03'], 'ending at midnight stays on one day');
});

t('only the chosen calendars; bad input is ignored, not fatal', () => {
  const list = [ev({ id: 'a', calendarId: 'home', startDate: at(2026, 11, 3, 9) }), ev({ id: 'b', calendarId: 'work', startDate: at(2026, 11, 3, 10) }),
    null, 'x', { id: 'c' }, ev({ id: '', startDate: at(2026, 11, 3) })];
  assert.deepEqual(deviceEventsByDate(list, ['work'])['2026-11-03'].map(e => e.deviceId), ['b']);
  assert.equal(deviceEventsByDate(list, null)['2026-11-03'].length, 2);
  assert.deepEqual(deviceEventsByDate(list, []), {}, 'no calendars chosen → nothing');
  assert.deepEqual(deviceEventsByDate(undefined), {});
  assert.equal(deviceEventsByDate([ev({ title: '  ', startDate: at(2026, 11, 3) })])['2026-11-03'][0].title, 'Busy');
});

t('capped, so a huge shared calendar cannot stall a render', () => {
  const many = Array.from({ length: MAX_EVENTS + 50 }, (_, i) => ev({ id: 'm' + i, startDate: at(2026, 11, 3, 9), endDate: at(2026, 11, 3, 10) }));
  assert.equal(deviceEventsByDate(many)['2026-11-03'].length, MAX_EVENTS);
  assert.equal(daysOf({ startDate: at(2026, 1, 1), endDate: at(2027, 1, 1) }).length, 62);
});

t('colours: hex with or without #, alpha dropped, junk → fallback', () => {
  assert.equal(colourOf('#00AAFF'), '#00aaff');
  assert.equal(colourOf('00aaff80'), '#00aaff');
  assert.equal(colourOf(null), '#4d9ec4');
  assert.equal(colourOf('red'), '#4d9ec4');
});

t('the view: events merge into eventsOn / eventsInMonth, in time order', () => {
  const S = { calendarEvents: { '2026-11-03': [{ id: 'ev_mine', title: 'Gym', time: '12:00', createdAt: 1 }] } };
  const by = deviceEventsByDate([
    ev({ id: 'x', startDate: at(2026, 11, 3, 9), endDate: at(2026, 11, 3, 10) }),
    ev({ id: 'y', isAllDay: true, title: 'Bank holiday', startDate: at(2026, 11, 3), endDate: at(2026, 11, 4) }),
    ev({ id: 'z', startDate: at(2026, 11, 20, 18), endDate: at(2026, 11, 20, 19) }),
  ]);
  const V = withDeviceEvents(S, by);
  assert.deepEqual(eventsOn(V, '2026-11-03').map(e => e.title), ['Bank holiday', 'Dentist', 'Gym']);
  assert.deepEqual(Object.keys(eventsInMonth(V, 2026, 10)).sort(), ['2026-11-03', '2026-11-20'], 'a day with only a device event counts');
  assert.deepEqual(eventsOn(S, '2026-11-03').map(e => e.title), ['Gym'], 'the real state is untouched');
  assert.equal(withDeviceEvents(S, {}), S, 'nothing to add → S itself');
  assert.equal(withDeviceEvents(S, null), S);
});

t('the view cannot leak the events into a save', () => {
  const S = { coins: 5, calendarEvents: {} };
  const V = withDeviceEvents(S, deviceEventsByDate([ev({ startDate: at(2026, 11, 3, 9) })]));
  assert.equal(deviceEventsOn(V, '2026-11-03').length, 1);
  assert.equal(JSON.stringify(V), JSON.stringify(S), 'serialising drops them');
  assert.equal(deviceEventsOn({ ...V }, '2026-11-03').length, 0, 'spreading drops them');
  assert.equal(Object.keys(V).includes(String(DEVICE_EVENTS)), false);
});

t('the writers refuse device ids', () => {
  const S = { calendarEvents: {} };
  const V = withDeviceEvents(S, deviceEventsByDate([ev({ startDate: at(2026, 11, 3, 9) })]));
  const id = eventsOn(V, '2026-11-03')[0].id;
  assert.equal(isDeviceEventId(id), true);
  assert.equal(updateEvent(S, '2026-11-03', id, { title: 'x' }), S);
  assert.equal(removeEvent(S, '2026-11-03', id), S);
  const added = addEvent(S, '2026-11-03', makeEvent({ title: 'Mine' }));
  assert.equal(eventsOn(added, '2026-11-03').length, 1, 'adding your own still works');
});

t('read window: first of last month to the end of six months ahead', () => {
  const { from, to } = readWindow(new Date(2026, 10, 15));
  assert.equal(new Date(from).toDateString(), new Date(2026, 9, 1).toDateString());
  assert.equal(new Date(to).getMonth(), 4); // May 2027
  assert.equal(new Date(to).getFullYear(), 2027);
});

console.log(`device calendar: ${n} tests passed`);

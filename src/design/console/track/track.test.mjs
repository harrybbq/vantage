// node src/design/console/track/track.test.mjs — TRACK area pure logic (run by check:console).
import assert from 'node:assert/strict';
import { applyTick, tapValue } from './tick.js';
import { addTrip, editTrip, deleteTrip, cycleTripStatus, nextStatus, tripFromForm, photoOf } from './trips.js';
import {
  monthMatrix, weekDays, mondayOf, rowBands, eventsForDays, billsInRange, trackerCompletion,
  itineraryOn, nextTrip, yearMarks, tripHue, visitedSummary, money,
} from './model.js';
import { getWeekKey } from '../../../utils/helpers.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL:', name); throw e; } };
const NOW = 1792486920000; // fixed; never the wall clock

// ── tick: mirrors QuickLog.handleChange ─────────────────────────────
const trackers = [
  { id: 'gym', name: 'Gym', type: 'boolean', weeklyTarget: 2, weeklyCoins: 20 },
  { id: 'steps', name: 'Steps', type: 'number', dailyGoal: 10000, weeklyTarget: 1, weeklyCoins: 5 },
  { id: 'free', name: 'No target', type: 'boolean' },
];
const base = () => ({ trackers, logs: { '2026-10-19': { gym: true } }, streaks: {}, coins: 100, coinHistory: [], other: { keep: 1 } });

t('tick writes the cell, marks it manual, recalcs streaks', () => {
  const { next } = applyTick(base(), { day: '2026-10-20', trackerId: 'free', value: true, today: '2026-10-20', now: NOW });
  assert.equal(next.logs['2026-10-20'].free, true);
  assert.equal(next.logsAuto['2026-10-20'].free, 'manual');
  assert.ok(next.streaks.free && next.streaks.free.current >= 1);
  assert.deepEqual(next.other, { keep: 1 });
  assert.equal(next.coins, 100);
});

t('untick deletes the cell and an emptied day', () => {
  const s0 = applyTick(base(), { day: '2026-10-20', trackerId: 'free', value: true, today: '2026-10-20', now: NOW }).next;
  const { next } = applyTick(s0, { day: '2026-10-20', trackerId: 'free', value: false, today: '2026-10-20', now: NOW });
  assert.equal(next.logs['2026-10-20'], undefined);
  assert.equal(next.logsAuto['2026-10-20'].free, 'manual');
});

t('reaching the weekly target awards once; dropping under refunds (nets zero)', () => {
  const wk = getWeekKey('2026-10-20');
  const a = applyTick(base(), { day: '2026-10-20', trackerId: 'gym', value: true, today: '2026-10-20', now: NOW });
  assert.equal(a.next.coins, 120);
  assert.equal(a.next['awarded_gym_' + wk], true);
  assert.deepEqual(a.next.coinHistory[0], { type: 'earn', label: 'Gym weekly goal (2x)', amount: 20, ts: NOW });
  assert.deepEqual(a.effects.map(e => e.type), ['award']);
  const b = applyTick(a.next, { day: '2026-10-20', trackerId: 'gym', value: false, today: '2026-10-20', now: NOW });
  assert.equal(b.next.coins, 100);
  assert.equal(b.next['awarded_gym_' + wk], undefined);
  assert.deepEqual(b.next.coinHistory[0], { type: 'refund', label: 'Gym weekly goal reversed', amount: -20, ts: NOW });
});

t('a number tracker counts as done only at its daily goal', () => {
  const a = applyTick(base(), { day: '2026-10-20', trackerId: 'steps', value: 9000, today: '2026-10-20', now: NOW });
  assert.equal(a.next.coins, 100);
  const b = applyTick(a.next, { day: '2026-10-20', trackerId: 'steps', value: 10000, today: '2026-10-20', now: NOW });
  assert.equal(b.next.coins, 105);
});

t('a past day keys the award on ITS week', () => {
  const { next } = applyTick(base(), { day: '2026-10-13', trackerId: 'steps', value: 12000, today: '2026-10-20', now: NOW });
  assert.equal(next['awarded_steps_' + getWeekKey('2026-10-13')], true);
});

t('unknown tracker is a no-op returning prev', () => {
  const s = base();
  assert.equal(applyTick(s, { day: '2026-10-20', trackerId: 'nope', value: true, today: '2026-10-20' }).next, s);
});

t('tapValue toggles booleans and steps numbers', () => {
  assert.equal(tapValue(trackers[0], true), false);
  assert.equal(tapValue(trackers[0], undefined), true);
  assert.equal(tapValue(trackers[1], 500, 500), 1000);
  assert.equal(tapValue(trackers[1], undefined, 500), 500);
});

// ── trips: the Holiday section's own writes ─────────────────────────
const FORM = { dest: '', from: '', to: '', accom: '', flight: '', budget: '', status: 'planning', notes: '', imageUrl: '', items: [], savingsGoalId: '' };
t('add/edit/delete/status touch only holidays', () => {
  const s0 = { holidays: [{ id: 'h1', dest: 'Lisbon', status: 'booked' }], logs: { a: 1 } };
  const trip = tripFromForm(FORM, { dest: 'Tokyo', from: '2027-04-02', to: '2027-04-16' }, 123);
  assert.deepEqual(trip, { ...FORM, id: 'h123', dest: 'Tokyo', from: '2027-04-02', to: '2027-04-16' });
  const s1 = addTrip(s0, trip);
  assert.equal(s1.holidays.length, 2);
  assert.equal(s1.logs, s0.logs);
  assert.equal(addTrip(s0, { ...trip, dest: '  ' }), s0);
  const s2 = editTrip(s1, 'h1', { notes: 'x' });
  assert.deepEqual(s2.holidays[0], { id: 'h1', dest: 'Lisbon', status: 'booked', notes: 'x' });
  assert.equal(editTrip(s1, 'zz', {}), s1);
  assert.equal(cycleTripStatus(s2, 'h1', 'booked').holidays[0].status, 'completed');
  assert.equal(nextStatus('completed'), 'planning');
  assert.deepEqual(deleteTrip(s2, 'h1').holidays.map(h => h.id), ['h123']);
});
t('photoOf strips quotes and backslashes', () => {
  assert.equal(photoOf({ imageUrl: ' https://x/a"b\\c.jpg ' }), 'https://x/abc.jpg');
  assert.equal(photoOf({}), '');
});

// ── model ───────────────────────────────────────────────────────────
t('month matrix is Monday-first whole weeks', () => {
  const w = monthMatrix(2026, 9); // October 2026: 1st is a Thursday
  assert.equal(w.length, 5);
  assert.deepEqual(w[0].map(d => d.day), [28, 29, 30, 1, 2, 3, 4]);
  assert.equal(w[0][0].inMonth, false);
  assert.equal(w[4][6].iso, '2026-11-01');
  assert.equal(monthMatrix(2026, 1).length, 4 + 1); // Feb 2026 starts Sunday → 5 rows
  assert.equal(mondayOf('2026-10-20'), '2026-10-19');
  assert.equal(mondayOf('2026-10-19'), '2026-10-19');
  assert.equal(weekDays('2026-10-26')[6].iso, '2026-11-01');
});

const S = {
  trackers,
  logs: { '2026-10-20': { gym: true, steps: 12000 } },
  calendarEvents: { '2026-10-20': [{ id: 'e1', title: 'MOT', kind: 'admin', time: '09:00' }] },
  calendarSpans: [{ id: 's1', title: 'Offsite', start: '2026-10-22', end: '2026-10-27', colour: '#c47a4d' }],
  holidays: [
    { id: 'h1', dest: 'Lisbon, Portugal', from: '2026-10-05', to: '2026-10-09', status: 'completed' },
    { id: 'h2', dest: 'Porto', from: '2026-11-15', to: '2026-11-18', status: 'booked', items: [{ id: 'i1', day: '2026-11-16', time: '11:00', title: 'Cellar tour' }, { id: 'i2', day: '2026-11-16', time: '09:00', title: 'Breakfast' }] },
    { id: 'h3', dest: 'Tokyo, Japan', from: '2027-04-02', to: '2027-04-16', status: 'planning' },
  ],
  subscriptions: [
    { id: 'a', name: 'Spotify', amount: 11.99, freq: 'month', nextDate: '2026-10-23' },
    { id: 'b', name: 'Weekly box', amount: 30, freq: 'week', nextDate: '2026-10-21' },
    { id: 'c', name: 'No date', amount: 5, freq: 'month' },
  ],
  visitedExtra: ['NL'],
};

t('row bands join a span across the days of a week row', () => {
  const weeks = monthMatrix(2026, 9);
  const { events, layout } = eventsForDays(S, weeks.flat().map(d => d.iso));
  assert.equal(events['2026-10-20'][0].title, 'MOT');
  const b3 = rowBands(weeks[3], layout);    // 19–25 Oct
  assert.deepEqual(b3.map(b => [b.key, b.from, b.to, b.isStart, b.isEnd]), [['sp:s1', 3, 6, true, false]]);
  const b4 = rowBands(weeks[4], layout);    // 26 Oct – 1 Nov
  assert.deepEqual(b4.map(b => [b.from, b.to, b.isStart, b.isEnd]), [[0, 1, false, true]]);
  const b1 = rowBands(weeks[1], layout);    // Lisbon trip 5–9
  assert.deepEqual(b1.map(b => [b.key, b.from, b.to]), [['hol:h1', 0, 4]]);
});

t('bills: forward from the stored date, every occurrence in range', () => {
  const b = billsInRange(S, '2026-10-19', '2026-11-30');
  assert.deepEqual(b['2026-10-23'], [{ id: 'a', name: 'Spotify', amount: 11.99 }]);
  assert.ok(b['2026-11-23']);
  assert.deepEqual(Object.keys(b).filter(k => b[k].some(x => x.id === 'b')).slice(0, 3), ['2026-10-21', '2026-10-28', '2026-11-04']);
  assert.equal(Object.values(b).flat().filter(x => x.id === 'c').length, 0);
  assert.deepEqual(billsInRange(S, '2026-09-01', '2026-09-30'), {});
  assert.equal(money(11.99), '£11.99');
  assert.equal(money(239), '£239');
});

t('tracker completion uses trackerDone', () => {
  assert.deepEqual(trackerCompletion(S, '2026-10-20'), { done: 2, total: 3 });
  assert.deepEqual(trackerCompletion(S, '2026-10-21'), { done: 0, total: 3 });
});

t('itinerary on a day is sorted by time and carries its trip', () => {
  const it = itineraryOn(S, '2026-11-16');
  assert.deepEqual(it.map(i => i.title), ['Breakfast', 'Cellar tour']);
  assert.equal(it[0].trip.id, 'h2');
});

t('next trip skips completed and past trips', () => {
  assert.equal(nextTrip(S, '2026-10-20').id, 'h2');
  assert.equal(nextTrip(S, '2026-11-17').id, 'h2');   // mid-trip still counts
  assert.equal(nextTrip(S, '2026-11-19').id, 'h3');
  assert.equal(nextTrip({ holidays: [] }, '2026-10-20'), null);
});

t('year marks: trips over spans, planning flagged, stable trip colour', () => {
  const y = yearMarks(S, 2026);
  assert.equal(y['2026-10-05'].kind, 'trip');
  assert.equal(y['2026-10-22'].kind, 'span');
  assert.equal(y['2026-10-22'].colour, '#c47a4d');
  assert.equal(yearMarks(S, 2027)['2027-04-02'].planning, true);
  assert.equal(tripHue({ id: 'h2' }), tripHue({ id: 'h2' }));
});

t('visited: completed trips + manual ticks; planned listed after', () => {
  const C = { Portugal: 'PT', Japan: 'JP' };
  const countryFor = tr => C[String(tr.dest).split(',').pop().trim()] || (String(tr.dest).includes('Porto') ? 'PT' : null);
  const nameOf = c => ({ PT: 'Portugal', JP: 'Japan', NL: 'Netherlands' })[c] || null;
  const v = visitedSummary(S, 2026, countryFor, nameOf);
  assert.equal(v.countries, 2);
  assert.equal(v.cities, 1);
  assert.equal(v.nights, 4);
  assert.deepEqual(v.rows.map(r => [r.name, r.planned]), [['Portugal', false], ['Netherlands', false], ['Japan', true]]);
});

console.log(`track: ${n} tests passed`);

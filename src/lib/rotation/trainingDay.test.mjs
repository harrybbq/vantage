/**
 * The day a workout counts for — a 3:30am session after a night shift
 * is the shift's, everything else keeps its date.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shiftOn } from './pattern.js';
import {
  NIGHT_ROLLOVER_HOUR, usesRota, trainingDayFor, trainingDayOf, nightBefore, wallClock, dayBefore, dayAfter,
} from './trainingDay.js';
import { hasDeviceWorkout, proposeAutoLogs, applyAutoLogs } from '../trackers/autoLog.js';
import { deviceWorkoutDays } from '../body/goal.js';

const require = createRequire(import.meta.url);
const { mapWhoop, localStart } = require('../../../netlify/lib/whoop.js');
const { mapOura } = require('../../../netlify/lib/oura.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const ROTA = { rotation: {} };                 // the default schedule, in use

// The default rota: nights on 3–6 Oct 2026, days on 11–14 Oct.
eq(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'].map(d => shiftOn(ROTA, d).shift), ['night', 'night', 'night', 'night'], 'fixture: four nights');
eq(shiftOn(ROTA, '2026-10-02').shift, 'off', 'fixture: off before them');
eq(shiftOn(ROTA, '2026-10-07').shift, 'off', 'fixture: off after them');
eq(shiftOn(ROTA, '2026-10-11').shift, 'day', 'fixture: a day shift');

// ── the rule ─────────────────────────────────────────────────────────
eq(trainingDayFor(ROTA, '2026-10-04', 3), '2026-10-03', '3am after N1 counts for N1');
eq(trainingDayFor(ROTA, '2026-10-07', 3), '2026-10-06', '3am after the last night counts for it, though the morning is a day off');
eq(trainingDayFor(ROTA, '2026-10-04', 0), '2026-10-03', 'just after midnight too');
eq(trainingDayFor(ROTA, '2026-10-04', NIGHT_ROLLOVER_HOUR - 1), '2026-10-03', 'straight after the shift ends');
eq(trainingDayFor(ROTA, '2026-10-04', NIGHT_ROLLOVER_HOUR), '2026-10-04', 'from the rollover hour it is the new day');
eq(trainingDayFor(ROTA, '2026-10-04', 18), '2026-10-04', 'before the next night shift it is that day');
eq(trainingDayFor(ROTA, '2026-10-03', 3), '2026-10-03', 'the morning before the first night keeps its date');
eq(trainingDayFor(ROTA, '2026-10-12', 3), '2026-10-12', 'after a day shift nothing moves');
eq(nightBefore(ROTA, '2026-10-12', 3), null, 'and there is no night to name');

// ── whose rota ───────────────────────────────────────────────────────
ok(!usesRota({}), 'an account with no rota');
eq(trainingDayFor({}, '2026-10-04', 3), '2026-10-04', 'never inherits the default pattern\'s nights');
ok(usesRota({ lifts: { list: [] } }), 'the Lifts store means the rota is real');
eq(trainingDayFor({ lifts: {} }, '2026-10-04', 3), '2026-10-03', 'so it applies there too');
const leave = { rotation: { overrides: { '2026-10-03': { leave: 'AL' } } } };
eq(trainingDayFor(leave, '2026-10-04', 3), '2026-10-04', 'a booked-off night does not pull the morning back');

// ── the clock ────────────────────────────────────────────────────────
eq(trainingDayOf(ROTA, new Date(2026, 9, 4, 3, 30)), '2026-10-03', 'a Date at 3:30am after a night');
eq(trainingDayOf(ROTA, new Date(2026, 9, 4, 14, 0)), '2026-10-04', 'and that afternoon');
eq(trainingDayOf(ROTA, new Date(2026, 9, 1, 3, 30)), '2026-10-01', 'a night-free early morning');
eq(dayBefore('2026-03-01'), '2026-02-28', 'dayBefore crosses months');
eq(dayAfter('2026-12-31'), '2027-01-01', 'dayAfter crosses years');
eq(wallClock('2026-10-04T03:30'), { iso: '2026-10-04', hour: 3 }, 'a stored start');
eq(wallClock('2026-10-04T23:05:00+01:00'), { iso: '2026-10-04', hour: 23 }, 'with seconds and an offset');
eq(wallClock(undefined), null, 'older entries have none');
eq(wallClock('yesterday'), null, 'junk is ignored');

// ── the syncs store a local start ────────────────────────────────────
eq(localStart('2026-10-04T02:30:00.000Z', '+01:00'), '2026-10-04T03:30', 'WHOOP: UTC + offset is the wall clock');
eq(localStart('2026-10-04T02:30:00.000Z', '-05:00'), '2026-10-03T21:30', 'a negative offset');
eq(localStart('2026-10-04T02:30:00.000Z'), '2026-10-04T02:30', 'no offset reads as UTC');
eq(localStart('nope', '+01:00'), null, 'an unreadable start is left out');
const wb = mapWhoop({ workouts: [{ id: 7, start: '2026-10-04T02:30:00.000Z', timezone_offset: '+01:00', score: { kilojoule: 2000 } }] }).burn;
eq(wb['2026-10-04'][0].start, '2026-10-04T03:30', 'a WHOOP workout carries it');
eq(wb['2026-10-04'][0].id, 'whoop-7', 'id and filing day unchanged');
const ob = mapOura({ workouts: [{ id: 'w1', day: '2026-10-04', start_datetime: '2026-10-04T03:30:00+01:00', calories: 400, activity: 'strength' }] }).burn;
eq(ob['2026-10-04'][0].start, '2026-10-04T03:30', 'an Oura workout carries it');
const ob2 = mapOura({ workouts: [{ id: 'w2', day: '2026-10-04', calories: 400 }] }).burn;
ok(!('start' in ob2['2026-10-04'][0]), 'no start_datetime, no start key');

// ── a wearable workout counts for the shift's day ────────────────────
const at330 = { id: 'whoop-1', label: 'WHOOP workout', kcal: 500, start: '2026-10-04T03:30' };
const S = { ...ROTA, trackers: [], logs: {}, logsAuto: {}, streaks: {}, vitalsLog: {}, burnLog: { '2026-10-04': [at330] } };
ok(hasDeviceWorkout(S, '2026-10-03'), 'the 3:30am WHOOP workout trained Saturday\'s night');
ok(!hasDeviceWorkout(S, '2026-10-04'), 'not the morning it was filed under');
ok(hasDeviceWorkout({ ...S, rotation: undefined }, '2026-10-04'), 'with no rota it keeps its date');
const old = { ...S, burnLog: { '2026-10-04': [{ id: 'whoop-2', kcal: 500 }] } };
ok(hasDeviceWorkout(old, '2026-10-04') && !hasDeviceWorkout(old, '2026-10-03'), 'an entry synced before `start` existed keeps its date');
const pm = { ...S, burnLog: { '2026-10-04': [{ ...at330, start: '2026-10-04T17:00' }] } };
ok(hasDeviceWorkout(pm, '2026-10-04') && !hasDeviceWorkout(pm, '2026-10-03'), 'an afternoon workout keeps its date');
const steps = { ...S, burnLog: { '2026-10-04': [{ id: 'whoop-steps-1', start: '2026-10-04T03:30' }] } };
ok(!hasDeviceWorkout(steps, '2026-10-03'), 'step imports still never count');
eq([...deviceWorkoutDays(S)], ['2026-10-03'], 'the body goal sees the same day');

// The Gym Session tracker with the workout rule is ticked for the night.
const gym = { id: 'gym', name: 'Gym Session', type: 'boolean', weeklyTarget: 4, auto: { source: 'workout' } };
const T = { ...S, trackers: [gym] };
const now = new Date(2026, 9, 5, 10, 0);
const props = proposeAutoLogs(T, { now });
ok(props.some(p => p.day === '2026-10-03' && p.trackerId === 'gym'), 'Gym Session is proposed for the night\'s day');
ok(!props.some(p => p.day === '2026-10-04'), 'and not for the morning after');
const next = applyAutoLogs(T, props, { now });
eq(next.logs['2026-10-03'].gym, true, 'ticked for the night');
eq(next.burnLog, T.burnLog, 'the burn entry stays filed where it was (calories are that calendar day\'s)');

console.log(`training day: ${n} assertions passed`);

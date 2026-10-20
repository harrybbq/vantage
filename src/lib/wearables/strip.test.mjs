/**
 * stripWearableData / shareableView / wearableDataSummary.
 *
 * The deletion is a user-confirmed removal of a SUBSET of the state, so
 * the tests that matter most are the ones proving what survives: every
 * hand-entered value, every non-band burn entry, every manual tick, and
 * every key the function has no business with.
 *
 * Run: node src/lib/wearables/strip.test.mjs
 */
import assert from 'node:assert/strict';
import { stripWearableData, shareableView, wearableDataSummary, providerLabel } from './strip.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const trackers = [
  { id: 'tSleep', name: 'Sleep 7h', type: 'boolean', category: 'fitness', auto: { source: 'sleep', threshold: 7 } },
  { id: 'tSteps', name: 'Steps', type: 'number', category: 'fitness', auto: { source: 'steps', threshold: null } },
  { id: 'tStepsB', name: '10k steps', type: 'boolean', category: 'fitness', auto: { source: 'steps', threshold: 10000 } },
  { id: 'tGym', name: 'Gym', type: 'boolean', category: 'fitness', auto: { source: 'workout' } },
  { id: 'tRec', name: 'Green recovery', type: 'boolean', category: 'fitness', auto: { source: 'recovery', threshold: 60 } },
  { id: 'tWeigh', name: 'Weigh in', type: 'boolean', category: 'fitness', auto: { source: 'weight' } },
  { id: 'tRead', name: 'Read', type: 'boolean', category: 'brain' },
];

function fixture() {
  return {
    profile: { name: 'Test' },
    trackers,
    savings: [{ id: 's1', target: 100, current: 40 }],
    habits: [{ id: 'h1', name: 'No sugar', startTime: 1 }],
    whoopConnected: true,
    ouraConnected: false,
    whoopLastError: { at: 1, message: 'x', reconnect: false },
    vitalsLog: {
      // WHOOP day: band keys + sleep/rhr from the sync, and a hand weight
      '2026-10-01': { sleep: 7.4, rhr: 52, hrv: 61, recovery: 70, strain: 12.1, burnKcal: 2600, stepsWhoop: 9000, weight: 80.2 },
      // hand-only day: sleep + rhr typed, no band key
      '2026-10-02': { sleep: 6.5, rhr: 58, weight: 80.0 },
      // Oura day with only band keys + sleep
      '2026-10-03': { sleep: 8.1, hrv: 55, recovery: 81, burnKcal: 2400, stepsOura: 12000 },
      // Apple Health / hand day: weight only
      '2026-10-04': { weight: 79.8 },
    },
    burnLog: {
      '2026-10-01': [
        { id: 'whoop-abc', label: 'WHOOP workout', kcal: 400, start: '2026-10-01T07:00' },
        { id: 'ah-steps-1', label: '8,214 steps', kcal: 300, steps: 8214 },
        { id: 'manual-1', label: 'Walk', kcal: 120 },
      ],
      '2026-10-03': [{ id: 'oura-xyz', label: 'Oura · running', kcal: 500 }],
      '2026-10-04': [{ id: 'manual-2', label: 'Swim', kcal: 250 }],
    },
    logs: {
      '2026-10-01': { tSleep: true, tSteps: 9000, tStepsB: false, tGym: true, tRec: true, tWeigh: true, tRead: true },
      '2026-10-02': { tSleep: true, tRead: true },
      '2026-10-03': { tSleep: true, tSteps: 12000, tStepsB: true, tRec: true },
      '2026-10-04': { tGym: true },
    },
    logsAuto: {
      '2026-10-01': { tSleep: 'sleep', tSteps: 'steps', tGym: 'workout', tRec: 'recovery', tWeigh: 'weight', tRead: 'manual' },
      // hand-only vitals day: an auto sleep tick here is NOT band
      '2026-10-02': { tSleep: 'sleep' },
      '2026-10-03': { tSleep: 'sleep', tSteps: 'steps', tStepsB: 'steps', tRec: 'recovery' },
      // tGym on 10-04 is 'manual' — the user ticked it
      '2026-10-04': { tGym: 'manual' },
    },
    streaks: { tSleep: { current: 3, best: 9, lastDate: '2026-10-03' } },
    lifts: { sessions: [] },
  };
}

// ── stripWearableData: what goes ──
{
  const S = fixture();
  const out = stripWearableData(S);
  const v = out.vitalsLog;
  eq(v['2026-10-01'], { weight: 80.2 }, 'band keys and band-row sleep/rhr removed; weight stays');
  eq(v['2026-10-03'], undefined, 'a row holding only band data is removed whole');
  ok(!('whoop-abc' in Object.fromEntries((out.burnLog['2026-10-01'] || []).map(e => [e.id, 1]))), 'whoop- burn entry removed');
  eq(out.burnLog['2026-10-03'], undefined, 'a burn day holding only an oura- entry is removed');
  eq(out.logs['2026-10-01'].tSleep, undefined, 'sleep tick on a band row removed');
  eq(out.logs['2026-10-01'].tRec, undefined, 'recovery tick removed (band-only source)');
  eq(out.logs['2026-10-01'].tGym, undefined, 'workout tick from a WHOOP workout removed');
  eq(out.logs['2026-10-03'], undefined, 'a log day of only band ticks is removed');
  eq(out.logsAuto['2026-10-01'].tSleep, undefined, 'its logsAuto mark goes with it');
  eq(out.whoopLastError, undefined, 'sync error marker cleared');
}

// ── stripWearableData: what stays (the important half) ──
{
  const S = fixture();
  const out = stripWearableData(S);
  eq(out.vitalsLog['2026-10-02'], { sleep: 6.5, rhr: 58, weight: 80.0 }, 'hand-entered sleep/rhr on a day no band touched survive');
  eq(out.vitalsLog['2026-10-04'], { weight: 79.8 }, 'weight-only row untouched');
  eq(out.vitalsLog['2026-10-01'].weight, 80.2, 'weight on a band row survives');
  eq(out.burnLog['2026-10-01'].map(e => e.id), ['ah-steps-1', 'manual-1'], 'Apple Health steps and typed activity survive, in order');
  eq(out.burnLog['2026-10-04'], S.burnLog['2026-10-04'], 'untouched burn day kept by reference');
  eq(out.logs['2026-10-01'].tRead, true, 'manual tick survives');
  eq(out.logs['2026-10-01'].tWeigh, true, 'weight-sourced tick survives (bands never write weight)');
  eq(out.logs['2026-10-01'].tStepsB, false, 'a cell with no logsAuto mark is untouched');
  eq(out.logs['2026-10-02'], { tSleep: true, tRead: true }, 'auto sleep tick on a hand-only vitals day survives');
  eq(out.logs['2026-10-04'], { tGym: true }, 'manual-marked workout tick survives');
  eq(out.logsAuto['2026-10-01'].tRead, 'manual', 'manual marks kept');
  eq(out.logsAuto['2026-10-04'], { tGym: 'manual' }, 'manual-only mark day kept');
  eq(out.savings, S.savings, 'unrelated keys kept by reference');
  eq(out.habits, S.habits, 'habits by reference');
  eq(out.profile, S.profile, 'profile by reference');
  eq(out.whoopConnected, true, 'connection flag left alone (disconnect is its own action)');
  eq(out.streaks.tSleep.best, 9, 'best streak kept');
  ok(S.vitalsLog['2026-10-01'].hrv === 61 && S.logs['2026-10-01'].tSleep === true, 'input not mutated');
}

// ── steps: a cell the phone could have produced stays ──
{
  const S = fixture();
  // 10-01: number cell 9000, phone (Apple Health) 8214 → above the phone's count → band
  const out = stripWearableData(S);
  eq(out.logs['2026-10-01'].tSteps, undefined, 'steps cell above the phone count came from the band');
  S.burnLog['2026-10-01'][1].steps = 9500;
  const out2 = stripWearableData(S);
  eq(out2.logs['2026-10-01'].tSteps, 9000, 'steps cell the phone count covers is kept');
}

// ── keepVantageWorkouts: a workout tick on a Lifts day is kept by the deletion ──
{
  const S = fixture();
  S.lifts = { sessions: [{ date: '2026-10-01', exercises: [{ name: 'Squat' }] }] };
  eq(stripWearableData(S).logs['2026-10-01'].tGym, true, 'workout tick backed by a Vantage workout survives deletion');
  eq(shareableView(S).logs['2026-10-01'].tGym, undefined, 'the shared view stays conservative (server has no lifts data)');
}

// ── sharedVitals: false keeps every sleep / rhr ──
{
  const out = stripWearableData(fixture(), { sharedVitals: false });
  eq(out.vitalsLog['2026-10-01'], { sleep: 7.4, rhr: 52, weight: 80.2 }, 'sleep/rhr kept when the user says so');
  eq(out.vitalsLog['2026-10-03'], { sleep: 8.1 }, 'Oura row keeps its sleep');
}

// ── idempotent, and no-op returns prev ──
{
  const once = stripWearableData(fixture());
  const twice = stripWearableData(once);
  ok(twice === once, 'second run returns the same reference (no save queued)');
  const clean = { vitalsLog: { '2026-10-02': { sleep: 6 } }, burnLog: { d: [{ id: 'm', kcal: 1 }] }, logs: { d: { a: true } } };
  ok(stripWearableData(clean) === clean, 'state with no band data is returned unchanged');
  ok(stripWearableData(null) === null, 'null tolerated');
  ok(stripWearableData({}) !== undefined, 'empty tolerated');
}

// ── shareableView ──
{
  const S = fixture();
  const view = shareableView(S);
  ok(view !== S, 'a view is a new object');
  ok(shareableView(S) === view, 'memoised per state object');
  eq(view.whoopLastError, S.whoopLastError, 'the view leaves markers alone (it is not a deletion)');
  eq(view.vitalsLog['2026-10-01'], { weight: 80.2 }, 'view drops band vitals the same way');
  eq(view.streaks, S.streaks, 'view does not recompute streaks');
  const plain = { logs: { a: { x: true } }, vitalsLog: { '2026-01-01': { weight: 1 } } };
  ok(shareableView(plain) === plain, 'no band data → the same object');
}

// ── summary ──
{
  const s = wearableDataSummary(fixture());
  eq(s.vitalsDays, 2, 'two band vitals days');
  eq(s.workouts, 2, 'two band workouts');
  eq(s.ticks, 8, 'eight band ticks (10-01: sleep, steps, gym, recovery; 10-03: sleep, steps, 10k steps, recovery)');
  eq(s.days, 2, 'two distinct days');
  eq(s.providers, ['WHOOP', 'Oura'], 'both providers named');
  ok(s.any, 'any');
  eq(wearableDataSummary({}).any, false, 'empty → nothing');
  eq(providerLabel(['WHOOP']), 'WHOOP', 'label one');
  eq(providerLabel([]), 'WHOOP/Oura', 'label unknown');
}

console.log(`strip: ${n} checks passed`);

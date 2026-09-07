/**
 * Auto-filled trackers.
 *
 * The dangerous property here is not "does it tick" — it is that it can
 * write into the log store on every sync, unattended. So most of this
 * file is about what it must NOT do: overwrite a value, resurrect a
 * cell the user cleared, retract history when a rule stops matching, or
 * return a fresh object when it has nothing to say.
 */
import assert from 'node:assert/strict';
import {
  AUTO_SOURCES, MANUAL, proposeAutoLogs, applyAutoLogs, markManual,
  hasDeviceWorkout, stepsOn, ruleFor, ruleLabel, isAutoFilled, autoProvenance,
  sourceHasData, sourceById, recentDays, dayKey, BACKFILL_DAYS,
} from './autoLog.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 8, 7, 10, 0, 0);          // Mon 7 Sep 2026
const D = i => dayKey(new Date(2026, 8, 7 - i));      // i days ago
const TODAY = D(0), YDAY = D(1);

const base = (over = {}) => ({
  trackers: [], logs: {}, logsAuto: {}, streaks: {}, vitalsLog: {}, burnLog: {},
  coins: 0, coinHistory: [], ...over,
});

const boolT = (id, auto, extra = {}) => ({ id, name: id, type: 'boolean', auto, ...extra });
const numT = (id, auto, extra = {}) => ({ id, name: id, type: 'number', auto, ...extra });

// ── The sources are well formed ──
{
  for (const s of AUTO_SOURCES) {
    ok(typeof s.id === 'string' && s.id, 'a source has an id');
    ok(typeof s.read === 'function', `${s.id} can read`);
    ok(typeof s.label === 'string' && s.label, `${s.id} has a label`);
  }
  const ids = AUTO_SOURCES.map(s => s.id);
  eq(ids.length, new Set(ids).size, 'source ids are unique');
  eq(sourceById('nope'), null, 'an unknown source is null, not a throw');
}

// ── Reading the day ──
{
  const S = base({
    burnLog: {
      [TODAY]: [{ id: 'whoop-w1', label: 'Weightlifting', kcal: 420 }],
      [D(1)]: [{ id: 'ah-steps-x', label: '9,123 steps', kcal: 300 }],
      [D(2)]: [{ id: 'whoop-steps-x', label: 'steps', kcal: 100 }],
      [D(3)]: [{ id: 'a1699', label: 'Cycling', kcal: 200 }],
      [D(4)]: [{ id: 'ah-steps-y', label: '12,000 steps', kcal: 400, steps: 12000 }],
    },
  });
  ok(hasDeviceWorkout(S, TODAY), 'a WHOOP workout is a workout');
  ok(!hasDeviceWorkout(S, D(2)), 'a step import is not a workout, however it is prefixed');
  ok(!hasDeviceWorkout(S, D(3)), 'and neither is one the user typed in');
  ok(!hasDeviceWorkout(S, '2026-01-01'), 'a day with nothing on it does not throw');
  eq(stepsOn(S, D(1)), 9123, 'steps are read back out of an older label');
  eq(stepsOn(S, D(4)), 12000, 'and straight off the number when one was stored');
  eq(stepsOn(S, TODAY), null, 'a workout is not a step count');
}

// ── It ticks ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'weight' })],
    vitalsLog: { [TODAY]: { weight: 82.4 }, [D(3)]: { weight: 83 } },
  });
  const props = proposeAutoLogs(S, { now: NOW });
  eq(props.length, 2, 'both days with a reading are proposed');
  eq(props.map(p => p.day).sort(), [D(3), TODAY].sort(), 'and they are the right days');
  ok(props.every(p => p.value === true), 'a boolean tracker gets a tick');

  const next = applyAutoLogs(S, props, { now: NOW });
  eq(next.logs[TODAY].t1, true, 'the log is written');
  eq(next.logsAuto[TODAY].t1, 'weight', 'and says where it came from');
  ok(isAutoFilled(next, TODAY, 't1'), 'which reads back as auto-filled');
  ok(!isAutoFilled(next, TODAY, 'nothing'), 'an untouched cell is not');
  ok(next.streaks.t1, 'streaks were recalculated');
}

// ── Rule 1: it never overwrites ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'weight' }), numT('t2', { source: 'sleep' })],
    vitalsLog: { [TODAY]: { weight: 82.4, sleep: 7.4 } },
    logs: { [TODAY]: { t1: true, t2: 6 } },
  });
  eq(proposeAutoLogs(S, { now: NOW }), [], 'a day already logged is left entirely alone');
  eq(applyAutoLogs(S, [], { now: NOW }), S, 'and nothing to write returns the SAME object');
  ok(applyAutoLogs(S, [], { now: NOW }) === S, 'identity, not a copy — a copy would queue a save of the whole state');
}

// A falsy-but-present value is still the user's answer.
{
  const S = base({
    trackers: [numT('t2', { source: 'sleep' })],
    vitalsLog: { [TODAY]: { sleep: 7.4 } },
    logs: { [TODAY]: { t2: 0 } },
  });
  eq(proposeAutoLogs(S, { now: NOW }), [], 'a logged zero is a value, not an absence');
}

// ── Rule 3: a cleared cell stays cleared ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'weight' })],
    vitalsLog: { [TODAY]: { weight: 82.4 } },
  });
  const filled = applyAutoLogs(S, proposeAutoLogs(S, { now: NOW }), { now: NOW });

  // The user un-ticks it: the value goes, and the path that removed it
  // marks the cell as theirs.
  const unticked = markManual({ ...filled, logs: { ...filled.logs, [TODAY]: {} } }, TODAY, ['t1']);
  eq(unticked.logsAuto[TODAY].t1, MANUAL, 'the cell is marked as the user’s');
  eq(proposeAutoLogs(unticked, { now: NOW }), [],
    'and the next sync does not put it back — the bug where the app argues with you');

  eq(markManual(unticked, TODAY, ['t1']), unticked, 'marking twice changes nothing');
  eq(markManual(unticked, TODAY, []), unticked, 'and marking nothing is a no-op');
  eq(markManual(unticked, null, ['t1']), unticked, 'as is marking no day');
}

// ── Rule 2: it never retracts ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'strain', threshold: 10 })],
    vitalsLog: { [YDAY]: { strain: 14 } },
  });
  const filled = applyAutoLogs(S, proposeAutoLogs(S, { now: NOW }), { now: NOW });
  eq(filled.logs[YDAY].t1, true, 'yesterday ticked at strain 14');

  // WHOOP revises the reading down below the bar.
  const revised = { ...filled, vitalsLog: { [YDAY]: { strain: 4 } } };
  eq(proposeAutoLogs(revised, { now: NOW }), [], 'nothing new is proposed');
  eq(applyAutoLogs(revised, proposeAutoLogs(revised, { now: NOW }), { now: NOW }).logs[YDAY].t1, true,
    'and the tick that was already there stands — the log is a record, not a live query');
}

// ── Thresholds ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'sleep', threshold: 7 })],
    vitalsLog: { [D(0)]: { sleep: 7.4 }, [D(1)]: { sleep: 6.2 }, [D(2)]: { sleep: 7 } },
  });
  const days = proposeAutoLogs(S, { now: NOW }).map(p => p.day).sort();
  eq(days, [D(0), D(2)].sort(), 'at or above the bar ticks; below it does not');
}

// A number tracker takes the reading, and ignores the bar — a Sleep
// tracker in hours wants 6.2, not silence.
{
  const S = base({
    trackers: [numT('t2', { source: 'sleep', threshold: 7 })],
    vitalsLog: { [D(0)]: { sleep: 7.42 }, [D(1)]: { sleep: 6.2 } },
  });
  const props = proposeAutoLogs(S, { now: NOW });
  eq(props.length, 2, 'both nights are recorded');
  eq(props.find(p => p.day === D(0)).value, 7.4, 'rounded to the source’s precision');
  eq(props.find(p => p.day === D(1)).value, 6.2, 'including the short one');
}

// A number tracker on a source with no reading, and a zero reading.
{
  const S = base({
    trackers: [numT('t2', { source: 'steps' })],
    burnLog: { [D(0)]: [{ id: 'ah-steps-a', label: '0 steps', kcal: 0, steps: 0 }] },
  });
  eq(proposeAutoLogs(S, { now: NOW }), [], 'a zero reading is not worth a log entry');
}

// ── The backfill window is bounded ──
{
  const vitalsLog = {};
  for (let i = 0; i < 40; i++) vitalsLog[D(i)] = { weight: 80 + i * 0.1 };
  const S = base({ trackers: [boolT('t1', { source: 'weight' })], vitalsLog });
  eq(proposeAutoLogs(S, { now: NOW }).length, BACKFILL_DAYS,
    'a new rule reaches back a fortnight, not a year');
  eq(recentDays(3, NOW), [D(0), D(1), D(2)], 'and the window is the days it says it is');
}

// ── Trackers with no rule are untouched ──
{
  const S = base({
    trackers: [boolT('t1'), boolT('t2', { source: 'nonsense' }), boolT('t3', { source: '' })],
    vitalsLog: { [TODAY]: { weight: 82 } },
  });
  eq(proposeAutoLogs(S, { now: NOW }), [], 'opt-in means opt-in');
  eq(ruleFor(S.trackers[0]), null, 'no rule reads as no rule');
  eq(ruleFor(S.trackers[1]), null, 'and so does an unknown source');
  eq(ruleLabel(S.trackers[0]), null, 'with nothing to label');
  eq(proposeAutoLogs(base(), { now: NOW }), [], 'an empty state proposes nothing');
  eq(proposeAutoLogs({}, { now: NOW }), [], 'and neither does a bare object');
}

// ── Coins: current week only, award-only ──
{
  const vitalsLog = {};
  for (let i = 0; i < 10; i++) vitalsLog[D(i)] = { weight: 80 };
  const S = base({
    trackers: [boolT('t1', { source: 'weight' }, { weeklyTarget: 3, weeklyCoins: 15 })],
    vitalsLog,
    coins: 100,
  });
  const next = applyAutoLogs(S, proposeAutoLogs(S, { now: NOW }), { now: NOW });
  // 7 Sep 2026 is a Monday, so the current week holds exactly one day.
  // One tick cannot clear a target of three, so nothing is paid.
  eq(next.coins, 100, 'a week that has not met its target pays nothing');

  const later = new Date(2026, 8, 10, 10, 0);        // Thursday
  const S2 = base({
    trackers: [boolT('t1', { source: 'weight' }, { weeklyTarget: 3, weeklyCoins: 15 })],
    vitalsLog: {
      '2026-09-07': { weight: 80 }, '2026-09-08': { weight: 80 },
      '2026-09-09': { weight: 80 }, '2026-09-10': { weight: 80 },
    },
    coins: 100,
  });
  const paid = applyAutoLogs(S2, proposeAutoLogs(S2, { now: later }), { now: later });
  eq(paid.coins, 115, 'a week that clears its target pays once');
  eq(paid.coinHistory.length, 1, 'and says so in the ledger');
  const again = applyAutoLogs(paid, proposeAutoLogs(paid, { now: later }), { now: later });
  ok(again === paid, 'and running it again writes nothing at all');
}

// Backfilled history does not retro-award.
{
  const vitalsLog = {};
  for (let i = 0; i < 14; i++) vitalsLog[D(i)] = { weight: 80 };
  const S = base({
    trackers: [boolT('t1', { source: 'weight' }, { weeklyTarget: 3, weeklyCoins: 15 })],
    vitalsLog, coins: 0,
  });
  const next = applyAutoLogs(S, proposeAutoLogs(S, { now: NOW }), { now: NOW });
  eq(next.coins, 0, 'connecting a watch does not pay out a fortnight of past weeks');
  ok(Object.keys(next).every(k => !k.startsWith('awarded_')), 'and marks no past week as awarded');
}

// ── Provenance ──
{
  const S = base({
    trackers: [boolT('t1', { source: 'strain', threshold: 10 })],
    vitalsLog: { [TODAY]: { strain: 14.2 } },
  });
  const next = applyAutoLogs(S, proposeAutoLogs(S, { now: NOW }), { now: NOW });
  const p = autoProvenance(next, TODAY, 't1');
  ok(p && /14\.2/.test(p.text), `the reading that caused the tick is shown: ${p && p.text}`);
  eq(autoProvenance(next, TODAY, 'other'), null, 'a cell with no marker has no provenance');
  eq(autoProvenance({ logsAuto: { [TODAY]: { t1: MANUAL } } }, TODAY, 't1'), null,
    'and neither does one the user owns');
  eq(ruleLabel(S.trackers[0]), 'Strain reached 10', 'the rule reads as a sentence');
}

// ── Offering a source only where it could work ──
{
  const S = base({ vitalsLog: { [TODAY]: { weight: 82 } } });
  ok(sourceHasData(S, sourceById('weight'), 30, NOW), 'weight has data');
  ok(!sourceHasData(S, sourceById('strain'), 30, NOW), 'strain does not');
  ok(!sourceHasData(S, null, 30, NOW), 'and no source has nothing');
}

console.log(`tracker auto-fill: ${n} assertions passed`);

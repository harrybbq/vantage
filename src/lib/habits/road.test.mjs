// node src/lib/habits/road.test.mjs — the record that does not reset, the road that does not end, and Undo (Nov 2026).
import assert from 'node:assert/strict';
import { recordOf, recordLabel, RECORD_DAYS } from './record.js';
import { roadBase, hasRoad, roadAhead, roadReached, nextRoadStep, nextTarget, settleRoad, ROAD_COIN_MAX, ROAD_COIN_MIN } from './road.js';
import { applyRelapse, undoRelapse } from './relapse.js';
import { sceneryLevel, habitView } from './view.js';
import { isoDay, addDays, PERIOD_MS } from './cutdown.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const DAY = 86400000;
// A fixed "now": Wednesday 18 Nov 2026, 15:00 local.
const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime();
const ms = (days, label, coins, awarded = false) => ({ id: `m${days}`, label, duration: days * DAY, coins, awarded });
const quit = (over = {}) => ({ id: 'q', name: 'Vaping', color: '#c4306a', endless: true, startTime: NOW - 40 * DAY, relapseCount: 0,
  milestones: [ms(7, '1 week', 50, true), ms(30, '1 month', 200, true)], ...over });
const S = (...habits) => ({ habits, coins: 100, coinHistory: [{ type: 'earn', label: 'old', amount: 1, ts: 1 }], savings: [{ id: 's1' }] });

// ── The 30-day record ─────────────────────────────────────────────
t('a clean month: 30 of 30, and the label says so', () => {
  const r = recordOf(quit(), NOW);
  assert.equal(r.kind, 'days');
  assert.deepEqual([r.good, r.of, r.marks.length], [30, 30, RECORD_DAYS]);
  assert.equal(r.marks[r.marks.length - 1].iso, isoDay(NOW), 'today is the last mark');
  assert.equal(recordLabel(r), '30 of the last 30 days clean');
});

t('a slip dents the record by its day and no more', () => {
  // Three runs ended in the window: 20, 9 and 2 days ago; the current run began at the last one.
  const ends = [NOW - 20 * DAY, NOW - 9 * DAY, NOW - 2 * DAY];
  const runs = [{ start: NOW - 60 * DAY, end: ends[0] }, { start: ends[0], end: ends[1] }, { start: ends[1], end: ends[2] }];
  const h = quit({ startTime: ends[2], runs, relapseCount: 3 });
  const r = recordOf(h, NOW);
  assert.deepEqual([r.good, r.of], [27, 30]);
  assert.deepEqual(r.marks.filter(m => !m.ok).map(m => m.iso), ends.map(e => isoDay(e)));
  assert.equal(recordLabel(r), '27 of the last 30 days clean');
  // Two slips on one day cost one day.
  const twice = quit({ startTime: NOW - 2 * DAY + 3600e3, relapseCount: 4, runs: [...runs, { start: ends[2], end: NOW - 2 * DAY + 3600e3 }] });
  assert.equal(recordOf(twice, NOW).good, 27);
});

t('slipping today shows today, and the clock at zero does not take the record with it', () => {
  const h0 = quit({ startTime: NOW - 12 * DAY });
  const after = applyRelapse(S(h0), 'q', NOW - 3600e3).habits[0];
  const r = recordOf(after, NOW);
  assert.equal(r.marks[r.marks.length - 1].ok, false, 'today is the slip');
  assert.deepEqual([r.good, r.of], [12, 13], 'history begins 12 days ago: 13 days counted, one slipped');
});

t('days before the habit existed are not counted either way', () => {
  const week = quit({ startTime: NOW - 6 * DAY - 3600e3, milestones: [ms(7, '1 week', 50)] });
  assert.deepEqual([recordOf(week, NOW).good, recordOf(week, NOW).of], [7, 7]);
  assert.equal(recordLabel(recordOf(week, NOW)), '7 of the last 7 days clean');
  const fresh = quit({ startTime: NOW - 60e3 });
  assert.deepEqual([recordOf(fresh, NOW).good, recordOf(fresh, NOW).of], [1, 1]);
  assert.equal(recordLabel(recordOf(fresh, NOW)), 'Clean today');
  // History is the earliest kept run, not the current start.
  const old = quit({ startTime: NOW - DAY, runs: [{ start: NOW - 90 * DAY, end: NOW - DAY }], relapseCount: 1 });
  assert.deepEqual([recordOf(old, NOW).good, recordOf(old, NOW).of], [29, 30]);
});

t('a slip older than 30 days is outside the window', () => {
  const h = quit({ startTime: NOW - 35 * DAY, runs: [{ start: NOW - 80 * DAY, end: NOW - 35 * DAY }], relapseCount: 1 });
  assert.equal(recordOf(h, NOW).good, 30);
});

t('garbage in: nothing throws, nothing is invented', () => {
  for (const h of [null, undefined, {}, { runs: 'x', startTime: 'y' }, { runs: [{ start: 5, end: 1 }, null, { start: NaN, end: 3 }] }]) {
    const r = recordOf(h, NOW);
    assert.ok(r.good <= r.of && r.of <= RECORD_DAYS);
    assert.equal(typeof recordLabel(r), 'string');
  }
});

const mondayOf = iso => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
t('cut down: the last closed weeks against the budget, not days', () => {
  const wk0 = mondayOf(isoDay(NOW));
  // Budget 1 a week, tracked for 6 full weeks: over in the week 3 back (two days used), dry 5 back.
  const h = { id: 'c', name: 'Takeaways', kind: 'cut', endless: true, budget: { max: 1, per: 'week' }, budgetSince: addDays(wk0, -42), startTime: NOW - 43 * DAY,
    useDays: [addDays(wk0, -41), addDays(wk0, -27), addDays(wk0, -20), addDays(wk0, -19), addDays(wk0, -13), addDays(wk0, -6)], milestones: [ms(7, '1 week', 50)] };
  const r = recordOf(h, NOW);
  assert.equal(r.kind, 'periods');
  assert.deepEqual([r.good, r.of], [5, 6]);
  assert.deepEqual(r.marks.map(m => m.ok), [true, true, true, false, true, true]);
  assert.equal(r.marks[1].dry, true);
  assert.equal(recordLabel(r), '5 of the last 6 weeks on budget');
  // The week in progress is not judged.
  assert.deepEqual([recordOf({ ...h, useDays: [...h.useDays, wk0, addDays(wk0, 1)] }, NOW).good], [5]);
  const first = { ...h, budgetSince: wk0, useDays: [] };
  assert.equal(recordOf(first, NOW).of, 0);
  assert.equal(recordLabel(recordOf(first, NOW)), 'First week in progress');
});

t('scenery: a slip no longer clears the lane', () => {
  const ends = [NOW - 20 * DAY, NOW - 9 * DAY];
  const h = quit({ startTime: NOW - 3 * 3600e3, relapseCount: 3, runs: [{ start: NOW - 60 * DAY, end: ends[0] }, { start: ends[0], end: ends[1] }, { start: ends[1], end: NOW - 3 * 3600e3 }] });
  assert.equal(recordOf(h, NOW).good, 27);
  assert.equal(sceneryLevel(h, NOW), 27, 'three hours into a run, the lane is 27 days grown');
  assert.equal(habitView(h, NOW).scenery, 27);
  // A long run still grows past the 30-day window.
  assert.equal(Math.round(sceneryLevel(quit({ startTime: NOW - 75 * DAY }), NOW)), 75);
  // The runner himself is untouched: his gait is this run's.
  assert.ok(habitView(h, NOW).runnerDays < 1);
});

// ── The road ──────────────────────────────────────────────────────
t('the road continues the user’s own ladder, in their economy', () => {
  const h = quit();
  assert.deepEqual(roadBase(h), { duration: 30 * DAY, coins: 200 });
  assert.ok(hasRoad(h));
  assert.deepEqual(roadAhead(h, 0, 6).map(s => [s.label, s.coins, s.duration / DAY]),
    [['2 months', 300, 60], ['3 months', 400, 90], ['6 months', 600, 182], ['1 year', 1000, 365], ['2 years', 1000, 730], ['3 years', 1000, 1095]]);
  assert.ok(roadAhead(h, 0, 6).every(s => s.auto && s.id.startsWith('road-')));
  // Only steps past their own longest milestone exist.
  const long = quit({ milestones: [ms(100, '100 days', 40)] });
  assert.deepEqual(roadAhead(long, 0, 2).map(s => [s.label, s.coins]), [['6 months', 60], ['1 year', 80]]);
  // Coins are clamped, so an absurd milestone cannot mint a fortune, and a tiny one still pays something.
  assert.equal(roadAhead(quit({ milestones: [ms(1, '1 day', 999999)] }), 0, 1)[0].coins, ROAD_COIN_MAX * 1.5);
  assert.equal(roadAhead(quit({ milestones: [ms(7, '1 week', 0)] }), 0, 1)[0].coins, ROAD_COIN_MIN * 1.5);
});

t('no road without milestones, or when the habit is not endless', () => {
  assert.equal(hasRoad(quit({ milestones: [] })), false);
  assert.equal(hasRoad(quit({ endless: false })), false);
  assert.deepEqual(roadAhead(quit({ endless: false }), 0, 3), []);
  assert.equal(nextRoadStep(quit({ milestones: [] })), null);
  const st = S(quit({ milestones: [] }));
  assert.equal(settleRoad(st, 'q', NOW).state, st);
  assert.equal(settleRoad(st, 'nope', NOW).state, st);
});

t('cut down walks its own units', () => {
  const wk = { id: 'c', kind: 'cut', endless: true, budget: { max: 1, per: 'week' }, milestones: [{ id: 'a', label: '1 week', duration: PERIOD_MS.week, coins: 50 }] };
  assert.deepEqual(roadAhead(wk, 0, 5).map(s => [s.label, s.duration / PERIOD_MS.week, s.coins]),
    [['8 weeks', 8, 75], ['13 weeks', 13, 100], ['26 weeks', 26, 150], ['52 weeks', 52, 250], ['104 weeks', 104, 250]]);
  const mo = { ...wk, budget: { max: 4, per: 'month' }, milestones: [{ id: 'a', label: '1 month', duration: PERIOD_MS.month, coins: 100 }] };
  assert.deepEqual(roadAhead(mo, 0, 4).map(s => s.label), ['2 months', '3 months', '6 months', '12 months']);
});

t('first look pays nothing for what the run has already passed', () => {
  const h = quit({ startTime: NOW - 400 * DAY });
  const st = S(h);
  const a = settleRoad(st, 'q', NOW);
  assert.equal(a.paid, null);
  assert.equal(a.state.coins, st.coins, 'no back-pay');
  assert.equal(a.state.coinHistory, st.coinHistory);
  assert.equal(a.state.habits[0].autoPaid, 365 * DAY, 'everything up to a year is settled');
  assert.equal(nextRoadStep(a.state.habits[0]).label, '2 years');
  // Nothing more to do until then.
  assert.equal(settleRoad(a.state, 'q', NOW).state, a.state);
  // Still on their own ladder: not looked at yet, nothing written.
  const young = S(quit({ startTime: NOW - 10 * DAY, milestones: [ms(7, '1 week', 50, true), ms(30, '1 month', 200)] }));
  assert.equal(settleRoad(young, 'q', NOW).state, young);
});

t('a step is paid once, when the run reaches it', () => {
  let st = S(quit({ startTime: NOW - 40 * DAY }));
  st = settleRoad(st, 'q', NOW).state;                         // first look at 40 d: settled to 0
  assert.equal(st.habits[0].autoPaid, 0);
  assert.equal(nextRoadStep(st.habits[0]).label, '2 months');
  assert.equal(settleRoad(st, 'q', NOW + 19 * DAY).state, st, 'day 59: not yet');
  const at60 = settleRoad(st, 'q', NOW + 20 * DAY + 1000);
  assert.equal(at60.paid.label, '2 months');
  assert.equal(at60.state.coins, st.coins + 300);
  assert.deepEqual(at60.state.coinHistory[0], { type: 'earn', label: 'Vaping — 2 months', amount: 300, ts: NOW + 20 * DAY + 1000 });
  assert.equal(at60.state.coinHistory.length, st.coinHistory.length + 1);
  assert.equal(at60.state.habits[0].autoPaid, 60 * DAY);
  assert.equal(settleRoad(at60.state, 'q', NOW + 21 * DAY).state, at60.state, 'never twice');
  // Only the habit, the coins and the history change.
  assert.equal(at60.state.savings, st.savings);
  assert.deepEqual(Object.keys(at60.state).sort(), Object.keys(st).sort());
  assert.equal(at60.state.habits[0].milestones, st.habits[0].milestones, 'their own milestones are untouched');
  // One step a call, even if the app was shut for months.
  const late = settleRoad(at60.state, 'q', NOW + 200 * DAY);
  assert.equal(late.paid.label, '3 months');
  assert.equal(settleRoad(late.state, 'q', NOW + 200 * DAY).paid.label, '6 months');
});

t('a slip starts the road again, and it pays again on the next run', () => {
  let st = S(quit({ startTime: NOW - 61 * DAY, autoPaid: 60 * DAY }));
  st = applyRelapse(st, 'q', NOW);
  assert.equal(st.habits[0].autoPaid, 0);
  assert.equal(nextRoadStep(st.habits[0]).label, '2 months');
  assert.equal(settleRoad(st, 'q', NOW + 10 * DAY).state, st);
  assert.equal(settleRoad(st, 'q', NOW + 60 * DAY + 1).paid.label, '2 months');
  // A habit the road has never looked at gains no key from a slip.
  assert.equal('autoPaid' in applyRelapse(S(quit()), 'q', NOW).habits[0], false);
  // Settled further than the run now is (a broken run of weeks, a change of kind): back to zero, unpaid.
  const odd = S(quit({ startTime: NOW - 5 * DAY, autoPaid: 90 * DAY }));
  const fixed = settleRoad(odd, 'q', NOW);
  assert.equal(fixed.paid, null);
  assert.equal(fixed.state.habits[0].autoPaid, 0);
  assert.equal(fixed.state.coins, odd.coins);
});

t('roadReached: what a run of that length has passed', () => {
  const h = quit();
  assert.equal(roadReached(h, 59 * DAY), 0);
  assert.equal(roadReached(h, 60 * DAY), 60 * DAY);
  assert.equal(roadReached(h, 364 * DAY), 182 * DAY);
  assert.equal(roadReached(h, 800 * DAY), 730 * DAY);
});

t('there is always a next thing on an endless habit', () => {
  const h = quit({ milestones: [ms(7, '1 week', 50), ms(30, '1 month', 200)] });
  assert.deepEqual(nextTarget(h, 2 * DAY), { id: 'm7', label: '1 week', duration: 7 * DAY, coins: 50, auto: false });
  assert.equal(nextTarget(h, 10 * DAY).label, '1 month');
  assert.equal(nextTarget(h, 40 * DAY).label, '2 months');
  assert.equal(nextTarget(h, 40 * DAY).auto, true);
  assert.equal(nextTarget(h, 400 * DAY).label, '2 years', 'never the step already passed, paid or not');
  assert.equal(nextTarget({ ...h, autoPaid: 60 * DAY }, 61 * DAY).label, '3 months');
  // Not endless: the ladder ends where they wrote it to.
  assert.equal(nextTarget({ ...h, endless: false }, 40 * DAY), null);
  assert.equal(nextTarget(quit({ milestones: [] }), DAY), null);
});

// ── Undo ──────────────────────────────────────────────────────────
t('undo puts the habit back exactly, and touches nothing else', () => {
  const before = quit({ startTime: NOW - 12 * DAY, runs: [{ start: NOW - 30 * DAY, end: NOW - 12 * DAY }], relapseCount: 1, strikeTimes: [], autoPaid: 0 });
  const st0 = S(before, { id: 'other', name: 'Other', startTime: 5 });
  const st1 = applyRelapse(st0, 'q', NOW);
  assert.notEqual(st1.habits[0].startTime, before.startTime);
  assert.equal(st1.habits[0].runs.length, 2);
  const st2 = undoRelapse(st1, before, NOW);
  assert.equal(st2.habits[0], before, 'the very same object');
  assert.equal(st2.habits[1], st0.habits[1]);
  assert.equal(st2.coins, st1.coins);
  assert.equal(st2.coinHistory, st1.coinHistory);
  assert.deepEqual(Object.keys(st2).sort(), Object.keys(st0).sort());
});

t('undo never overwrites newer history', () => {
  const before = quit({ startTime: NOW - 12 * DAY });
  const st1 = applyRelapse(S(before), 'q', NOW);
  // A second slip, or a back-dated one, has moved the start since: leave it.
  const st2 = applyRelapse(st1, 'q', NOW + 60e3);
  assert.equal(undoRelapse(st2, before, NOW), st2);
  // Wrong instant, a habit that has gone, garbage.
  assert.equal(undoRelapse(st1, before, NOW + 1), st1);
  const gone = { ...st1, habits: [] };
  assert.equal(undoRelapse(gone, before, NOW), gone);
  assert.equal(undoRelapse(st1, null, NOW), st1);
  assert.equal(undoRelapse(st1, {}, NOW), st1);
  // The count must be exactly one more than before (nothing else slipped in between).
  const tampered = { ...st1, habits: [{ ...st1.habits[0], relapseCount: 9 }] };
  assert.equal(undoRelapse(tampered, before, NOW), tampered);
});

t('a cut-down habit has no slip to undo', () => {
  const c = { id: 'c', name: 'Drinking', kind: 'cut', budget: { max: 2, per: 'week' }, budgetSince: '2026-10-01', startTime: NOW - 40 * DAY, useDays: [] };
  const st = applyRelapse(S(c), 'c', NOW);
  assert.equal(undoRelapse(st, c, NOW), st);
});

console.log(`habit record, road and undo: ${n} tests passed`);

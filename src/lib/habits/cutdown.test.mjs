/**
 * Cut-down habits, runs, and the progress every surface reads.
 * Invented data only. Dates are local; NOW is Wed 7 Oct 2026, 15:00.
 */
import assert from 'node:assert/strict';
import {
  periodStart, nextPeriod, periods, streak, bestStreak, bestBefore, onTargetTotal, dryTotal, streakMs,
  current, periodDays, dryBonusDue, toggleUse, addUse, toCut, toQuit, isoDay, DAY,
} from './cutdown.js';
import { habitElapsed, runnerDays, weeksToDays, ghostOf, bestRunMs, odometerMs, cutHeadline } from './progress.js';
import { applyRelapse } from './relapse.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const NOW = new Date(2026, 9, 7, 15).getTime();

const cut = (extra = {}) => ({
  id: 'c1', name: 'Alcohol', kind: 'cut', startTime: NOW - 90 * DAY,
  budget: { max: 2, per: 'week' }, budgetSince: '2026-08-31',
  useDays: [
    '2026-09-01', '2026-09-04',                 // wk Aug 31: 2, on target
    '2026-09-08', '2026-09-09', '2026-09-10',   // wk Sep 7: 3, over
    //                                             wk Sep 14: dry
    '2026-09-23',                               // wk Sep 21: 1
    '2026-09-29', '2026-10-02',                 // wk Sep 28: 2
    '2026-10-06',                               // this week: 1
  ],
  milestones: [
    { id: 'm1', label: '2 weeks', duration: 14 * DAY, coins: 10, awarded: true },
    { id: 'm2', label: '4 weeks', duration: 28 * DAY, coins: 25, awarded: false },
  ],
  ...extra,
});

t('periods start on Monday or the 1st', () => {
  assert.equal(isoDay(NOW), '2026-10-07');
  assert.equal(periodStart('2026-10-07', 'week'), '2026-10-05');
  assert.equal(periodStart('2026-10-05', 'week'), '2026-10-05');
  assert.equal(periodStart('2026-10-04', 'week'), '2026-09-28');
  assert.equal(periodStart('2026-10-07', 'month'), '2026-10-01');
  assert.equal(nextPeriod('2026-12-28', 'week'), '2027-01-04');
  assert.equal(nextPeriod('2026-12-01', 'month'), '2027-01-01');
});

t('weeks on target: the run of closed weeks within budget', () => {
  const h = cut();
  const ps = periods(h, NOW);
  assert.deepEqual(ps.map(p => [p.start, p.used]), [
    ['2026-08-31', 2], ['2026-09-07', 3], ['2026-09-14', 0], ['2026-09-21', 1], ['2026-09-28', 2], ['2026-10-05', 1],
  ]);
  assert.deepEqual(ps.map(p => p.onTarget), [true, false, true, true, true, true]);
  assert.equal(ps[2].dry, true);
  assert.equal(ps[5].dry, false, 'the open week is never "dry" yet');
  assert.equal(streak(h, NOW), 3, 'the open week does not count until it closes');
  assert.equal(bestStreak(h, NOW), 3);
  assert.equal(bestBefore(h, NOW), 1, 'the run being chased is the best one that ENDED');
  assert.equal(onTargetTotal(h, NOW), 4);
  assert.equal(dryTotal(h, NOW), 1);
  assert.equal(streakMs(h, NOW), 21 * DAY);
});

t('an over-budget week restarts the run only once it closes', () => {
  const h = cut({ useDays: [...cut().useDays, '2026-10-05', '2026-10-07'] });
  assert.equal(current(h, NOW).state, 'over');
  assert.equal(streak(h, NOW), 3, 'still 3 while the week is open');
  assert.equal(streak(h, NOW + 5 * DAY), 0, 'and 0 once it has closed over budget');
});

t('this period so far, and the strip of its days', () => {
  const c = current(cut(), NOW);
  assert.deepEqual([c.used, c.left, c.state, c.usedToday], [1, 1, 'ok', false]);
  assert.equal(current(cut({ useDays: [] }), NOW).state, 'dry');
  assert.equal(current(cut({ useDays: ['2026-10-05', '2026-10-06'] }), NOW).state, 'at');
  const days = periodDays(cut({ useDays: ['2026-10-05', '2026-10-06', '2026-10-07'] }), NOW);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map(d => !!d.over), [false, false, true, false, false, false, false]);
  assert.deepEqual(days.map(d => d.future), [false, false, false, true, true, true, true]);
  assert.equal(periodDays(cut({ budget: { max: 4, per: 'month' } }), NOW).length, 31);
});

t('the trail shows untracked periods before the budget began', () => {
  const ps = periods(cut(), NOW, 8);
  assert.equal(ps.length, 8);
  assert.deepEqual(ps.slice(0, 2).map(p => [p.tracked, p.onTarget]), [[false, false], [false, false]]);
});

t('dry bonus: due for the last closed period only, once', () => {
  const h = cut({ useDays: ['2026-09-23'] });
  assert.equal(dryBonusDue(h, NOW), '2026-09-28');
  assert.equal(dryBonusDue({ ...h, dryPaid: ['2026-09-28'] }, NOW), null);
  assert.equal(dryBonusDue(cut(), NOW), null);
});

t('toggleUse logs and un-logs; future days and Quit habits change nothing', () => {
  const s = { habits: [cut(), { id: 'q1', startTime: NOW - DAY }] };
  const a = toggleUse(s, 'c1', '2026-10-07', NOW);
  assert.ok(a.habits[0].useDays.includes('2026-10-07'));
  assert.equal(a.habits[1], s.habits[1]);
  const b = toggleUse(a, 'c1', '2026-10-07', NOW);
  assert.deepEqual(b.habits[0].useDays, s.habits[0].useDays);
  assert.equal(toggleUse(s, 'c1', '2026-10-08', NOW), s, 'tomorrow is refused');
  assert.equal(toggleUse(s, 'q1', '2026-10-07', NOW), s, 'a Quit habit has no days to log');
  assert.equal(toggleUse(s, 'nope', '2026-10-07', NOW), s);
  assert.equal(toggleUse(s, 'c1', 'today', NOW), s);
  assert.equal(addUse(s, 'c1', '2026-10-06', NOW), s, 'addUse never un-logs');
});

t('a relapse from a quick button logs the day on a Cut-down habit', () => {
  const s = { habits: [cut()] };
  const r = applyRelapse(s, 'c1', NOW);
  assert.ok(r.habits[0].useDays.includes('2026-10-07'));
  assert.equal(r.habits[0].startTime, s.habits[0].startTime, 'no timer restarts');
  assert.deepEqual(r.habits[0].milestones, s.habits[0].milestones, 'no milestones re-arm');
  assert.equal(applyRelapse(r, 'c1', NOW), r, 'twice on one day is one day');
});

t('a Quit relapse keeps the run that ended', () => {
  const s = { habits: [{ id: 'q1', startTime: NOW - 10 * DAY, milestones: [] }] };
  const r = applyRelapse(s, 'q1', NOW);
  assert.deepEqual(r.habits[0].runs, [{ start: NOW - 10 * DAY, end: NOW }]);
  const r2 = applyRelapse(r, 'q1', NOW - DAY);
  assert.equal(r2.habits[0].runs.length, 1, 'a relapse dated before the current start adds no run');
  const many = { habits: [{ id: 'q1', startTime: NOW - DAY, runs: Array.from({ length: 60 }, (_, i) => ({ start: i, end: i + 1 })) }] };
  assert.equal(applyRelapse(many, 'q1', NOW).habits[0].runs.length, 60, 'the newest 60 are kept');
});

t('toCut and toQuit keep the timer and never pay twice', () => {
  const q = { id: 'q1', startTime: NOW - 20 * DAY, strikesAllowed: 1, strikesPeriod: 'ever',
    strikeTimes: [NOW - 40 * DAY, NOW - DAY], relapseCount: 4,
    milestones: [{ id: 'a', duration: 7 * DAY, awarded: true }, { id: 'b', duration: 30 * DAY, awarded: false }] };
  const c = toCut(q, {}, NOW);
  assert.equal(c.kind, 'cut');
  assert.deepEqual(c.budget, { max: 1, per: 'week' }, "'ever' becomes weekly");
  assert.equal(c.budgetSince, '2026-10-07');
  assert.deepEqual(c.useDays, ['2026-10-06'], "this week's strike becomes a logged day");
  assert.equal(c.startTime, q.startTime);
  assert.equal(c.relapseCount, 4);
  assert.ok(c.milestones.every(m => !m.awarded));
  const back = toQuit(c, NOW);
  assert.equal(back.kind, 'quit');
  assert.deepEqual(back.milestones.map(m => m.awarded), [true, false], 'passed milestones are marked, not paid');
  assert.deepEqual(back.useDays, c.useDays, 'the logged days stay on the habit');
  assert.deepEqual(toCut(q, { max: 3, per: 'month' }, NOW).budget, { max: 3, per: 'month' });
});

t('progress: ladder time, runner stage, ghost and odometer', () => {
  const h = cut();
  assert.equal(habitElapsed(h, NOW), 21 * DAY);
  assert.equal(weeksToDays(0), 0);
  assert.equal(weeksToDays(2), 4);
  assert.equal(weeksToDays(4), 7);
  assert.equal(weeksToDays(13), 30);
  assert.equal(runnerDays(h, NOW), weeksToDays(3));
  assert.deepEqual(ghostOf(h, NOW), { bestMs: 7 * DAY, passed: true });
  assert.equal(cutHeadline(h, NOW), '3 wk on target');
  assert.equal(cutHeadline(h, NOW, false), '3 weeks on target');

  const q = { id: 'q', startTime: NOW - 5 * DAY, runs: [{ start: 0, end: 12 * DAY }, { start: 0, end: 3 * DAY }] };
  assert.equal(habitElapsed(q, NOW), 5 * DAY);
  assert.equal(bestRunMs(q), 12 * DAY);
  assert.deepEqual(ghostOf(q, NOW), { bestMs: 12 * DAY, passed: false });
  assert.equal(odometerMs(q, NOW), 20 * DAY);
  assert.equal(bestRunMs({ bestManualMs: 40 * DAY, runs: [] }), 40 * DAY, 'a best entered by hand counts');
  assert.equal(ghostOf({ startTime: NOW - DAY }, NOW), null, 'no history, no ghost');
});

console.log(`habits cut-down: ${n} passed`);

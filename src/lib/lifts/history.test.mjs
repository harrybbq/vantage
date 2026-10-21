/**
 * Workout history grids and the past-days import.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import { workoutDays, yearGrid, historyYears, parsePastDays, mergePastDays, shadeOf, pastDayCount, liftedTotals, liftedText } from './history.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const ex = [{ liftId: 'a', sets: [{ reps: 8, weight: 50 }] }];
const S = {
  lifts: {
    list: [], gyms: [],
    sessions: [{ id: 's1', date: '2026-10-13', exercises: ex }, { id: 's2', date: '2026-10-13', exercises: ex }, { id: 's3', date: '2026-10-14', exercises: [] }],
    log: [
      { id: 'q1', liftId: 'a', date: '2026-10-15', weight: 50, reps: 8 },                    // quick log, own day
      { id: 'q2', liftId: 'a', date: '2026-10-13', weight: 50, reps: 8 },                    // quick log on a workout day
      { id: 'w1', liftId: 'a', date: '2026-10-13', weight: 50, reps: 8, sessionId: 's1' },
    ],
    pastDays: { '2026-10-13': 1, '2024-12-23': 4, '2023-09-25': 1, 'nope': 3, '2025-02-30': 1, '2025-01-01': 0 },
  },
};

t('a day counts workouts, a quick-log day counts once, imports never double up', () => {
  const c = workoutDays(S);
  assert.equal(c.get('2026-10-13'), 2, 'two workouts; the import (1) and the quick log add nothing');
  assert.equal(c.get('2026-10-14'), undefined, 'an empty session is not a workout');
  assert.equal(c.get('2026-10-15'), 1, 'quick-logged sets');
  assert.equal(c.get('2024-12-23'), 4, 'imported');
  assert.ok(!c.has('nope') && !c.has('2025-02-30') && !c.has('2025-01-01'), 'junk ignored');
  assert.equal(workoutDays({}).size, 0, 'no store → nothing');
  assert.deepEqual([0, 1, 2, 3, 7].map(shadeOf), [0, 1, 2, 3, 3]);
});

t('a year grid is Monday-first and lines up with the calendar', () => {
  const c = workoutDays(S);
  const g26 = yearGrid(2026, c, '2026-10-20');
  assert.equal(g26.cols[0][3].iso, '2026-01-01', '1 Jan 2026 is a Thursday');
  assert.equal(g26.cols[0][2], null, 'before the year: no cell');
  const last = g26.cols[g26.cols.length - 1];
  assert.equal(last[3].iso, '2026-12-31');
  assert.equal(last[4], null);
  assert.equal(g26.cols.length, 53);
  assert.equal(g26.total, 3);
  assert.equal(g26.days, 2);
  assert.ok(g26.cols.flat().find(x => x && x.iso === '2026-10-21').future);
  assert.deepEqual(g26.months.map(m => m.label), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.equal(yearGrid(2024, c).cols[0][0].iso, '2024-01-01', '2024 starts on a Monday');
  assert.equal(yearGrid(2023, c).cols[0][6].iso, '2023-01-01', '2023 starts on a Sunday');
  assert.equal(yearGrid(2012, new Map()).cols.length, 54, 'a leap year starting on Sunday spans 54 columns');
  assert.equal(yearGrid(2024, c).total, 4);
  assert.deepEqual(historyYears(c, '2026-10-20'), [2026, 2025, 2024, 2023]);
  assert.deepEqual(historyYears(new Map(), '2026-10-20'), [2026]);
});

t('pasted history parses dates and counts, and refuses the future', () => {
  const p = parsePastDays('2023-09-25, 2024-12-23 x4\n2025-02-12×2 2025-02-12 2026-13-01 2026-10-30 junk', '2026-10-20');
  assert.deepEqual(p.days, { '2023-09-25': 1, '2024-12-23': 4, '2025-02-12': 2 });
  assert.equal(p.workouts, 7);
  assert.deepEqual(p.bad, ['2026-13-01', '2026-10-30']);
});

t('merging is additive and idempotent', () => {
  const A = mergePastDays(S, { '2026-10-13': 3, '2024-12-23': 1, '2022-05-05': 1 });
  assert.equal(A.lifts.pastDays['2026-10-13'], 3, 'higher count wins');
  assert.equal(A.lifts.pastDays['2024-12-23'], 4, 'a lower count never lowers a day');
  assert.equal(A.lifts.pastDays['2022-05-05'], 1);
  assert.equal(A.lifts.sessions, S.lifts.sessions, 'nothing else touched');
  assert.equal(mergePastDays(A, { '2022-05-05': 1 }), A, 'nothing new → same state');
  assert.equal(mergePastDays(A, {}), A);
  const fresh = mergePastDays({ other: 1 }, { '2024-01-01': 1 });
  assert.equal(fresh.other, 1);
  assert.equal(pastDayCount(fresh), 1);
});

t('total lifted: weight x reps, both dumbbells, added weight only for bodyweight', () => {
  const S2 = { lifts: { list: [{ id: 'lp', load: 'weight' }, { id: 'db', load: 'per_hand' }, { id: 'dip', load: 'bodyweight_plus' }], log: [
    { liftId: 'lp', date: '2026-10-13', weight: 100, reps: 10 },      // 1000
    { liftId: 'db', date: '2026-10-02', weight: 20, reps: 10 },       // 400 (two dumbbells)
    { liftId: 'dip', date: '2026-03-05', weight: 10, reps: 8 },       // 80 (added weight)
    { liftId: 'dip', date: '2026-03-05', weight: 0, reps: 12 },       // bodyweight only: 0
    { liftId: 'lp', date: '2025-12-30', weight: 140, reps: 5 },       // 700, last year
    { liftId: 'lp', date: '2026-10-14', weight: 'x', reps: 5 },       // junk
  ] } };
  const r = liftedTotals(S2, '2026-10-20');
  assert.deepEqual(r, { all: 2180, year: 1480, month: 1400, sets: 4 }, 'a bodyweight-only set adds no weight, so is not a weighted set');
  assert.equal(liftedTotals({}, '2026-10-20').all, 0, 'no store, nothing lifted');
  assert.deepEqual([liftedText(8450), liftedText(12430), liftedText(1203900)], ['8,450 kg', '12,430 kg', '1,203,900 kg']);
});

console.log(`history: ${n} tests passed`);

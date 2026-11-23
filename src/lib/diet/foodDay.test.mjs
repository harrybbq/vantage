// node src/lib/diet/foodDay.test.mjs
import assert from 'node:assert/strict';
import { groupByTime, barOf, diffText, isFloor, shiftDay, dayLabel, weekOf, minutesOf, clockOf, MARK } from './foodDay.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const at = (h, m) => new Date(2026, 10, 23, h, m).toISOString();
const E = (id, h, m, calories, protein_g = 0) => ({ id, created_at: at(h, m), calories, protein_g, food_name: id });

t('a breakfast of three things is one block; a meal hours later is its own', () => {
  const day = [E('oats', 7, 12, 372, 15), E('banana', 7, 14, 105, 1), E('shake', 7, 15, 152, 25), E('yoghurt', 10, 40, 164, 20),
    E('chicken', 13, 5, 642, 58), E('oil', 13, 9, 88), E('toast', 16, 30, 356, 13), E('coffee', 16, 32, 119, 6), E('chilli', 19, 45, 702, 52), E('cottage', 21, 20, 205, 26)];
  const g = groupByTime(day);
  assert.deepEqual(g.map(x => x.items.length), [3, 1, 2, 2, 1, 1]);
  assert.deepEqual(g.map(x => x.time), ['07:12', '10:40', '13:05', '16:30', '19:45', '21:20']);
  assert.equal(g[0].kcal, 629);
  assert.equal(g[0].protein, 41);
  assert.equal(g.reduce((s, x) => s + x.kcal, 0), 2905);
});

t('order is by time whatever order the rows arrive in, and a slow meal chains', () => {
  const g = groupByTime([E('c', 12, 35, 1), E('a', 12, 0, 1), E('b', 12, 18, 1), E('d', 13, 0, 1)]);
  assert.deepEqual(g.map(x => x.items.map(e => e.id).join('')), ['abc', 'd'], '18 and 17 minute gaps chain; 25 does not');
  assert.equal(groupByTime([E('a', 12, 0, 1), E('b', 12, 20, 1)]).length, 1, 'exactly the gap still joins');
  assert.equal(groupByTime([E('a', 12, 0, 1), E('b', 12, 21, 1)]).length, 2);
});

t('entries with no time stand alone, and bad input is safe', () => {
  const g = groupByTime([{ id: 'x', calories: 10 }, { id: 'y', calories: 20 }, E('a', 8, 0, 5)]);
  assert.equal(g.length, 3);
  assert.equal(g[0].time, '');
  assert.equal(minutesOf({ created_at: 'nonsense' }), -1);
  assert.equal(clockOf(435), '07:15');
  for (const bad of [undefined, null, [], 'x', [null]]) assert.deepEqual(groupByTime(bad), []);
});

t('a bar sits at its mark on target and runs past it when over', () => {
  assert.equal(barOf(2400, 2400).fill, MARK);
  assert.ok(barOf(2905, 2400).fill > MARK && barOf(2905, 2400).fill < 1);
  assert.equal(barOf(9999, 2400).fill, 1, 'capped at the end of the track');
  assert.ok(barOf(309, 250).fill > barOf(216, 180).fill, '124 % reads longer than 120 %');
  assert.deepEqual(barOf(0, 2400), { fill: 0, state: 'under', diff: -2400, pct: 0 });
  assert.deepEqual(barOf(50, 0), { fill: 0, state: 'none', diff: 0, pct: null });
});

t('what the bar means: a target lands within 5 %, a floor is met by passing it', () => {
  assert.equal(barOf(2905, 2400).state, 'over');
  assert.equal(barOf(2500, 2400).state, 'met', '104 % is landed');
  assert.equal(barOf(2300, 2400).state, 'met', '96 % is landed');
  assert.equal(barOf(2200, 2400).state, 'under');
  assert.equal(barOf(216, 180, { floor: true }).state, 'met', 'over on protein is the point');
  assert.equal(barOf(179, 180, { floor: true }).state, 'under', 'a floor is not met until it is');
  assert.ok(isFloor('Protein') && isFloor('fibre') && !isFloor('Fat') && !isFloor('Calories'));
  assert.ok(isFloor('Fat', { planned: true, planFloors: new Set(['protein', 'fat']) }), 'the plan can make fat a floor');
  assert.ok(!isFloor('Carbs', { planned: true, planFloors: new Set(['protein', 'fat']) }));
});

t('the words are the plain difference', () => {
  assert.equal(diffText(barOf(2905, 2400)), '505 over');
  assert.equal(diffText(barOf(2200, 2400)), '200 left');
  assert.equal(diffText(barOf(2400, 2400)), 'on target');
  assert.equal(diffText(barOf(216, 180, { floor: true }), 'g'), '36 g over');
  assert.equal(diffText(barOf(12900, 2400)), '10,500 over');
  assert.equal(diffText(barOf(5, 0)), '');
});

t('days: stepping, labels and the week', () => {
  assert.equal(shiftDay('2026-11-23', -1), '2026-11-22');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDay('2026-03-29', 1), '2026-03-30', 'across the clock change');
  assert.equal(dayLabel('2026-11-23', '2026-11-23'), 'Today · Mon 23 Nov');
  assert.equal(dayLabel('2026-11-22', '2026-11-23'), 'Yesterday · Sun 22 Nov');
  assert.equal(dayLabel('2026-11-20', '2026-11-23'), 'Fri 20 Nov');
  const w = weekOf({ '2026-11-23': { cal: 121 }, '2026-11-22': { cal: 96 }, '2026-11-20': { cal: 71 } }, '2026-11-23');
  assert.deepEqual(w.map(x => x.label), ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']);
  assert.deepEqual(w.map(x => x.pct), [null, null, null, 71, null, 96, 121]);
  assert.deepEqual(w.map(x => x.on), [false, false, false, false, false, true, false]);
  assert.equal(w[6].sel, true);
  assert.equal(weekOf(null, '2026-11-23').length, 7);
  assert.ok(weekOf({}, '2026-11-25', '2026-11-23')[6].future, 'a day after today is marked');
});

console.log(`\n${n} tests passed`);

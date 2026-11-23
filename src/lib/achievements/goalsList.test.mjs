// node src/lib/achievements/goalsList.test.mjs
import assert from 'node:assert/strict';
import { goalsView, pathName } from './goalsList.js';
import { pathsOf } from './pathPlayer.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const G = (id, name, completed = false, coins = 100, extra = {}) => ({ id, name, completed, coins, ...(completed ? { completedAt: 1000 + n } : {}), ...extra });

// 22 goals: four linked paths (one forks) and seven on their own — the mockup's set.
const goals = [
  G('f1', 'Save £1,000', true), G('f2', 'Save £5,000', true), G('f3', 'Save £10,000'), G('f4', 'House deposit', false, 400), G('f5', 'Buy a house', false, 800), G('f6', 'Max out the ISA', false, 300),
  G('r1', 'Run 5K', true), G('r2', 'Run 10K'), G('r3', 'Half marathon'), G('r4', 'Marathon'),
  G('b1', 'Bench 60 kg', true), G('b2', 'Bench 80 kg'), G('b3', 'Bench 100 kg'),
  G('c1', 'AWS Solutions Architect'), G('c2', 'Senior engineer'),
  G('s1', 'Read 20 books'), G('s2', 'Visit Japan'), G('s3', 'Spanish to B1'), G('s4', 'Cook 30 new recipes'), G('s5', 'Pass driving test', true), G('s6', 'Climb Ben Nevis'), G('s7', 'Finish the garden'),
];
const links = [['f1', 'f2'], ['f2', 'f3'], ['f3', 'f4'], ['f4', 'f5'], ['f3', 'f6'], ['r1', 'r2'], ['r2', 'r3'], ['r3', 'r4'], ['b1', 'b2'], ['b2', 'b3'], ['c1', 'c2']];
const names = list => list.map(x => (x.goal || x).name);

t('every goal is in exactly one of next, locked and finished', () => {
  const v = goalsView(goals, links);
  assert.equal(v.total, 22);
  const ids = [...v.next.map(x => x.goal.id), ...v.locked.map(x => x.goal.id), ...v.finished.map(g => g.id)];
  assert.equal(ids.length, 22);
  assert.equal(new Set(ids).size, 22);
  assert.equal(v.done, 5);
  assert.equal(v.next.length, 10);
  assert.equal(v.locked.length, 7);
  assert.ok(Math.abs(v.pct - 5 / 22) < 1e-9);
});

t('next up: every open goal, path goals first and in path order, then the ones on their own', () => {
  const v = goalsView(goals, links);
  assert.deepEqual(names(v.next), ['Save £10,000', 'Run 10K', 'Bench 80 kg', 'AWS Solutions Architect',
    'Read 20 books', 'Visit Japan', 'Spanish to B1', 'Cook 30 new recipes', 'Climb Ben Nevis', 'Finish the garden']);
  const first = v.next[0];
  assert.equal(first.path.name, 'Buy a house');
  assert.deepEqual([first.step, first.of], [3, 6]);
  assert.equal(v.next[4].path, null, 'a goal on its own has no path');
});

t('a path is named by where it ends; a fork takes the furthest end, never "2 end goals"', () => {
  const v = goalsView(goals, links);
  assert.deepEqual(v.paths.map(p => p.name), ['Buy a house', 'Marathon', 'Bench 100 kg', 'Senior engineer']);
  assert.deepEqual(v.paths.map(p => `${p.done}/${p.total}`), ['2/6', '1/4', '1/3', '0/2']);
  for (const p of pathsOf(goals, links)) assert.doesNotMatch(pathName(p), /end goals/);
  // equal depth: the one that pays more
  const fork = [G('a', 'Start'), G('b', 'Left', false, 50), G('c', 'Right', false, 90)];
  assert.equal(goalsView(fork, [['a', 'b'], ['a', 'c']]).paths[0].name, 'Right');
});

t('a path shows each step\'s state, and what it is waiting for', () => {
  const v = goalsView(goals, links);
  assert.deepEqual(v.paths[0].states, ['completed', 'completed', 'active', 'locked', 'locked', 'locked']);
  assert.equal(v.paths[0].next.name, 'Save £10,000');
  const deposit = v.locked.find(x => x.goal.id === 'f4');
  assert.deepEqual(names(deposit.needs), ['Save £10,000']);
  assert.equal(v.at('f4').path.name, 'Buy a house');
  assert.equal(v.at('s1'), null);
  assert.equal(v.state(goals.find(g => g.id === 'f5')), 'locked');
});

t('finishing a goal moves it to finished and opens what it unlocked', () => {
  const after = goals.map(g => (g.id === 'f3' ? { ...g, completed: true, completedAt: 9e12 } : g));
  const v = goalsView(after, links);
  assert.equal(v.finished[0].name, 'Save £10,000', 'newest first');
  assert.ok(names(v.next).includes('House deposit') && names(v.next).includes('Max out the ISA'));
  assert.ok(!names(v.next).includes('Save £10,000'));
});

t('a stored locked flag on a goal with no path still has a place (locked), and empty input is safe', () => {
  const v = goalsView([G('x', 'Odd one', false, 10, { locked: true }), G('y', 'Free')], []);
  assert.deepEqual(names(v.locked), ['Odd one']);
  assert.deepEqual(names(v.next), ['Free']);
  for (const input of [[undefined, undefined], [null, null], [[], []], [[null], 'nope']]) {
    const e = goalsView(...input);
    assert.deepEqual([e.total, e.done, e.pct, e.next.length, e.paths.length], [0, 0, 0, 0, 0]);
  }
});

console.log(`\n${n} tests passed`);

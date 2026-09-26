import assert from 'node:assert/strict';
import { weightSeries, slopePer30, pace } from './weightTrend.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const NOW = new Date(2026, 8, 26, 9);
const iso = back => { const d = new Date(NOW.getTime() - back * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const log = (fn, days = 60) => Object.fromEntries(Array.from({ length: days }, (_, i) => [iso(i), { weight: fn(i) }]));

t('weightSeries keeps the window, sorts oldest first, drops blanks', () => {
  const v = { [iso(0)]: { weight: 80 }, [iso(5)]: { weight: 81 }, [iso(100)]: { weight: 90 }, [iso(2)]: { sleep: 7 } };
  const s = weightSeries(v, 90, NOW);
  assert.deepEqual(s.map(p => p.kg), [81, 80]);
});
t('slope of a straight line is exact per 30 days', () => {
  const s = weightSeries(log(i => 80 + i * 0.01), 90, NOW);   // losing 0.01 kg/day going forward in time
  assert.ok(Math.abs(slopePer30(s) - (-0.3)) < 1e-9);
});
t('slope needs three points', () => {
  assert.equal(slopePer30([{ t: 0, kg: 1 }, { t: 1, kg: 2 }]), null);
});
t('cutting at the planned rate is on pace', () => {
  const s = weightSeries(log(i => 80 + i * (0.3 / 30)), 90, NOW);
  const p = pace(s, 76, 0.25, { now: NOW });
  assert.equal(p.status, 'on');
  assert.equal(p.direction, -1);
  assert.equal(p.planned, -0.25);
});
t('cutting too slowly is slow', () => {
  const s = weightSeries(log(i => 80 + i * (0.1 / 30)), 90, NOW);
  assert.equal(pace(s, 76, 0.25, { now: NOW }).status, 'slow');
});
t('gaining while cutting is the wrong way', () => {
  const s = weightSeries(log(i => 80 - i * (0.3 / 30)), 90, NOW);
  assert.equal(pace(s, 76, 0.25, { now: NOW }).status, 'wrong');
});
t('a gain target reads the same maths the other way', () => {
  const s = weightSeries(log(i => 70 - i * (0.3 / 30)), 90, NOW);
  assert.equal(pace(s, 76, 0.25, { now: NOW }).status, 'on');
});
t('at the target is there; no data is unknown', () => {
  const s = weightSeries(log(() => 76.1), 90, NOW);
  assert.equal(pace(s, 76, 0.25, { now: NOW }).status, 'there');
  assert.equal(pace([], 76, 0.25, { now: NOW }).status, 'unknown');
});

console.log(`weight trend: ${n} passed`);

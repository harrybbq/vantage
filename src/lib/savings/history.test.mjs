/** Savings snapshots. Invented figures — this file is in a public repo. */
import assert from 'node:assert/strict';
import { withSnapshot, actualSeries, versusPlan, ymOf } from './history.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const NOW = new Date(2026, 10, 15, 12).getTime();        // 15 Nov 2026
const acc = (id, balance) => ({ id, name: id, balance, apy: 0, balanceAt: NOW });

t('ymOf', () => assert.equal(ymOf(new Date(2026, 0, 3)), '2026-01'));

t('withSnapshot stamps the current month total and keeps other keys', () => {
  const s = withSnapshot({ coins: 5, savingsAccounts: [acc('a', 100), acc('b', 50.5)] }, NOW);
  assert.equal(s.coins, 5);
  assert.deepEqual(s.savingsHistory['2026-11'], { total: 150.5, at: NOW });
});
t('withSnapshot keeps earlier months and overwrites only this one', () => {
  const s = withSnapshot({ savingsAccounts: [acc('a', 200)], savingsHistory: { '2026-10': { total: 90, at: 1 }, '2026-11': { total: 150, at: 2 } } }, NOW);
  assert.equal(s.savingsHistory['2026-10'].total, 90);
  assert.equal(s.savingsHistory['2026-11'].total, 200);
});
t('withSnapshot is a no-op when nothing changed or there are no accounts', () => {
  const same = { savingsAccounts: [acc('a', 150)], savingsHistory: { '2026-11': { total: 150, at: 2 } } };
  assert.equal(withSnapshot(same, NOW), same);
  const none = { coins: 1 };
  assert.equal(withSnapshot(none, NOW), none);
});
t('withSnapshot includes interest to date', () => {
  const a = { id: 'a', balance: 1000, apy: 10, balanceAt: NOW - 365 * 86400000 };
  assert.equal(Math.round(withSnapshot({ savingsAccounts: [a] }, NOW).savingsHistory['2026-11'].total), 1100);
});

const S = {
  savingsAccounts: [acc('a', 300), acc('b', 20)],
  savingsHistory: { '2026-08': { total: 50 }, '2026-09': { total: 100 }, '2026-10': { total: 200 }, '2026-11': { total: 999 } },
};
t('actualSeries: stored months before now, then a live point for this month', () => {
  const a = actualSeries(S, { from: '2026-09', now: NOW });
  assert.deepEqual(a.map(p => [p.month, p.balance, !!p.live]), [['2026-09', 100, false], ['2026-10', 200, false], ['2026-11', 320, true]]);
});
t('actualSeries: a subset of accounts marks stored months approximate', () => {
  const a = actualSeries(S, { from: '2026-10', accountIds: ['a'], now: NOW });
  assert.deepEqual(a.map(p => [p.month, p.balance, !!p.approx, !!p.live]), [['2026-10', 200, true, false], ['2026-11', 300, false, true]]);
});
t('actualSeries with no data is empty', () => {
  assert.deepEqual(actualSeries({}, { now: NOW }), []);
});
t('versusPlan pairs months and signs the gap', () => {
  const v = versusPlan([{ month: '2026-10', balance: 200 }, { month: '2026-11', balance: 320, live: true }],
    [{ month: '2026-10', balance: 250 }, { month: '2026-11', balance: 300 }]);
  assert.deepEqual(v.map(x => [x.month, x.diff, x.live]), [['2026-10', -50, false], ['2026-11', 20, true]]);
});

console.log(`savings history: ${n} passed`);

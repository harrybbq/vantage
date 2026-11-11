// node src/lib/money/payday.test.mjs — pay day on the calendar (owner, Nov 2026).
import assert from 'node:assert/strict';
import { payOf, payDaysBetween, isPayDay, nextPayDay, beforePay, setPayDay, clearPayDay, inDays, PAY_FREQS } from './payday.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const S0 = { coins: 5, subscriptions: [] };

t('no pay day set → nothing anywhere', () => {
  assert.equal(payOf(S0), null);
  assert.deepEqual(payDaysBetween(S0, '2026-11-01', '2026-12-31'), []);
  assert.equal(nextPayDay(S0, '2026-11-06'), null);
  assert.equal(beforePay(S0, '2026-11-06'), null);
  assert.equal(payOf({ pay: { anchor: 'nope' } }), null);
});

t('monthly: same date each month, clamped to short months', () => {
  const S = setPayDay(S0, '2026-01-31', 'month', { weekendEarly: false, now: 1 });
  assert.deepEqual(payDaysBetween(S, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

t('monthly with weekend → Friday before (UK payroll)', () => {
  // 28 Nov 2026 is a Saturday, 28 Feb 2027 a Sunday.
  const S = setPayDay(S0, '2026-10-28', 'month', { now: 1 });
  assert.equal(payOf(S).weekendEarly, true);
  assert.deepEqual(payDaysBetween(S, '2026-11-01', '2026-11-30'), ['2026-11-27']);
  assert.deepEqual(payDaysBetween(S, '2027-02-01', '2027-02-28'), ['2027-02-26']);
  // A 1st on a weekend is pulled back into the month before.
  const S1 = setPayDay(S0, '2026-08-01', 'month', { now: 1 }); // 1 Aug 2026 Sat → Fri 31 Jul
  assert.deepEqual(payDaysBetween(S1, '2026-07-01', '2026-07-31'), ['2026-07-01', '2026-07-31']);
  assert.equal(isPayDay(S1, '2026-08-01'), false);
});

t('every 4 / 2 / 1 weeks step from the anchor, both directions', () => {
  const S = setPayDay(S0, '2026-11-13', '4week', { now: 1 });
  assert.deepEqual(payDaysBetween(S, '2026-10-01', '2027-01-31'), ['2026-10-16', '2026-11-13', '2026-12-11', '2027-01-08']);
  assert.equal(payOf(S).weekendEarly, false, 'weekend rule is monthly-only');
  const W = setPayDay(S0, '2026-11-06', 'week', { now: 1 });
  assert.deepEqual(payDaysBetween(W, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
  const F = setPayDay(S0, '2026-11-06', '2week', { now: 1 });
  assert.deepEqual(payDaysBetween(F, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-20']);
});

t('just this day', () => {
  const S = setPayDay(S0, '2026-11-20', 'once', { now: 1 });
  assert.deepEqual(payDaysBetween(S, '2026-11-01', '2027-12-31'), ['2026-11-20']);
  assert.equal(nextPayDay(S, '2026-11-20'), null, 'after it, no next pay');
});

t('next pay is strictly after today', () => {
  const S = setPayDay(S0, '2026-11-27', 'month', { now: 1 });
  assert.equal(nextPayDay(S, '2026-11-06'), '2026-11-27');
  // 27 Dec 2026 is a Sunday → paid Friday 25 Dec.
  assert.equal(nextPayDay(S, '2026-11-27'), '2026-12-25', 'on pay day, the next one is next month');
});

t('before pay: renewals from today up to, not including, pay day', () => {
  const S = setPayDay({
    subscriptions: [
      { id: 'n', name: 'Netflix', amount: 10.99, freq: 'month', nextDate: '2026-10-10' },  // → 10 Nov
      { id: 's', name: 'Spotify', amount: 11.99, freq: 'month', nextDate: '2026-11-06' },  // today counts
      { id: 'g', name: 'Gym', amount: 25, freq: 'week', nextDate: '2026-11-02' },          // 9, 16, 23
      { id: 'i', name: 'iCloud', amount: 2.99, freq: 'month', nextDate: '2026-11-20' },    // the pay day itself → next period
      { id: 'a', name: 'Annual', amount: 99, freq: 'year', nextDate: '2027-03-01' },       // not this period
      { id: 'x', name: 'No date', amount: 5 },
    ],
  }, '2026-11-20', 'month', { now: 1 });
  const b = beforePay(S, '2026-11-06');
  assert.equal(b.next, '2026-11-20');
  assert.equal(b.days, 14);
  assert.deepEqual(b.items.map(i => `${i.iso} ${i.name}`), [
    '2026-11-06 Spotify', '2026-11-09 Gym', '2026-11-10 Netflix', '2026-11-16 Gym',
  ]);
  assert.equal(b.total, 11.99 + 25 + 10.99 + 25);
  assert.equal(b.paidToday, false);
  const onPay = beforePay(S, '2026-11-20');
  assert.equal(onPay.paidToday, true);
  assert.equal(onPay.items[0].name, 'iCloud', 'on pay day, its renewals start the new period');
});

t('updaters only touch S.pay', () => {
  const S = { ...S0, habits: [{ id: 'h' }] };
  const set = setPayDay(S, '2026-11-20', '2week', { now: 7 });
  const { pay, ...rest } = set;
  assert.deepEqual(rest, S);
  assert.deepEqual(pay, { anchor: '2026-11-20', freq: '2week', weekendEarly: false, setAt: 7 });
  assert.equal(setPayDay(S, 'bad', 'month'), S);
  assert.equal(setPayDay(S, '2026-11-20', 'nonsense').pay.freq, 'month');
  const cleared = clearPayDay(set);
  assert.equal(cleared.pay, null);
  assert.deepEqual({ ...cleared, pay: undefined }, { ...S, pay: undefined });
  assert.equal(clearPayDay(S), S, 'nothing set → unchanged');
});

t('labels', () => {
  assert.equal(PAY_FREQS.length, 5);
  assert.deepEqual([inDays(0), inDays(1), inDays(9)], ['today', 'tomorrow', 'in 9 days']);
});

console.log(`payday: ${n} tests passed`);

/**
 * Interest on savings accounts — pinned, because it is money.
 * Run: node src/lib/savings/interest.test.mjs
 */
import assert from 'node:assert/strict';
import { accountBalance, balanceNow, accountsTotal, settleAccount, monthlyRate, INTEREST_EPOCH } from './interest.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, m, tol = 0.005) => { assert.ok(Math.abs(a - b) < tol, `${m} (got ${a}, want ${b})`); n++; };
const DAY = 86400000;
const T0 = new Date(2027, 0, 1).getTime();

// ── A year at 4% is 4% ──
near(balanceNow({ balance: '1000', apy: '4', balanceAt: T0 }, T0 + 365 * DAY), 1040, 'a year at 4% APY is £1,040 — APY is the effective annual rate');
near(balanceNow({ balance: 1000, apy: 4, balanceAt: T0 }, T0 + 730 * DAY), 1081.6, 'two years compound: 1000 × 1.04²');
near(balanceNow({ balance: 1000, apy: 4, balanceAt: T0 }, T0 + 182 * DAY), 1000 * Math.pow(1.04, 182 / 365), 'part years accrue daily');

// ── Nothing accrues when it should not ──
eq(balanceNow({ balance: '1000', apy: '4', balanceAt: T0 }, T0 + 5 * 3600000), 1000, 'less than a day earns nothing yet');
eq(balanceNow({ balance: '1000', apy: '', balanceAt: T0 }, T0 + 400 * DAY), 1000, 'no rate, no interest');
eq(balanceNow({ balance: '', apy: '4', balanceAt: T0 }, T0 + 400 * DAY), 0, 'blank balance is zero, not NaN');
eq(balanceNow({ balance: '1000', apy: '4', balanceAt: T0 }, T0 - 10 * DAY), 1000, 'a clock behind the stamp never shrinks a balance');
eq(balanceNow({ balance: 'abc', apy: 'x' }, T0), 0, 'garbage is zero');

// ── Accounts from before this existed accrue from the release, not from 1970 ──
{
  const old = { balance: '8400', apy: '4.1' };
  near(balanceNow(old, INTEREST_EPOCH + 365 * DAY), 8400 * 1.041, 'an unstamped account starts at the release date');
  eq(balanceNow(old, INTEREST_EPOCH), 8400, 'and on release day shows exactly what was typed');
  eq(accountBalance(old, INTEREST_EPOCH + 3 * DAY).since, INTEREST_EPOCH, 'since reports the epoch');
}

// ── earned is the difference ──
{
  const r = accountBalance({ balance: 5000, apy: 5, balanceAt: T0 }, T0 + 365 * DAY);
  near(r.earned, 250, 'earned is interest only');
  eq(r.days, 365, 'days is whole days');
}

// ── Settling is lossless and restarts the clock ──
{
  const a = { id: 'a', balance: 1000, apy: 4, balanceAt: T0 };
  const mid = T0 + 182 * DAY;
  const s = settleAccount(a, 0, mid);
  eq(s.balanceAt, mid, 'settle restamps');
  ok(s.id === 'a' && s.apy === 4, 'and keeps every other field');
  near(balanceNow(s, T0 + 365 * DAY), 1040, 'settling half way and carrying on lands on the same year-end figure', 0.02);

  const dep = settleAccount(a, 500, mid);
  near(dep.balance, Math.round((1000 * Math.pow(1.04, 182 / 365) + 500) * 100) / 100, 'a deposit adds to the accrued balance');
  near(balanceNow(dep, mid + 183 * DAY), dep.balance * Math.pow(1.04, 183 / 365), 'and only earns from the day it went in', 0.01);

  eq(settleAccount(a, -5000, mid).balance, 0, 'a withdrawal never takes an account below zero');
  eq(String(settleAccount({ balance: '10.005', apy: 0 }, 0, T0).balance), '10.01', 'settled balances are pence');
}

// ── Totals and monthly rate ──
near(accountsTotal([{ balance: 100, apy: 0 }, { balance: '200', apy: '0' }], T0), 300, 'total sums today\'s balances');
eq(accountsTotal([], T0), 0, 'no accounts total zero');
near(Math.pow(1 + monthlyRate(4), 12), 1.04, 'twelve monthly steps make the APY, not more');
eq(monthlyRate(''), 0, 'blank rate is a zero monthly rate');

console.log(`interest: ${n} assertions passed`);

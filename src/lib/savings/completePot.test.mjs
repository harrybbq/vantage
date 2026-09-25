/**
 * Completing a pot draws down the ticked accounts, in list order — and
 * undo puts every penny back. Run: node src/lib/savings/completePot.test.mjs
 */
import assert from 'node:assert/strict';
import { planPotCompletion, completePot, undoCompletePot, livePots } from './completePot.js';
import { balanceNow } from './interest.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const T = new Date(2027, 2, 1).getTime();

const base = () => ({
  savings: [
    { id: 'car', name: 'Car', current: 5000, target: 5000, contributions: [{ id: 'c1', amount: 5000 }] },
    { id: 'hol', name: 'Holiday', current: 900, target: 1400 },
  ],
  savingsAccounts: [
    { id: 'isa', name: 'ISA', balance: 20000, apy: 0, drainable: false },       // never touched
    { id: 'easy', name: 'Easy', balance: 3000, apy: 0, drainable: true, balanceAt: T },
    { id: 'monzo', name: 'Monzo', balance: 4000, apy: 0, drainable: true, balanceAt: T },
  ],
  other: { keep: 'me' },
});

// ── The plan ──
{
  const p = planPotCompletion(base(), 'car', T);
  eq(p.amount, 5000, 'the pot amount is what is in it');
  eq(p.draws.map(d => [d.id, d.take]), [['easy', 3000], ['monzo', 2000]], 'ticked accounts, in list order, first emptied first');
  eq([p.covered, p.short], [5000, 0], 'fully covered');
  ok(!p.draws.some(d => d.id === 'isa'), 'an unticked account is never drawn on, even with the most money in it');
  eq(planPotCompletion(base(), 'nope', T), null, 'no such pot → null');
}

// ── Not enough in the ticked accounts ──
{
  const S = base(); S.savings[0].current = 9000;
  const p = planPotCompletion(S, 'car', T);
  eq([p.covered, p.short], [7000, 2000], 'the shortfall is reported, not invented');
  const next = completePot(S, 'car', T);
  eq(next.savingsAccounts.map(a => Number(a.balance)), [20000, 0, 0], 'ticked accounts go to zero, never below');
}

// ── Completing ──
{
  const S = base();
  const next = completePot(S, 'car', T + 1000);
  eq(next.savingsAccounts.map(a => Number(a.balance)), [20000, 0, 2000], 'balances drawn down');
  const car = next.savings.find(g => g.id === 'car');
  ok(car.completedAt === T + 1000 && car.completedAmount === 5000, 'the pot is stamped complete with its amount');
  eq(car.current, 5000, 'current is untouched — a funded pot is still an achievement');
  eq(car.contributions.length, 1, 'and its history is intact');
  eq(car.drained, [{ accountId: 'easy', amount: 3000 }, { accountId: 'monzo', amount: 2000 }], 'withdrawals are recorded exactly');
  eq(next.other, { keep: 'me' }, 'nothing else in state changes');
  eq(next.savings[1], S.savings[1], 'other pots are untouched');
  eq(next.savingsAccounts[0], S.savingsAccounts[0], 'the unticked account object is untouched');
  eq(livePots(next.savings).map(g => g.id), ['hol'], 'a completed pot is no longer live');
  eq(completePot(next, 'car', T + 2000), next, 'completing twice is a no-op, not a double withdrawal');
}

// ── Undo is exact ──
{
  const S = base();
  const done = completePot(S, 'car', T + 1000);
  const undone = undoCompletePot(done, 'car', T + 2000);
  eq(undone.savingsAccounts.map(a => Number(a.balance)), [20000, 3000, 4000], 'undo refunds every account it drew from');
  const car = undone.savings.find(g => g.id === 'car');
  ok(!car.completedAt && !car.drained, 'and the pot is live again');
  eq(livePots(undone.savings).length, 2, 'both pots live');
  eq(undoCompletePot(undone, 'car', T), undone, 'undo on a live pot is a no-op');
}

// ── Interest is folded in before the draw ──
{
  const S = base();
  S.savingsAccounts[1] = { id: 'easy', name: 'Easy', balance: 3000, apy: 5, drainable: true, balanceAt: T - 365 * 86400000 };
  const p = planPotCompletion(S, 'car', T);
  eq(p.draws[0].before, 3150, 'a year at 5% is there to be drawn');
  eq(p.draws.map(d => d.take), [3150, 1850], 'so less is needed from the next account');
  const next = completePot(S, 'car', T);
  eq(Number(next.savingsAccounts[1].balance), 0, 'the interest went with it');
  eq(next.savingsAccounts[1].balanceAt, T, 'and the account clock restarted');
  eq(balanceNow(next.savingsAccounts[2], T), 2150, 'the second account holds the rest');
}

// ── An empty pot completes without touching anything ──
{
  const S = base(); S.savings[1].current = 0;
  const next = completePot(S, 'hol', T);
  eq(next.savingsAccounts, S.savingsAccounts.map(a => a), 'no money, no withdrawals');
  ok(next.savings[1].completedAt === T, 'but it is complete');
}

console.log(`complete pot: ${n} assertions passed`);

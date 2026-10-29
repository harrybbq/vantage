/**
 * Accounts are owner-only: for anyone else the view behaves as if there
 * are none, and nothing they do writes to them.
 * Run: node src/lib/savings/visibleAccounts.test.mjs
 */
import assert from 'node:assert/strict';
import {
  visibleAccounts, visibleItems, savingsView,
  visibleBlockIds, visiblePresets, keepHiddenBlocks, OWNER_BLOCKS,
} from './visibleAccounts.js';
import { potTotals, flowTotals, cashSeries, savingsSeries, derivePot } from './derive.js';
import { completePot, undoCompletePot, planPotCompletion } from './completePot.js';
import { applyPlanPosts, proposePlanPosts, routedRows } from './planPost.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 9, 15);
const T = NOW.getTime();

const heavy = () => ({
  savings: [
    { id: 'house', name: 'House', current: 8000, target: 30000, createdAt: '2025-01-01', targetDate: '2028-06-01' },
    { id: 'car', name: 'Car', current: 5000, target: 5000 },
  ],
  savingsAccounts: [
    { id: 'isa', name: 'ISA', balance: 12000, apy: 4.1, balanceAt: T, goalId: 'house' },
    { id: 'easy', name: 'Easy', balance: 3000, apy: 3, balanceAt: T, drainable: true },
  ],
  savingsHistory: { '2026-09': { total: 15000, at: T - 1 } },
  projection: {
    items: [
      { id: 'sal', kind: 'income', label: 'Salary', amount: 3000, freq: 'month' },
      { id: 'rent', kind: 'expense', label: 'Rent', amount: 1200, freq: 'month' },
      { id: 'toIsa', kind: 'expense', label: 'ISA order', amount: 300, freq: 'month', accountId: 'isa' },
      { id: 'bonus', kind: 'income', label: 'Bonus to easy', amount: 100, freq: 'month', accountId: 'easy' },
      { id: 'both', kind: 'expense', label: 'House + ISA', amount: 200, freq: 'month', goalId: 'house', accountId: 'isa' },
      { id: 'toCar', kind: 'expense', label: 'Car', amount: 50, freq: 'month', goalId: 'car' },
    ],
    groups: [],
    horizon: 12,
  },
  planLedger: { from: '2026-08', months: {} },
  other: { keep: 'me' },
});

// ── visibleAccounts ──
{
  const S = heavy();
  ok(visibleAccounts(S, true) === S.savingsAccounts, 'owner: the very same list');
  eq(visibleAccounts(S, false), [], 'non-owner: none');
  eq(visibleAccounts({}, true), [], 'owner with none: empty, not undefined');
  eq(visibleAccounts(null, true), [], 'no state: empty');
}

// ── visibleItems ──
{
  const S = heavy();
  const items = S.projection.items;
  ok(visibleItems(items, true) === items, 'owner: rows untouched (same array)');
  const v = visibleItems(items, false);
  ok(v.every(it => !('accountId' in it)), 'non-owner: no row points at an account');
  eq(v.find(it => it.id === 'both').goalId, 'house', 'a row naming a pot still routes into it');
  ok(items.find(it => it.id === 'toIsa').accountId === 'isa', 'the stored row is not mutated');
  const plain = [{ id: 'a', kind: 'income', amount: 1 }];
  ok(visibleItems(plain, false) === plain, 'nothing routed to an account: same array back');
  eq(visibleItems(undefined, false), [], 'no rows: empty');
}

// ── savingsView ──
{
  const S = heavy();
  const before = JSON.stringify(S);
  ok(savingsView(S, true) === S, 'owner: S itself');
  const V = savingsView(S, false);
  eq(V.savingsAccounts, [], 'view has no accounts');
  ok(V.projection.items.every(it => !it.accountId), 'view rows have no accountId');
  eq(V.other, S.other, 'everything else is carried');
  eq(JSON.stringify(S), before, 'building the view does not touch the state');
  const none = { savings: [], projection: { items: [{ id: 'x', kind: 'income', amount: 5 }] } };
  ok(savingsView(none, false) === none, 'no accounts anywhere: S itself, so memos keyed on S hold');
}

// ── The numbers, as a non-owner sees them ──
{
  const S = heavy();
  const V = savingsView(S, false);
  const items = V.projection.items;
  const flow = flowTotals(items, V.savings, V.savingsAccounts, NOW, 0);
  // Salary 3000 + bonus 100 (no longer routed: plain income);
  // rent 1200 + ISA order 300 + house 200 + car 50.
  eq(flow.income, 3100, 'income routed into an account is plain income');
  eq(flow.spend, 1750, 'every expense is spend');
  eq(flow.routed, 250, 'only rows naming a pot are routed');
  const cash = cashSeries(1000, items, 3, NOW, 0);
  eq(cash[1] - cash[0], 3100 - 1750, 'the cash line gets the bonus that used to go to an account');
  eq(savingsSeries(V.savingsAccounts, items, 3, NOW), [0, 0, 0, 0], 'no savings line to speak of');
  const house = derivePot(V.savings[0], items, V.savingsAccounts, NOW);
  eq(house.routed, 200, 'the ISA order no longer reaches the pot through its account');
  eq(house.accounts, [], 'a pot is held in no accounts');
  const t = potTotals(V.savings, items, V.savingsAccounts, NOW);
  ok(Number.isFinite(t.routed) && Number.isFinite(t.pct), 'no NaN in the headline');

  // And the owner's numbers are exactly the unfiltered ones.
  const O = savingsView(S, true);
  eq(flowTotals(O.projection.items, O.savings, O.savingsAccounts, NOW, 0),
     flowTotals(S.projection.items, S.savings, S.savingsAccounts, NOW, 0), 'owner: unchanged');
  eq(derivePot(S.savings[0], O.projection.items, O.savingsAccounts, NOW).routed, 500, 'owner: ISA order still reaches the house pot');
}

// ── Plan post: pots only, accounts untouched ──
{
  const S = heavy();
  const V = savingsView(S, false);
  eq(routedRows(V).map(r => r.id), ['both', 'toCar'], 'non-owner: only rows into a pot are routed');
  const rows = proposePlanPosts(V, '2026-09', NOW);
  ok(rows.every(r => r.accountId == null), 'no proposal lands in an account');
  const next = applyPlanPosts(S, '2026-09', rows, T, { accounts: false });
  ok(next.savingsAccounts === S.savingsAccounts, 'accounts: the same array, not a copy');
  ok(next.savingsHistory === S.savingsHistory, 'no snapshot stamped');
  eq(next.savings.find(g => g.id === 'house').current, 8200, 'the pot still gets its contribution');
  ok(next.planLedger.months['2026-09'], 'the month is recorded as decided');
  // Defensive: a row that DOES name an account is still pots-only.
  const sneaky = applyPlanPosts(S, '2026-09', [{ itemId: 'toIsa', amount: 300, accountId: 'isa', goalId: null }], T, { accounts: false });
  ok(sneaky.savingsAccounts === S.savingsAccounts, 'accountId on a row is ignored with accounts off');
  // Owner path unchanged.
  const own = applyPlanPosts(S, '2026-09', proposePlanPosts(S, '2026-09', NOW), T);
  ok(own.savingsAccounts !== S.savingsAccounts, 'owner: accounts move as before');
}

// ── Completing and undoing a pot without accounts ──
{
  const S = heavy();
  const before = JSON.stringify({ a: S.savingsAccounts, h: S.savingsHistory });
  const p = planPotCompletion(S, 'car', T, { accounts: false });
  eq([p.draws, p.drainable, p.short], [[], 0, 5000], 'the plan draws on nothing');
  const done = completePot(S, 'car', T, { accounts: false });
  ok(done.savingsAccounts === S.savingsAccounts, 'complete: accounts are the same array');
  ok(done.savingsHistory === S.savingsHistory, 'complete: no snapshot');
  const car = done.savings.find(g => g.id === 'car');
  eq([car.completedAt, car.completedAmount, car.drained, car.current], [T, 5000, [], 5000], 'the pot completes, current untouched');
  const back = undoCompletePot(done, 'car', T + 1, { accounts: false });
  ok(back.savingsAccounts === S.savingsAccounts, 'undo: accounts are the same array');
  eq(back.savings.find(g => g.id === 'car').completedAt, null, 'undo: the pot is live again');
  eq(JSON.stringify({ a: back.savingsAccounts, h: back.savingsHistory }), before, 'accounts and history byte-identical');

  // A pot completed with draws BEFORE the gate: undo as a non-owner
  // refunds nothing and keeps the record of what was drawn.
  const drawn = completePot(S, 'car', T);
  const easyAfter = drawn.savingsAccounts.find(a => a.id === 'easy');
  const reopened = undoCompletePot(drawn, 'car', T + 1, { accounts: false });
  ok(reopened.savingsAccounts === drawn.savingsAccounts, 'no refund written');
  eq(reopened.savingsAccounts.find(a => a.id === 'easy'), easyAfter, 'the drawn account is as it was');
  eq(reopened.savings.find(g => g.id === 'car').drained, drawn.savings.find(g => g.id === 'car').drained, 'drained record kept');
  const again = completePot(reopened, 'car', T + 2, { accounts: false });
  eq(again.savings.find(g => g.id === 'car').drained, drawn.savings.find(g => g.id === 'car').drained, 're-completing keeps the record too');
}

// ── Prime blocks ──
{
  ok(OWNER_BLOCKS.savings.includes('accounts'), 'the accounts block is owner-only');
  eq(visibleBlockIds('savings', ['bills', 'accounts', 'total'], false), ['bills', 'total'], 'non-owner: not drawn');
  eq(visibleBlockIds('savings', ['bills', 'accounts', 'total'], true), ['bills', 'accounts', 'total'], 'owner: drawn');
  eq(visibleBlockIds('trackers', ['accounts'], false), ['accounts'], 'other primes untouched');
  const presets = [['Overview', ['total', 'pots']], ['Bills', ['bills', 'accounts', 'total']], ['Only', ['accounts']]];
  eq(visiblePresets('savings', presets, false), [['Overview', ['total', 'pots']], ['Bills', ['bills', 'total']]], 'presets lose the block; an empty preset goes');
  ok(visiblePresets('savings', presets, true) === presets, 'owner: presets as they are');
  // A non-owner reorders a card that holds the hidden block: it stays, where it was.
  eq(keepHiddenBlocks('savings', ['bills', 'accounts', 'total'], ['total', 'bills'], false), ['total', 'accounts', 'bills'], 'hidden block kept at its index');
  eq(keepHiddenBlocks('savings', ['total', 'pots', 'accounts'], ['pots'], false), ['pots', 'accounts'], 'clamped to the end');
  eq(keepHiddenBlocks('savings', ['total'], ['pots', 'total'], false), ['pots', 'total'], 'nothing hidden: as given');
  eq(keepHiddenBlocks('savings', ['accounts', 'total'], ['total', 'accounts'], true), ['total', 'accounts'], 'owner: as given');
}

console.log(`visibleAccounts: ${n} assertions passed`);

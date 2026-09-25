/**
 * Posting the finished month from the plan.
 *
 * Every assertion here exists because the failure it guards is money
 * appearing that never moved: a month posted twice, a row counted twice
 * because it names both a pot and that pot's account, a back-post of
 * months the user already entered by hand, or an amount arriving
 * without anyone confirming it.
 */
import assert from 'node:assert/strict';
import {
  monthKey, monthLabel, prevMonth, monthOffset, routedRows, armPlanLedger,
  duePlanMonth, proposePlanPosts, applyPlanPosts, skipPlanMonth, postedMonths,
  contributionId,
} from './planPost.js';
import { addContribution } from './contribute.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = new Date(2026, 8, 7, 10, 0);             // 7 Sep 2026
const AUG = '2026-08';

const state = (over = {}) => ({
  savings: [
    { id: 'g1', name: 'House deposit', target: 20000, current: 5000, contributions: [] },
    { id: 'g2', name: 'Emergency fund', target: 6000, current: 1000, contributions: [] },
  ],
  savingsAccounts: [
    { id: 'a1', name: 'Cash ISA', balance: 5000, apy: 4.5, goalId: 'g1' },
    { id: 'a2', name: 'Instant saver', balance: 1000, apy: 3, goalId: null },
  ],
  projection: {
    startBalance: 2000,
    items: [
      { id: 'i1', kind: 'expense', label: 'Rent', amount: 900, freq: 'month' },
      { id: 'i2', kind: 'expense', label: 'To house deposit', amount: 250, freq: 'month', goalId: 'g1' },
      { id: 'i3', kind: 'expense', label: 'To ISA', amount: 100, freq: 'month', accountId: 'a1' },
      { id: 'i4', kind: 'expense', label: 'To instant saver', amount: 50, freq: 'month', accountId: 'a2' },
    ],
  },
  achievements: [], coins: 0, coinHistory: [],
  ...over,
});

// ── Month arithmetic ──
{
  eq(monthKey(NOW), '2026-09', 'the month a date is in');
  eq(prevMonth('2026-09'), AUG, 'the month before it');
  eq(prevMonth('2026-01'), '2025-12', 'across a year boundary');
  eq(monthOffset(AUG, NOW), -1, 'August is one month behind September');
  eq(monthOffset('2026-09', NOW), 0, 'and September is now');
  eq(monthLabel(AUG), 'August 2026', 'a month reads as a month');
  eq(monthLabel('nonsense'), 'nonsense', 'and rubbish is passed through rather than thrown');
}

// ── Which rows count ──
{
  const S = state();
  eq(routedRows(S).map(r => r.id), ['i2', 'i3', 'i4'],
    'rent is not routed anywhere; the three that are, are');
  eq(routedRows({}), [], 'an empty state routes nothing');
  eq(routedRows({ projection: { items: [{ id: 'x', accountId: 'gone' }] } }), [],
    'and a row pointed at a deleted account is not a route');
}

// ── Arming: nothing before the day the feature saw a plan ──
{
  const S = state();
  eq(duePlanMonth(S, NOW), null, 'an unarmed ledger proposes nothing at all');

  const armed = armPlanLedger(S, NOW);
  eq(armed.planLedger.from, '2026-09', 'arming records the month it started');
  ok(armPlanLedger(armed, NOW) === armed, 'arming twice writes nothing');

  const noPlan = state({ projection: { items: [] } });
  ok(armPlanLedger(noPlan, NOW) === noPlan, 'and there is nothing to arm without a plan');

  eq(duePlanMonth(armed, NOW), null,
    'armed in September, August is before the start — it is never back-posted');

  const oct = new Date(2026, 9, 3);
  eq(duePlanMonth(armed, oct), '2026-09', 'the first month proposed is the first full one after arming');
}

// ── The proposal ──
{
  const S = armPlanLedger(state(), new Date(2026, 7, 1));    // armed in August
  eq(duePlanMonth(S, NOW), AUG, 'August is the month waiting');
  const rows = proposePlanPosts(S, AUG, NOW);
  eq(rows.length, 3, 'three routed rows');
  eq(rows.map(r => r.amount), [250, 100, 50], 'at their monthly amounts');
  eq(rows[0].goalName, 'House deposit', 'a row pointed at a pot names the pot');
  eq(rows[1].goalName, 'House deposit', 'a row pointed at the pot’s account names it too');
  eq(rows[1].accountName, 'Cash ISA', 'and says which account');
  eq(rows[2].goalId, null, 'an account belonging to no pot is just an account');
  eq(proposePlanPosts(S, null, NOW), [], 'no month, no proposal');
}

// A row's window is respected — a plan that ended in July does not post
// for August.
{
  const S = armPlanLedger(state({
    projection: { items: [{ id: 'i2', kind: 'expense', label: 'Ended', amount: 250, freq: 'month', goalId: 'g1', until: '2026-07' }] },
  }), new Date(2026, 6, 1));
  eq(proposePlanPosts(S, AUG, NOW), [], 'a row that stopped in July contributes nothing to August');
}

// Cadences normalise, and a zero row is not worth proposing.
{
  const S = armPlanLedger(state({
    projection: { items: [
      { id: 'w', kind: 'expense', label: 'Weekly', amount: 12, freq: 'week', goalId: 'g1' },
      { id: 'z', kind: 'expense', label: 'Nothing', amount: 0, freq: 'month', goalId: 'g1' },
    ] },
  }), new Date(2026, 6, 1));
  const rows = proposePlanPosts(S, AUG, NOW);
  eq(rows.length, 1, 'the zero row is dropped');
  eq(rows[0].amount, 52, '£12 a week is £52 a month');
}

// ── Posting ──
{
  const S = armPlanLedger(state(), new Date(2026, 7, 1));
  const rows = proposePlanPosts(S, AUG, NOW);
  const after = applyPlanPosts(S, AUG, rows, NOW.getTime());

  const g1 = after.savings.find(g => g.id === 'g1');
  eq(g1.current, 5350, 'the pot took both the row aimed at it and the row aimed at its ISA');
  eq(g1.contributions.length, 2, 'as two entries on the ledger');
  ok(g1.contributions.every(c => /Plan · August 2026/.test(c.note)), 'each saying where it came from');
  ok(g1.contributions.every(c => c.auto === 'plan'), 'and marked as a plan post rather than a hand entry');
  ok(g1.contributions.every(c => c.ts.startsWith('2026-08-31')),
    'stamped at the end of the month it belongs to, so it buckets there');

  eq(after.savingsAccounts.find(a => a.id === 'a1').balance, 5100, 'the ISA balance moved');
  eq(after.savingsAccounts.find(a => a.id === 'a2').balance, 1050, 'and so did the unlinked saver');
  eq(after.savings.find(g => g.id === 'g2').current, 1000, 'a pot nothing was routed at is untouched');
  eq(after.projection.startBalance, 2000, 'and the current-account figure is the user’s to set');

  eq(after.planLedger.months[AUG].total, 400, 'the month is recorded with its total');
  eq(after.planLedger.months[AUG].itemIds.sort(), ['i2', 'i3', 'i4'], 'and what it posted');
}

// ── Never twice ──
{
  const S = armPlanLedger(state(), new Date(2026, 7, 1));
  const once = applyPlanPosts(S, AUG, proposePlanPosts(S, AUG, NOW), NOW.getTime());
  eq(duePlanMonth(once, NOW), null, 'a decided month stops being asked about');
  const twice = applyPlanPosts(once, AUG, proposePlanPosts(once, AUG, NOW), NOW.getTime());
  ok(twice === once, 'and a second post is refused outright');

  // Belt and braces: even with the ledger entry removed, the deterministic
  // contribution id stops the same money landing again.
  const scrubbed = { ...once, planLedger: { from: once.planLedger.from, months: {} } };
  const again = applyPlanPosts(scrubbed, AUG, proposePlanPosts(scrubbed, AUG, NOW), NOW.getTime());
  eq(again.savings.find(g => g.id === 'g1').current, 5350,
    'the pot does not take the same contribution ids twice');
  eq(contributionId(AUG, 'i2'), 'plan-2026-08-i2', 'because the id is derived, not random');
}

// ── The user edits the month before confirming ──
{
  const S = armPlanLedger(state(), new Date(2026, 7, 1));
  const edited = [{ ...proposePlanPosts(S, AUG, NOW)[0], amount: 100 }];
  const after = applyPlanPosts(S, AUG, edited, NOW.getTime());
  eq(after.savings.find(g => g.id === 'g1').current, 5100, 'what was confirmed is what was posted');
  eq(after.planLedger.months[AUG].itemIds, ['i2'], 'and the dropped rows stayed dropped');
}

// ── Skipping ──
{
  const S = armPlanLedger(state(), new Date(2026, 7, 1));
  const skipped = skipPlanMonth(S, AUG);
  eq(skipped.planLedger.months[AUG].skipped, true, 'a skipped month is recorded as skipped');
  eq(skipped.savings.find(g => g.id === 'g1').current, 5000, 'and moved no money');
  eq(duePlanMonth(skipped, NOW), null, 'a question already answered is not asked again');
  ok(skipPlanMonth(skipped, AUG) === skipped, 'and skipping twice writes nothing');
  eq(postedMonths(skipped).map(m => m.month), [AUG], 'the ledger can be read back');
}

// ── Crossing the target still completes the achievement ──
{
  const S = armPlanLedger(state({
    savings: [{ id: 'g1', name: 'House deposit', target: 5200, current: 5000, contributions: [], achievementId: 'ach1' }],
    achievements: [{ id: 'ach1', name: 'Deposit saved', completed: false, coins: 500 }],
    projection: { items: [{ id: 'i2', kind: 'expense', label: 'To deposit', amount: 250, freq: 'month', goalId: 'g1' }] },
  }), new Date(2026, 7, 1));
  const after = applyPlanPosts(S, AUG, proposePlanPosts(S, AUG, NOW), NOW.getTime());
  eq(after.achievements[0].completed, true, 'the linked achievement fires');
  eq(after.coins, 500, 'and pays exactly what completing it by hand pays');
}

// ── addContribution on its own ──
{
  const S = state();
  ok(addContribution(S, 'nope', { amount: 10 }) === S, 'a pot that is gone takes nothing');
  ok(addContribution(S, 'g1', { amount: 0 }) === S, 'and nor does a zero');
  ok(addContribution(S, 'g1', { amount: 'abc' }) === S, 'or an amount that is not one');
  const first = addContribution(S, 'g1', { id: 'c1', amount: 10 });
  eq(first.savings[0].current, 5010, 'a balance that predates the ledger is carried, not deleted');
  ok(addContribution(first, 'g1', { id: 'c1', amount: 10 }) === first, 'a repeated id is refused');

  // The ordinary case: a pot whose ledger accounts for all of it.
  const ledgered = state({
    savings: [{ id: 'g1', name: 'Pot', target: 100, current: 30, contributions: [{ id: 'x', amount: 30 }] }],
  });
  eq(addContribution(ledgered, 'g1', { id: 'y', amount: 20 }).savings[0].current, 50,
    'recomputes from the ledger when the ledger is the whole story');
}

console.log(`plan posting: ${n} assertions passed`);

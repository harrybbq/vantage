/**
 * Completing a pot: the money is spent, so take it out of the accounts
 * that were holding it.
 *
 * ── Which accounts, in what order ────────────────────────────────────
 * Only the ones the user ticked as "can pay out a completed pot"
 * (`drainable: true`), and in the order they sit in the Accounts list.
 * Each is emptied as far as it needs to be before the next is touched.
 * An account nobody ticked is never drawn on — an ISA the user does not
 * want raided stays whole even if it is the only money there.
 *
 * If the ticked accounts hold less than the pot, they are all drawn to
 * zero and the rest is reported as `short`. The pot still completes:
 * the confirm step shows the shortfall first, and whether the rest came
 * from a current account is the user's business, not ours.
 *
 * ── What happens to the pot ──────────────────────────────────────────
 * Nothing is deleted and `current` is not touched: a pot that reached
 * its target is still an achievement (ratings and visions both read it).
 * It gains `completedAt`, `completedAmount` and `drained` — the exact
 * withdrawals, which is what makes UNDO exact: each amount goes back to
 * the account it came from.
 *
 * Every balance change goes through `settleAccount`, so interest earned
 * up to today is folded in before anything is taken out.
 */
import { balanceNow, settleAccount } from './interest.js';

const pence = v => Math.round((Number(v) || 0) * 100) / 100;

/** Pots that are still being saved into. */
export const livePots = goals => (goals || []).filter(g => g && !g.completedAt);

/**
 * What completing this pot WOULD do — for the confirm step.
 * @returns null if no such live pot, else
 *   { goal, amount, draws: [{ id, name, before, take, after }], covered, short, drainable }
 */
export function planPotCompletion(S, goalId, now = Date.now()) {
  const goal = (S?.savings || []).find(g => g.id === goalId);
  if (!goal || goal.completedAt) return null;
  const amount = pence(Math.max(0, Number(goal.current) || 0));
  const accounts = (S?.savingsAccounts || []).filter(a => a && a.drainable);
  let left = amount;
  const draws = [];
  for (const a of accounts) {
    const before = pence(balanceNow(a, now));
    const take = pence(Math.min(before, left));
    draws.push({ id: a.id, name: a.name || 'Account', before, take, after: pence(before - take) });
    left = pence(left - take);
  }
  return {
    goal, amount, draws: draws.filter(d => d.take > 0),
    covered: pence(amount - left), short: left, drainable: accounts.length,
  };
}

/** The state with the pot completed and its accounts drawn down. */
export function completePot(prev, goalId, now = Date.now()) {
  const plan = planPotCompletion(prev, goalId, now);
  if (!plan) return prev;
  const takes = new Map(plan.draws.map(d => [d.id, d.take]));
  return {
    ...prev,
    savingsAccounts: (prev.savingsAccounts || []).map(a =>
      (takes.has(a.id) ? settleAccount(a, -takes.get(a.id), now) : a)),
    savings: (prev.savings || []).map(g => (g.id === goalId ? {
      ...g,
      completedAt: now,
      completedAmount: plan.amount,
      drained: plan.draws.map(d => ({ accountId: d.id, amount: d.take })),
    } : g)),
  };
}

/**
 * Undo a completion: every withdrawal goes back where it came from, and
 * the pot is live again. An account deleted since simply cannot be
 * refunded — the rest still are.
 */
export function undoCompletePot(prev, goalId, now = Date.now()) {
  const goal = (prev.savings || []).find(g => g.id === goalId);
  if (!goal || !goal.completedAt) return prev;
  const back = new Map();
  for (const d of (goal.drained || [])) {
    if (d && d.accountId) back.set(d.accountId, pence((back.get(d.accountId) || 0) + (Number(d.amount) || 0)));
  }
  return {
    ...prev,
    savingsAccounts: (prev.savingsAccounts || []).map(a =>
      (back.has(a.id) ? settleAccount(a, back.get(a.id), now) : a)),
    savings: (prev.savings || []).map(g => (g.id === goalId
      ? { ...g, completedAt: null, completedAmount: null, drained: null }
      : g)),
  };
}

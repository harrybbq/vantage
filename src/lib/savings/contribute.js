/**
 * Putting money into a pot.
 *
 * Lifted out of Modals.jsx's handleAddContribution unchanged in
 * behaviour, because a second caller arrived: the monthly plan post in
 * planPost.js. Two implementations of "a pot crossed its target" would
 * have drifted the first time either was touched, and the one that
 * drifted would be the one that quietly stopped paying the achievement
 * reward.
 *
 * `current` is recomputed from the contributions rather than added to,
 * which is what makes a re-run harmless: post the same contribution id
 * twice and the second is refused outright, but even a hand-edited
 * ledger can only ever produce the sum of what is actually in it.
 *
 * With one guard the original did not have. Recomputing from the ledger
 * assumes every penny in `current` is IN the ledger, which is true for
 * every pot this app has created (they start at zero and only move
 * through here). It would not be true of a pot that arrived with an
 * opening balance — an import, or a `current` set directly — and the
 * recompute would silently delete that balance the first time anything
 * was contributed. Nothing did that often enough to notice; the monthly
 * plan post would do it to every pot, on a schedule. So the unledgered
 * remainder is measured once and carried, which is a no-op whenever the
 * ledger is already complete.
 *
 * Pure. Takes a state, returns a state.
 */

/**
 * Append one contribution to a pot.
 *
 * Returns `prev` unchanged when the pot is gone, when the amount is not
 * a real number, or when a contribution with this id is already on the
 * ledger — the last of those is what makes the monthly plan post safe
 * to run twice.
 */
export function addContribution(prev, goalId, contribution) {
  const goals = prev.savings || [];
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return prev;

  const amount = Number(contribution && contribution.amount);
  if (!Number.isFinite(amount) || amount === 0) return prev;

  const existing = goal.contributions || [];
  if (contribution.id && existing.some(c => c && c.id === contribution.id)) return prev;

  const ledgered = existing.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const opening = Math.max(0, (Number(goal.current) || 0) - ledgered);

  const nextContribs = [{ ...contribution, amount }, ...existing];
  const nextCurrent = Math.round((opening + ledgered + amount) * 100) / 100;
  const justHit = nextCurrent >= goal.target && goal.current < goal.target;

  let next = {
    ...prev,
    savings: goals.map(g => g.id === goalId
      ? { ...g, current: nextCurrent, contributions: nextContribs }
      : g),
  };

  // Crossing the target completes the linked achievement through the
  // same pipeline as ticking it by hand — coin reward included, so the
  // route the money took does not change what it is worth.
  if (justHit && goal.achievementId) {
    const linked = (prev.achievements || []).find(a => a.id === goal.achievementId);
    if (linked && !linked.completed) {
      next.achievements = (prev.achievements || []).map(a =>
        a.id === goal.achievementId ? { ...a, completed: true } : a
      );
      if (linked.coins && linked.coins > 0) {
        next.coins = (prev.coins || 0) + linked.coins;
        next.coinHistory = [
          { type: 'earn', label: linked.name, amount: linked.coins, ts: Date.now() },
          ...(prev.coinHistory || []),
        ];
      }
    }
  }

  return next;
}

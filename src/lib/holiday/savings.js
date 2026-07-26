/**
 * Linking a trip's budget to a savings goal.
 *
 * The savings system already tracks target/current per goal, so a trip
 * doesn't duplicate any of that — it stores only a goal id and reads
 * through. That means one number, one place to update it, and no
 * migration: trips without a link behave exactly as they always have.
 */

/** Parse the free-text budget field ("£1,200", "1200 eur", "1.2k"). */
export function parseBudget(text) {
  if (text == null || text === '') return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const raw = String(text).trim().toLowerCase().replace(/[,\s]/g, '');
  const m = raw.match(/(\d+(?:\.\d+)?)(k?)/);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1000 : 1);
  return Number.isFinite(n) ? n : null;
}

/**
 * Progress for a trip's linked savings goal, or null when there's no
 * link (or the goal has since been deleted — the trip is left intact
 * either way and simply stops showing progress).
 */
export function tripSavings(S, trip) {
  if (!trip?.savingsGoalId) return null;
  const goal = (S.savings || []).find(g => g.id === trip.savingsGoalId);
  if (!goal) return null;

  const target = Number(goal.target) || 0;
  const current = Number(goal.current) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  // Days until departure, so the card can say whether it's on track.
  let perMonthNeeded = null, onTrack = null;
  if (trip.from && target > current) {
    const days = Math.ceil((new Date(trip.from) - new Date()) / 86400000);
    if (days > 0) {
      const months = Math.max(1, days / 30.44);
      perMonthNeeded = Math.ceil((target - current) / months);
      // "On track" needs contribution history to be meaningful; without
      // it we only claim the trivially true case.
      onTrack = current >= target;
    } else {
      onTrack = current >= target;
    }
  } else if (target > 0) {
    onTrack = current >= target;
  }

  return { goal, target, current, pct, perMonthNeeded, onTrack };
}

/** Goals offered in the trip picker, newest first. */
export function selectableGoals(S) {
  return [...(S.savings || [])].reverse();
}

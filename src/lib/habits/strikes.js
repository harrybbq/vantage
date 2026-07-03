/**
 * Habit strike accounting — single source of truth for every surface
 * that displays a habit timer (Habits page desktop/mobile, hub widget
 * desktop/mobile).
 *
 * Semantics (2026-07): every relapse restarts the timer. Strikes no
 * longer keep the streak alive — they're a damage record for the
 * current period. A habit whose timer has never been hit this period
 * is "unscathed"; once struck it wears the strike visibly:
 *
 *   clean   0 strikes used          → pristine green
 *   struck  1..allowed-1 used       → amber
 *   maxed   used >= allowed         → red (strike allowance spent)
 *   off     strikesAllowed === 0    → no strike system on this habit
 *
 * Strikes expire with their period (week/month roll off via the
 * timestamp filter; 'ever' never expires), so a struck habit heals
 * back to clean once the period passes without another relapse.
 */
export const STRIKE_PERIOD_MS = { week: 604800000, month: 2592000000, ever: Infinity };

export function strikesUsed(h, now = Date.now()) {
  const cutoff = now - (STRIKE_PERIOD_MS[h.strikesPeriod] ?? Infinity);
  return (h.strikeTimes || []).filter(t => t > cutoff).length;
}

export function strikeState(h, now = Date.now()) {
  const allowed = h.strikesAllowed || 0;
  if (!allowed) return { used: 0, allowed: 0, state: 'off' };
  const used = strikesUsed(h, now);
  const state = used === 0 ? 'clean' : used >= allowed ? 'maxed' : 'struck';
  return { used: Math.min(used, allowed), allowed, state };
}

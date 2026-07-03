/**
 * Habit strike accounting — single source of truth for every surface
 * that displays a habit timer (Habits page desktop/mobile, hub widget
 * desktop/mobile).
 *
 * Semantics (2026-07): every relapse restarts the timer. Strikes are
 * a planned allowance for the current calendar period — "stop
 * drinking, but 1 night a week is allowed" = 1 strike/week. The
 * allowance replenishes when the period rolls over:
 *
 *   week   resets Monday 00:00 local time
 *   month  resets on the 1st, 00:00 local time
 *   ever   never replenishes (lifetime total)
 *
 * A habit whose timer hasn't been hit this period is "unscathed";
 * once struck it wears the strike until the reset:
 *
 *   clean   0 strikes used this period  → pristine green
 *   struck  1..allowed-1 used           → amber
 *   maxed   used >= allowed             → red (allowance spent)
 *   off     strikesAllowed === 0        → no strike system on this habit
 */

/** Start of the calendar period `ts` falls in (week = Monday). */
export function periodStart(period, now = Date.now()) {
  if (period === 'ever') return -Infinity;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'month') {
    d.setDate(1);
  } else {
    // week — walk back to Monday (getDay: Sun=0 … Sat=6)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  }
  return d.getTime();
}

/** When the current period's strikes replenish (null for 'ever'). */
export function replenishAt(period, now = Date.now()) {
  if (period === 'ever') return null;
  const d = new Date(periodStart(period, now));
  if (period === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 7);
  return d.getTime();
}

export function strikesUsed(h, now = Date.now()) {
  const start = periodStart(h.strikesPeriod, now);
  return (h.strikeTimes || []).filter(t => t >= start).length;
}

export function strikeState(h, now = Date.now()) {
  const allowed = h.strikesAllowed || 0;
  if (!allowed) return { used: 0, allowed: 0, state: 'off', replenishAt: null };
  const used = strikesUsed(h, now);
  const state = used === 0 ? 'clean' : used >= allowed ? 'maxed' : 'struck';
  return {
    used: Math.min(used, allowed),
    allowed,
    state,
    replenishAt: replenishAt(h.strikesPeriod, now),
  };
}

/** Short human label for when a struck allowance comes back:
 *  "↻ tomorrow" / "↻ 3d" / "" (ever, or nothing to replenish). */
export function replenishLabel(strikes, now = Date.now()) {
  if (!strikes.replenishAt || strikes.used === 0) return '';
  const days = Math.ceil((strikes.replenishAt - now) / 86400000);
  return days <= 1 ? '↻ tomorrow' : `↻ ${days}d`;
}

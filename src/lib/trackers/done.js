/**
 * When a tracker counts as DONE for a day — the one definition.
 *
 * A boolean tracker is done when ticked. A number tracker used to be
 * done at any value above zero, so "10k steps" ticked at 6,000 and a
 * failed day read as a kept one — on the hub, in the weekly coin
 * challenge and in linked achievements alike.
 *
 * A number tracker can now carry a DAILY target, `dailyGoal` (new key,
 * additive). With one it is done at or above it; without one it keeps
 * the old any-amount rule, so nothing changes until a target is set.
 *
 * `goal` is deliberately NOT read here: the add form has always called
 * it a MONTHLY target ("£500 saved"), and gating a day on it would fail
 * every day for anyone who entered one.
 *
 * Pure. No React, no DOM.
 */

export const dailyGoalOf = t => {
  const g = Number(t && t.dailyGoal);
  return t && t.type !== 'boolean' && g > 0 ? g : null;
};

/** Is this day's value a kept day for the tracker? */
export function trackerDone(t, v) {
  if (!t) return false;
  if (t.type === 'boolean') return !!v; // as every caller always read it
  const n = Number(v) || 0;
  const g = dailyGoalOf(t);
  return g ? n >= g : n > 0;
}

/** 0‥1 of the way to the daily target (1 when done; 0 or 1 without one). */
export function trackerProgress(t, v) {
  if (trackerDone(t, v)) return 1;
  const g = dailyGoalOf(t);
  if (!g) return 0;
  return Math.max(0, Math.min(1, (Number(v) || 0) / g));
}

/**
 * How far one tap of + / − moves a number tracker: about a twentieth
 * of the daily target, on a round number (10,000 → 500, 3 → 1). With
 * no target, the auto-fill source's own step if it has one, else 1.
 */
export function trackerStep(t, sourceStep) {
  const g = dailyGoalOf(t);
  if (g) {
    const raw = g / 20;
    if (raw <= 1) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  }
  const s = Number(sourceStep);
  return s > 0 ? s : 1;
}

/**
 * A target guessed from the tracker's name — "10k steps" → 10000,
 * "8 glasses of water" → 8 — offered as the starting value when the
 * user sets one. Never applied on its own.
 */
export function targetFromName(name) {
  const m = /(\d+(?:[.,]\d+)?)\s*(k)?\b/i.exec(String(name || ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.')) * (m[2] ? 1000 : 1);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

/** "6,000", "12.5k" when space is short. */
export function fmtTrackerValue(v, compact = false) {
  const n = Number(v) || 0;
  if (compact && Math.abs(n) >= 10000) return `${Math.round(n / 100) / 10}k`.replace('.0k', 'k');
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

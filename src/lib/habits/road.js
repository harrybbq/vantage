/**
 * The road that does not end (owner, Nov 2026).
 *
 * An endless habit used to run out of things to earn: past its last
 * milestone the page said "Every milestone cleared" and a run that was
 * going well went flat exactly when it was going best. Now, once the
 * habit's own milestones are behind it, the next one arrives by itself.
 *
 *   Quit              2 months · 3 months · 6 months · 1 year, then
 *                     every year after
 *   Cut down, weekly  8 · 13 · 26 · 52 weeks on budget, then every 52
 *   Cut down, monthly 2 · 3 · 6 · 12 months, then every 12
 *
 * Only steps LONGER than the habit's own longest milestone exist: the
 * road continues the ladder the user wrote, it never competes with it.
 * A habit with no milestones has no road (they chose no rewards), and
 * neither does one that is not endless.
 *
 * COINS scale from the user's own last milestone, so the road pays in
 * the economy they set: ×1.5, ×2, ×3, ×5, then ×5 a step, on that
 * milestone's coins clamped to 10–500 and rounded to 5.
 *
 * STATE: one additive number on the habit, `autoPaid` — the length (ms)
 * of the furthest road step settled in the current run.
 *   · absent  never looked at. The first look settles every step the
 *             run has ALREADY passed without paying, so shipping this
 *             cannot hand a 400-day run a year of back-pay.
 *   · a slip, or a broken run of weeks, puts it back to 0 (as milestones
 *     are re-armed): the road pays again as the next run climbs.
 * The user's own milestones are untouched and still pay as they did.
 *
 * Pure. No React, no DOM. The coin write itself is settleRoad, called by
 * useHabitAwards inside `update`, so two tabs cannot pay a step twice.
 */
import { isCut, budgetOf, PERIOD_MS, DAY } from './cutdown.js';
import { habitElapsed } from './progress.js';
import { sortedMilestones } from './ladder.js';

const MULT = [1.5, 2, 3, 5];
const LATER = 5;
export const ROAD_COIN_MIN = 10;
export const ROAD_COIN_MAX = 500;

const SHAPE = {
  quit:  { unit: DAY, at: [60, 90, 182, 365], every: 365, label: n => (n === 60 ? '2 months' : n === 90 ? '3 months' : n === 182 ? '6 months' : n % 365 === 0 ? `${n / 365} ${n === 365 ? 'year' : 'years'}` : `${n} days`) },
  week:  { unit: PERIOD_MS.week, at: [8, 13, 26, 52], every: 52, label: n => `${n} weeks` },
  month: { unit: PERIOD_MS.month, at: [2, 3, 6, 12], every: 12, label: n => `${n} months` },
};
const shapeOf = h => (isCut(h) ? SHAPE[budgetOf(h).per === 'month' ? 'month' : 'week'] : SHAPE.quit);
const round5 = n => Math.max(5, Math.round(n / 5) * 5);

/** The user's own longest milestone → { duration, coins }, or null when they set none. */
export function roadBase(h) {
  const ms = (h && Array.isArray(h.milestones) ? h.milestones : []).filter(m => m && Number(m.duration) > 0);
  if (!ms.length) return null;
  const last = ms.reduce((a, b) => (Number(b.duration) > Number(a.duration) ? b : a));
  return { duration: Number(last.duration), coins: Math.max(0, Number(last.coins) || 0) };
}

/** Does this habit have a road at all? */
export const hasRoad = h => !!(h && h.endless && roadBase(h));

/**
 * The road for this habit, nearest step first: only the steps past the
 * user's own longest milestone, and the coin multiplier counts from the
 * FIRST of those (so a habit whose own ladder already reaches 100 days
 * starts its road at 6 months for ×1.5, not ×3).
 */
function* steps(h) {
  const base = roadBase(h);
  if (!base) return;
  const s = shapeOf(h);
  const c = Math.min(ROAD_COIN_MAX, Math.max(ROAD_COIN_MIN, base.coins));
  let k = 0;
  for (let i = 0; i < 400; i++) {
    const n = i < s.at.length ? s.at[i] : s.at[s.at.length - 1] + (i - s.at.length + 1) * s.every;
    const duration = n * s.unit;
    if (duration <= base.duration) continue;
    yield { id: `road-${n}`, label: s.label(n), duration, coins: round5(c * (k < MULT.length ? MULT[k] : LATER)), auto: true };
    k++;
  }
}

/**
 * The next `count` road steps past `after` ms (and past the habit's own
 * ladder), nearest first. [] when the habit has no road.
 */
export function roadAhead(h, after = 0, count = 1) {
  if (!hasRoad(h)) return [];
  const floor = Number(after) || 0;
  const out = [];
  for (const st of steps(h)) {
    if (st.duration > floor) out.push(st);
    if (out.length >= count) break;
  }
  return out;
}

/** The furthest road step a run of `elapsed` ms has reached → its duration, or 0. */
export function roadReached(h, elapsed) {
  if (!hasRoad(h)) return 0;
  let got = 0;
  for (const st of steps(h)) {
    if (st.duration > elapsed) break;
    got = st.duration;
  }
  return got;
}

/** The step the run is working toward now (the first one not settled), or null. */
export function nextRoadStep(h) {
  if (!hasRoad(h)) return null;
  return roadAhead(h, Number(h.autoPaid) || 0, 1)[0] || null;
}

/**
 * What a run of `elapsed` ms is working toward: the user's own next
 * milestone, else the road's next step, else null (a finished ladder on
 * a habit that is not endless, or one with no milestones at all).
 * → { id, label, duration, coins, auto }
 */
export function nextTarget(h, elapsed) {
  const own = sortedMilestones(h).find(m => elapsed < m.duration);
  if (own) return { id: own.id, label: own.label, duration: own.duration, coins: own.coins, auto: false };
  if (!hasRoad(h)) return null;
  return roadAhead(h, Math.max(Number(h.autoPaid) || 0, roadReached(h, elapsed)), 1)[0] || null;
}

/**
 * Settle the road for one habit → next state (or `prev` itself when
 * there is nothing to do). At most one step is paid per call.
 *   · first look (`autoPaid` absent): mark what the run has already
 *     passed as settled, paying nothing;
 *   · the run is now shorter than what was settled (a slip, a broken
 *     run, a switch of kind): back to 0, paying nothing;
 *   · the next step is reached: pay it, once.
 * → { state, paid: step | null }
 */
export function settleRoad(prev, id, now = Date.now()) {
  const none = { state: prev, paid: null };
  const habits = (prev && prev.habits) || [];
  const h = habits.find(x => x && x.id === id);
  if (!h || !hasRoad(h)) return none;
  const base = roadBase(h);
  const elapsed = habitElapsed(h, now);
  const put = v => ({ ...prev, habits: habits.map(x => (x && x.id === id ? { ...x, autoPaid: v } : x)) });
  if (h.autoPaid === undefined || !Number.isFinite(Number(h.autoPaid))) {
    // Nothing to settle until the habit's own ladder is behind it.
    if (elapsed < base.duration) return none;
    return { state: put(roadReached(h, elapsed)), paid: null };
  }
  const settled = Number(h.autoPaid);
  if (settled > elapsed) return { state: put(0), paid: null };
  if (elapsed < base.duration) return none;
  const step = roadAhead(h, settled, 1)[0];
  if (!step || elapsed < step.duration) return none;
  const cut = isCut(h);
  const next = put(step.duration);
  return {
    state: {
      ...next,
      coins: (prev.coins || 0) + step.coins,
      coinHistory: [
        { type: 'earn', label: `${h.name} — ${step.label}${cut ? ' on target' : ''}`, amount: step.coins, ts: now },
        ...(prev.coinHistory || []),
      ],
    },
    paid: step,
  };
}

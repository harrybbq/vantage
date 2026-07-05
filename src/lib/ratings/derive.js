/**
 * Ratings derivation — FEATURE 5 Sprint 3.
 *
 * Pure function. Walks the user's state and returns 1-99 ratings
 * for Brain / Finance / Fitness / Social, plus a 1-99 OVR composite.
 *
 * Composition (per playbook F5 Sprint 3):
 *
 *   Brain    = IQ test 40% + Brain trackers 30% + Brain achievements 10% + Brain visions 20%
 *   Finance  = Savings 50% + Finance trackers 20% + Finance achievements 10% + Finance visions 20%
 *   Fitness  = Fitness trackers 40% + Health (deferred) 0% + Fitness achievements 10% + Fitness visions 50%
 *   Social   = Friend count 30% + Social achievements 10% + Days-active streak 40% + Social visions 20%
 *
 *   OVR      = round((brain + finance + fitness + social) / 4)
 *
 *   All values floor at 1, ceiling at 99.
 *
 * Anti-gaming (rules applied per playbook):
 *
 *   Rule 1 — Time-spaced achievements:
 *     an achievement only contributes points if
 *     `(completedAt - createdAt) >= 7 days`.
 *     Achievements without createdAt (legacy / seed) are considered
 *     legitimately old.
 *
 *   Rule 4 — Trackers need history, not creation:
 *     tracker contribution scales with log density × consistency ×
 *     age. A tracker with no logs is worth 0 regardless of how many
 *     the user creates.
 *
 *   Rule 5 — Savings caps + min target floor:
 *     savings goals with target < £10 don't count.
 *     Total counted savings across all goals capped at £25,000.
 *     Per-goal contribution = min(current, target) / target — overshooting
 *     doesn't multiply.
 *
 * Server-canonical recompute lives in
 * `netlify/functions/recompute-ratings.js` — same algorithm, same
 * weights. Drift between client and server = silent rating bug, so
 * keep both in lockstep when editing.
 */

import { metVisionIds } from '../visions/derive';
import { VISIONS_BY_ID } from '../visions/definitions';

const DAY_MS = 86_400_000;
const TIME_SPACING_MS = 7 * DAY_MS;
const SAVINGS_MIN_TARGET = 10;     // £
const SAVINGS_TOTAL_CAP = 25_000;  // £
const TRACKER_HISTORY_DAYS = 30;   // window for log-density signal
const CATEGORIES = ['brain', 'finance', 'fitness', 'social'];

function clamp(n, lo = 1, hi = 99) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function ymd(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/**
 * Map raw "rating points" to a 1-99 scale via sqrt so early progress
 * feels fast and the 90s feel earned. `k` tunes how much each "point"
 * is worth — bumped per-category so a moderately active user reaches
 * ~50 in their main category in roughly 60 days.
 */
function toRating(points, k = 1) {
  if (!Number.isFinite(points) || points <= 0) return 1;
  const r = 1 + Math.sqrt(points * k);
  return clamp(r);
}

// ── Rule 1: time-spaced achievement points ─────────────────────────────────

/**
 * Returns the rating-point contribution of completed achievements in
 * a given category.
 *
 * Anti-gaming layers:
 *   - Rule 1 (time-spacing): achievements with createdAt+completedAt
 *     where completedAt-createdAt < 7 days contribute 0. Legacy entries
 *     without createdAt are treated as legit.
 *   - Rule 1b (diminishing returns, added 2026-06): even with spacing,
 *     bulk creation+complete would let a user inflate ratings (create
 *     1000 today, complete in a week). Each qualifying achievement is
 *     worth 1 point up to FULL_CREDIT_N, then sqrt-tapered. Net effect:
 *     first 8 count fully; beyond that you need ~4× more for 2×.
 */
const FULL_CREDIT_N = 8;
function achievementPoints(S, category) {
  const list = S.achievements || [];
  let count = 0;
  for (const a of list) {
    if (a.category !== category) continue;
    if (!a.completed) continue;
    if (a.createdAt && a.completedAt) {
      if ((a.completedAt - a.createdAt) < TIME_SPACING_MS) continue;
    }
    count += 1;
  }
  if (count <= FULL_CREDIT_N) return count;
  return FULL_CREDIT_N + Math.sqrt((count - FULL_CREDIT_N) * FULL_CREDIT_N);
}

// ── Rule 4: tracker activity-based points ──────────────────────────────────

/**
 * For each tracker in `category`, compute its contribution from the
 * last 30 days of logs. Density (% of days logged) × age cap so a
 * 5-day-old tracker can't max out. A tracker with no logs in the
 * window adds 0 points regardless of creation.
 */
function trackerPoints(S, category) {
  const trackers = (S.trackers || []).filter(t => t.category === category);
  if (!trackers.length) return 0;
  const logs = S.logs || {};
  const today = Date.now();
  let total = 0;
  for (const t of trackers) {
    let hits = 0;
    for (let i = 0; i < TRACKER_HISTORY_DAYS; i++) {
      const k = ymd(new Date(today - i * DAY_MS));
      const v = logs[k]?.[t.id];
      const truthy = t.type === 'boolean' ? !!v : (Number(v) || 0) > 0;
      if (truthy) hits++;
    }
    // Density 0-1 × scaled cap (10 points max per tracker, achieved at
    // ~30/30 hits). Linear because sqrt is applied at the rating-level
    // step; double-curving makes the bottom too punitive.
    const density = hits / TRACKER_HISTORY_DAYS;
    total += density * 10;
  }
  return total;
}

// ── Rule 5: savings points ─────────────────────────────────────────────────

/**
 * Finance category alone. Sums per-goal completion percentage, capped
 * to £25,000 total counted across goals. Goals with target < £10
 * don't count (anti-spam).
 */
function savingsPoints(S) {
  const goals = (S.savings || []).filter(g => (g.target || 0) >= SAVINGS_MIN_TARGET);
  if (!goals.length) return 0;
  let totalCountedTarget = 0;
  let totalCountedCurrent = 0;
  for (const g of goals) {
    const remainingCap = SAVINGS_TOTAL_CAP - totalCountedTarget;
    if (remainingCap <= 0) break;
    const target = Math.min(g.target, remainingCap);
    const current = Math.min(g.current || 0, target);
    totalCountedTarget += target;
    totalCountedCurrent += current;
  }
  if (totalCountedTarget <= 0) return 0;
  // Scale: hitting the full £25k cap = 30 points. Linear in completion %.
  const completionPct = totalCountedCurrent / totalCountedTarget;
  const scale = Math.min(1, totalCountedTarget / SAVINGS_TOTAL_CAP);
  return completionPct * 30 * (0.5 + 0.5 * scale);
}

// ── Self-check contributions ──────────────────────────────────────────────
//
// Each ranked category has an optional 16-question self-check (see
// BrainCheck / FinanceCheck / FitnessCheck / SocialCheck). A score of
// 100 (median) maps to ~12 points, 130 to ~18, 70 to ~6. Bounded so
// a single test can't dominate the rating.

function selfCheckPoints(score) {
  if (!score || !score.result) return 0;
  // Map [70, 130] → [6, 18] linearly, clamp outside.
  const result = Math.max(70, Math.min(130, score.result));
  return ((result - 70) / 60) * 12 + 6;
}

function brainScorePoints(S)   { return selfCheckPoints(S.brainScore); }
function financeScorePoints(S) { return selfCheckPoints(S.financeScore); }
function fitnessScorePoints(S) { return selfCheckPoints(S.fitnessScore); }
function socialSelfCheckPoints(S) { return selfCheckPoints(S.socialScore); }

// ── Social: friend count + days-active ─────────────────────────────────────

function socialPoints(S, friendCount = 0) {
  // Friend count caps at 20 for points purposes (≥20 friends = max contrib).
  const friends = Math.min(friendCount, 20);
  // Approximate days-active from log keys: number of distinct days with
  // any log in the last 30 (cap 30). Same window as trackers.
  const logs = S.logs || {};
  const today = Date.now();
  let activeDays = 0;
  for (let i = 0; i < 30; i++) {
    const k = ymd(new Date(today - i * DAY_MS));
    if (logs[k] && Object.keys(logs[k]).length > 0) activeDays++;
  }
  // Friends contribute up to 12pt; active streak up to 16pt.
  return (friends / 20) * 12 + (activeDays / 30) * 16;
}

// ── Health contributions (vitals / burn / macros) — 2026-07 ───────────────
//
// Lifetime accumulations (owner call: points feed the prestige climb,
// so no rolling window). All self-reported, so each is per-day capped —
// consistency earns, magnitudes don't:
//
//   vitals: 0.4 pt per calendar day with any vitals entry (weight /
//           sleep / resting HR — the Vitals widget writes S.vitalsLog)
//   burn:   up to 0.5 pt per day, scaled by min(activityKcal, 600)/600
//           (S.burnLog — exercise + steps; typing a huge number earns
//           no more than a real session)
//   macros: 0.5 pt per on-target nutrition day. Nutrition lives in
//           Supabase tables, not synced state, so the count arrives
//           via ctx.macroDays (client passes a cached count for the
//           local view; the server counts the table itself — same
//           pattern as friendCount).

const BURN_DAY_CAP_KCAL = 600;

function vitalsPoints(S) {
  const log = S.vitalsLog || {};
  let days = 0;
  for (const k of Object.keys(log)) {
    const e = log[k];
    if (e && (e.weight != null || e.sleep != null || e.rhr != null)) days++;
  }
  return days * 0.4;
}

function burnPoints(S) {
  const log = S.burnLog || {};
  let pts = 0;
  for (const k of Object.keys(log)) {
    const kcal = (log[k] || []).reduce((sum, a) => sum + (Number(a.kcal) || 0), 0);
    if (kcal > 0) pts += Math.min(kcal, BURN_DAY_CAP_KCAL) / BURN_DAY_CAP_KCAL * 0.5;
  }
  return pts;
}

function macroPoints(macroDays = 0) {
  return Math.max(0, macroDays) * 0.5;
}

// ── Visions contribution ───────────────────────────────────────────────────

/**
 * Visions are system-defined milestones (src/lib/visions/definitions.js).
 * They can't be created or edited by the user — perfect anti-gaming
 * anchors for ratings.
 *
 * Each definition can optionally declare a category. Unlocked visions
 * in `category` contribute (xp / 4) points to that category's rating.
 * Visions without a category contribute equally to ALL categories
 * (rewards general progress).
 */
function visionPoints(S, category) {
  const stamped = S.visions || {};
  let points = 0;
  for (const id of Object.keys(stamped)) {
    const def = VISIONS_BY_ID[id];
    if (!def) continue;
    const xp = def.xp || 0;
    if (!xp) continue;
    if (def.category && def.category !== category) continue;
    // Uncategorised visions split equally across the 4 categories
    const weight = def.category ? 1 : 0.25;
    points += (xp / 4) * weight;
  }
  return points;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function deriveRatings(S, ctx = {}) {
  const friendCount = ctx.friendCount || 0;

  const brainPts =
    brainScorePoints(S) +
    trackerPoints(S, 'brain') * 1.0 +
    achievementPoints(S, 'brain') * 2.5 +
    visionPoints(S, 'brain');

  const financePts =
    financeScorePoints(S) +
    savingsPoints(S) +
    trackerPoints(S, 'finance') * 1.0 +
    achievementPoints(S, 'finance') * 2.5 +
    visionPoints(S, 'finance');

  const fitnessPts =
    fitnessScorePoints(S) +
    trackerPoints(S, 'fitness') * 1.2 +
    achievementPoints(S, 'fitness') * 2.5 +
    visionPoints(S, 'fitness') +
    vitalsPoints(S) +
    burnPoints(S) +
    macroPoints(ctx.macroDays);

  const socialPts =
    socialSelfCheckPoints(S) +
    socialPoints(S, friendCount) +
    achievementPoints(S, 'social') * 2.5 +
    visionPoints(S, 'social');

  const brain   = toRating(brainPts);
  const finance = toRating(financePts);
  const fitness = toRating(fitnessPts);
  const social  = toRating(socialPts);
  const ovr     = clamp((brain + finance + fitness + social) / 4);

  return {
    brain, finance, fitness, social, ovr,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Returns the contribution breakdown for one category. Used by the
 * tap-to-explain modal so users see why their rating is what it is.
 */
export function categoryBreakdown(S, category, ctx = {}) {
  const friendCount = ctx.friendCount || 0;
  switch (category) {
    case 'brain':
      return [
        { label: 'Brain self-check', points: brainScorePoints(S) },
        { label: 'Brain trackers',   points: trackerPoints(S, 'brain') * 1.0 },
        { label: 'Brain achievements', points: achievementPoints(S, 'brain') * 2.5 },
        { label: 'Brain visions',    points: visionPoints(S, 'brain') },
      ];
    case 'finance':
      return [
        { label: 'Finance self-check', points: financeScorePoints(S) },
        { label: 'Savings goals',    points: savingsPoints(S) },
        { label: 'Finance trackers', points: trackerPoints(S, 'finance') * 1.0 },
        { label: 'Finance achievements', points: achievementPoints(S, 'finance') * 2.5 },
        { label: 'Finance visions',  points: visionPoints(S, 'finance') },
      ];
    case 'fitness':
      return [
        { label: 'Fitness self-check', points: fitnessScorePoints(S) },
        { label: 'Fitness trackers', points: trackerPoints(S, 'fitness') * 1.2 },
        { label: 'Fitness achievements', points: achievementPoints(S, 'fitness') * 2.5 },
        { label: 'Fitness visions',  points: visionPoints(S, 'fitness') },
        { label: 'Vitals log days',  points: vitalsPoints(S) },
        { label: 'Activity burn',    points: burnPoints(S) },
        { label: 'On-target macro days', points: macroPoints(ctx.macroDays) },
      ];
    case 'social':
      return [
        { label: 'Social self-check', points: socialSelfCheckPoints(S) },
        { label: 'Friends + activity', points: socialPoints(S, friendCount) },
        { label: 'Social achievements', points: achievementPoints(S, 'social') * 2.5 },
        { label: 'Social visions',   points: visionPoints(S, 'social') },
      ];
    default:
      return [];
  }
}

export { CATEGORIES };

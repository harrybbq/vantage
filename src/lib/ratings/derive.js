/**
 * Ratings derivation — what the four numbers are made of.
 *
 * Pure. Walks the user's state and returns 1-99 ratings for Brain,
 * Finance, Fitness and Social, plus the OVR mean of the four.
 *
 * Each category sums points from its own sources, then
 * `toRating` maps points to the scale as `1 + √(points × RATING_SCALE)`.
 *
 *   Brain    self-check · lifetime logged days · trackers (30d) ·
 *            achievements · visions
 *   Finance  the same, plus savings goals
 *   Fitness  the same, plus vitals, activity burn and on-target macro days
 *   Social   the same, plus friends and days active
 *
 * ── What changed on 2026-08-19, and why ──────────────────────────────
 * An audit ran every one of these through the real code rather than
 * this comment, and found the ladder ended long before the scale did:
 * a committed year reached OVR 24, Brain, Finance and Social froze in
 * the low twenties permanently, and OVR 99 — where Prestige unlocks —
 * was unreachable by anyone, ever. Four things were wrong, and all four
 * are addressed here and in visions/definitions.js:
 *
 *   · No vision declared a category, so the single largest input paid
 *     the same into all four ratings and the four numbers moved as one.
 *     They are categorised now, and the twelve visions added alongside
 *     give Brain and Social a ladder of their own — between them they
 *     had none at all.
 *   · Only Fitness had a source that accumulated for life. Every
 *     category has one now: `categoryDayPoints`.
 *   · Tracker points were uncapped in tracker COUNT, so owning more
 *     checkboxes beat keeping better habits. Capped at TRACKER_CAP_N.
 *   · The scale itself was calibrated for a game nobody could finish.
 *     See RATING_SCALE.
 *
 * ── Anti-gaming, unchanged ───────────────────────────────────────────
 *   Achievements  count only if completed ≥7 days after being created,
 *                 and taper by √ past the eighth.
 *   Trackers      pay for logs, never for existing; and now cap.
 *   Savings       goals under £10 are ignored, £25,000 counted total,
 *                 and overshooting a goal does not multiply.
 *
 * The server re-derives all of this in netlify/lib/recompute.js because
 * a number other people can see must not be computed on the machine of
 * the person it flatters. `npm run check:parity` fails the build if the
 * two ever disagree — which is what was missing when they last did.
 */

// Explicit .js — the pure-lib convention in this repo, so the module
// stays runnable under plain node for the parity check in scripts/.
import { VISIONS_BY_ID } from '../visions/definitions.js';

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
 * How much a point is worth on the 1-99 scale.
 *
 * At 1 — where this sat until 2026-08-19 — the scale said 99 and the
 * game ended at 42. A committed year landed on 24, three categories
 * froze in the low twenties for good, and Prestige, which unlocks at
 * OVR 99, could not be reached by anyone. Two thirds of the number the
 * whole app is built around were decorative.
 *
 * 6 is set from the profiles, not picked: it puts a committed year near
 * 57, three years near 72, and 99 within reach of someone who keeps it
 * up for the better part of a decade. Early progress still moves fast —
 * a first month reads 28 — because sqrt does that on its own.
 *
 * Changing this moves every rating on the leaderboard at once. If it
 * changes again, bump FORMULA_EPOCH_ISO in get-leaderboard.js with it,
 * or every user is handed a week's "climb" they did not earn.
 */
const RATING_SCALE = 6;

/**
 * Map raw "rating points" to the 1-99 scale via sqrt, so early progress
 * feels fast and the 90s feel earned.
 */
function toRating(points, k = RATING_SCALE) {
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
/** Ceiling on what a category's trackers can contribute, in "trackers'
 *  worth". Uncapped, points were 10 per tracker with no limit on how
 *  many you own, so 160 Brain trackers ticked daily scored 41 against
 *  the 21 a year of genuine effort produced. It was a grind rather than
 *  an exploit — the same 160 ticked once are worth 8 — but it rewarded
 *  the length of your list over the strength of your habit. Four is
 *  above what anyone sensibly runs in one category. */
const TRACKER_CAP_N = 4;

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
  return Math.min(total, TRACKER_CAP_N * 10);
}

// ── Lifetime logged days, per category ────────────────────────────────────
//
// Fitness climbed for years because vitals, burn and macros pay 1.4
// points a day forever. Brain, Finance and Social had nothing of the
// kind: every source they owned was either a one-off number or a
// rolling 30-day window that reset. So all three froze around 23 inside
// the first year and stayed there — permanently, not for a while.
//
// This is the missing half: a day on which you logged anything in a
// category is worth 0.4 points, for life, exactly as a day with a
// vitals entry always has been. Consistency earns; the window measures
// whether you are on it, this measures whether you have been at it.

const CATEGORY_DAY_POINTS = 0.4;

function categoryDayPoints(S, category) {
  const ids = new Set((S.trackers || []).filter(t => t.category === category).map(t => t.id));
  if (!ids.size) return 0;
  const logs = S.logs || {};
  let days = 0;
  for (const key of Object.keys(logs)) {
    const day = logs[key] || {};
    for (const id of ids) {
      const v = day[id];
      const truthy = v !== false && v !== 0 && v != null && v !== '';
      if (truthy) { days++; break; }
    }
  }
  return days * CATEGORY_DAY_POINTS;
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
    categoryDayPoints(S, 'brain') +
    trackerPoints(S, 'brain') * 1.0 +
    achievementPoints(S, 'brain') * 2.5 +
    visionPoints(S, 'brain');

  const financePts =
    financeScorePoints(S) +
    categoryDayPoints(S, 'finance') +
    savingsPoints(S) +
    trackerPoints(S, 'finance') * 1.0 +
    achievementPoints(S, 'finance') * 2.5 +
    visionPoints(S, 'finance');

  const fitnessPts =
    fitnessScorePoints(S) +
    categoryDayPoints(S, 'fitness') +
    trackerPoints(S, 'fitness') * 1.2 +
    achievementPoints(S, 'fitness') * 2.5 +
    visionPoints(S, 'fitness') +
    vitalsPoints(S) +
    burnPoints(S) +
    macroPoints(ctx.macroDays);

  const socialPts =
    socialSelfCheckPoints(S) +
    categoryDayPoints(S, 'social') +
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
        { label: 'Days logged (lifetime)', points: categoryDayPoints(S, 'brain') },
        { label: 'Brain trackers',   points: trackerPoints(S, 'brain') * 1.0 },
        { label: 'Brain achievements', points: achievementPoints(S, 'brain') * 2.5 },
        { label: 'Brain visions',    points: visionPoints(S, 'brain') },
      ];
    case 'finance':
      return [
        { label: 'Finance self-check', points: financeScorePoints(S) },
        { label: 'Days logged (lifetime)', points: categoryDayPoints(S, 'finance') },
        { label: 'Savings goals',    points: savingsPoints(S) },
        { label: 'Finance trackers', points: trackerPoints(S, 'finance') * 1.0 },
        { label: 'Finance achievements', points: achievementPoints(S, 'finance') * 2.5 },
        { label: 'Finance visions',  points: visionPoints(S, 'finance') },
      ];
    case 'fitness':
      return [
        { label: 'Fitness self-check', points: fitnessScorePoints(S) },
        { label: 'Days logged (lifetime)', points: categoryDayPoints(S, 'fitness') },
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
        { label: 'Days logged (lifetime)', points: categoryDayPoints(S, 'social') },
        { label: 'Friends + activity', points: socialPoints(S, friendCount) },
        { label: 'Social achievements', points: achievementPoints(S, 'social') * 2.5 },
        { label: 'Social visions',   points: visionPoints(S, 'social') },
      ];
    default:
      return [];
  }
}

export { CATEGORIES };

/**
 * The achievement credit rules, in a shape the UI can render.
 *
 * These rules are good and defensible — they stop forty achievements
 * made in an afternoon out-ranking a year of real ones — but until now
 * they lived only in this file. A playtester worked out that he could
 * "still take the piss and get all the achievements anyways", was told
 * about the taper in a chat, and said: that should be made more clear.
 * He was right. Nothing in the product said any of it.
 *
 * Returns, across every category:
 *   fullCredit  how many completed achievements count at full weight
 *   counted     how many currently qualify (spacing rule passed)
 *   pending     completed, but still inside the 7-day window
 *   spacingDays the window itself
 */
export function achievementCreditState(S) {
  const list = S?.achievements || [];
  let counted = 0;
  let pending = 0;
  for (const a of list) {
    if (!a.completed) continue;
    if (a.createdAt && a.completedAt && (a.completedAt - a.createdAt) < TIME_SPACING_MS) {
      pending += 1;
      continue;
    }
    counted += 1;
  }
  return {
    fullCredit: FULL_CREDIT_N,
    counted,
    pending,
    spacingDays: Math.round(TIME_SPACING_MS / DAY_MS),
    atFullCredit: Math.min(counted, FULL_CREDIT_N),
    tapering: Math.max(0, counted - FULL_CREDIT_N),
  };
}

/**
 * Whether a single achievement is earning rating credit yet, and if
 * not, when it will. Used on the card itself so the rule is visible
 * where it applies rather than in a help page.
 */
export function achievementCreditStatus(a) {
  if (!a?.completed) return { state: 'open' };
  if (!a.createdAt || !a.completedAt) return { state: 'counting' };
  const elapsed = a.completedAt - a.createdAt;
  if (elapsed >= TIME_SPACING_MS) return { state: 'counting' };
  const daysLeft = Math.max(1, Math.ceil((TIME_SPACING_MS - elapsed) / DAY_MS));
  return { state: 'too-soon', daysLeft, spacingDays: Math.round(TIME_SPACING_MS / DAY_MS) };
}


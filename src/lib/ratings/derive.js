/**
 * Ratings derivation — what the numbers are made of.
 *
 * Pure. Walks the user's state and returns 1-99 ratings for Brain,
 * Finance, Fitness and Social, plus OVR.
 *
 * Each category sums points from its own sources:
 *
 *   all four  self-check · days you showed up (for life) · trackers
 *             (last 30 days) · achievements · honours (visions)
 *   Finance   plus savings goals
 *   Fitness   "showing up" also counts vitals, activity and on-target
 *             calorie days
 *   Social    plus friends and days active
 *
 * OVR comes from the TOTAL across the four (2026-10-21, owner's call):
 * progress in any category raises it, and a category you never use
 * costs nothing. The four category ratings show where the points came
 * from — what you are best at, what to work on. See toRating.
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
 *     category has one now: days you showed up (`pillarDays`).
 *   · Tracker points were uncapped in tracker COUNT, so owning more
 *     checkboxes beat keeping better habits. Capped at TRACKER_CAP_N.
 *   · The scale itself was calibrated for a game nobody could finish.
 *     (Replaced again on 2026-10-21 — see toRating.)
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
import { trackerDone } from '../trackers/done.js';
import { shareableView } from '../wearables/strip.js';

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
 * Points → the 1-99 scale.
 *
 * History, briefly: until 2026-10-21 each category ran on
 * `1 + √(points × RATING_SCALE)` and OVR was the MEAN of the four. Two
 * problems, both measured in a simulation before anything changed:
 *
 *   · Pace. A committed user (all four categories, six days a week)
 *     sat at 28 after three months and reached 99 — where Prestige
 *     unlocks — after about six years. The owner wants a prestige
 *     roughly every three months.
 *   · The mean. A category you never use sits on the floor, and the
 *     average of four drags everyone who does fewer than four. Real
 *     profiles: median OVR 4.5, best 32. A fitness-and-reading user was
 *     capped under 20 for life whatever the curve.
 *
 * Now: OVR is set by your points across all four, so progress in any
 * of them moves it and none you skip holds it back. Your best category
 * counts in full, the next at half, then 0.35, then 0.25
 * (BREADTH_WEIGHTS). Summed flat, four categories earned four times
 * what one did, so a committed all-rounder prestiged every three months
 * and someone who only trains every eleven; weighted, it is three and
 * about six. Doing more still climbs faster; doing one thing well is
 * not a penalty. Each category also keeps its own 1-99 rating
 * (PILLAR_FULL) — what the profile uses to show what you are best at
 * and what to work on.
 *
 *   rating = 1 + 98 × min(1, points / full)^CURVE
 *
 * A steadier curve than the square root: the square root put a week of
 * effort at 50 and then took four days a point through the eighties.
 * OVR_FULL was tuned on the SECOND climb — after a prestige the
 * baseline takes away everything paid once (self-checks, honours,
 * friends, tracker form), so the repeating sources set the cycle. See
 * ladder.test.mjs for the profiles and the numbers.
 *
 * Changing these moves every number on the leaderboard at once, which
 * is why FORMULA_EPOCH_ISO in get-leaderboard.js is bumped with them.
 */
const OVR_FULL = 170;
const BREADTH_WEIGHTS = [1, 0.5, 0.35, 0.25];
// An even all-rounder's four categories reach 99 together with OVR.
const PILLAR_FULL = OVR_FULL / BREADTH_WEIGHTS.reduce((a, b) => a + b, 0);
const CURVE = 0.75;

function toRating(points, full) {
  if (!Number.isFinite(points) || points <= 0) return 1;
  return clamp(1 + 98 * Math.pow(Math.min(1, points / full), CURVE));
}

// ── Which day keys count (mirror of netlify/lib/recompute.js) ─────────────
//
// `logs`, `vitalsLog` and `burnLog` are maps keyed by day, and until
// 2026-09-30 every key counted. Ten thousand junk keys, or ten years of
// dates before the account existed, or dates in the future, all scored
// as years of logging — which is how anyone could reach global #1.
//
// A key now counts only if it is a real calendar date (YYYY-MM-DD that
// round-trips), not after tomorrow (a day of slack for timezones ahead
// of UTC) and, when `ctx.createdAt` is known, not before the day before
// the account was created. Lifetime day counts are also capped at the
// account's age in days — implied by the window, kept explicit so a
// change to the window cannot lift it. Unknown createdAt: no floor, no
// cap, as before. Honest users are unaffected: their keys are real,
// past dates.
//
// Known cost: history imported from before sign-up (an Apple Health
// export, a wearable's 30-day backfill) stays in the user's data but
// does not count toward the rating.
//
// Achievements are NOT touched: undated ones still count unspaced, as
// legitimate accounts older than the createdAt stamp would otherwise
// lose rating they earned. Known hole; waits on item 26.
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toMs(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Vision stamps (mirror of netlify/lib/recompute.js, 2026-09-30) ──────
//
// Stamps are client-written and the server cannot re-run the checks, so
// a day-old state could stamp every vision. Two limits from account age,
// neither of which an honest user meets:
//   · a stamp dated before the account (a day's slack) or after
//     tomorrow does not count; undated stamps still do, inside the cap;
//   · total xp counted ≤ VISION_XP_BASE + VISION_XP_PER_DAY × age in
//     days, applied as one scale factor across all counted visions.
// The reasoning behind the numbers is at the same spot in recompute.js.
// Unknown createdAt: no floor, no cap.
const VISION_XP_BASE = 5000;
const VISION_XP_PER_DAY = 100;

function dayWindow(createdAt, now = Date.now()) {
  const created = toMs(createdAt);
  const known = created != null && created <= now;
  return {
    min: known ? ymd(created - DAY_MS) : null,
    max: ymd(now + DAY_MS),
    cap: known ? Math.floor((now - created) / DAY_MS) + 3 : Infinity,
    stampFrom: known ? created - DAY_MS : null,
    stampUntil: now + DAY_MS,
    visionXpCap: known ? VISION_XP_BASE + VISION_XP_PER_DAY * Math.floor((now - created) / DAY_MS) : Infinity,
  };
}

/** A vision stamp's time in ms: `{ unlockedAt }`, an ISO string or ms. Null = undated. */
function stampMs(v) {
  if (v == null || typeof v === 'boolean') return null;
  return toMs(typeof v === 'object' ? v.unlockedAt : v);
}

function isCountableDay(key, win) {
  if (!DAY_KEY_RE.test(key)) return false;
  if (key > win.max) return false;
  if (win.min && key < win.min) return false;
  const t = Date.parse(key + 'T00:00:00Z');
  return Number.isFinite(t) && ymd(t) === key;
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

function trackerPoints(S, category, win = dayWindow(null)) {
  const trackers = (S.trackers || []).filter(t => t.category === category);
  if (!trackers.length) return 0;
  const logs = S.logs || {};
  const today = Date.now();
  let total = 0;
  for (const t of trackers) {
    let hits = 0;
    for (let i = 0; i < TRACKER_HISTORY_DAYS; i++) {
      const k = ymd(new Date(today - i * DAY_MS));
      if (win.min && k < win.min) break;
      const v = logs[k]?.[t.id];
      const truthy = trackerDone(t, v);
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

// ── Days you showed up, per category ──────────────────────────────────
//
// A day on which you did something in a category is worth DAY_POINTS,
// for life, once per category per day. Until 2026-10-21 Fitness had
// three extra accruals of its own — vitals 0.4, burn up to 0.5, macros
// 0.5 a day — on top of its 0.6, so a fitness-only user climbed about
// three times faster than a brain-only one doing the same work. Those
// are now ways to SHOW UP in Fitness, not extra pay: a day counts if a
// fitness tracker was ticked, or vitals were logged, or activity was
// logged. On-target macro days arrive as a count without dates
// (ctx.macroDays — nutrition is in its own tables), so they set a
// floor rather than joining the union: a food-only user still earns
// every day they log, and someone who does both is not paid twice.
const DAY_POINTS = 1;

const loggedTruthy = v => v !== false && v !== 0 && v != null && v !== '';

function pillarDays(S, category, win = dayWindow(null), macroDays = 0) {
  const days = new Set();
  const ids = new Set((S.trackers || []).filter(t => t.category === category).map(t => t.id));
  if (ids.size) {
    const logs = S.logs || {};
    for (const key of Object.keys(logs)) {
      if (!isCountableDay(key, win)) continue;
      const day = logs[key] || {};
      for (const id of ids) if (loggedTruthy(day[id])) { days.add(key); break; }
    }
  }
  if (category === 'fitness') {
    const vitals = S.vitalsLog || {};
    for (const key of Object.keys(vitals)) {
      const e = vitals[key];
      if (e && (e.weight != null || e.sleep != null || e.rhr != null) && isCountableDay(key, win)) days.add(key);
    }
    const burn = S.burnLog || {};
    for (const key of Object.keys(burn)) {
      const list = Array.isArray(burn[key]) ? burn[key] : [];
      if (list.some(a => Number(a?.kcal) > 0) && isCountableDay(key, win)) days.add(key);
    }
  }
  let n = Math.min(days.size, win.cap);
  if (category === 'fitness') n = Math.max(n, Math.max(0, Math.min(macroDays || 0, win.cap)));
  return n;
}

const dayPoints = (S, category, win, macroDays) => pillarDays(S, category, win, macroDays) * DAY_POINTS;

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
// BrainCheck / FinanceCheck / FitnessCheck / SocialCheck). 70 → 2
// points, 100 → 4, 130 → 6. Was 6-18 until 2026-10-21: four honest
// questionnaires on day one were worth a third of a climb on the new
// scale, which is a number handed out, not earned.

function selfCheckPoints(score) {
  if (!score || !score.result) return 0;
  const result = Math.max(70, Math.min(130, score.result));
  return ((result - 70) / 60) * 4 + 2;
}

function brainScorePoints(S)   { return selfCheckPoints(S.brainScore); }
function financeScorePoints(S) { return selfCheckPoints(S.financeScore); }
function fitnessScorePoints(S) { return selfCheckPoints(S.fitnessScore); }
function socialSelfCheckPoints(S) { return selfCheckPoints(S.socialScore); }

// ── Social: friend count + days-active ─────────────────────────────────────

function socialPoints(S, friendCount = 0, win = dayWindow(null)) {
  // Friend count caps at 20 for points purposes (≥20 friends = max contrib).
  const friends = Math.min(friendCount, 20);
  // Approximate days-active from log keys: number of distinct days with
  // any log in the last 30 (cap 30). Same window as trackers.
  const logs = S.logs || {};
  const today = Date.now();
  let activeDays = 0;
  for (let i = 0; i < 30; i++) {
    const k = ymd(new Date(today - i * DAY_MS));
    if (win.min && k < win.min) break;
    if (logs[k] && Object.keys(logs[k]).length > 0) activeDays++;
  }
  // Friends contribute up to 12pt; active streak up to 16pt.
  return (friends / 20) * 12 + (activeDays / 30) * 16;
}

// ── Visions contribution ───────────────────────────────────────────────────

/**
 * Visions are system-defined milestones (src/lib/visions/definitions.js).
 * They can't be created or edited by the user — perfect anti-gaming
 * anchors for ratings.
 *
 * Each definition can optionally declare a category. Unlocked visions
 * in `category` contribute xp / VISION_XP_PER_POINT points to that
 * category. 40 since 2026-10-21 (was 4): the catalogue is 8,200 xp, so
 * at 4 it was worth seven prestiges by itself and a 30-day streak paid
 * a sixth of a climb. At 40 the whole set is worth under one climb,
 * spread over the year or more it takes to earn.
 * Visions without a category contribute equally to ALL categories
 * (rewards general progress).
 *
 * Stamps outside the account's lifetime are dropped and the total is
 * held to the age ceiling — see "Vision stamps" at dayWindow.
 */
function countedVisions(S, win) {
  const stamped = S.visions || {};
  const ids = [];
  let xp = 0;
  for (const id of Object.keys(stamped)) {
    const def = VISIONS_BY_ID[id];
    if (!def || !def.xp) continue;
    const t = stampMs(stamped[id]);
    if (t != null && (t > win.stampUntil || (win.stampFrom != null && t < win.stampFrom))) continue;
    ids.push(id);
    xp += def.xp;
  }
  return { ids, scale: xp > win.visionXpCap ? win.visionXpCap / xp : 1 };
}

const VISION_XP_PER_POINT = 40;

function visionPoints(S, category, win = dayWindow(null)) {
  const { ids, scale } = countedVisions(S, win);
  let points = 0;
  for (const id of ids) {
    const def = VISIONS_BY_ID[id];
    if (def.category && def.category !== category) continue;
    // Uncategorised visions split equally across the 4 categories
    const weight = def.category ? 1 : 0.25;
    points += (def.xp / VISION_XP_PER_POINT) * weight;
  }
  return points * scale;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Raw points per category, before the curve and before any prestige
 * baseline. Mirrors derivePoints in netlify/lib/recompute.js.
 *
 * ctx: { friendCount, macroDays, createdAt } — createdAt is the account's
 * creation time (ISO or ms, e.g. session.user.created_at). Leave it out
 * and day keys are unfloored and uncapped; the server passes it, so the
 * leaderboard number is the capped one either way.
 */
export function derivePoints(rawS, ctx = {}) {
  // Item 124 / D1: WHOOP- and Oura-derived values never move a rating —
  // the server canonical number (netlify/lib/recompute.js) leaves them
  // out the same way, and the parity check holds the two together.
  const S = shareableView(rawS || {});
  const friendCount = ctx.friendCount || 0;
  const win = dayWindow(ctx.createdAt);
  return {
    brain:
      brainScorePoints(S) +
      dayPoints(S, 'brain', win) +
      trackerPoints(S, 'brain', win) * 1.0 +
      achievementPoints(S, 'brain') * 2.5 +
      visionPoints(S, 'brain', win),
    finance:
      financeScorePoints(S) +
      dayPoints(S, 'finance', win) +
      savingsPoints(S) +
      trackerPoints(S, 'finance', win) * 1.0 +
      achievementPoints(S, 'finance') * 2.5 +
      visionPoints(S, 'finance', win),
    fitness:
      fitnessScorePoints(S) +
      dayPoints(S, 'fitness', win, ctx.macroDays) +
      trackerPoints(S, 'fitness', win) * 1.0 +
      achievementPoints(S, 'fitness') * 2.5 +
      visionPoints(S, 'fitness', win),
    social:
      socialSelfCheckPoints(S) +
      dayPoints(S, 'social', win) +
      socialPoints(S, friendCount, win) +
      achievementPoints(S, 'social') * 2.5 +
      visionPoints(S, 'social', win),
  };
}

/** Per-category points this climb: raw minus the prestige baseline. */
function climbPoints(pts, baseline = {}) {
  const adj = {};
  for (const c of CATEGORIES) adj[c] = Math.max(0, (Number(pts?.[c]) || 0) - (Number(baseline?.[c]) || 0));
  return adj;
}

/** The OVR total: best category in full, the rest by BREADTH_WEIGHTS. */
function ovrPoints(adj) {
  return CATEGORIES.map(c => adj[c]).sort((a, b) => b - a)
    .reduce((sum, v, i) => sum + v * BREADTH_WEIGHTS[i], 0);
}

/**
 * Points → ratings. `baseline` is the prestige snapshot
 * (profiles.prestige_baseline, cached locally as S.prestigeBaseline):
 * per-category raw points at the moment of the last prestige, taken
 * off so each climb starts from the floor. Nothing is wiped.
 */
export function ratingsFromPoints(pts, baseline = {}) {
  const adj = climbPoints(pts, baseline);
  return {
    brain:   toRating(adj.brain, PILLAR_FULL),
    finance: toRating(adj.finance, PILLAR_FULL),
    fitness: toRating(adj.fitness, PILLAR_FULL),
    social:  toRating(adj.social, PILLAR_FULL),
    ovr:     toRating(ovrPoints(adj), OVR_FULL),
  };
}

/** ctx as derivePoints, plus `baseline` (the prestige snapshot). */
export function deriveRatings(rawS, ctx = {}) {
  return {
    ...ratingsFromPoints(derivePoints(rawS, ctx), ctx.baseline),
    computedAt: new Date().toISOString(),
  };
}

/** How many more OVR points this climb needs before it reads 99 —
 *  where the rounded rating reaches 99, a hair short of OVR_FULL. */
const PRESTIGE_AT = OVR_FULL * Math.pow(97.5 / 98, 1 / CURVE);
export function pointsToPrestige(pts, baseline = {}) {
  return Math.max(0, PRESTIGE_AT - ovrPoints(climbPoints(pts, baseline)));
}

/** What one more point in `category` is worth toward OVR right now. */
export function breadthWeight(pts, baseline, category) {
  const adj = climbPoints(pts, baseline);
  const rank = CATEGORIES.filter(c => c !== category && adj[c] > adj[category]).length;
  return BREADTH_WEIGHTS[rank];
}

/** A server baseline (profiles.prestige_baseline) as { brain, finance,
 *  fitness, social } numbers, or null when it is empty (never
 *  prestiged) or not the right shape. */
export function cleanBaseline(b) {
  if (!b || typeof b !== 'object') return null;
  const out = {};
  let any = false;
  for (const c of CATEGORIES) {
    const v = Number(b[c]);
    out[c] = Number.isFinite(v) && v > 0 ? v : 0;
    if (out[c] > 0) any = true;
  }
  return any ? out : null;
}

export { OVR_FULL, PILLAR_FULL, DAY_POINTS, BREADTH_WEIGHTS };

/**
 * Returns the contribution breakdown for one category. Used by the
 * tap-to-explain modal so users see why their rating is what it is.
 */
export function categoryBreakdown(rawS, category, ctx = {}) {
  const S = shareableView(rawS || {});
  const friendCount = ctx.friendCount || 0;
  const win = dayWindow(ctx.createdAt);
  const days = n => ({ key: 'days', label: 'Days you showed up', points: n });
  switch (category) {
    case 'brain':
      return [
        { key: 'check', label: 'Brain self-check', points: brainScorePoints(S) },
        days(dayPoints(S, 'brain', win)),
        { key: 'trackers', label: 'Brain trackers, last 30 days', points: trackerPoints(S, 'brain', win) },
        { key: 'achievements', label: 'Brain achievements', points: achievementPoints(S, 'brain') * 2.5 },
        { key: 'honours', label: 'Brain honours', points: visionPoints(S, 'brain', win) },
      ];
    case 'finance':
      return [
        { key: 'check', label: 'Finance self-check', points: financeScorePoints(S) },
        days(dayPoints(S, 'finance', win)),
        { key: 'savings', label: 'Savings goals', points: savingsPoints(S) },
        { key: 'trackers', label: 'Finance trackers, last 30 days', points: trackerPoints(S, 'finance', win) },
        { key: 'achievements', label: 'Finance achievements', points: achievementPoints(S, 'finance') * 2.5 },
        { key: 'honours', label: 'Finance honours', points: visionPoints(S, 'finance', win) },
      ];
    case 'fitness':
      return [
        { key: 'check', label: 'Fitness self-check', points: fitnessScorePoints(S) },
        { ...days(dayPoints(S, 'fitness', win, ctx.macroDays)), hint: 'A tracker ticked, vitals or activity logged, or calories on target' },
        { key: 'trackers', label: 'Fitness trackers, last 30 days', points: trackerPoints(S, 'fitness', win) },
        { key: 'achievements', label: 'Fitness achievements', points: achievementPoints(S, 'fitness') * 2.5 },
        { key: 'honours', label: 'Fitness honours', points: visionPoints(S, 'fitness', win) },
      ];
    case 'social':
      return [
        { key: 'check', label: 'Social self-check', points: socialSelfCheckPoints(S) },
        days(dayPoints(S, 'social', win)),
        { key: 'friends', label: 'Friends + activity', points: socialPoints(S, friendCount, win) },
        { key: 'achievements', label: 'Social achievements', points: achievementPoints(S, 'social') * 2.5 },
        { key: 'honours', label: 'Social honours', points: visionPoints(S, 'social', win) },
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


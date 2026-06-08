/**
 * Shared rating recompute helper.
 *
 * Single source-of-truth for the SERVER side of the ratings system,
 * extracted so both:
 *   • netlify/functions/recompute-ratings.js (user-triggered POST)
 *   • netlify/functions/get-leaderboard.js   (stale-self refresh)
 * call exactly the same maths against the user's raw user_data.state.
 *
 * The CLIENT side (src/lib/ratings/derive.js) is the second source-of-
 * truth — drift between this file and that one = silent rating bug.
 * See docs/RANKING_SYSTEM.md for the full algorithm and constraints.
 */

// ── Constants (mirror derive.js) ─────────────────────────────────────────
const DAY_MS = 86_400_000;
const TIME_SPACING_MS = 7 * DAY_MS;
const SAVINGS_MIN_TARGET = 10;
const SAVINGS_TOTAL_CAP = 25_000;
const TRACKER_HISTORY_DAYS = 30;
const FULL_CREDIT_N = 8;

function clamp(n, lo = 1, hi = 99) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function toRating(points, k = 1) {
  if (!Number.isFinite(points) || points <= 0) return 1;
  return clamp(1 + Math.sqrt(points * k));
}

// ── Point sources ────────────────────────────────────────────────────────
function achievementPoints(state, category) {
  const list = state.achievements || [];
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

function trackerPoints(state, category) {
  const trackers = (state.trackers || []).filter(t => t.category === category);
  if (!trackers.length) return 0;
  const logs = state.logs || {};
  const today = Date.now();
  let total = 0;
  for (const t of trackers) {
    let hits = 0;
    for (let i = 0; i < TRACKER_HISTORY_DAYS; i++) {
      const k = ymd(today - i * DAY_MS);
      const v = logs[k]?.[t.id];
      const truthy = t.type === 'boolean' ? !!v : (Number(v) || 0) > 0;
      if (truthy) hits++;
    }
    total += (hits / TRACKER_HISTORY_DAYS) * 10;
  }
  return total;
}

function savingsPoints(state) {
  const goals = (state.savings || []).filter(g => (g.target || 0) >= SAVINGS_MIN_TARGET);
  if (!goals.length) return 0;
  let target = 0, current = 0;
  for (const g of goals) {
    const cap = SAVINGS_TOTAL_CAP - target;
    if (cap <= 0) break;
    const t = Math.min(g.target, cap);
    const c = Math.min(g.current || 0, t);
    target += t; current += c;
  }
  if (target <= 0) return 0;
  const completion = current / target;
  const scale = Math.min(1, target / SAVINGS_TOTAL_CAP);
  return completion * 30 * (0.5 + 0.5 * scale);
}

function selfCheckPoints(score) {
  if (!score?.result) return 0;
  const result = Math.max(70, Math.min(130, score.result));
  return ((result - 70) / 60) * 12 + 6;
}
const brainScorePoints      = s => selfCheckPoints(s.brainScore);
const financeScorePoints    = s => selfCheckPoints(s.financeScore);
const fitnessScorePoints    = s => selfCheckPoints(s.fitnessScore);
const socialSelfCheckPoints = s => selfCheckPoints(s.socialScore);

function socialPoints(state, friendCount = 0) {
  const friends = Math.min(friendCount, 20);
  const logs = state.logs || {};
  const today = Date.now();
  let activeDays = 0;
  for (let i = 0; i < 30; i++) {
    const k = ymd(today - i * DAY_MS);
    if (logs[k] && Object.keys(logs[k]).length > 0) activeDays++;
  }
  return (friends / 20) * 12 + (activeDays / 30) * 16;
}

function visionPoints(state /* , category */) {
  // Server doesn't import the visions definitions module (separate
  // module graph). Approximation: each unlocked vision = 8 pts / 4
  // categories. Drift risk: if visions definitions get re-weighted the
  // server lags by a constant factor until this file is updated.
  const stamped = state.visions || {};
  const count = Object.keys(stamped).length;
  return (8 * count) / 4;
}

// ── Public API ───────────────────────────────────────────────────────────
function deriveRatings(state, friendCount = 0) {
  const brainPts =
    brainScorePoints(state) +
    trackerPoints(state, 'brain') * 1.0 +
    achievementPoints(state, 'brain') * 2.5 +
    visionPoints(state, 'brain');

  const financePts =
    financeScorePoints(state) +
    savingsPoints(state) +
    trackerPoints(state, 'finance') * 1.0 +
    achievementPoints(state, 'finance') * 2.5 +
    visionPoints(state, 'finance');

  const fitnessPts =
    fitnessScorePoints(state) +
    trackerPoints(state, 'fitness') * 1.2 +
    achievementPoints(state, 'fitness') * 2.5 +
    visionPoints(state, 'fitness');

  const socialPts =
    socialSelfCheckPoints(state) +
    socialPoints(state, friendCount) +
    achievementPoints(state, 'social') * 2.5 +
    visionPoints(state, 'social');

  const brain   = toRating(brainPts);
  const finance = toRating(financePts);
  const fitness = toRating(fitnessPts);
  const social  = toRating(socialPts);
  const ovr     = clamp((brain + finance + fitness + social) / 4);

  return { brain, finance, fitness, social, ovr };
}

/**
 * End-to-end recompute for one user: read raw user_data.state, count
 * accepted friendships, derive ratings, patch profiles. Used by both
 * recompute-ratings.js and get-leaderboard.js.
 *
 * Returns { ratings, computedAt } on success, throws on failure.
 */
async function recomputeUser(userId, { supabaseUrl, serviceKey }) {
  const stateRes = await fetch(
    `${supabaseUrl}/rest/v1/user_data?id=eq.${userId}&select=state`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!stateRes.ok) throw new Error('state read failed');
  const stateRows = await stateRes.json();
  const state = stateRows?.[0]?.state || {};

  const friendsRes = await fetch(
    `${supabaseUrl}/rest/v1/friendships?status=eq.accepted&or=(requester_id.eq.${userId},addressee_id.eq.${userId})&select=requester_id`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const friends = friendsRes.ok ? (await friendsRes.json()).length : 0;

  const ratings = deriveRatings(state, friends);
  const computedAt = new Date().toISOString();

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ratings,
        ratings_ovr: ratings.ovr,
        ratings_computed_at: computedAt,
      }),
    }
  );
  if (!patchRes.ok) {
    const detail = await patchRes.text().catch(() => '');
    const e = new Error('profile patch failed');
    e.detail = detail;
    throw e;
  }

  return { ratings, computedAt };
}

module.exports = { deriveRatings, recomputeUser };

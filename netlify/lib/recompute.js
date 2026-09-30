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

const { VISION_XP } = require('./visionXp');

// ── Constants (mirror derive.js) ─────────────────────────────────────────
const DAY_MS = 86_400_000;
const TIME_SPACING_MS = 7 * DAY_MS;
const SAVINGS_MIN_TARGET = 10;
const SAVINGS_TOTAL_CAP = 25_000;
const TRACKER_HISTORY_DAYS = 30;
const FULL_CREDIT_N = 8;
const TRACKER_CAP_N = 4;

function clamp(n, lo = 1, hi = 99) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function ymd(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
/* How much a point is worth on the 1-99 scale. Mirrors RATING_SCALE in
   src/lib/ratings/derive.js — see the note there for why it is 8, what
   the simulation said, and what to bump alongside it. This copy exists
   because a number other people can see must not be computed on the
   machine of the person it flatters; `npm run check:parity` fails the
   build if the two ever disagree. */
const RATING_SCALE = 8;
function toRating(points, k = RATING_SCALE) {
  if (!Number.isFinite(points) || points <= 0) return 1;
  return clamp(1 + Math.sqrt(points * k));
}

/* ── Which day keys count (mirror of derive.js) ──────────────────────
   `logs`, `vitalsLog` and `burnLog` are client-written maps keyed by
   day, and until 2026-09-30 every key counted as a day. So a state with
   ten thousand junk keys, or ten years of dates before the account
   existed, or dates in the future, scored as ten years of logging —
   which is how anyone could reach global #1 without doing anything.

   A key now counts only if it is a real calendar date (YYYY-MM-DD that
   round-trips), not after tomorrow (one day of slack for timezones
   ahead of UTC), and — when the account's creation time is known — not
   before the day before it was created (slack the other way). Lifetime
   day counts are also capped at the account's age in days, which the
   window already implies; the cap is kept explicit so a future change
   to the window cannot silently lift it.

   Unknown creation time (createdAt null) keeps today's behaviour for
   the lower bound: no floor, no cap. Honest users are unaffected either
   way — their keys are real, past dates.

   Achievements are NOT touched: undated ones still count unspaced,
   because legitimate accounts older than the createdAt stamp would lose
   rating they earned. That hole is known and waits on item 26.

   Known cost: history imported from before sign-up (an Apple Health
   export, a wearable's 30-day backfill on connect) stays in the user's
   data but does not count toward the rating. A public ranking should
   measure what happened while the account existed. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toMs(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dayWindow(createdAt, now = Date.now()) {
  const created = toMs(createdAt);
  const known = created != null && created <= now;
  return {
    min: known ? ymd(created - DAY_MS) : null,
    max: ymd(now + DAY_MS),
    cap: known ? Math.floor((now - created) / DAY_MS) + 3 : Infinity,
  };
}

function isCountableDay(key, win) {
  if (!DAY_KEY_RE.test(key)) return false;
  if (key > win.max) return false;
  if (win.min && key < win.min) return false;
  const t = Date.parse(key + 'T00:00:00Z');
  return Number.isFinite(t) && ymd(t) === key;
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

// Mirror of src/lib/trackers/done.js: a number tracker with a daily
// target (`dailyGoal`) is done at or above it, otherwise at any amount.
function trackerDone(t, v) {
  if (t.type === 'boolean') return !!v;
  const n = Number(v) || 0;
  const g = Number(t.dailyGoal);
  return g > 0 ? n >= g : n > 0;
}

function trackerPoints(state, category, win) {
  const trackers = (state.trackers || []).filter(t => t.category === category);
  if (!trackers.length) return 0;
  const logs = state.logs || {};
  const today = Date.now();
  let total = 0;
  for (const t of trackers) {
    let hits = 0;
    for (let i = 0; i < TRACKER_HISTORY_DAYS; i++) {
      const k = ymd(today - i * DAY_MS);
      if (win.min && k < win.min) break;
      const v = logs[k]?.[t.id];
      if (trackerDone(t, v)) hits++;
    }
    total += (hits / TRACKER_HISTORY_DAYS) * 10;
  }
  return Math.min(total, TRACKER_CAP_N * 10);
}

/* Lifetime days on which anything in the category was logged, at 0.6 a
   day — the per-category equivalent of vitalsPoints, and what stops
   Brain, Finance and Social freezing inside the first year. Mirrors
   categoryDayPoints in derive.js. */
const CATEGORY_DAY_POINTS = 0.6;

function categoryDayPoints(state, category, win) {
  const ids = new Set((state.trackers || []).filter(t => t.category === category).map(t => t.id));
  if (!ids.size) return 0;
  const logs = state.logs || {};
  let days = 0;
  for (const key of Object.keys(logs)) {
    if (days >= win.cap) break;
    if (!isCountableDay(key, win)) continue;
    const day = logs[key] || {};
    for (const id of ids) {
      const v = day[id];
      const truthy = v !== false && v !== 0 && v != null && v !== '';
      if (truthy) { days++; break; }
    }
  }
  return days * CATEGORY_DAY_POINTS;
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

function socialPoints(state, friendCount = 0, win) {
  const friends = Math.min(friendCount, 20);
  const logs = state.logs || {};
  const today = Date.now();
  let activeDays = 0;
  for (let i = 0; i < 30; i++) {
    const k = ymd(today - i * DAY_MS);
    if (win.min && k < win.min) break;
    if (logs[k] && Object.keys(logs[k]).length > 0) activeDays++;
  }
  return (friends / 20) * 12 + (activeDays / 30) * 16;
}

// Health contributions (vitals / burn / macros) — mirror derive.js.
// Lifetime accumulations, per-day capped (self-reported data rewards
// consistency, never magnitudes).
const BURN_DAY_CAP_KCAL = 600;

function vitalsPoints(state, win) {
  const log = state.vitalsLog || {};
  let days = 0;
  for (const k of Object.keys(log)) {
    if (days >= win.cap) break;
    if (!isCountableDay(k, win)) continue;
    const e = log[k];
    if (e && (e.weight != null || e.sleep != null || e.rhr != null)) days++;
  }
  return days * 0.4;
}

function burnPoints(state, win) {
  const log = state.burnLog || {};
  let pts = 0, days = 0;
  for (const k of Object.keys(log)) {
    if (days >= win.cap) break;
    if (!isCountableDay(k, win)) continue;
    const list = Array.isArray(log[k]) ? log[k] : [];
    const kcal = list.reduce((sum, a) => sum + (Number(a?.kcal) || 0), 0);
    if (kcal > 0) { pts += Math.min(kcal, BURN_DAY_CAP_KCAL) / BURN_DAY_CAP_KCAL * 0.5; days++; }
  }
  return pts;
}

function macroPoints(macroDays = 0) {
  return Math.max(0, macroDays) * 0.5;
}

/**
 * Count the user's lifetime "on-target" nutrition days server-side:
 * days with a daily summary whose calories land between 50% and 130%
 * of the CURRENT calorie goal (goal changes over time — accepted
 * approximation, documented in RANKING_SYSTEM.md). The client passes
 * its own cached count via ctx for the local preview; this count is
 * the canonical one.
 */
async function fetchMacroDays(userId, { supabaseUrl, serviceKey }) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    const goalRes = await fetch(
      `${supabaseUrl}/rest/v1/nutrition_macros?user_id=eq.${userId}&name=eq.Calories&select=daily_goal`,
      { headers }
    );
    const goal = goalRes.ok ? Number((await goalRes.json())[0]?.daily_goal) : 0;
    if (!goal || goal <= 0) return 0;
    const lo = Math.round(goal * 0.5), hi = Math.round(goal * 1.3);
    const cntRes = await fetch(
      `${supabaseUrl}/rest/v1/nutrition_daily_summary?user_id=eq.${userId}&calories=gte.${lo}&calories=lte.${hi}&select=log_date`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } }
    );
    if (!cntRes.ok) return 0;
    const range = cntRes.headers.get('content-range') || '';
    const total = parseInt(range.split('/')[1]);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

/**
 * Vision points for one category — the same arithmetic as the client's
 * `visionPoints` in src/lib/ratings/derive.js, reading the mirrored XP
 * table in ./visionXp.js.
 *
 * What this replaced: every vision priced at a flat 8 xp, split four
 * ways. The real catalogue runs 50–1000 xp and totals 5,100, so the
 * server was scoring the whole set as 176 and reporting an OVR around
 * half what the app showed the same user. That is the "leaderboard is
 * stuck at the wrong number" bug — not staleness. See visionXp.js.
 *
 * A vision with no category counts a quarter toward each of the four,
 * exactly as on the client. Today no vision declares one, so all of
 * them land that way.
 */
function visionPoints(state, category) {
  const stamped = state.visions || {};
  let points = 0;
  for (const id of Object.keys(stamped)) {
    const def = VISION_XP[id];
    if (!def || !def.xp) continue;
    if (def.category && def.category !== category) continue;
    const weight = def.category ? 1 : 0.25;
    points += (def.xp / 4) * weight;
  }
  return points;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Raw per-category point sums BEFORE the sqrt rating curve. Exposed so
 * prestige-up.js can snapshot them as the new competitive baseline.
 * `createdAt` (ISO string or ms) is when the account was created; null
 * means unknown, which leaves day keys unfloored and uncapped.
 */
function derivePoints(state, friendCount = 0, macroDays = 0, createdAt = null) {
  const win = dayWindow(createdAt);
  return {
    brain:
      brainScorePoints(state) +
      categoryDayPoints(state, 'brain', win) +
      trackerPoints(state, 'brain', win) * 1.0 +
      achievementPoints(state, 'brain') * 2.5 +
      visionPoints(state, 'brain'),
    finance:
      financeScorePoints(state) +
      categoryDayPoints(state, 'finance', win) +
      savingsPoints(state) +
      trackerPoints(state, 'finance', win) * 1.0 +
      achievementPoints(state, 'finance') * 2.5 +
      visionPoints(state, 'finance'),
    fitness:
      fitnessScorePoints(state) +
      categoryDayPoints(state, 'fitness', win) +
      trackerPoints(state, 'fitness', win) * 1.2 +
      achievementPoints(state, 'fitness') * 2.5 +
      visionPoints(state, 'fitness') +
      vitalsPoints(state, win) +
      burnPoints(state, win) +
      // nutrition rows are client-written too, so the same age cap holds
      macroPoints(Math.min(macroDays, win.cap)),
    social:
      socialSelfCheckPoints(state) +
      categoryDayPoints(state, 'social', win) +
      socialPoints(state, friendCount, win) +
      achievementPoints(state, 'social') * 2.5 +
      visionPoints(state, 'social'),
  };
}

/**
 * Points → 1-99 ratings. `baseline` is the prestige snapshot
 * (profiles.prestige_baseline): per-category raw points captured at
 * prestige time, subtracted here so the post-prestige climb starts
 * from the floor without wiping any user data. {} = no prestige yet.
 */
function deriveRatings(state, friendCount = 0, baseline = {}, macroDays = 0, createdAt = null) {
  const pts = derivePoints(state, friendCount, macroDays, createdAt);
  const adj = cat => Math.max(0, pts[cat] - (Number(baseline?.[cat]) || 0));

  const brain   = toRating(adj('brain'));
  const finance = toRating(adj('finance'));
  const fitness = toRating(adj('fitness'));
  const social  = toRating(adj('social'));
  const ovr     = clamp((brain + finance + fitness + social) / 4);

  return { brain, finance, fitness, social, ovr };
}

/* The state keys the maths above reads — and nothing else. The state
   is ~1 MB, most of it base64 images and logs the rating never looks
   at, and this runs on every recompute and every stale leaderboard
   open. A JSON-path projection hands back only these, which is the
   difference between moving a megabyte and moving the part that
   counts on a Micro instance. Add a key here when a point source
   starts reading a new one, or it will silently read as empty. */
const RATING_STATE_KEYS = [
  'achievements', 'trackers', 'logs', 'savings', 'visions',
  'brainScore', 'financeScore', 'fitnessScore', 'socialScore',
  'vitalsLog', 'burnLog',
];
const RATING_STATE_SELECT = RATING_STATE_KEYS.map(k => `${k}:state->${k}`).join(',');

/**
 * When the account was created, from the auth server — profiles has no
 * created_at. Callers that already verified the user's JWT hold this
 * from /auth/v1/user and should pass it in instead; this is the
 * fallback. Null on any failure, which means "no floor, no cap" rather
 * than a wrong one.
 */
async function fetchCreatedAt(userId, { supabaseUrl, serviceKey }) {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return null;
    return (await res.json())?.created_at || null;
  } catch {
    return null;
  }
}

/**
 * Everything the rating is computed from, read ONCE: the projected
 * state, the friend count, the prestige row and the macro-day count.
 * prestige-up uses this directly so the value it guards on and the
 * baseline it stores come from the same read — reading twice is what
 * let a state be emptied in between.
 */
async function loadRatingInputs(userId, { supabaseUrl, serviceKey }, { createdAt } = {}) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const stateRes = await fetch(
    `${supabaseUrl}/rest/v1/user_data?id=eq.${userId}&select=${RATING_STATE_SELECT}`,
    { headers }
  );
  if (!stateRes.ok) throw new Error('state read failed');
  const row = (await stateRes.json())?.[0] || {};
  const state = {};
  for (const k of RATING_STATE_KEYS) if (row[k] != null) state[k] = row[k];

  const friendsRes = await fetch(
    `${supabaseUrl}/rest/v1/friendships?status=eq.accepted&or=(requester_id.eq.${userId},addressee_id.eq.${userId})&select=requester_id`,
    { headers }
  );
  const friends = friendsRes.ok ? (await friendsRes.json()).length : 0;

  // Prestige baseline: raw points snapshotted at prestige time. The
  // canonical (friend-visible) ratings are computed net of it so each
  // prestige climb restarts from the floor. Client derive.js stays
  // un-baselined (local preview may briefly run higher post-prestige —
  // accepted skew; server value is canonical).
  const profRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=prestige,prestige_baseline`,
    { headers }
  );
  const prof = profRes.ok ? (await profRes.json())[0] : null;

  const macroDays = await fetchMacroDays(userId, { supabaseUrl, serviceKey });
  const created = createdAt !== undefined ? createdAt : await fetchCreatedAt(userId, { supabaseUrl, serviceKey });

  return {
    state,
    friends,
    profile: prof,
    prestige: prof?.prestige || 0,
    baseline: prof?.prestige_baseline || {},
    macroDays,
    createdAt: created || null,
  };
}

/** Write the canonical ratings to profiles. Throws on failure. */
async function writeRatings(userId, ratings, { supabaseUrl, serviceKey }) {
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
    // Detail stays in the server log; callers return a generic error.
    const detail = await patchRes.text().catch(() => '');
    console.error('recompute: profile patch failed', patchRes.status, detail.slice(0, 300));
    throw new Error('profile patch failed');
  }
  return computedAt;
}

/**
 * End-to-end recompute for one user: read the rating inputs, derive,
 * patch profiles. Used by recompute-ratings.js and get-leaderboard.js.
 * `opts.createdAt` — the account's creation time if the caller already
 * has it (saves an auth round trip).
 *
 * Returns { ratings, computedAt, prestige } on success, throws on failure.
 */
async function recomputeUser(userId, env, opts = {}) {
  const inp = await loadRatingInputs(userId, env, opts);
  const ratings = deriveRatings(inp.state, inp.friends, inp.baseline, inp.macroDays, inp.createdAt);
  const computedAt = await writeRatings(userId, ratings, env);
  return { ratings, computedAt, prestige: inp.prestige };
}

module.exports = {
  deriveRatings, derivePoints, recomputeUser, fetchMacroDays,
  loadRatingInputs, writeRatings, fetchCreatedAt, RATING_STATE_KEYS,
};

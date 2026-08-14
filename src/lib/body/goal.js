/**
 * Body-goal projection.
 *
 * Answers "how many training sessions until I hit my target", derived
 * from the user's own measured rate of change — NOT from a physiological
 * model of what a gym session burns. A session is worth roughly 0.05 kg
 * of fat; projecting from session count would be modelling the wrong
 * variable entirely. Measured rate is self-correcting: eat more and the
 * trend flattens, and the estimate extends by itself.
 *
 * The sessions figure is therefore a RESTATEMENT of the timeline in the
 * user's own units ("13 weeks, which for you is 40 sessions"), never a
 * claim that the sessions caused it. The UI must say so.
 *
 * Refusal is a first-class result. Every caller gets `{ ok:false, reason }`
 * rather than a plausible number, because a confident wrong ETA is worse
 * than no ETA: people plan around it.
 *
 * Pure — no DOM, no React, no network. All inputs come from S.
 */

/*
 * There is deliberately NO minimum-history gate any more. The modelled
 * plan works from a profile and a calorie target alone, so a new user
 * gets a real answer on day one instead of being told to come back in a
 * fortnight. Weight history, once it exists, replaces the model rather
 * than unlocking it — see the source hierarchy in bodyGoalPlan.
 */
/**
 * Safety rails. These are not stylistic — a goal-weight feature with a
 * countdown is the shape of thing that gets scrutinised for encouraging
 * disordered eating, and it should refuse rather than cheer someone
 * toward an unsafe target or an unsafe speed.
 */
export const MIN_SAFE_BMI = 18.5;
/** Weigh-ins needed inside a window before a slope means anything. */
export const MIN_RATE_POINTS = 3;
/**
 * Windows tried, in order, when fitting the rate. 28 days is the ideal
 * — recent enough to reflect what the user is doing now. But someone
 * weighing in fortnightly only has two points in 28 days, and refusing
 * them entirely was wrong: a slower cadence is still a cadence. Widen
 * until there is enough to fit, and tell the caller which window was
 * used so the UI can say so.
 */
export const RATE_WINDOWS = [28, 56, 90];
export const MAX_SAFE_LOSS_FRACTION = 0.01;  // 1% of bodyweight per week

import { bmrKcal, currentWeightKg } from '../burn.js';
import { blendedDailyKcal } from '../diet/plan.js';
import { plannedSessionsPerWeek } from '../rotation/pattern.js';

/**
 * Planned sessions a week.
 *
 * `goal.weeklyWeights + weeklyCardio` is a number typed once at setup —
 * a guess about a rota that is already written down. When the rotation
 * is in use its own cadence is the better input, and it is the same
 * figure the calendar draws, so the two cannot disagree.
 *
 * Only used when the user actually has a rotation; a typed cadence still
 * wins if there is one, because someone who set it deliberately meant it.
 */
function cadenceOf(S, goal) {
  const typed = (goal.weeklyWeights || 0) + (goal.weeklyCardio || 0);
  if (typed > 0) return typed;
  return S && S.rotation ? plannedSessionsPerWeek() : 0;
}

const DAY = 86400000;
const ymd = d => d.toISOString().slice(0, 10);

/** Ordered [date, kg] from the shared vitals store, oldest first. */
export function weightSeries(S) {
  const log = (S && S.vitalsLog) || {};
  return Object.keys(log)
    .filter(d => log[d] && log[d].weight != null && log[d].weight > 0)
    .sort()
    .map(d => [d, parseFloat(log[d].weight)]);
}

/** Mean of every entry in the 7 days ending `endDate` (inclusive). */
function rollingAvg(series, endDate) {
  const end = new Date(endDate + 'T12:00');
  const start = new Date(end.getTime() - 6 * DAY);
  const win = series.filter(([d]) => {
    const t = new Date(d + 'T12:00');
    return t >= start && t <= end;
  });
  if (!win.length) return null;
  return win.reduce((s, [, w]) => s + w, 0) / win.length;
}

/**
 * Least-squares slope in kg/week over the trailing `days`.
 *
 * A regression rather than (this week's average − last week's), because
 * the two-point form is dominated by whichever day happened to bookend
 * the window — one heavy meal at the wrong end and the "rate" doubles.
 */
export function ratePerWeek(series, days = 28) {
  const cutoff = Date.now() - days * DAY;
  const pts = series
    .map(([d, w]) => [new Date(d + 'T12:00').getTime(), w])
    .filter(([t]) => t >= cutoff);
  if (pts.length < MIN_RATE_POINTS) return null;
  const n = pts.length;
  const mx = pts.reduce((s, [t]) => s + t, 0) / n;
  const my = pts.reduce((s, [, w]) => s + w, 0) / n;
  let num = 0, den = 0;
  for (const [t, w] of pts) { num += (t - mx) * (w - my); den += (t - mx) ** 2; }
  if (!den) return null;
  return (num / den) * 7 * DAY;   // kg per ms → kg per week
}

/**
 * Fit the rate over the narrowest window that has enough weigh-ins.
 * Returns { rate, days, points } or null when even 90 days is too thin.
 */
export function fitRate(series) {
  for (const days of RATE_WINDOWS) {
    const rate = ratePerWeek(series, days);
    if (rate != null) {
      const cutoff = Date.now() - days * DAY;
      const points = series.filter(([d]) => new Date(d + 'T12:00').getTime() >= cutoff).length;
      return { rate, days, points };
    }
  }
  return null;
}

/** Weigh-ins inside the trailing `days`. Used to explain a refusal. */
export function recentPoints(series, days = 90) {
  const cutoff = Date.now() - days * DAY;
  return series.filter(([d]) => new Date(d + 'T12:00').getTime() >= cutoff).length;
}

/** Sessions per week for a boolean tracker, over the trailing `weeks`. */
export function sessionsPerWeek(S, trackerId, weeks = 8) {
  if (!trackerId) return null;
  const logs = (S && S.logs) || {};
  const cutoff = Date.now() - weeks * 7 * DAY;
  let n = 0;
  for (const d of Object.keys(logs)) {
    const t = new Date(d + 'T12:00').getTime();
    if (t < cutoff || t > Date.now()) continue;
    if (logs[d] && logs[d][trackerId]) n++;
  }
  return n / weeks;
}

/**
 * Nutrition adherence over `days`, from a { 'YYYY-MM-DD': {...} } map of
 * daily totals and a { name: goal } map of targets.
 *
 * Deliberately scored against LOGGED days only. A day with no food
 * logged is not a day off target — counting it as a miss would punish
 * people for not logging, and the rational response to that is to log
 * less. Coverage is reported separately and honestly instead.
 */
export function nutritionAdherence(daily, goals, days = 7) {
  const out = { logged: 0, onTarget: 0, unlogged: 0, pct: null, byDay: [] };
  if (!daily || !goals) return out;
  const kcalGoal = goals.calories || null;
  const proteinGoal = goals.protein || null;
  for (let i = days - 1; i >= 0; i--) {
    const key = ymd(new Date(Date.now() - i * DAY));
    const row = daily[key];
    if (!row || !row.calories) { out.unlogged++; out.byDay.push('none'); continue; }
    out.logged++;
    // "On target" = within 10% of the calorie goal AND at or above the
    // protein goal, when each is set. A single target still counts.
    const kcalOk = kcalGoal ? Math.abs(row.calories - kcalGoal) <= kcalGoal * 0.1 : true;
    const proteinOk = proteinGoal ? (row.protein_g || 0) >= proteinGoal * 0.9 : true;
    const ok = kcalOk && proteinOk;
    if (ok) out.onTarget++;
    out.byDay.push(ok ? 'hit' : 'miss');
  }
  out.pct = out.logged ? Math.round((out.onTarget / out.logged) * 100) : null;
  return out;
}


// ══════════════════════════════════════════════════════════════════════
// The modelled plan — what the research says, before you have a trend
// ══════════════════════════════════════════════════════════════════════

/**
 * Energy in a kilogram of body fat. The Wishnofsky (1958) figure, still
 * the standard planning constant. It is a simplification and a known
 * OVER-estimate of long-run loss: as you get lighter your maintenance
 * falls and the body adapts, so a fixed deficit yields less each month.
 * Treated here as a first estimate that the measured trend replaces the
 * moment there is enough data to fit one.
 */
export const KCAL_PER_KG_FAT = 7700;

/**
 * Harris-Benedict style activity multipliers on BMR. These already
 * account for training — session kcal must NOT be added on top or the
 * exercise is counted twice, which is the classic way these estimates
 * end up wildly optimistic.
 */
export function activityFactor(sessionsPerWeek) {
  if (sessionsPerWeek >= 6) return 1.725;   // very active, 6-7 d/wk
  if (sessionsPerWeek >= 3) return 1.55;    // moderate, 3-5 d/wk
  if (sessionsPerWeek >= 1) return 1.375;   // light, 1-3 d/wk
  return 1.2;                               // sedentary
}

/**
 * Total daily energy expenditure, from the burn profile the Calories
 * widget already collects. Null when height/age/sex/weight are missing —
 * we don't guess a body.
 */
export function tdeeKcal(S, sessionsPerWeek) {
  // A wearable's measured all-day burn beats any multiplier we could
  // pick. Activity factors are a coarse guess at how much someone
  // moves, and that guess is the biggest error term in the projection.
  const measured = measuredBurn(S);
  if (measured) return measured.kcal;
  const bmr = bmrKcal(S);
  if (!bmr) return null;
  return Math.round(bmr * activityFactor(sessionsPerWeek || 0));
}

/**
 * The modelled weekly rate, in kg/week (signed: negative = losing).
 *
 * rate = (TDEE − intake) × 7 ÷ 7700
 *
 * Returns null when we can't model it — no burn profile, or no daily
 * calorie target to compare TDEE against. A guessed intake would make
 * the whole plan fiction, so it declines instead.
 */
export const MIN_INTAKE_DAYS = 5;
/**
 * A logged day under this share of resting burn is almost certainly a
 * PARTIAL log — breakfast entered, the rest of the day forgotten. It is
 * not a fasting day, and treating it as one is the dangerous direction:
 * a 400 kcal "day" implies an enormous deficit, which would speed the
 * projection up and tell the user they are ahead of schedule for
 * forgetting to log their dinner. Excluded from the average and
 * reported separately.
 */
export const PARTIAL_DAY_BMR_FRACTION = 0.7;

/**
 * Classify logged days into complete and partial, and average only the
 * complete ones.
 *
 * @param entries [{date, calories}] from nutrition_daily_summary
 * @param bmr     resting burn, for the partial-day floor
 */
export function summariseIntake(entries, bmr, windowDays = 14) {
  const list = entries || [];
  const floor = bmr ? bmr * PARTIAL_DAY_BMR_FRACTION : 800;
  const complete = list.filter(e => e.calories >= floor);
  const partial = list.filter(e => e.calories < floor);
  return {
    days: windowDays,
    loggedDays: complete.length,
    partialDays: partial.length,
    avgKcal: complete.length
      ? Math.round(complete.reduce((s, e) => s + e.calories, 0) / complete.length)
      : null,
    coverage: Math.round((complete.length / windowDays) * 100),
    floor: Math.round(floor),
  };
}

export function modelledRate(S, goal, intakeAvg = null) {
  const cadence = cadenceOf(S, goal);
  const tdee = tdeeKcal(S, cadence);
  if (!tdee) return null;

  // What the user ACTUALLY ate beats what they planned to, once there
  // is enough of it to be representative. Someone logging faithfully at
  // 2,600 against a 2,000 target has a smaller deficit and a longer
  // timeline, and the widget should say so rather than keep quoting the
  // plan back at them. Under MIN_INTAKE_DAYS the average is too thin to
  // trust and the typed target stands.
  //
  // `useMacros: false` opts out entirely — for people who log some meals
  // but not reliably enough to want it steering their goal. Off by
  // choice is not the same as off by accident, so the widget says which.
  const optedOut = goal.useMacros === false;
  const useActual = !optedOut && intakeAvg && intakeAvg.avgKcal > 0
    && intakeAvg.loggedDays >= MIN_INTAKE_DAYS;
  // Target precedence, most authoritative first:
  //   1. the macro goal in Track — what the food log measures against
  //   2. goal.dailyKcal — legacy, for goals saved before that was wired
  //   3. the Diet tab plan, blended across the rotation
  // The plan is last because it is an intention, not the app's live
  // target — but it is far better than refusing to project at all just
  // because the same number wasn't typed into Track as well.
  const planKcal = blendedDailyKcal(S);
  const targetKcal = (intakeAvg && intakeAvg.targetKcal) || goal.dailyKcal || planKcal || null;
  const targetFromPlan = !((intakeAvg && intakeAvg.targetKcal) || goal.dailyKcal) && !!planKcal;
  const intake = useActual ? intakeAvg.avgKcal : targetKcal;
  if (!intake) return null;

  const dailyDeficit = tdee - intake;              // + = losing
  if (!dailyDeficit) return null;
  const measured = measuredBurn(S);
  return {
    kgPerWeek: -(dailyDeficit * 7) / KCAL_PER_KG_FAT,
    tdee, intake, dailyDeficit,
    burnSource: measured ? 'measured' : 'estimated',
    ...(measured ? { burnDays: measured.days } : {}),
    intakeSource: useActual ? 'logged' : optedOut ? 'target-opted-out' : targetFromPlan ? 'plan' : 'target',
    ...(intakeAvg ? { partialDays: intakeAvg.partialDays } : {}),
    ...(useActual ? { loggedDays: intakeAvg.loggedDays, coverage: intakeAvg.coverage,
                      targetKcal } : {}),
  };
}


// ══════════════════════════════════════════════════════════════════════
// Wearables — WHOOP / Oura make the estimate an actual measurement
// ══════════════════════════════════════════════════════════════════════

/** Days of measured burn needed before it beats the BMR estimate. */
export const MIN_BURN_DAYS = 5;

/**
 * Average MEASURED all-day energy expenditure, from WHOOP's cycle
 * kilojoules (vitalsLog[date].burnKcal).
 *
 * This is the single biggest accuracy win available to this widget.
 * Without it, TDEE is BMR × a coarse activity multiplier — a guess
 * about how much someone moves, and the largest error term in the whole
 * projection. WHOOP measures it. When the data is there we stop
 * guessing.
 */
export function measuredBurn(S, days = 14) {
  const log = (S && S.vitalsLog) || {};
  const cutoff = ymd(new Date(Date.now() - days * DAY));
  const vals = Object.keys(log)
    .filter(d => d >= cutoff && log[d] && log[d].burnKcal > 0)
    .map(d => log[d].burnKcal);
  if (vals.length < MIN_BURN_DAYS) return null;
  return {
    kcal: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    days: vals.length,
  };
}

/**
 * Dates on which a connected wearable recorded a workout.
 *
 * WHOOP workouts land in burnLog as entries prefixed `whoop-` (see
 * netlify/lib/whoop.js). They are used only to FILL IN days the user
 * didn't tick a tracker on — never to add to a day they did — so a
 * device can rescue a forgotten log without ever inflating a day that
 * was already counted.
 */
export function deviceWorkoutDays(S) {
  const burn = (S && S.burnLog) || {};
  const out = new Set();
  for (const d of Object.keys(burn)) {
    const entries = burn[d] || [];
    if (entries.some(e => /^(whoop|oura)-/.test(String(e.id || '')) && !/steps/i.test(String(e.id || '')))) {
      out.add(d);
    }
  }
  return out;
}

/**
 * Which of the user's trackers count as training.
 *
 * Anything the user set up at goal time is included by name, but so is
 * any boolean tracker they've since created that reads like training —
 * someone who adds a "Gym" tracker next month shouldn't have to redo
 * their goal for it to count. Matching on the tracker's own name is the
 * only signal available: trackers carry no type beyond boolean/number.
 */
export const CARDIO_RE = /(cardio|run(?!g)|jog|walk|bike|cycl|spin|swim|row|hiit|treadmill|elliptical|hike|steps)/i;
export const WEIGHTS_RE = /(gym|lift|weight|strength|resistance|workout|train|crossfit|calisthen|exercise)/i;

// Numeric trackers count as sessions too — "Gym", target 3/week, is a
// perfectly ordinary way to track training, and skipping every non-boolean
// tracker meant those users' sessions were invisible and their plan
// collapsed to zero. countSessions already treats any truthy value as
// "did it that day", so a numeric tracker needs no special counting.
//
// The exception is a tracker that is a DAILY QUANTITY rather than a
// session: step counts get logged every day, so admitting them would
// report seven cardio sessions a week for someone who simply owns a
// phone. Booleans are unaffected — ticking "Steps" every day is a choice
// the user made, a step count arriving is not.
const DAILY_METRIC_RE = /(steps|distance|km\b|miles)/i;

export function trainingTrackers(S, goal = {}) {
  const out = { weights: [], cardio: [] };
  for (const t of ((S && S.trackers) || [])) {
    const numeric = t.type !== 'boolean';
    // An explicit pick at setup always wins over the name guess — and
    // over the daily-metric exclusion, because it was a deliberate act.
    if (t.id === goal.cardioTrackerId) { out.cardio.push(t.id); continue; }
    if (t.id === goal.gymTrackerId) { out.weights.push(t.id); continue; }
    if (numeric && DAILY_METRIC_RE.test(t.name || '')) continue;
    if (CARDIO_RE.test(t.name || '')) out.cardio.push(t.id);
    else if (WEIGHTS_RE.test(t.name || '')) out.weights.push(t.id);
  }
  return out;
}

/**
 * Count sessions between two dates, deduped to at most one per category
 * per day.
 *
 * The dedupe matters once trackers are auto-detected: someone with
 * "Gym", "Workout" AND "Lift" who ticks all three on a Monday did one
 * session, not three, and inflating their count would inflate their
 * progress. A morning run plus an evening lift is still two, because
 * they fall in different categories.
 */
export function countSessions(S, ids, fromYmd, toYmd, deviceDays = null) {
  const logs = (S && S.logs) || {};
  const weights = new Set(ids.weights);
  const cardio = new Set(ids.cardio);
  const dates = new Set(Object.keys(logs));
  if (deviceDays) for (const d of deviceDays) dates.add(d);

  let n = 0;
  for (const d of dates) {
    if (fromYmd && d < fromYmd) continue;
    if (toYmd && d > toYmd) continue;
    const day = logs[d] || {};
    let didWeights = false, didCardio = false;
    for (const id of Object.keys(day)) {
      if (!day[id]) continue;
      if (weights.has(id)) didWeights = true;
      else if (cardio.has(id)) didCardio = true;
    }
    const tracked = (didWeights ? 1 : 0) + (didCardio ? 1 : 0);
    // A device only fills a day the user logged nothing on. Adding to a
    // tracked day would double-count the same workout — the tick and
    // the WHOOP record are usually the same session.
    n += tracked > 0 ? tracked : (deviceDays && deviceDays.has(d) ? 1 : 0);
  }
  return n;
}

/** Training sessions logged since the goal was set. */
export function sessionsSince(S, goal) {
  if (!goal || !goal.startedAt) return 0;
  return countSessions(S, trainingTrackers(S, goal), goal.startedAt, null, deviceWorkoutDays(S));
}

/**
 * Actual weekly cadence per category over the trailing `weeks`, from
 * every training tracker rather than only the one picked at setup.
 */
export function trainingCadence(S, goal, weeks = 8) {
  const ids = trainingTrackers(S, goal);
  const from = ymd(new Date(Date.now() - weeks * 7 * DAY));
  // Device days are attributed to weights, since WHOOP's sport type is
  // not persisted — an unknown workout is more often resistance work in
  // this app's population, and the split only affects presentation.
  const dev = deviceWorkoutDays(S);
  const perCat = cat => {
    const only = { weights: [], cardio: [], [cat]: ids[cat] };
    return countSessions(S, only, from, null, cat === 'weights' ? dev : null) / weeks;
  };
  return { weights: perCat('weights'), cardio: perCat('cardio') };
}

/**
 * How the user's actual training compares to what they committed to.
 *
 * `planned` is the cadence typed at setup — the promise. `recent` is
 * the trailing three weeks — the behaviour. Three weeks rather than
 * one, so a single missed week (illness, a holiday, a busy fortnight)
 * doesn't get called slacking; this should notice a drift, not nag
 * about noise.
 */
export const SLACK_RATIO = 0.7;   // under 70% of plan = drifting
export const SLACK_WEEKS = 3;

export function trainingAdherence(S, goal) {
  if (!goal) return null;
  const planned = (goal.weeklyWeights || 0) + (goal.weeklyCardio || 0);
  if (planned <= 0) return null;
  const cad = trainingCadence(S, goal, SLACK_WEEKS);
  const recent = cad.weights + cad.cardio;
  const ratio = recent / planned;
  return {
    planned,
    recent: Math.round(recent * 10) / 10,
    ratio: Math.round(ratio * 100) / 100,
    slacking: ratio < SLACK_RATIO,
    // How many sessions behind the plan they are over the window.
    shortBy: Math.max(0, Math.round((planned - recent) * SLACK_WEEKS)),
  };
}

/**
 * Is this target safe to count down to?
 *
 * Returns null when fine, or a string reason. Height comes from the burn
 * profile; with no height we can't compute BMI and don't guess — an
 * un-checkable target is allowed through, but the caller still shows the
 * disclaimer.
 */
export function targetSafety(S, goal) {
  if (!goal || !goal.targetKg) return null;
  const h = S && S.burnProfile && S.burnProfile.heightCm;
  if (!h) return null;
  const bmi = goal.targetKg / ((h / 100) ** 2);
  if (bmi < MIN_SAFE_BMI) return 'target-below-healthy-bmi';
  return null;
}

/**
 * The projection.
 *
 * @returns {{ok:true, ...}} or {{ok:false, reason:string}}
 *   reason ∈ 'no-goal' | 'no-weight' | 'no-profile' | 'no-intake'
 *          | 'intake-wrong-way' | 'wrong-way' | 'no-trend'
 *          | 'target-below-healthy-bmi'
 */
export function bodyGoalPlan(S, opts = {}) {
  const goal = S && S.bodyGoal;
  if (!goal || !goal.targetKg) return { ok: false, reason: 'no-goal' };

  const unsafe = targetSafety(S, goal);
  if (unsafe) return { ok: false, reason: unsafe };

  const series = weightSeries(S);
  const current = series.length
    ? rollingAvg(series, series[series.length - 1][0])
    : currentWeightKg(S);
  if (current == null) return { ok: false, reason: 'no-weight' };

  const target = goal.targetKg;
  const start = goal.startKg || current;
  const remaining = target - current;                 // signed

  // What is knowable WITHOUT a rate.
  //
  // Every refusal below is about the same missing thing: a trustworthy
  // rate, and therefore a timeline. None of them are about progress —
  // sessions logged and ground covered are plain counting, and the app
  // has both. It was returning a bare { ok:false, reason } anyway, so a
  // user with a flat month, or two weigh-ins, or a cut that has gone the
  // wrong way, saw an em-dash where their 39 logged sessions should be.
  //
  // Spread into every refusal from here on. `pct` is the weight figure
  // rather than the session one because there is no timeline to derive a
  // session total from; pctBasis says which it is so the UI can label it
  // honestly instead of implying sessions.
  const spanKg = Math.abs(start - target);
  const knownWeightPct = spanKg > 0
    ? Math.max(0, Math.min(100, Math.round((Math.abs(start - current) / spanKg) * 100)))
    : 0;
  const known = {
    current, target, start,
    pct: knownWeightPct,
    weightPct: knownWeightPct,
    pctBasis: 'weight',
    sessionsDone: sessionsSince(S, goal),
  };

  // Cadence: what the user actually does beats what they typed at setup.
  const weights = opts.weightsPerWeek != null ? opts.weightsPerWeek : (goal.weeklyWeights || 0);
  const cardio = opts.cardioPerWeek != null ? opts.cardioPerWeek : (goal.weeklyCardio || 0);
  const perWeek = weights + cardio;

  if (Math.abs(remaining) < 0.3) {
    return { ok: true, atGoal: true, pct: 100, current, target, start,
             sessionsDone: sessionsSince(S, goal) };
  }

  // ── Where the rate comes from ──
  // Measured trend first: it is ground truth and already contains every
  // factor the model has to approximate. The model is the fallback that
  // makes the widget useful on day one, when there is nothing to fit.
  const fit = fitRate(series);
  let rate = null, source = null, rateWindowDays = null, ratePoints = null;

  if (fit) {
    // A measurement exists. It wins outright — including when it says
    // "flat" or "going the wrong way". Falling through to the model
    // there would let an optimistic projection paper over what the
    // scale is actually reporting, which is the one thing this must
    // never do.
    if (Math.abs(fit.rate) < 0.02) {
      return { ok: false, reason: 'no-trend', ...known, window: fit.days };
    }
    if (Math.sign(fit.rate) !== Math.sign(remaining)) {
      return { ok: false, reason: 'wrong-way', ...known, rate: fit.rate };
    }
    rate = fit.rate; source = 'measured';
    rateWindowDays = fit.days; ratePoints = fit.points;
  } else {
    // No usable trend yet — this is the day-one case the model exists
    // for. Name whichever input is missing rather than shrugging; each
    // one is a different thing for the user to go and do.
    const model = modelledRate(S, goal, opts.intakeAvg);
    if (!model) {
      if (!bmrKcal(S)) return { ok: false, reason: 'no-profile', ...known };
      if (!(opts.intakeAvg && opts.intakeAvg.targetKcal) && !goal.dailyKcal && !blendedDailyKcal(S)) {
      return { ok: false, reason: 'no-intake', ...known };
    }
      return { ok: false, reason: 'no-recent-data', ...known,
               have: recentPoints(series), need: MIN_RATE_POINTS };
    }
    if (Math.sign(model.kgPerWeek) !== Math.sign(remaining)) {
      return { ok: false, reason: 'intake-wrong-way', ...known,
               dailyDeficit: model.dailyDeficit, tdee: model.tdee, intake: model.intake };
    }
    rate = model.kgPerWeek; source = 'projected';
  }

  const model = source === 'projected' ? modelledRate(S, goal, opts.intakeAvg) : null;

  const weeks = Math.max(1, Math.ceil(Math.abs(remaining / rate)));

  // ── Progress in sessions ──
  // The whole point: "how far am I" answered in the unit the user
  // actually controls. Weight is the outcome; sessions are the work.
  const sessionsDone = sessionsSince(S, goal);
  const weeksElapsed = goal.startedAt
    ? Math.max(0, (Date.now() - new Date(goal.startedAt + 'T12:00').getTime()) / (7 * DAY))
    : 0;
  // Remaining sessions are counted at the cadence the user COMMITTED to,
  // not the one they are currently keeping. Using the live cadence had
  // it backwards: train less, fewer sessions are "required", and the
  // percentage climbs. Slacking would have looked like progress. Against
  // the plan, a slower rate stretches `weeks`, the remaining count grows,
  // and the bar correctly falls back.
  const plannedPerWeek = cadenceOf(S, goal) || perWeek;

  // Kept alongside the session count, because the two can disagree and
  // that is worth seeing: plenty of sessions logged but the weight not
  // moving is a real signal, not a rounding error.
  const span = Math.abs(start - target);
  const weightPct = span > 0
    ? Math.max(0, Math.min(100, Math.round((Math.abs(start - current) / span) * 100)))
    : 0;

  // No cadence to plan against — no typed commitment, no rotation, and
  // nothing that reads like a training tracker ticked in the last eight
  // weeks. This used to fall through and multiply by zero, which printed
  // answers that were not answers: "0 of 0 sessions · 0 to go · 0%" for
  // a new goal, and — far worse — a flat 100% for anyone who trained for
  // a while and then stopped, because zero remaining over N done rounds
  // to complete. Someone 6 kg out was being told they had arrived.
  //
  // The weight trend is still real in this case, so the widget keeps a
  // percentage; it just says which one it is and what is missing.
  const sessionsUnknown = !(plannedPerWeek > 0);
  const sessionsRemaining = sessionsUnknown ? null : Math.round(weeks * plannedPerWeek);
  const sessionsTotal = sessionsUnknown ? null : sessionsDone + sessionsRemaining;
  const pct = sessionsUnknown
    ? weightPct
    : (sessionsTotal > 0
        ? Math.max(0, Math.min(100, Math.round((sessionsDone / sessionsTotal) * 100)))
        : 0);

  const tooFast = remaining < 0 && Math.abs(rate) > current * MAX_SAFE_LOSS_FRACTION;

  return {
    ok: true,
    atGoal: false,
    pct,                       // session progress — the headline
    pctBasis: sessionsUnknown ? 'weight' : 'sessions',
    sessionsUnknown,           // no cadence: session counts are null, not 0
    weightPct,                 // the same journey measured in kg
    current, target, start, rate, weeks, source,
    weightSessions: Math.round(weeks * weights),
    cardioSessions: Math.round(weeks * cardio),
    weightsPerWeek: weights,
    cardioPerWeek: cardio,
    sessionsDone,
    sessionsRemaining,
    sessionsTotal,
    weeksElapsed: Math.round(weeksElapsed * 10) / 10,
    plannedPerWeek,
    adherence: trainingAdherence(S, goal),
    tooFast,
    points: series.length,
    rateWindowDays,
    ratePoints,
    ...(model ? {
      tdee: model.tdee, intake: model.intake, dailyDeficit: model.dailyDeficit,
      intakeSource: model.intakeSource, intakeLoggedDays: model.loggedDays,
      intakeCoverage: model.coverage, targetKcal: model.targetKcal,
      burnSource: model.burnSource, burnDays: model.burnDays,
      intakePartialDays: model.partialDays,
    } : {}),
  };
}

/** Human copy for a refusal. Kept beside the reasons so they can't drift. */
export function refusalCopy(reason, extra = {}) {
  switch (reason) {
    case 'no-goal':
      return 'Set a target to see how far along you are.';
    case 'no-weight':
      return 'Log your weight once and this starts working.';
    case 'no-profile':
      return 'Needs your height, age and sex to estimate energy use — set those up in the Calories widget.';
    case 'no-intake':
      return 'Set a daily Calories goal in your macro settings and this can estimate how long the goal will take.';
    case 'intake-wrong-way':
      return `At ${extra.intake} kcal a day against an estimated ${extra.tdee} burned, you would move away from this target, not toward it.`;
    case 'no-recent-data':
      return `Only ${extra.have || 0} weigh-in${extra.have === 1 ? '' : 's'} in the last 90 days — needs at least ${extra.need || MIN_RATE_POINTS} to work out a rate. Log your weight a few times and this fills in.`;
    case 'no-trend':
      return `Your weight has held steady over the last ${extra.window || 28} days, so there is no rate to project from yet.`;
    case 'wrong-way':
      return 'Currently moving away from the target — no timeline until that turns around.';
    case 'target-below-healthy-bmi':
      return 'That target is below a healthy BMI for your height, so no countdown is shown. Worth talking to a GP or dietitian.';
    default:
      return 'Not enough signal for an estimate yet.';
  }
}

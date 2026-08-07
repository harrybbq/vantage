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

/** Minimum span of weight history before any projection is offered. */
export const MIN_DAYS = 14;
/** Minimum distinct weigh-ins in that span. */
export const MIN_POINTS = 5;
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
 *   reason ∈ 'no-goal' | 'not-enough-data' | 'no-recent-data' | 'no-trend'
 *          | 'wrong-way' | 'at-goal' | 'target-below-healthy-bmi'
 */
export function bodyGoalPlan(S, opts = {}) {
  const goal = S && S.bodyGoal;
  if (!goal || !goal.targetKg) return { ok: false, reason: 'no-goal' };

  const unsafe = targetSafety(S, goal);
  if (unsafe) return { ok: false, reason: unsafe };

  const series = weightSeries(S);
  if (series.length < MIN_POINTS) return { ok: false, reason: 'not-enough-data', have: series.length, need: MIN_POINTS };
  const spanDays = (new Date(series[series.length - 1][0]) - new Date(series[0][0])) / DAY;
  if (spanDays < MIN_DAYS) return { ok: false, reason: 'not-enough-data', have: Math.round(spanDays), need: MIN_DAYS };

  const lastDate = series[series.length - 1][0];
  const current = rollingAvg(series, lastDate);
  const start = goal.startKg || series[0][1];
  const target = goal.targetKg;

  // Progress is measured from where the user STARTED, not from zero —
  // otherwise the bar leaps around every time the target is edited.
  const span = Math.abs(start - target);
  const done = Math.abs(start - current);
  const pct = span > 0 ? Math.max(0, Math.min(100, Math.round((done / span) * 100))) : 0;

  const remaining = target - current;                 // signed
  if (Math.abs(remaining) < 0.3) return { ok: true, atGoal: true, pct: 100, current, target, start };

  // These were one branch, and that was a mistake: "not enough recent
  // weigh-ins" was being reported as "your weight is holding steady",
  // which is the app asserting something about the user's body that it
  // has no way to know. Separate facts, separate messages.
  const fit = fitRate(series);
  if (!fit) {
    return { ok: false, reason: 'no-recent-data', pct, current, target,
             have: recentPoints(series), need: MIN_RATE_POINTS };
  }
  const rate = fit.rate;                             // signed kg/week
  if (Math.abs(rate) < 0.02) {
    return { ok: false, reason: 'no-trend', pct, current, target, rate, window: fit.days };
  }
  // Moving away from the target: an ETA here would be a negative number
  // dressed up as a plan. Say what's happening instead.
  if (Math.sign(rate) !== Math.sign(remaining)) {
    return { ok: false, reason: 'wrong-way', pct, current, target, rate };
  }

  const weeks = Math.ceil(Math.abs(remaining / rate));

  // Sessions are the timeline restated in the user's own cadence.
  const weights = opts.weightsPerWeek != null ? opts.weightsPerWeek : (goal.weeklyWeights || 0);
  const cardio = opts.cardioPerWeek != null ? opts.cardioPerWeek : (goal.weeklyCardio || 0);

  // Losing faster than ~1% of bodyweight a week is worth flagging even
  // when the target itself is fine.
  const tooFast = remaining < 0 && Math.abs(rate) > current * MAX_SAFE_LOSS_FRACTION;

  return {
    ok: true,
    atGoal: false,
    pct,
    current,
    target,
    start,
    rate,
    weeks,
    weightSessions: Math.round(weeks * weights),
    cardioSessions: Math.round(weeks * cardio),
    weightsPerWeek: weights,
    cardioPerWeek: cardio,
    tooFast,
    points: series.length,
    spanDays: Math.round(spanDays),
    // Which window the rate was actually fitted over, and how many
    // weigh-ins were in it — the "How" block shows this so the number
    // is auditable rather than asserted.
    rateWindowDays: fit.days,
    ratePoints: fit.points,
  };
}

/** Human copy for a refusal. Kept beside the reasons so they can't drift. */
export function refusalCopy(reason, extra = {}) {
  switch (reason) {
    case 'no-goal':
      return 'Set a target to see how far along you are.';
    case 'not-enough-data':
      return `Needs about ${extra.need || MIN_DAYS} days of weigh-ins before an estimate means anything — ${extra.have || 0} so far.`;
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

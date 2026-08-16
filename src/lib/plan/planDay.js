/**
 * The recomposition plan, resolved for a date — the one place that
 * answers "does the plan apply, and what does it say today".
 *
 * Until now the plan lived on two screens: the rotation page drew it and
 * the rotation widget summarised it. Everything else in the app — the
 * macro rings, the nutrition page, the coach — still read the flat
 * `nutrition_macros.daily_goal`, so on a night leg day the rotation page
 * said 2630 and the macro ring said 2250. Two numbers for one question
 * is worse than only having the wrong one, because now you have to know
 * which screen to believe.
 *
 * ── Owner-only, and it fails to OFF ──────────────────────────────────
 * The rota, the split and the targets are one person's plan, not a
 * feature. `planDayFor()` returns `{ active: false }` for anybody else,
 * and every caller is written as `plan.active ? planValue : existing`,
 * so a non-owner's app is byte-for-byte what it was. The gate is
 * `window.__vantageOwner`, the same flag the rotation surfaces already
 * use — a UI gate, not authorisation, which is all this needs since
 * nothing here reads or writes anyone else's data.
 *
 * Three things must all hold before it activates:
 *   1. the account is the owner
 *   2. the rota exists in state — they have actually engaged with it
 *   3. the date sits inside the pattern's window
 * Plus an explicit off switch, so it can be turned off without
 * unpicking the rota.
 *
 * Pure — no React, no DOM, no network. Date and state in, verdict out.
 */
import { resolveDay, rotaDayIndex, dayTypeOf, loadScaleOf } from '../rotation/pattern.js';
import { targetsForDay, DAY_TYPE_LABEL, exercisesFor } from '../../data/trainingProgramme.js';

/** True when this build/session is the owner's. UI gate only. */
export function isOwnerHere() {
  return typeof window !== 'undefined' && !!window.__vantageOwner;
}

/**
 * @param iso   'YYYY-MM-DD'
 * @param S     app state
 * @param opts  { assumeOwner } — tests pass this rather than poking window
 * @returns {{active:boolean, dayIndex?, dayType?, dayTypeLabel?, session?,
 *            loadScale?, targets?, exercises?, isRest?, isNight?}}
 */
export function planDayFor(iso, S = {}, opts = {}) {
  const owner = opts.assumeOwner != null ? opts.assumeOwner : isOwnerHere();
  const rotation = (S && S.rotation) || null;
  // Explicit off switch. `=== false` so the absence of the key means on,
  // matching how the rest of the app treats its opt-outs.
  if (!owner || !rotation || rotation.planFuelling === false) return { active: false };

  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return { active: false };
  const [y, m, d] = parts;

  const day = resolveDay(y, m - 1, d, rotation.overrides || {});
  if (!day.inPattern) return { active: false };

  // Booked leave fuels as an off day: it is not a working night,
  // whatever the pattern underneath would have been.
  const dayType = day.shift === 'leave' ? 'off' : dayTypeOf(day.shift);
  const loadScale = day.shift === 'leave' ? 1 : loadScaleOf(day.shift);

  return {
    active: true,
    dayIndex: rotaDayIndex(day.pos),
    dayType,
    dayTypeLabel: DAY_TYPE_LABEL[dayType],
    session: day.session,
    isRest: day.session === 'Rest',
    isNight: dayType === 'night_shift',
    loadScale,
    targets: targetsForDay(dayType, day.session),
    exercises: exercisesFor(day.session),
  };
}

/**
 * The plan's goal for a macro by name, or null to leave the caller's own
 * value alone.
 *
 * Name-matched because that is the only thing the plan and the macro
 * table share — the table's rows are user-created and carry no code.
 * An unrecognised macro (someone's "Fibre" row) returns null and keeps
 * its own goal, which is the right answer rather than a guess.
 */
const MACRO_KEY = {
  calories: 'kcal', kcal: 'kcal', energy: 'kcal',
  protein: 'protein',
  carbs: 'carbs', carbohydrate: 'carbs', carbohydrates: 'carbs',
  fat: 'fat', fats: 'fat',
};

export function planGoalFor(plan, macroName) {
  if (!plan || !plan.active || !macroName) return null;
  const key = MACRO_KEY[String(macroName).trim().toLowerCase()];
  if (!key) return null;
  const v = plan.targets[key];
  return Number.isFinite(v) ? v : null;
}

/** One-line summary for a badge: "Day 9 · Night shift · Legs". */
export function planBadge(plan) {
  if (!plan || !plan.active) return null;
  return `Day ${plan.dayIndex} · ${plan.dayTypeLabel} · ${plan.session}`;
}

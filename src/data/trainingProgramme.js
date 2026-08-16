/**
 * The training programme and its day-type nutrition targets.
 *
 * From Harry's written recomposition plan (2026-08-16). Programme
 * DEFINITION, not user data — so it lives here as a static constant
 * rather than in a table, and it is the same on every device without a
 * migration.
 *
 * ── The constraint that shapes the exercise lists ────────────────────
 * No barbell back squat, no conventional deadlift, no barbell RDL.
 * Form breaks down before the load matters and there is ongoing
 * chiropractic care for mid-thoracic pain. The substitutes below are
 * the programme, not a fallback — hack squat and leg press carry the
 * quad work, hip thrust and 45° hyperextension carry the posterior
 * chain. `assertNoBannedLifts()` guards it so a future edit cannot
 * quietly put one back.
 *
 * ── Why nights are different ─────────────────────────────────────────
 * Night shifts run at MAINTENANCE calories on purpose: appetite
 * regulation collapses on nights, and holding a deficit through one
 * produces a binge rather than a loss. The training load drops to 80%
 * for the same reason — same sets, same reps, lighter bar. Neither is a
 * bug and the UI has to say so, or it reads as one.
 *
 * Pure data + pure helpers. No DOM, no React, no network.
 */

/** Sessions, in the order the rota runs them. Mirrors SEQ in pattern.js. */
export const SESSION_CODES = ['Legs', 'Push', 'Pull', 'Lower', 'Upper'];

/**
 * Prescribed work per session. `sets` × `reps` are the written
 * prescription; load is whatever the user is progressing at, which the
 * app records rather than dictates.
 */
export const PROGRAMME = {
  Legs: [
    { name: 'Hack squat / leg press', sets: 4, reps: '8–12' },
    { name: 'Bulgarian split squat', sets: 3, reps: '10 per leg' },
    { name: 'Leg extension', sets: 3, reps: '12–15' },
    { name: 'Lying leg curl', sets: 4, reps: '10–12' },
    { name: 'Standing calf raise', sets: 4, reps: '10–12' },
  ],
  Push: [
    { name: 'Barbell bench (rack, pins)', sets: 4, reps: '5–8' },
    { name: 'Incline dumbbell press', sets: 3, reps: '8–10' },
    { name: 'Weighted dip', sets: 3, reps: '6–10' },
    { name: 'Lateral raise', sets: 4, reps: '12–15' },
    { name: 'Cable fly', sets: 3, reps: '12–15' },
    { name: 'Triceps pushdown', sets: 3, reps: '12–15' },
  ],
  Pull: [
    { name: 'Pull-up, banded', sets: 4, reps: '4–6' },
    { name: 'Lat pulldown, wide', sets: 4, reps: '8–10' },
    { name: 'Chest-supported row', sets: 3, reps: '10–12' },
    { name: 'Straight-arm pulldown', sets: 3, reps: '12–15' },
    { name: 'Face pull', sets: 3, reps: '15–20' },
    { name: 'Incline dumbbell curl', sets: 3, reps: '10–12' },
  ],
  Lower: [
    { name: 'Hip thrust', sets: 4, reps: '8–12' },
    { name: 'Seated leg curl', sets: 4, reps: '10–12' },
    { name: '45° hyperextension', sets: 4, reps: '12–15' },
    { name: 'Leg press, feet high', sets: 3, reps: '10–12' },
    { name: 'Reverse lunge', sets: 3, reps: '10 per leg' },
    { name: 'Seated calf raise', sets: 4, reps: '15' },
  ],
  Upper: [
    { name: 'Lat pulldown, neutral', sets: 4, reps: '8–10' },
    { name: 'Seated dumbbell press', sets: 3, reps: '8–10' },
    { name: 'Seated cable row', sets: 3, reps: '10–12' },
    { name: 'Lateral raise', sets: 5, reps: '12–15' },
    { name: 'Rear delt fly', sets: 3, reps: '15–20' },
    { name: 'Hammer curl', sets: 3, reps: '12–15' },
    { name: 'Overhead triceps extension', sets: 2, reps: '12–15' },
  ],
};

/**
 * Movements that must never appear. Matched loosely on purpose — a
 * future "Barbell Back Squat (heavy)" has to trip this too.
 */
export const BANNED_LIFTS = [
  { re: /back\s*squat/i, why: 'barbell back squat' },
  { re: /(^|[^a-z])deadlift/i, why: 'conventional deadlift' },
  { re: /barbell\s*rdl|barbell\s*romanian/i, why: 'barbell RDL' },
];

/**
 * @returns {string[]} offending "Session · Exercise" strings; empty when clean.
 * Called by the tests and by the rotation page in dev, so a bad edit
 * fails loudly instead of putting a contraindicated lift in front of
 * someone under treatment for back pain.
 */
export function assertNoBannedLifts(programme = PROGRAMME) {
  const bad = [];
  for (const [session, list] of Object.entries(programme)) {
    for (const ex of list) {
      for (const b of BANNED_LIFTS) {
        if (b.re.test(ex.name)) bad.push(`${session} · ${ex.name} (${b.why})`);
      }
    }
  }
  return bad;
}

/** Night sessions: same sets and reps, 80% of the load. Maintenance. */
export const NIGHT_LOAD_SCALE = 0.8;

/**
 * Daily targets by day type.
 *
 * `floor: true` means under-hitting matters and over-hitting does not —
 * protein and fat are minimums, so the UI must read 170 g against a
 * 165 g floor as MET, never as overshoot. Calories are a target to land
 * on rather than a floor.
 */
export const DAY_TYPE_TARGETS = {
  day_shift:   { kcal: 2250, protein: 165, fat: 65, carbs: 250 },
  off:         { kcal: 2250, protein: 165, fat: 65, carbs: 250 },
  night_shift: { kcal: 2450, protein: 180, fat: 70, carbs: 275 },
};

/** Which of those are floors rather than targets. */
export const FLOOR_MACROS = new Set(['protein', 'fat']);

export const DAY_TYPE_LABEL = {
  day_shift: 'Day shift',
  off: 'Off',
  night_shift: 'Night shift',
};

/** Targets for a day type, falling back to the deficit day. */
export function targetsFor(dayType) {
  return DAY_TYPE_TARGETS[dayType] || DAY_TYPE_TARGETS.off;
}

/** The prescribed work for a session code, or [] for a rest day. */
export function exercisesFor(session) {
  return PROGRAMME[session] || [];
}

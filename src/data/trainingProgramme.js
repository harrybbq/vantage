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
export const SESSION_CODES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower'];

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

/* ══════════════════════════════════════════════════════════════════════
   Stretch and mobility — the Spider-Man block.
   ══════════════════════════════════════════════════════════════════════

   The goal is a shape and a way of moving, not just a set of lifts: wide
   shoulders over a narrow waist, and hips and a mid-back that actually
   go where you point them. The lifting programme above builds the first
   half. This is the second, and it is deliberately SMALL — five minutes
   attached to a session that is already happening beats a mobility day
   that never gets done.

   Two constraints shaped every choice below:

   1. There is ongoing chiropractic care for MID-THORACIC pain, which is
      why thoracic extension and rotation appear on almost every day
      rather than once a week. It is the joint under treatment and the
      one that decides whether the shoulders can sit back where the
      V-taper needs them.
   2. Nothing here loads the spine. These are positions held or moved
      through, at the end of a session when the tissue is warm — never
      the thing that hurts you.

   THIS LIST IS A STARTING POINT. The owner is going to supply what they
   have actually been doing, and these get tuned against it rather than
   replacing it. Keep the shape — three or four per session, a reason
   attached, seconds not sets — so a swap is an edit and not a redesign.
*/

/** `hold` is per side where the movement has sides. */
const ST = (name, hold, why) => ({ name, hold, why });

export const STRETCHES = {
  Legs: [
    ST('Couch stretch', '60s / side', 'Hip flexors shorten under a day of sitting and a hack squat; short hip flexors tip the pelvis and push the belly forward — the opposite of the taper.'),
    ST('90/90 hip switch', '8 slow / side', 'Rotation, not just length. It is what makes a deep squat position available without the low back rounding.'),
    ST('Standing calf wall stretch', '45s / side', 'Ankles decide squat depth. Depth you cannot reach is depth you cannot train.'),
  ],
  Lower: [
    ST('Couch stretch', '60s / side', 'Same reason as Legs, and hip thrusts leave the flexors on the short side of the joint.'),
    ST('Seated hamstring floss', '10 slow / side', 'Moved, not held — after leg curls the hamstrings want length under control rather than a static pull.'),
    ST('Child’s pose with side reach', '45s / side', 'Lats and the side of the ribcage, which is where the day’s posterior work ends up tight.'),
  ],
  Push: [
    ST('Doorway pec stretch, three heights', '30s each', 'Bench and dips shorten the chest. A short chest rounds the shoulders forward and narrows the very line the taper is built on.'),
    ST('Thoracic extension over a roller', '8 slow breaths', 'The mid-back joint under treatment. Extension here is what lets the shoulders sit back instead of the low back arching to fake it.'),
    ST('Overhead lat stretch on a bench', '45s / side', 'Tight lats cap overhead reach, and pressing overhead with a capped reach is where the mid-back pays for it.'),
  ],
  Pull: [
    ST('Dead hang from the bar', '30s × 2', 'Decompresses after pulling, and it is free grip work. Stop early if the shoulders complain rather than pushing through.'),
    ST('Thread the needle', '8 slow / side', 'Thoracic ROTATION, the half that extension work misses. Directly the segment under chiropractic care.'),
    ST('Forearm and biceps stretch at a wall', '30s / side', 'Curls and pull-ups leave the elbow flexors short; a short biceps quietly limits how straight the arm hangs.'),
  ],
  Upper: [
    ST('Wall slides', '10 slow', 'Teaches the shoulder blade to travel while the ribs stay down. The rehearsal for every overhead press.'),
    ST('Thoracic extension over a roller', '8 slow breaths', 'Twice a cycle, because it is the segment being treated and once a fortnight is not a dose.'),
    ST('Levator and upper trap stretch', '30s / side', 'Lateral raises and shrugging under fatigue leave the neck doing the work. This is where a day-shift headache comes from.'),
  ],
  Rest: [
    ST('Cat–cow', '10 slow', 'Wakes the whole spine through its range with no load at all. The safest possible entry on a day off.'),
    ST('90/90 hip switch', '10 slow / side', 'Hips keep their rotation on the days you are not training them, or they do not have it on the days you are.'),
    ST('Deep squat hold, heels down', '60s', 'Ankles, knees and hips at end range at once. Hold a doorframe — this is a position to own, not a test to pass.'),
    ST('Dead hang', '30s × 2', 'Shoulders and spine under nothing but gravity. Two minutes of the week that pay for themselves.'),
  ],
};

/** What the block is FOR, shown once above the list. */
export const STRETCH_GOAL =
  'Shoulders wide, waist narrow, mid-back that moves. Five minutes at the '
  + 'end of the session while everything is still warm.';

/** The stretch block for a session code; rest days get the longer flow. */
export function stretchesFor(session) {
  return STRETCHES[session] || STRETCHES.Rest;
}

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

/**
 * Session-level calorie cycling.
 *
 * The day-type targets above set the baseline by SHIFT. This sets it by
 * SESSION on top: a leg day costs more than an upper day, and a rest
 * day costs least.
 *
 * ── The rule that makes this safe ────────────────────────────────────
 * It REDISTRIBUTES, it does not inflate. Over one 16-day cycle the
 * additions on the ten training days and the subtractions across the
 * six rest days cancel to zero, so the fortnightly average — and
 * therefore the deficit the whole recomposition depends on — is exactly
 * what the flat plan says it is. Adding calories to hard days without
 * taking them off easy ones is how a cut quietly becomes maintenance.
 *
 * `cycleCarbBalance()` proves it, and is asserted in the tests. If you
 * retune these numbers you must re-solve the rest-day figure or the
 * plan starts lying about its own deficit.
 *
 *   10 training days: Legs ×2, Lower ×2, Push ×2, Pull ×2, Upper ×2
 *    6 rest days, all of them `off` days
 *   (2×45 + 2×45 + 2×15 + 2×15 + 2×15) g = 270 g  ÷ 6 = 45 g per rest day
 *
 * ── Why carbs carry it ───────────────────────────────────────────────
 * Protein and fat are FLOORS. A floor that moves is not a floor, and
 * dropping protein on a rest day is the opposite of what a
 * recomposition wants. Carbs fuel the session, so the session is what
 * they track. Calories follow from the carbs at 4 kcal/g rather than
 * being set separately — one number to tune, and the two can't drift.
 */
export const KCAL_PER_CARB_G = 4;

export const SESSION_CARB_DELTA = {
  Legs:  45,   // the two biggest lower-body sessions
  Lower: 45,
  Push:  15,   // upper days
  Pull:  15,
  Upper: 15,
  Rest: -45,   // carries the whole redistribution
};

/** Sessions with no entry above (a hand-swapped Arms day, say) sit at baseline. */
export function carbDeltaFor(session) {
  return SESSION_CARB_DELTA[session] ?? 0;
}

/**
 * Targets for a specific day: shift baseline, then the session delta.
 *
 * @returns {{kcal,protein,fat,carbs,carbDelta,kcalDelta,session}}
 */
export function targetsForDay(dayType, session) {
  const base = targetsFor(dayType);
  const carbDelta = carbDeltaFor(session);
  const kcalDelta = carbDelta * KCAL_PER_CARB_G;
  return {
    ...base,
    carbs: base.carbs + carbDelta,
    kcal: base.kcal + kcalDelta,
    carbDelta,
    kcalDelta,
    session: session || null,
  };
}

/**
 * Net carb grams added across one full cycle. MUST be 0 — anything else
 * means the cycling has moved the average and the deficit with it.
 *
 * @param sessions the 16 session codes of one cycle, in order
 */
export function cycleCarbBalance(sessions) {
  return sessions.reduce((sum, s) => sum + carbDeltaFor(s), 0);
}

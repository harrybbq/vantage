/**
 * Muscle tags for lifts, shared by the workout logger (picker, set
 * table) and the session plan (plan.js infers which session a workout
 * was from what it trained). Pure.
 */

/** Muscle targets, in the order the picker lists them. */
export const MUSCLES = ['Shoulders', 'Back', 'Lower back', 'Chest', 'Abs', 'Triceps', 'Biceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves', 'Other'];

/**
 * Tags for every exercise in the programme (src/data/trainingProgramme.js):
 * each group its evidence-based part weights (adaptive.js EXERCISE_PARTS)
 * credit at 0.5 or more, strongest first. adaptive.test.mjs checks the two
 * stay in step, so change the weights there and these with them.
 */
export const PROGRAMME_MUSCLES = {
  '45° hyperextension': ['Lower back', 'Glutes', 'Hamstrings'],
  'Leg extension': ['Quads'],
  'Machine leg press': ['Quads', 'Glutes', 'Adductors'],
  'Standing calf raise': ['Calves'],
  'Walking dumbbell lunge': ['Quads', 'Glutes'],
  'Ab crunch machine': ['Abs'],
  'Dip': ['Chest', 'Triceps', 'Shoulders'],
  'Incline dumbbell press': ['Chest', 'Shoulders', 'Triceps'],
  'Machine shoulder press': ['Shoulders', 'Triceps'],
  'Dumbbell lateral raise': ['Shoulders'],
  'Single-arm cable triceps pushdown (cuff)': ['Triceps'],
  'Overhead cable bar extension': ['Triceps'],
  'Lat pulldown': ['Back', 'Biceps'],
  'Single-arm cable row': ['Back', 'Biceps'],
  'Cable bar pullover': ['Back'],
  'Cable archer pull (rear delt)': ['Shoulders', 'Back'],
  'Incline dumbbell curl, 21s': ['Biceps'],
  'Reverse EZ-bar curl': ['Biceps', 'Forearms'],
  'Hip thrust': ['Glutes'],
  'Seated leg curl': ['Hamstrings'],
  'Leg press, feet high': ['Glutes', 'Quads', 'Adductors'],
  'Reverse lunge': ['Quads', 'Glutes'],
  'Seated calf raise': ['Calves'],
  'Pallof press': ['Abs'],
  'Wide-grip cable row': ['Back', 'Shoulders', 'Biceps'],
};

// Keyword fallback for lifts the owner added by hand without tags.
const MUSCLE_WORDS = [
  [/leg\s*curl|hamstring|\brdl\b|romanian/i, 'Hamstrings'],
  [/calf/i, 'Calves'],
  [/hyperextension|back\s*extension/i, 'Lower back'],
  [/hip\s*thrust|glute/i, 'Glutes'],
  [/squat|leg\s*press|lunge|leg\s*extension/i, 'Quads'],
  [/^(?!.*leg\s*curl).*curl/i, 'Biceps'],
  [/hammer|reverse.*curl|wrist|forearm|farmer/i, 'Forearms'],
  [/adduct/i, 'Adductors'],
  [/tricep|pushdown|skull|^(?!.*(leg|back|hyper)).*extension/i, 'Triceps'],
  [/row|pulldown|pull-?\s*up|chin|pullover/i, 'Back'],
  [/bench|chest|fly|\bdips?\b|push-?\s*up/i, 'Chest'],
  [/shoulder|lateral|overhead\s*press|delt|arnold/i, 'Shoulders'],
  [/crunch|\babs?\b|plank|pallof|sit-?\s*up/i, 'Abs'],
];

export const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A lift's muscle tags: its own, else the programme's, else guessed from the name. */
export function musclesOf(lift) {
  if (!lift) return [];
  if (Array.isArray(lift.muscles) && lift.muscles.length) return lift.muscles;
  const p = Object.keys(PROGRAMME_MUSCLES).find(k => norm(k) === norm(lift.name));
  if (p) return PROGRAMME_MUSCLES[p];
  const out = [];
  for (const [re, m] of MUSCLE_WORDS) if (re.test(String(lift.name || '')) && !out.includes(m)) out.push(m);
  return out;
}

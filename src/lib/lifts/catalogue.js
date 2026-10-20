/**
 * Built-in exercises the picker offers beyond your own list.
 *
 * Picking one adds it to the workout as a PENDING exercise (the same
 * mechanism the programme uses): it only becomes a lift in your list when
 * a set of it is ticked, so browsing the library never fills the list
 * with things you didn't do. Ids are fixed (`cat-…`), so two devices that
 * create the same exercise create the same lift.
 *
 * Rep-based only: a lift records weight × reps, so timed holds (plank,
 * hollow hold) are left out rather than logged as fake reps.
 *
 * `load`: 'weight' (the number on the stack or bar), 'per_hand'
 * (dumbbells, kg per hand) or 'bodyweight_plus' (bodyweight, plus any
 * added weight — 0 is a bodyweight set). Muscles use MUSCLES' names.
 *
 * Names that the programme already uses (PROGRAMME_MUSCLES) are not
 * repeated here; catalogue.test checks that.
 *
 * Pure.
 */
import { norm } from './muscles.js';

const W = 'weight', H = 'per_hand', B = 'bodyweight_plus';

const RAW = [
  // Abs
  ['Captain’s chair knee raise', B, ['Abs']],
  ['Captain’s chair leg raise', B, ['Abs']],
  ['Hanging knee raise', B, ['Abs']],
  ['Hanging leg raise', B, ['Abs']],
  ['Toes to bar', B, ['Abs']],
  ['Cable crunch', W, ['Abs']],
  ['Decline sit-up', B, ['Abs']],
  ['Crunch', B, ['Abs']],
  ['Reverse crunch', B, ['Abs']],
  ['Bicycle crunch', B, ['Abs']],
  ['Lying leg raise', B, ['Abs']],
  ['Ab wheel rollout', B, ['Abs']],
  ['V-up', B, ['Abs']],
  ['Dead bug', B, ['Abs']],
  ['Russian twist', B, ['Abs']],
  ['Cable woodchop', W, ['Abs']],
  ['Dumbbell side bend', H, ['Abs']],
  ['Landmine rotation', W, ['Abs']],
  ['Rotary torso machine', W, ['Abs']],

  // Chest
  ['Barbell bench press', W, ['Chest', 'Triceps', 'Shoulders']],
  ['Incline barbell bench press', W, ['Chest', 'Shoulders', 'Triceps']],
  ['Decline bench press', W, ['Chest', 'Triceps']],
  ['Dumbbell bench press', H, ['Chest', 'Triceps', 'Shoulders']],
  ['Machine chest press', W, ['Chest', 'Triceps']],
  ['Smith machine incline press', W, ['Chest', 'Shoulders']],
  ['Pec deck', W, ['Chest']],
  ['Cable fly', W, ['Chest']],
  ['Dumbbell fly', H, ['Chest']],
  ['Push-up', B, ['Chest', 'Triceps']],

  // Back
  ['Pull-up', B, ['Back', 'Biceps']],
  ['Chin-up', B, ['Back', 'Biceps']],
  ['Barbell row', W, ['Back', 'Biceps']],
  ['Dumbbell row', H, ['Back', 'Biceps']],
  ['Seated cable row', W, ['Back', 'Biceps']],
  ['T-bar row', W, ['Back']],
  ['Chest-supported row machine', W, ['Back']],
  ['Straight-arm pulldown', W, ['Back']],
  ['Close-grip lat pulldown', W, ['Back', 'Biceps']],
  ['Deadlift', W, ['Back', 'Hamstrings', 'Glutes', 'Lower back']],
  ['Rack pull', W, ['Back', 'Lower back']],
  ['Barbell shrug', W, ['Back']],
  ['Dumbbell shrug', H, ['Back']],

  // Lower back
  ['Back extension', B, ['Lower back', 'Glutes']],
  ['Good morning', W, ['Lower back', 'Hamstrings']],

  // Shoulders
  ['Overhead barbell press', W, ['Shoulders', 'Triceps']],
  ['Seated dumbbell shoulder press', H, ['Shoulders', 'Triceps']],
  ['Arnold press', H, ['Shoulders']],
  ['Cable lateral raise', W, ['Shoulders']],
  ['Machine lateral raise', W, ['Shoulders']],
  ['Face pull', W, ['Shoulders', 'Back']],
  ['Reverse pec deck', W, ['Shoulders', 'Back']],
  ['Rear delt dumbbell fly', H, ['Shoulders']],
  ['Dumbbell front raise', H, ['Shoulders']],
  ['Upright row', W, ['Shoulders']],

  // Biceps
  ['Barbell curl', W, ['Biceps']],
  ['EZ-bar curl', W, ['Biceps']],
  ['Dumbbell curl', H, ['Biceps']],
  ['Hammer curl', H, ['Biceps']],
  ['Preacher curl', W, ['Biceps']],
  ['Cable curl', W, ['Biceps']],
  ['Concentration curl', H, ['Biceps']],

  // Triceps
  ['Rope triceps pushdown', W, ['Triceps']],
  ['Straight-bar triceps pushdown', W, ['Triceps']],
  ['Skull crusher', W, ['Triceps']],
  ['Close-grip bench press', W, ['Triceps', 'Chest']],
  ['Overhead dumbbell triceps extension', H, ['Triceps']],
  ['Triceps dip machine', W, ['Triceps', 'Chest']],
  ['Bench dip', B, ['Triceps']],

  // Legs
  ['Barbell back squat', W, ['Quads', 'Glutes']],
  ['Front squat', W, ['Quads', 'Glutes']],
  ['Hack squat', W, ['Quads', 'Glutes']],
  ['Smith machine squat', W, ['Quads', 'Glutes']],
  ['Goblet squat', W, ['Quads', 'Glutes']],
  ['Bulgarian split squat', H, ['Quads', 'Glutes']],
  ['Dumbbell step-up', H, ['Quads', 'Glutes']],
  ['Romanian deadlift', W, ['Hamstrings', 'Glutes', 'Lower back']],
  ['Dumbbell Romanian deadlift', H, ['Hamstrings', 'Glutes']],
  ['Lying leg curl', W, ['Hamstrings']],
  ['Nordic curl', B, ['Hamstrings']],
  ['Hip abduction machine', W, ['Glutes']],
  ['Hip adduction machine', W, ['Other']],
  ['Cable glute kickback', W, ['Glutes']],
  ['Glute bridge', W, ['Glutes', 'Hamstrings']],
  ['Leg press calf raise', W, ['Calves']],
];

const slug = name => norm(name).replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "Captain’s chair knee raise" → "cat-captains-chair-knee-raise". */
export const catId = name => `cat-${slug(name)}`;

export const CATALOGUE = Object.freeze(RAW.map(([name, load, muscles]) => Object.freeze({ id: catId(name), name, load, muscles: Object.freeze([...muscles]) })));

const BY_ID = new Map(CATALOGUE.map(c => [c.id, c]));

/** The catalogue entry for an id, or null. */
export const catalogueEntry = id => BY_ID.get(id) || null;

/** The pending descriptor a workout exercise carries for a catalogue pick. */
export function cataloguePending(id) {
  const c = catalogueEntry(id);
  return c ? { key: c.id, name: c.name, load: c.load, muscles: [...c.muscles] } : null;
}

/**
 * Catalogue entries to offer next to `list`: every one whose name isn't
 * already a lift there (archived ones count — that name is taken) or one of
 * `taken` (other names to hold back, e.g. pending exercises). Each comes
 * as a virtual lift marked `catalogue: true`.
 */
export function catalogueFor(list, taken = []) {
  const have = new Set([...(list || []).map(l => norm(l && l.name)), ...taken.map(norm)]);
  return CATALOGUE.filter(c => !have.has(norm(c.name)))
    .map(c => ({ id: c.id, name: c.name, load: c.load, muscles: [...c.muscles], catalogue: true }));
}

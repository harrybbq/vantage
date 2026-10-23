/**
 * Adaptive training (adaptive.js) and how the suggestion uses it
 * (workout.js suggestWorkout): Upper / Lower built from what the week
 * still owes, the missed-anchor catch-up, WHOOP red days, the week view,
 * self-adjusting targets, the tuned stretch block and readiness bands.
 * Weights and dates are invented — this file is public.
 * Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  PARTS, GROUP_OF, GROUPS, UPPER_GROUPS, LOWER_GROUPS, PRIORITY, EXERCISE_PARTS, partsOf, sessionParts,
  BASE_TARGETS, BASE_GROUP_TARGETS, sessionGroups, MIN_TARGET, weekTargets, readinessOn, RED_RPE_CAP, weekView, buildAdaptive, trimForRed, adaptStretches, MAX_HISTORY,
  MAX_EXERCISES, MAX_EXERCISES_WORST, FREQ_EXEMPT,
} from './adaptive.js';
import { suggestWorkout, suggestedStart, startWorkout, activeOf, progId, estimateMinutes } from './workout.js';
import { blockProgress } from './plan.js';
import { workoutLoad, sessionTargets as bmSessionTargets } from './bodymap.js';
import { shiftOn } from '../rotation/pattern.js';
import { PROGRAMME, STRETCHES } from '../../data/trainingProgramme.js';
import { PROGRAMME_MUSCLES } from './muscles.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};

// ── Fixture ───────────────────────────────────────────────────────
// Default rota: day block 2026-10-11 Push · 12 Pull · 13 Legs · 14 Upper ·
// 15 Off Lower · 16–18 rest; the block before (10-03…10-10) is a NIGHT block.
const B = { push: '2026-10-11', pull: '2026-10-12', legs: '2026-10-13', upper: '2026-10-14', lower: '2026-10-15', rest1: '2026-10-16' };
const CODES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower'];
const NAMES = [...new Set(Object.values(PROGRAMME).flat().map(x => x.name))];
// A working weight for every programme exercise (kg; Dip is added load).
const KG = {
  '45° hyperextension': 20, 'Leg extension': 60, 'Machine leg press': 180, 'Standing calf raise': 90, 'Walking dumbbell lunge': 20,
  'Ab crunch machine': 50, Dip: 20, 'Incline dumbbell press': 30, 'Machine shoulder press': 50, 'Dumbbell lateral raise': 12,
  'Single-arm cable triceps pushdown (cuff)': 15, 'Overhead cable bar extension': 30, 'Lat pulldown': 75, 'Single-arm cable row': 35,
  'Cable bar pullover': 30, 'Cable archer pull (rear delt)': 10, 'Incline dumbbell curl, 21s': 10, 'Reverse EZ-bar curl': 25,
  'Hip thrust': 140, 'Seated leg curl': 50, 'Leg press, feet high': 160, 'Reverse lunge': 20, 'Seated calf raise': 60,
  'Pallof press': 20, 'Wide-grip cable row': 60,
};
const OWN = [
  { id: 'own-cable-lat', name: 'Cable lateral raise', load: 'weight', unit: 'kg', muscles: ['Shoulders'] },
  { id: 'own-pullthrough', name: 'Cable pull-through', load: 'weight', unit: 'kg', muscles: ['Glutes', 'Hamstrings'] },
  { id: 'own-squat', name: 'Barbell back squat', load: 'weight', unit: 'kg', muscles: ['Quads'] },   // banned: never suggested
];
const LIST = [...NAMES.map(name => ({ id: progId(name), name, load: name === 'Dip' ? 'bodyweight_plus' : 'weight', unit: 'kg' })), ...OWN];
assert.ok(NAMES.every(nm => KG[nm] != null), 'a weight for every programme exercise');

let k = 0;
/**
 * A finished workout of `code` on `date`, as the programme writes it (optional
 * exercises left out). opts: scale (× every weight, or a function of the
 * name), skip [names], sets { name: n }, extra [{ liftId, sets, weight }].
 */
function W(date, code, opts = {}) {
  const night = !!(shiftOn({}, date) && shiftOn({}, date).shift === 'night');
  const scaleOf = nm => (typeof opts.scale === 'function' ? opts.scale(nm) : opts.scale || 1) * (night ? 0.8 : 1);
  const exercises = PROGRAMME[code].filter(x => !x.optional && !(opts.skip || []).includes(x.name)).map(x => ({
    liftId: progId(x.name),
    sets: Array.from({ length: (opts.sets && opts.sets[x.name]) ?? x.sets }, (_, i) => ({ id: `s${k}-${i}`, reps: 10 - Math.min(i, 2), weight: Math.round(KG[x.name] * scaleOf(x.name) * 2) / 2, done: true })),
  }));
  for (const e of opts.extra || []) exercises.push({ liftId: e.liftId, sets: Array.from({ length: e.sets }, () => ({ reps: 12, weight: e.weight, done: true })) });
  k++;
  return { id: `w${k}`, date, startedAt: k * 1000, finishedAt: k * 1000 + 600, durationSec: 3600, name: code, source: 'suggested', rotaSession: code, shift: night ? 'night' : 'day', gym: 'dxc', exercises };
}
/** All five sessions of the block starting `start`, on their rota days. */
const block = (start, opts = {}) => CODES.map((c, i) => W(addDays(start, i), c, opts));
function addDays(iso, d) { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); }
const blockStartBefore = iso => blockProgress({}, addDays(blockProgress({}, iso).start, -1)).start;
const B1 = blockStartBefore(B.push), B2 = blockStartBefore(B1), B3 = blockStartBefore(B2);
// Tracking started before this block (a Legs on the night block), so an empty training day here is MISSED.
const ANCHOR = () => W('2026-10-05', 'Legs');
const S_ = (sessions, extra = {}) => ({ lifts: { list: LIST, log: [], sessions: [ANCHOR(), ...sessions] }, ...extra });
const sum = xs => xs.reduce((a, x) => a + x.sets, 0);
const byName = (r, nm) => r.exercises.find(x => x.name === nm);
const writtenSets = code => PROGRAMME[code].filter(x => !x.optional).reduce((a, x) => a + x.sets, 0);
/** A built session as a finished workout, to read the week AFTER it. */
const asWorkout = (r, date, code) => ({ date, rotaSession: code, exercises: r.exercises.map(x => ({ liftId: x.liftId || progId(x.name), sets: Array.from({ length: x.sets }, () => ({ done: true })) })) });

// ── The maps ──────────────────────────────────────────────────────
t('parts: every programme exercise is mapped, every part rolls up to a known group', () => {
  for (const nm of NAMES) assert.ok(EXERCISE_PARTS[nm], `${nm} has parts`);
  for (const [, g] of PARTS) assert.ok(GROUPS.includes(g));
  for (const ps of Object.values(EXERCISE_PARTS)) for (const p of Object.keys(ps)) assert.ok(GROUP_OF[p], `${p} is a part`);
  assert.deepEqual([...UPPER_GROUPS, ...LOWER_GROUPS].sort(), [...GROUPS].sort(), 'Upper + Lower cover every group once');
  assert.equal(PRIORITY['Side delts'], 1.5);
  assert.deepEqual(partsOf({ name: 'cable LATERAL raise', muscles: ['Shoulders'] }), { 'Side delts': 1 }, 'an owner lift reads its part from its name');
  assert.deepEqual(partsOf({ name: 'Seated calf raise' }), { Soleus: 1 });
  assert.deepEqual(partsOf(null), {});
});
t('BASE_GROUP_TARGETS: the programme week by group, counted like the body map (optional work included)', () => {
  const nonOptional = {};
  for (const c of CODES) for (const [m, x] of Object.entries(bmSessionTargets(c))) nonOptional[m] = (nonOptional[m] || 0) + x;
  // Evidence-based weights (Oct 2026): a group takes its strongest part's weight per set.
  assert.deepEqual(nonOptional, { Chest: 11.5, Triceps: 13.25, Shoulders: 27.25, Back: 20, Biceps: 16, Forearms: 3, 'Lower back': 6, Glutes: 13.5, Hamstrings: 8.75, Quads: 14, Adductors: 4.25, Calves: 8, Abs: 6 });
  assert.deepEqual(BASE_GROUP_TARGETS, { ...nonOptional, Triceps: 15.5, Shoulders: 27.5, Hamstrings: 9, Quads: 17, Glutes: 15, Adductors: 5 },
    '+ overhead extension 2 triceps, walking lunge 3 quads / 1.5 glutes / 0.75 adductors; rounded to half sets');
  for (const g of GROUPS) assert.deepEqual(sessionGroups('Push')[g] || 0, bmSessionTargets('Push')[g] || 0, g);
});
t('BASE_TARGETS: the programme week, lower back twice (Legs 4 + Lower 2)', () => {
  assert.equal(BASE_TARGETS['Lower back'], 6);
  for (const [p, v] of Object.entries(BASE_TARGETS)) assert.equal(v * 2, Math.round(v * 2), `${p}: whole or half sets (${v})`);
  // Maeo 2023: pushdowns grow the long head too (0.5), overhead work grows the lateral/medial heads (1).
  assert.equal(BASE_TARGETS['Triceps long head'], 6, 'pushdowns 2 × 3 × 0.5 + the optional overhead 2 + pullover 3 × 0.25');
  assert.equal(BASE_TARGETS['Triceps lateral & medial'], 14.5);
  // Kinoshita 2026: the leg press doesn't grow rectus femoris; only the leg extension counts.
  assert.equal(BASE_TARGETS['Rectus femoris'], 3);
  assert.equal(BASE_TARGETS.Adductors, 5, 'leg press 2 + feet-high 1.5 + lunges 1.5');
  assert.equal(BASE_TARGETS.Forearms, 3, 'the reverse curl');
  assert.equal(BASE_TARGETS.Abs, 4, '3.75 → 4');
  assert.equal(BASE_TARGETS['Outer & inner quads'], 17, 'feet-high leg press now full for quads; the optional walking lunge included');
  assert.equal(BASE_TARGETS['Glute medius'], 1.5, 'two lunges × 0.25 × 3 = 1.5: right at MIN_TARGET');
  assert.ok(Object.values(BASE_TARGETS).every(v => v >= MIN_TARGET), 'nothing under MIN_TARGET has a target');
  assert.equal(sessionParts('Push')['Triceps long head'], 1.5, 'the pushdown’s long-head half (Maeo 2023); projections leave the optional overhead out');
  assert.equal(sessionParts('Push', { optional: true })['Triceps long head'], 1.5 + 2);
  assert.equal(BASE_TARGETS['Side delts'], 10.5, 'lateral raise 4 + 5, shoulder press 3 × 0.5');
  assert.equal(BASE_TARGETS.Lats, 15.5);
  assert.equal(sessionParts('Push')['Side delts'], 5.5);
  assert.equal(sessionParts('Legs')['Outer & inner quads'], 7, 'leg press 4 + leg extension 3 (vasti grow from it as much as from leg press, Kinoshita 2026) — the optional lunge is not owed');
});

// ── (g) Readiness ─────────────────────────────────────────────────
t('readinessOn: WHOOP bands — green ≥ 67, yellow 34–66, red ≤ 33; banded on the score shown', () => {
  const at = v => readinessOn({ vitalsLog: { [B.push]: { recovery: v, weight: 80 } } }, B.push);
  assert.deepEqual(at(72), { score: 72, band: 'green' });
  assert.equal(at(67).band, 'green');
  assert.equal(at(66).band, 'yellow');
  assert.equal(at(34).band, 'yellow');
  assert.deepEqual(at(33.5), { score: 34, band: 'yellow' }, 'shows 34 → reads yellow');
  assert.equal(at(33).band, 'red');
  assert.equal(at(0).band, 'red');
  assert.equal(at('55').band, 'yellow', 'a numeric string');
  assert.equal(at(null), null);
  assert.equal(at(150), null, 'nonsense is ignored');
  assert.equal(readinessOn({ vitalsLog: { [B.push]: { weight: 80 } } }, B.push), null, 'no recovery that day');
  assert.equal(readinessOn({}, B.push), null);
  assert.equal(readinessOn(null, 'nope'), null);
});

// ── (d) The week view ─────────────────────────────────────────────
t('weekView: shape, parts / groups / hits from the logged sets', () => {
  const S = S_([W(B.push, 'Push'), W(B.pull, 'Pull')]);
  const v = weekView(S, B.legs);
  assert.deepEqual(Object.keys(v).sort(), ['belowStandard', 'changes', 'end', 'groups', 'label', 'missed', 'parts', 'start'].sort());
  assert.equal(v.start, B.push);
  assert.equal(v.end, '2026-10-18');
  assert.equal(v.belowStandard, false);
  assert.deepEqual(v.missed, []);
  assert.deepEqual(v.changes, []);
  for (const p of v.parts) assert.deepEqual(Object.keys(p), ['part', 'group', 'done', 'target']);
  for (const g of v.groups) assert.deepEqual(Object.keys(g), ['group', 'done', 'target', 'hits', 'twiceAWeek']);
  const part = nm => v.parts.find(p => p.part === nm);
  const grp = nm => v.groups.find(g => g.group === nm);
  assert.deepEqual(part('Side delts'), { part: 'Side delts', group: 'Shoulders', done: 5.5, target: 10.5 });
  assert.equal(part('Lats').done, 10, 'pulldown 4 + row 3 + pullover 3');
  assert.equal(grp('Chest').done, 8.5, 'dip 4 + incline 3 + shoulder press 0.75 + pullover 0.75 (Muyor 2022)');
  assert.equal(grp('Chest').target, 11.5);
  assert.equal(grp('Chest').hits, 1);
  assert.equal(grp('Shoulders').hits, 2, 'Push, and the archer pull on Pull');
  assert.equal(grp('Quads').done, 0);
  assert.equal(grp('Quads').hits, 0);
  // Groups count the body map's way (first tag 1, others ½): the same numbers as This workout, added up.
  const sumLoads = {};
  for (const w of S.lifts.sessions.filter(w => w.date >= B.push && w.date <= B.legs)) for (const [m, x] of Object.entries(workoutLoad(w, LIST))) sumLoads[m] = (sumLoads[m] || 0) + x;
  for (const g of v.groups) assert.equal(g.done, Math.round((sumLoads[g.group] || 0) * 10) / 10, `${g.group} matches the body map`);
  assert.equal(grp('Shoulders').done, 15.3, 'shoulder press 3 + laterals 4 + dip 2 + incline 1.5 + archer 3 + rear delts from pulldown 1 and row 0.75 (Signorile 2002; Botton 2013)');
  assert.equal(grp('Shoulders').target, 27.5, 'not the parts’ sum (a press set is one shoulder set, not 1.5)');
  // the Finish sheet's unsaved workout is counted in
  const withLegs = weekView(S, B.legs, { extra: W(B.legs, 'Legs') });
  assert.equal(withLegs.groups.find(g => g.group === 'Quads').hits, 1);
  assert.equal(weekView(S, '2026-01-05'), null, 'outside the rota: null');
});
t('weekView: sessions before the first workout ever logged are counted from the programme', () => {
  const S = { lifts: { list: LIST, log: [], sessions: [W(B.legs, 'Legs')] } };
  const v = weekView(S, B.legs);
  const grp = nm => v.groups.find(g => g.group === nm);
  assert.equal(grp('Chest').done, 8.5, 'Push assumed: dip 4 + incline 3 + shoulder press 0.75; Pull assumed: pullover 0.75');
  assert.equal(grp('Chest').hits, 1);
  assert.equal(grp('Back').hits, 1, 'Pull assumed');
  assert.equal(grp('Quads').hits, 1, 'Legs logged');
  assert.equal(v.parts.find(p => p.part === 'Lats').done, 10);
});
t('weekView: a missed Push → below standard; finishing that Push later reclaims it, saved or not', () => {
  const v = weekView(S_([W(B.pull, 'Pull'), W(B.legs, 'Legs')]), B.upper);
  assert.deepEqual(v.missed, ['Push']);
  assert.equal(v.belowStandard, true);
  assert.equal(v.groups.find(g => g.group === 'Chest').hits, 0);
  // Push day passed empty, Pull logged; Push finished today on the Finish sheet (not saved yet).
  const S = S_([W(B.pull, 'Pull')]);
  assert.deepEqual(weekView(S, B.legs).missed, ['Push']);
  const live = W(B.legs, 'Push');
  const before = weekView(S, B.legs, { extra: live });
  assert.deepEqual(before.missed, [], 'the unsaved Push counts as Push');
  assert.equal(before.belowStandard, false);
  const saved = weekView({ ...S, lifts: { ...S.lifts, sessions: [...S.lifts.sessions, live] } }, B.legs);
  assert.deepEqual(saved.missed, [], 'same once saved');
  assert.deepEqual(before.groups, saved.groups, 'and the same numbers');
  // An unsaved Legs doesn't reclaim the missed Push.
  assert.deepEqual(weekView(S, B.legs, { extra: W(B.legs, 'Legs') }).missed, ['Push']);
});

// ── (a) P / P / L at 100 % → Upper ─────────────────────────────────
const PPL = () => S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs')]);
t('(a) Upper after Push, Pull and Legs on plan: the written Upper, every group’s second hit', () => {
  const S = PPL();
  const r = buildAdaptive(S, B.upper, 'Upper');
  assert.ok(r && r.exercises.length >= 5 && r.exercises.length <= MAX_EXERCISES);
  // Every pick is a programme exercise, and the written Upper's core is there.
  const programmeNames = new Set(Object.values(PROGRAMME).flat().map(x => x.name));
  assert.ok(r.exercises.every(x => programmeNames.has(x.name)), r.exercises.map(x => x.name).join(', '));
  for (const nm of ['Dip', 'Lat pulldown', 'Wide-grip cable row', 'Dumbbell lateral raise', 'Cable archer pull (rear delt)', 'Incline dumbbell curl, 21s']) assert.ok(byName(r, nm), nm);
  // Evidence (Maeo 2023, MRI): overhead extensions grow the long head AND the lateral/medial heads more
  // than pushdowns, so with long-head work owed the overhead extension covers the triceps on its own.
  assert.ok(byName(r, 'Overhead cable bar extension'), 'overhead extension for both triceps parts');
  assert.ok(!byName(r, 'Single-arm cable triceps pushdown (cuff)'), 'no second triceps isolation when one covers both');
  assert.ok(sum(r.exercises) <= writtenSets('Upper') + 2, `${sum(r.exercises)} sets vs ${writtenSets('Upper')} written`);
  const lat = byName(r, 'Dumbbell lateral raise');
  assert.equal(lat.sets, Math.max(...r.exercises.map(x => x.sets)), 'side delts carry the most sets (taper)');
  assert.match(lat.why, /taper priority/);
  assert.deepEqual(lat.tags[0], { kind: 'need', text: 'side delts 5.5 / 10.5' });
  // Compounds carry the second hits (owner, Oct 2026: "apply bias toward compound movements such as
  // dips"): the dip for chest and triceps, the wide-grip row for back and biceps.
  assert.equal(byName(r, 'Dip').why, 'second hit for chest and triceps');
  assert.equal(byName(r, 'Wide-grip cable row').why, 'second hit for back and biceps');
  assert.deepEqual(r.catchUp, []);
  assert.equal(r.belowStandard, false);
  assert.equal(r.readiness, null);
  assert.match(r.notes[0], /^Built for this week — second hits for /);
  // every upper group on the twice-a-week rule reaches two hits once it's done
  const after = weekView(S, B.upper, { extra: asWorkout(r, B.upper, 'Upper') });
  for (const g of UPPER_GROUPS.filter(g => !FREQ_EXEMPT.includes(g))) assert.ok(after.groups.find(x => x.group === g).hits >= 2, `${g}: two hits`);
  for (const x of r.exercises) assert.ok(x.sets >= 2 && x.sets <= 6, `${x.name}: ${x.sets} sets`);
});
t('(a) the build follows the week: short archer sets on Pull → more rear delts on Upper', () => {
  const S = S_([W(B.push, 'Push'), W(B.pull, 'Pull', { sets: { 'Cable archer pull (rear delt)': 1 } }), W(B.legs, 'Legs')]);
  const r = buildAdaptive(S, B.upper, 'Upper');
  assert.ok(byName(r, 'Cable archer pull (rear delt)').sets > 3, 'rear delts were left behind on Pull');
});
t('(a) an owner lift fills a gap the programme’s pick can’t, by liftId; a banned lift never does', () => {
  // Push without lateral raises; the owner has been doing cable laterals lately.
  const S = S_([W('2026-10-08', 'Upper', { extra: [{ liftId: 'own-cable-lat', sets: 3, weight: 7.5 }, { liftId: 'own-squat', sets: 3, weight: 100 }] }),
    W(B.push, 'Push', { skip: ['Dumbbell lateral raise'] }), W(B.pull, 'Pull'), W(B.legs, 'Legs')]);
  const r = buildAdaptive(S, B.upper, 'Upper');
  assert.equal(byName(r, 'Dumbbell lateral raise').sets, 5);
  const own = byName(r, 'Cable lateral raise');
  assert.ok(own, 'side delts still short after five sets');
  assert.equal(own.liftId, 'own-cable-lat');
  assert.ok(!r.exercises.some(x => /squat/i.test(x.name)));
  const sug = suggestWorkout(S, B.upper);
  const x = sug.exercises.find(e => e.name === 'Cable lateral raise');
  assert.equal(x.liftId, 'own-cable-lat');
  assert.equal(x.rows.length, x.sets);
});
t('(a) Lower after Legs: hyperextension gives lower back its second hit', () => {
  const S = S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs'), W(B.upper, 'Upper')]);
  const r = buildAdaptive(S, B.lower, 'Lower');
  const hyper = byName(r, '45° hyperextension');
  assert.equal(hyper.sets, 2);
  // A compound for two hits: hamstrings (0.5) and lower back (1). The feet-high leg press no longer
  // carries the hamstrings' hit — they grew only +3% from it (Kinoshita 2026), so it credits 0.25.
  assert.match(hyper.why, /second hit for hamstrings and lower back/);
  assert.deepEqual(hyper.tags[0], { kind: 'need', text: 'lower back 4 / 6' });
  // Compound first: the feet-high leg press gives quads, glutes and adductors their hit in one exercise.
  assert.match(byName(r, 'Leg press, feet high').why, /second hit for quads, glutes and adductors/);
  assert.ok(byName(r, 'Reverse lunge'), 'the written Reverse lunge is still in');
  // Legs skipped its optional walking lunge, which the week's target counts: Lower picks up a little of it.
  assert.ok(sum(r.exercises) - writtenSets('Lower') <= 4, `${sum(r.exercises)} sets vs ${writtenSets('Lower')} written`);
  const withLunge = buildAdaptive(S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs', { extra: [{ liftId: progId('Walking dumbbell lunge'), sets: 3, weight: 20 }] }), W(B.upper, 'Upper')]), B.lower, 'Lower');
  assert.ok(!withLunge.exercises.some(x => x.name === 'Walking dumbbell lunge'), 'Legs did its optional lunge → none on Lower');
  assert.ok(Math.abs(sum(withLunge.exercises) - writtenSets('Lower')) <= 2, `${sum(withLunge.exercises)} sets vs ${writtenSets('Lower')} written`);
  const after = weekView(S, B.lower, { extra: asWorkout(r, B.lower, 'Lower') });
  for (const g of LOWER_GROUPS) assert.ok(after.groups.find(x => x.group === g).hits >= 2, `${g}: two hits`);
});
t('buildAdaptive: null for an anchor, outside the rota, and before any workout is logged', () => {
  assert.equal(buildAdaptive(PPL(), B.push, 'Push'), null);
  assert.equal(buildAdaptive(PPL(), '2026-01-05', 'Upper'), null);
  assert.equal(buildAdaptive({ lifts: { list: LIST, log: [], sessions: [] } }, B.upper, 'Upper'), null, 'until the first workout the rota stands');
  assert.equal(buildAdaptive(PPL(), 'nope', 'Upper'), null);
});

// ── (b) Push missed ───────────────────────────────────────────────
t('(b) Push missed → Upper carries +1 set per group Push owed, tagged; not a mammoth', () => {
  const S = S_([W(B.pull, 'Pull'), W(B.legs, 'Legs')]);
  const r = buildAdaptive(S, B.upper, 'Upper');
  // On plan with Push's optional extension done (a missed Push forgives its whole share, optional included).
  const normal = buildAdaptive(S_([W(B.push, 'Push', { extra: [{ liftId: progId('Overhead cable bar extension'), sets: 2, weight: 30 }] }), W(B.pull, 'Pull'), W(B.legs, 'Legs')]), B.upper, 'Upper');
  assert.deepEqual(r.catchUp, ['Push']);
  assert.equal(r.belowStandard, true);
  assert.equal(r.catchUpSets, 3, 'chest, shoulders, triceps');
  assert.equal(r.missedSets, writtenSets('Push'));
  const plus = r.exercises.filter(x => x.tags.some(tg => tg.kind === 'plus'));
  assert.deepEqual(plus.map(x => x.name).sort(), ['Dip', 'Dumbbell lateral raise', 'Single-arm cable triceps pushdown (cuff)']);
  for (const x of plus) {
    assert.deepEqual(x.tags.find(tg => tg.kind === 'plus'), { kind: 'plus', text: '+1 Push' });
    assert.equal(x.sets, byName(normal, x.name).sets + 1, `${x.name}: one more than on plan`);
  }
  assert.equal(byName(r, 'Dumbbell lateral raise').sets, 6, 'the shoulders’ +1 lands on the taper lift');
  assert.equal(sum(r.exercises), sum(normal.exercises) + 3);
  assert.ok(sum(r.exercises) <= writtenSets('Upper') + 5, 'bounded');
  assert.equal(r.exercises.length, normal.exercises.length, 'no extra exercise');
  assert.match(r.notes.join(' '), /Push was missed this week — \+1 set for each muscle it owed/);
  // A missed Legs does the same to Lower.
  const L = buildAdaptive(S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.upper, 'Upper')]), B.lower, 'Lower');
  assert.deepEqual(L.catchUp, ['Legs']);
  assert.ok(L.catchUpSets >= 3);
  assert.ok(L.exercises.every(x => x.tags.filter(tg => tg.kind === 'plus').every(tg => tg.text === '+1 Legs')));
  // Push missed does not touch Lower.
  assert.deepEqual(buildAdaptive(S_([W(B.pull, 'Pull'), W(B.legs, 'Legs'), W(B.upper, 'Upper')]), B.lower, 'Lower').catchUp, []);
});
t('(b) suggestWorkout: the catch-up reaches the card and the started workout', () => {
  const S = S_([W(B.pull, 'Pull'), W(B.legs, 'Legs')]);
  const sug = suggestWorkout(S, B.upper);
  assert.equal(sug.name, 'Upper');
  assert.deepEqual(sug.adaptive.catchUp, ['Push']);
  assert.equal(sug.adaptive.belowStandard, true);
  assert.equal(sug.adaptive.catchUpSets, 3);
  assert.equal(sug.adaptive.built, true);
  const dip = sug.exercises.find(x => x.name === 'Dip');
  assert.equal(dip.sets, 4);
  assert.equal(dip.rows.length, 4);
  assert.ok(dip.tags.some(tg => tg.text === '+1 Push'));
  assert.equal(sug.minutes, estimateMinutes(sug.exercises));
  const next = startWorkout(S, { ...suggestedStart(sug), now: 1, today: B.upper, ids: (() => { let i = 0; return p => `${p}${++i}`; })() });
  const a = activeOf(next);
  assert.equal(a.exercises.find(e => e.liftId === progId('Dip')).sets.length, 4, 'the started workout has the adaptive sets');
  assert.equal(a.exercises.length, sug.exercises.length);
  assert.equal(a.rotaSession, 'Upper');
});

// ── (c) Red recovery ──────────────────────────────────────────────
t('(c) red on an anchor day: one set fewer each (min 1), RPE 7 cap, same exercises', () => {
  const S = S_([], { vitalsLog: { [B.push]: { recovery: 28 } } });
  const sug = suggestWorkout(S, B.push);
  assert.equal(sug.name, 'Push');
  assert.deepEqual(sug.exercises.map(x => x.name), PROGRAMME.Push.map(x => x.name));
  sug.exercises.forEach((x, i) => {
    const want = PROGRAMME.Push[i].sets;
    assert.equal(x.sets, Math.max(1, want - 1), x.name);
    assert.equal(x.setsWas, want);
    assert.equal(x.rpeCap, RED_RPE_CAP);
    assert.equal(x.rows.length, x.sets);
    assert.deepEqual(x.tags, [{ kind: 'red', text: '≤ RPE 7' }]);
  });
  assert.deepEqual(sug.adaptive.readiness, { score: 28, band: 'red' });
  assert.equal(sug.adaptive.red, true);
  assert.match(sug.adaptive.notes[0], /WHOOP Recovery 28% · red/);
  assert.ok(sug.minutes < suggestWorkout(S_([]), B.push).minutes, 'shorter');
  assert.deepEqual(trimForRed([{ name: 'x', sets: 1 }])[0], { name: 'x', sets: 1, setsWas: 1, rpeCap: 7 }, 'never below one');
  // green and yellow change nothing; no recovery plans as normal
  for (const rec of [80, 50, undefined]) {
    const s = suggestWorkout(S_([], { vitalsLog: { [B.push]: { recovery: rec } } }), B.push);
    assert.ok(s.exercises.every((x, i) => x.sets === PROGRAMME.Push[i].sets && x.setsWas == null && x.rpeCap == null), `recovery ${rec}`);
  }
  // a red night still scales the load
  const NP = '2026-10-19';
  const night = suggestWorkout({ lifts: { list: LIST, log: [{ id: 'l1', liftId: progId('Dip'), date: B.push, weight: 20, reps: 8, gym: 'dxc', createdAt: 1 }], sessions: [ANCHOR()] }, vitalsLog: { [NP]: { recovery: 20 } } }, NP, { gym: 'dxc' });
  assert.equal(night.night, true);
  assert.equal(night.exercises[0].weight, 15, '20 × 0.8 = 16 → 15 (2.5 kg steps)');
  assert.equal(night.exercises[0].sets, 3);
});
t('(c) red on Upper: only what twice-a-week needs, two sets each', () => {
  const S = { ...PPL(), vitalsLog: { [B.upper]: { recovery: 22 } } };
  const r = buildAdaptive(S, B.upper, 'Upper');
  assert.ok(r.exercises.every(x => x.sets === 2));
  assert.ok(r.exercises.every(x => /second hit/.test(x.why)), 'nothing but second hits');
  // Four groups owe a second hit (shoulders already had two: Push, archer on Pull). The triceps'
  // hit is shared between compounds (dip + shoulder press, a half-credit set each) rather than
  // costing a separate exercise.
  assert.equal(r.exercises.length, 4);
  const after = weekView(S, B.upper, { extra: asWorkout(r, B.upper, 'Upper') });
  for (const g of UPPER_GROUPS.filter(g => !FREQ_EXEMPT.includes(g))) assert.ok(after.groups.find(x => x.group === g).hits >= 2, `${g}: two hits`);
  assert.ok(sum(r.exercises) <= 10);
  assert.match(r.notes[0], /WHOOP Recovery 22% · red — trimmed/);
  // a red Upper after a missed Push still carries no catch-up
  const M = buildAdaptive({ ...S_([W(B.pull, 'Pull'), W(B.legs, 'Legs')]), vitalsLog: { [B.upper]: { recovery: 10 } } }, B.upper, 'Upper');
  assert.equal(M.catchUpSets, 0);
  assert.equal(M.belowStandard, true);
  const sug = suggestWorkout(S, B.upper);
  assert.ok(sug.exercises.every(x => x.rpeCap == null), 'Upper / Lower are trimmed, not capped');
});

// ── (e) Self-adjusting targets ────────────────────────────────────
t('(e) two full weeks with the main lift rising → +1, with the reason', () => {
  // B2 (day) and B1 (night, 80 % loads) at 100 %, lifts up ~3 % a week.
  const S = { lifts: { list: LIST, log: [], sessions: [...block(B2, { scale: 1 }), ...block(B1, { scale: 1.03 })] } };
  const { targets, changes } = weekTargets(S, B.push);
  const ch = p => changes.find(c => c.part === p);
  assert.equal(targets.Lats, 16.5);
  assert.deepEqual(ch('Lats'), { part: 'Lats', from: 15.5, to: 16.5, why: '100% two weeks running, lat pulldown e1RM up 100 kg → 103.5 kg' });
  // The optional overhead extension now counts toward lateral & medial as well (Maeo 2023), so a week
  // without it isn't full for them either.
  assert.equal(ch('Triceps lateral & medial'), undefined, 'the optional overhead extension counts for them too now');
  assert.equal(ch('Abs').to, 5, 'Abs 3.75 → 4, same');
  assert.equal(ch('Glute medius'), undefined, 'parts under two sets a week are left alone');
  assert.equal(ch('Triceps long head'), undefined, 'the optional extension was never done: not full');
  assert.equal(ch('Outer & inner quads'), undefined, 'nor the optional lunge');
  assert.ok(changes.every(c => c.to === c.from + 1));
  // The week view carries the raised target and the changes.
  const v = weekView(S, B.push);
  assert.equal(v.parts.find(p => p.part === 'Lats').target, 16.5);
  assert.ok(v.changes.some(c => c.part === 'Side delts'));
  const backMoved = changes.filter(c => GROUP_OF[c.part] === 'Back').reduce((a, c) => a + c.to - c.from, 0);
  assert.ok(backMoved > 0);
  assert.equal(v.groups.find(g => g.group === 'Back').target, BASE_GROUP_TARGETS.Back + backMoved, 'a part’s +1 moves its group’s target too');
  // One full week is not enough.
  assert.deepEqual(weekTargets({ lifts: { list: LIST, log: [], sessions: block(B1) } }, B.push).changes, []);
});
t('(e) a night week at 80 % loads is not read as a drop; a real drop two weeks running → −1', () => {
  // B3 night, B2 day, B1 night: pulldown 75 → 71 → 67 (real loads before the 80 %).
  const down = { 'Lat pulldown': [1, 0.95, 0.9] };
  const mk = (start, i) => block(start, { scale: nm => (down[nm] ? down[nm][i] : 1 + i * 0.02) });
  const S = { lifts: { list: LIST, log: [], sessions: [...mk(B3, 0), ...mk(B2, 1), ...mk(B1, 2)] } };
  const { targets, changes } = weekTargets(S, B.push);
  const lats = changes.find(c => c.part === 'Lats');
  assert.equal(lats.from, 15.5);
  assert.equal(lats.to, 14.5);
  assert.match(lats.why, /^lat pulldown dropped two weeks running \(e1RM \d+(\.5)? kg → \d+(\.5)? kg\)$/);
  assert.equal(targets.Lats, 14.5);
  // Side delts went up two full weeks running in B2 (+1), so B1 was below the raised target: no further change.
  assert.equal(targets['Side delts'], 11.5);
  assert.equal(changes.find(c => c.part === 'Side delts'), undefined);
  // floor: never under 0.7 × base
  assert.ok(Object.entries(targets).every(([p, v]) => v >= Math.round(BASE_TARGETS[p] * 0.7 * 10) / 10 - 1e-9));
});
t('(e) weekTargets: memoised; ~400 sessions of history stays fast', () => {
  // A year and more of older history before the rota started, then every block since 15 Jul at 100 %.
  const sessions = [];
  for (let i = 0; i < 340; i++) sessions.push(W(addDays('2025-06-01', i), CODES[i % 5]));
  let s = blockProgress({}, '2026-07-20').start;
  while (s < B.push) { sessions.push(...block(s, { scale: 1 + sessions.length / 4000 })); s = addDays(blockProgress({}, s).end, 1); }
  assert.ok(sessions.length >= 395, `${sessions.length} sessions`);
  const S = { lifts: { list: LIST, log: [], sessions } };
  weekTargets({ lifts: { list: LIST, log: [], sessions: sessions.slice() } }, B.push);   // warm the JIT
  const t0 = performance.now();
  const a = weekTargets(S, B.push);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  const b = weekTargets(S, B.push);
  const warm = performance.now() - t1;
  assert.equal(a, b, 'the same object from the memo');
  assert.ok(cold < 50, `cold ${cold.toFixed(1)} ms`);
  assert.ok(warm < 1, `memo ${warm.toFixed(2)} ms`);
  assert.ok(MAX_HISTORY >= 8 && MAX_HISTORY <= 52);
  const t2 = performance.now();
  const sug = suggestWorkout({ ...S, lifts: { ...S.lifts, sessions: [...sessions, W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs')] } }, B.upper);
  const full = performance.now() - t2;
  assert.equal(sug.name, 'Upper');
  // Months at 100 % have raised targets (half-set parts included): sets stay whole.
  const lower = buildAdaptive({ ...S, lifts: { ...S.lifts, sessions: [...sessions, ...block(B.push).slice(0, 4)] } }, B.lower, 'Lower');
  for (const r of [sug, lower]) for (const x of r.exercises) assert.ok(Number.isInteger(x.sets) && x.sets >= 2, `${x.name}: ${x.sets} sets`);
  assert.ok(full < 150,`suggestWorkout cold with 400 sessions: ${full.toFixed(1)} ms`);
});

// ── (f) Stretches ─────────────────────────────────────────────────
const thoracic = xs => xs.some(x => /thoracic|thread the needle/i.test(x.name));
t('(f) thoracic is always in, whatever the session or the day', () => {
  const Ss = [S_([]), PPL(), { ...PPL(), vitalsLog: { [B.upper]: { recovery: 10 }, [B.legs]: { recovery: 10 }, [B.lower]: { recovery: 10 }, [B.push]: { recovery: 10 }, [B.pull]: { recovery: 10 }, [B.rest1]: { recovery: 10 } } }];
  for (const S of Ss) for (const [code, day] of [['Push', B.push], ['Pull', B.pull], ['Legs', B.legs], ['Upper', B.upper], ['Lower', B.lower], ['Rest', B.rest1]]) {
    const xs = adaptStretches(S, day, code, STRETCHES);
    assert.ok(thoracic(xs), `${code}: thoracic`);
    assert.ok(xs.length >= 3 && xs.length <= 7, `${code}: ${xs.length} moves`);
    assert.equal(new Set(xs.map(x => x.name)).size, xs.length, 'no duplicates');
  }
  const legs = adaptStretches(S_([]), B.legs, 'Legs', STRETCHES);
  assert.equal(legs.find(x => /thoracic/i.test(x.name)).added, 'mid-back, every session');
});
t('(f) press-heavy → pecs on Upper; leg-heavy → hips on Lower; red → the longer flow', () => {
  const up = adaptStretches(PPL(), B.upper, 'Upper', STRETCHES);
  assert.equal(up.find(x => /doorway pec/i.test(x.name))?.added, 'press-heavy week');
  assert.ok(up.length <= 5);
  const lo = adaptStretches(S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs'), W(B.upper, 'Upper')]), B.lower, 'Lower', STRETCHES);
  assert.equal(lo.find(x => /90\/90/.test(x.name))?.added, 'leg-heavy week');
  assert.ok(!lo.some(x => /doorway pec/i.test(x.name)), 'Lower takes the hips first, and the block stays at five');
  // Nothing loaded yet this week → nothing added but thoracic.
  const early = adaptStretches({ lifts: { list: LIST, log: [], sessions: [W('2026-10-06', 'Upper')] } }, B.push, 'Push', STRETCHES);
  assert.deepEqual(early.map(x => x.name), STRETCHES.Push.map(x => x.name), 'Push already has pecs and thoracic');
  // Red: the rest-day flow on top, up to seven; "Dead hang" not twice on a Pull day.
  const red = adaptStretches({ ...PPL(), vitalsLog: { [B.pull]: { recovery: 25 } } }, B.pull, 'Pull', STRETCHES);
  assert.ok(red.length > STRETCHES.Pull.length && red.length <= 7);
  assert.ok(red.some(x => x.added === 'red day'));
  assert.equal(red.filter(x => /dead hang/i.test(x.name)).length, 1);
  const green = adaptStretches({ ...PPL(), vitalsLog: { [B.pull]: { recovery: 80 } } }, B.pull, 'Pull', STRETCHES);
  assert.ok(!green.some(x => x.added === 'red day'));
});

// ── The evidence-based map stays well-formed and in step with the tags ──
t('EXERCISE_PARTS: known parts, weights 1 / 0.5 / 0.25, and muscles.js tags derived from them', () => {
  const partNames = new Set(PARTS.map(p => p[0]));
  for (const [name, parts] of Object.entries(EXERCISE_PARTS)) {
    for (const [p, w] of Object.entries(parts)) {
      assert.ok(partNames.has(p), `${name}: unknown part ${p}`);
      assert.ok([1, 0.5, 0.25].includes(w), `${name}: ${p} ${w}`);
    }
    assert.equal(Object.values(parts)[0], Math.max(...Object.values(parts)), `${name}: main part first`);
    // Tags = the groups credited at 0.5 or more, strongest first (ties in map order).
    const g = {};
    for (const [p, w] of Object.entries(parts)) { const gg = GROUP_OF[p]; g[gg] = Math.max(g[gg] || 0, w); }
    const want = Object.entries(g).filter(([, w]) => w >= 0.5).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    assert.deepEqual(PROGRAMME_MUSCLES[name], want, `${name}: muscles.js tags`);
  }
  assert.equal(Object.keys(EXERCISE_PARTS).length, NAMES.length, 'every programme exercise is mapped');
});

// ── (f) Shift-length sessions: the exercise cap and the compound bias ───
// Owner, Oct 2026: "say I miss a few muscle groups then I get to Upper, it should not have 12
// exercises waiting for me, instead apply bias toward compound movements such as dips … cap it at
// 8 exercises, maybe 9 in worst case."
t('(f) the cap: 8, 9 only in the worst case', () => {
  assert.equal(MAX_EXERCISES, 8);
  assert.equal(MAX_EXERCISES_WORST, 9);
});
t('(f) Push missed: compounds carry the second hits — the dip for chest and triceps, a row for shoulders', () => {
  const r = buildAdaptive(S_([W(B.pull, 'Pull'), W(B.legs, 'Legs')]), B.upper, 'Upper');
  assert.match(byName(r, 'Dip').why, /second hit for chest and triceps/);
  assert.ok(byName(r, 'Dip').sets >= 4, 'enough dip sets that triceps (half credit) reach their hit');
  const multi = r.exercises.filter(x => /second hit for \w+(, \w+)* and \w+/.test(x.why));
  assert.ok(multi.length >= 2, `compound hits: ${multi.map(x => `${x.name} (${x.why})`).join('; ')}`);
  assert.ok(multi.some(x => /shoulders/.test(x.why)), 'the shoulders’ hit rides on a compound too');
  assert.ok(r.exercises.length <= MAX_EXERCISES);
});
t('(f) Push and Pull missed: Pull’s shoulder catch-up lands on rear delts, not the lateral raise', () => {
  const r = buildAdaptive(S_([W(B.legs, 'Legs')]), B.upper, 'Upper');
  assert.deepEqual(r.catchUp, ['Push', 'Pull']);
  assert.ok(byName(r, 'Cable archer pull (rear delt)').tags.some(tg => tg.text === '+1 Pull'));
  assert.ok(r.exercises.every(x => x.sets <= 6), r.exercises.map(x => `${x.name} ${x.sets}`).join(', '));
  assert.ok(r.exercises.length <= MAX_EXERCISES);
});
t('(f) half-done Push and Pull: the cap holds and the rest goes on as extra sets', () => {
  const r = buildAdaptive(S_([
    W(B.push, 'Push', { skip: ['Dip', 'Machine shoulder press', 'Single-arm cable triceps pushdown (cuff)'] }),
    W(B.pull, 'Pull', { skip: ['Lat pulldown', 'Incline dumbbell curl, 21s', 'Cable archer pull (rear delt)'] }),
    W(B.legs, 'Legs')]), B.upper, 'Upper');
  assert.equal(r.exercises.length, MAX_EXERCISES);
  // The cap pushes work into sets, not more exercises: every pick is near its ceiling (4, or 5 for taper parts).
  assert.ok(r.exercises.every(x => x.sets >= 4), r.exercises.map(x => `${x.name} ${x.sets}`).join(', '));
  // Any set added past the cap is said out loud.
  for (const x of r.exercises) if (/to keep it to/.test(x.why)) assert.match(x.why, /\+\d+ to keep it to 8 exercises/);
});
t('(f) stress: no built session over 9 exercises or 6 sets an exercise, every group still hit', () => {
  // Every combination of whole anchors missed, and of half the exercises skipped on each, on both sessions.
  let seen = 0, max = 0;
  for (let mask = 0; mask < 64; mask++) {
    const sessions = [];
    for (const [i, code] of ['Push', 'Pull', 'Legs'].entries()) {
      const missed = mask & (1 << i);
      const half = mask & (1 << (i + 3));
      if (missed) continue;
      const names = PROGRAMME[code].filter(x => !x.optional).map(x => x.name);
      sessions.push(W(B[code.toLowerCase()], code, half ? { skip: names.filter((_, j) => j % 2 === 0) } : {}));
    }
    for (const [session, day] of [['Upper', B.upper], ['Lower', B.lower]]) {
      const ss = session === 'Lower' ? [...sessions, W(B.upper, 'Upper')] : sessions;
      for (const vitalsLog of [{}, { [day]: { recovery: 20 } }]) {
        const r = buildAdaptive(S_(ss, { vitalsLog }), day, session);
        if (!r) continue;
        seen++;
        max = Math.max(max, r.exercises.length);
        const label = `${session} mask=${mask} red=${!!vitalsLog[day]}`;
        assert.ok(r.exercises.length <= MAX_EXERCISES_WORST, `${label}: ${r.exercises.length} exercises`);
        assert.ok(r.exercises.every(x => x.sets <= 6), `${label}: ${r.exercises.map(x => `${x.name} ${x.sets}`).join(', ')}`);
        // Every group still short of two hits gets one from this session (with an anchor
        // missed, two may no longer be possible — the week is below standard, as agreed).
        const groups = session === 'Upper' ? UPPER_GROUPS : LOWER_GROUPS;
        const before = weekView(S_(ss, { vitalsLog }), day);
        const after = weekView(S_(ss, { vitalsLog }), day, { extra: asWorkout(r, day, session) });
        for (const g of groups.filter(g => !FREQ_EXEMPT.includes(g))) {
          const b = before.groups.find(x => x.group === g).hits, a = after.groups.find(x => x.group === g).hits;
          if (b < 2) assert.ok(a >= b + 1, `${label}: ${g} hit (${b} → ${a})`);
        }
      }
    }
  }
  assert.ok(seen >= 200, `${seen} builds checked`);
  assert.ok(max <= MAX_EXERCISES_WORST);
});

console.log(`adaptive: ${n} tests passed`);

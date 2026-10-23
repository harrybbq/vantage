/**
 * The workout logger: today's suggestion per rota session (night 80%,
 * rest days, leave, off-pattern), Previous lookup, the active workout's
 * edits, Finish writing the log once (and only once), Discard writing
 * nothing, JSON round trips, volume, real-set session PBs, templates,
 * and the Track auto-fill picking up a finished workout.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  suggestWorkout, suggestedStart, previousSets, prevText, planFor, parseReps, roundTo, guessLoad, progId, musclesOf,
  estimateMinutes, weekStrip, workoutsThisWeek, activeOf, startWorkout, addExercises, addSet, updateSet, toggleDone,
  setProblem, removeSet, removeExercise, swapExercise, setNote, renameWorkout,
  discardWorkout, volume, volumeText, sessionPBs, summariseWorkout, finishWorkout, PROGRAMME_TEMPLATES, templatesOf,
  templateFromSession, saveTemplate, deleteTemplate, templateStart, recentWorkouts, repeatStart, hasSessionOn,
  elapsedSec, clock, minutesText, MAX_SESSIONS, MUSCLES, PROGRAMME_MUSCLES, fillEmptyWorkout,
  exerciseLift, listWithPending, previousSession, setSetType, liftFromPending, RPE_STEPS,
  setWorkoutShift, markPbToasted, insertSet, insertExercise, nextOpenSet,
  planProgress, miniBarModel, livePbSets, nightComparison, estimateRise,
} from './workout.js';
import { pbTimeline, personalBests } from './lifts.js';
import { CATALOGUE, catId, catalogueFor, catalogueEntry } from './catalogue.js';
import { LOAD_TYPES } from './lifts.js';
import { proposeAutoLogs, applyAutoLogs } from '../trackers/autoLog.js';
import { PROGRAMME, SESSION_CODES } from '../../data/trainingProgramme.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
let idn = 0;
const ids = p => `${p}_${++idn}`;

// Rota (default pattern): 2026-10-11..14 Day 1–4 (Push Pull Legs Upper),
// 10-15 Off · Lower, 10-16..18 Rest, 10-19..22 Night 1–4, 10-23 Off · Lower.
const LEGS_DAY = '2026-10-13', LEGS_NIGHT = '2026-10-21', REST = '2026-10-17', PULL_NIGHT = '2026-10-20';

const LIST = [
  { id: 'seed-leg-press', name: 'Machine leg press', load: 'weight', unit: 'kg', createdAt: 0 },
  { id: 'seed-dip', name: 'Dip', load: 'bodyweight_plus', unit: 'kg', createdAt: 0 },
  { id: 'seed-incline-db-press', name: 'Incline dumbbell press', load: 'per_hand', unit: 'kg', createdAt: 0 },
  { id: 'seed-lat-pulldown', name: 'Lat pulldown', load: 'weight', unit: 'kg', createdAt: 0 },
  { id: 'bench', name: 'Bench press', load: 'weight', unit: 'kg', createdAt: 0 },
];
let c = 0;
// Every set in the fixture is at DXC (the default gym), so the machine lifts' history is in scope.
const e = (liftId, date, weight, reps, extra = {}) => ({ id: `e${++c}`, liftId, date, weight, reps, createdAt: ++c, gym: 'dxc', ...extra });
const LOG = [
  // a finished workout on a day shift: 3 sets of leg press
  e('seed-leg-press', '2026-10-05', 170, 10, { sessionId: 'old1' }), e('seed-leg-press', '2026-10-05', 180, 8, { sessionId: 'old1' }), e('seed-leg-press', '2026-10-05', 180, 7, { sessionId: 'old1' }),
  // a lighter night session after it — must not be the base for the next suggestion
  e('seed-leg-press', '2026-10-08', 145, 8, { sessionId: 'old2', shift: 'night' }), e('seed-leg-press', '2026-10-08', 145, 8, { sessionId: 'old2', shift: 'night' }),
  // quick-logged sets (no session): grouped by date
  e('seed-dip', '2026-10-02', 15, 8), e('seed-dip', '2026-10-02', 20, 6),
  e('seed-lat-pulldown', '2026-10-01', 70, 10, { shift: 'night' }),
];
const SESSIONS = [
  { id: 'old1', date: '2026-10-05', startedAt: 1, finishedAt: 100, durationSec: 3000, name: 'Legs', source: 'suggested', rotaSession: 'Legs', shift: 'day', gym: 'dxc',
    exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 10, weight: 170, done: true }, { reps: 8, weight: 180, done: true }, { reps: 7, weight: 180, done: true }] }] },
  { id: 'old2', date: '2026-10-08', startedAt: 200, finishedAt: 300, durationSec: 2400, name: 'Legs', source: 'suggested', rotaSession: 'Legs', shift: 'night', gym: 'dxc',
    exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 8, weight: 145, done: true }, { reps: 8, weight: 145, done: true }] }] },
];
const base = () => ({
  habits: [{ id: 'h1' }], vitalsLog: { '2026-10-01': { weight: 82 } }, trackers: [], logs: {}, logsAuto: {}, streaks: {}, burnLog: {},
  lifts: { list: LIST.map(l => ({ ...l })), log: LOG.map(x => ({ ...x })), sessions: SESSIONS.map(s => JSON.parse(JSON.stringify(s))) },
});

// ── Small helpers ──
t('parseReps / roundTo / guessLoad / progId', () => {
  assert.equal(parseReps('8–12'), 8);
  assert.equal(parseReps('7 + 7 + 7'), 21);
  assert.equal(parseReps('10 per leg'), 10);
  assert.equal(parseReps('15'), 15);
  assert.equal(parseReps(''), null);
  assert.equal(roundTo(180 * 0.8), 145, '144 → nearest 2.5 is 145');
  assert.equal(roundTo(20 * 0.8), 15);
  assert.equal(roundTo(71), 70);
  assert.equal(guessLoad('Dip'), 'bodyweight_plus');
  assert.equal(guessLoad('Walking dumbbell lunge'), 'per_hand');
  assert.equal(guessLoad('Leg extension'), 'weight');
  assert.equal(progId('Incline dumbbell curl, 21s'), 'prog-incline-dumbbell-curl-21s');
  assert.equal(progId('45° hyperextension'), 'prog-45-hyperextension');
});
t('muscle tags: every programme exercise is mapped, all from the picker list', () => {
  for (const list of Object.values(PROGRAMME)) for (const x of list) {
    assert.ok(PROGRAMME_MUSCLES[x.name], `${x.name} has muscles`);
    for (const m of PROGRAMME_MUSCLES[x.name]) assert.ok(MUSCLES.includes(m), `${m} is a picker muscle`);
  }
  assert.deepEqual(musclesOf({ name: 'Machine leg press' }), ['Quads', 'Glutes', 'Adductors'], 'the programme map for a seed lift (adductors: Kinoshita 2026)');
  assert.deepEqual(musclesOf({ name: 'Hammer curl' }), ['Biceps', 'Forearms'], 'guessed: hammer curls train the brachioradialis');
  assert.ok(!musclesOf({ name: 'Close-grip bench press' }).includes('Forearms'), 'close-grip is not a forearm cue');
  assert.deepEqual(musclesOf({ name: 'Bench press' }), ['Chest'], 'guessed from the name');
  assert.deepEqual(musclesOf({ name: 'Seated leg curl X' }), ['Hamstrings'], 'a leg curl is not a biceps curl');
  assert.deepEqual(musclesOf({ name: 'Thing', muscles: ['Other'] }), ['Other'], 'own tags win');
});

// ── Previous ──
t('previousSets: the last time the lift was trained, by session, else by date', () => {
  const S = base();
  const p = previousSets(S, 'seed-leg-press');
  assert.equal(p.sessionId, 'old2');
  assert.deepEqual(p.sets.map(s => [s.weight, s.reps]), [[145, 8], [145, 8]]);
  const d = previousSets(S, 'seed-leg-press', { skipNight: true });
  assert.equal(d.sessionId, 'old1', 'skipNight: the last day-shift workout');
  assert.deepEqual(d.sets.map(s => [s.weight, s.reps]), [[170, 10], [180, 8], [180, 7]], 'in the order they were lifted');
  const q = previousSets(S, 'seed-dip');
  assert.equal(q.sessionId, null);
  assert.deepEqual(q.sets.map(s => s.weight), [15, 20], 'quick-logged sets on one date are one time');
  assert.equal(previousSets(S, 'bench'), null);
  assert.equal(previousSets({}, 'x'), null, 'no store at all');
  assert.equal(prevText({ reps: 8, weight: 180 }, LIST[0]), '180×8');
  assert.equal(prevText({ reps: 6, weight: 20 }, LIST[1]), 'BW+20×6');
  assert.equal(prevText({ reps: 8, weight: 0 }, LIST[1]), 'BW×8');
  assert.equal(prevText(null, LIST[0]), '—');
});

// ── Suggested workout ──
// The suggestion follows the session PLAN (plan.js): missed sessions in a
// block carry forward once workouts are being logged. These tests check
// the programme mapping itself, so they use the same log with no
// finished workouts — the plan is then exactly the rota. (plan.test.mjs
// covers the plan moving.)
const noHistory = () => { const S = base(); S.lifts.sessions = []; return S; };
t('suggestion: Legs on a day shift — the programme, last day weights', () => {
  const S = noHistory();
  const s = suggestWorkout(S, LEGS_DAY);
  assert.equal(s.restDay, false);
  assert.equal(s.name, 'Legs');
  assert.equal(s.rotaSession, 'Legs');
  assert.equal(s.shift, 'day');
  assert.equal(s.night, false);
  assert.equal(s.exercises.length, PROGRAMME.Legs.length);
  assert.deepEqual(s.exercises.map(x => x.name), PROGRAMME.Legs.map(x => x.name));
  const lp = s.exercises.find(x => x.name === 'Machine leg press');
  assert.equal(lp.liftId, 'seed-leg-press');
  assert.equal(lp.sets, 4);
  assert.equal(lp.reps, '8–12');
  assert.deepEqual(lp.rows.map(r => [r.weight, r.reps]), [[170, 10], [180, 8], [180, 7], [180, 7]], 'set i ← set i of the last day workout; extra sets repeat the last');
  assert.equal(lp.weight, 170);
  const hyper = s.exercises[0];
  assert.equal(hyper.liftId, null, 'not in the list yet');
  assert.equal(hyper.liftKey, 'prog-45-hyperextension');
  assert.equal(hyper.weight, null);
  assert.deepEqual(hyper.rows.map(r => r.reps), [12, 12, 12, 12], 'reps from the target');
  assert.equal(s.exercises.find(x => x.name === 'Walking dumbbell lunge').optional, true);
  assert.ok(s.minutes >= 30 && s.minutes <= 90, `~${s.minutes} min`);
  assert.equal(s.minutes % 5, 0);
  assert.match(s.reason, /Day 3 · Legs on your rota\. Your first Legs logged here\./);
  const withHistory = suggestWorkout({ ...S, lifts: { ...S.lifts, sessions: SESSIONS, list: S.lifts.list } }, '2026-10-05');
  assert.equal(withHistory.name, 'Legs done', 'a session already logged today says so');
  assert.equal(withHistory.restDay, true);
  assert.match(withHistory.reason, /^Legs logged today\. Next: Upper tomorrow\.$/);
});
t('suggestion: a NIGHT shift pre-fills at 80%, rounded to 2.5 kg, from the last DAY base', () => {
  const S = noHistory();
  const s = suggestWorkout(S, LEGS_NIGHT);
  assert.equal(s.night, true);
  assert.equal(s.shift, 'night');
  const lp = s.exercises.find(x => x.name === 'Machine leg press');
  assert.deepEqual(lp.rows.map(r => r.weight), [135, 145, 145, 145], '170→136→135, 180→144→145');
  assert.match(s.reason, /Night 3 · Legs/);
});
t('suggestion: a night base is used as it stands (no 64%)', () => {
  const S = noHistory();
  S.lifts.log = S.lifts.log.filter(x => x.liftId !== 'seed-leg-press' || x.shift === 'night');
  const lp = suggestWorkout(S, LEGS_NIGHT).exercises.find(x => x.name === 'Machine leg press');
  assert.deepEqual(lp.rows.map(r => r.weight), [145, 145, 145, 145]);
  const pull = suggestWorkout(S, PULL_NIGHT).exercises.find(x => x.name === 'Lat pulldown');
  assert.equal(pull.weight, 70, 'only a night set on record: 70 stays 70');
});
t('suggestion per session: each programme session maps to its exercises', () => {
  const S = noHistory();
  const want = { '2026-10-11': 'Push', '2026-10-12': 'Pull', '2026-10-13': 'Legs', '2026-10-14': 'Upper', '2026-10-15': 'Lower' };
  for (const [iso, code] of Object.entries(want)) {
    const s = suggestWorkout(S, iso);
    assert.equal(s.rotaSession, code, iso);
    assert.equal(s.exercises.length, PROGRAMME[code].length);
    assert.ok(s.exercises.every((x, i) => x.sets === PROGRAMME[code][i].sets));
  }
  const push = suggestWorkout(S, '2026-10-11');
  const dip = push.exercises.find(x => x.name === 'Dip');
  assert.deepEqual(dip.rows.map(r => r.weight), [15, 20, 20, 20], 'quick-logged dips feed the plan too');
  assert.equal(suggestWorkout(S, '2026-10-15').shift, 'off', 'Lower lands on the first day off');
});
t('suggestion: rest day, leave, off-pattern, a non-programme session', () => {
  const S = noHistory();
  const r = suggestWorkout(S, REST);
  assert.equal(r.restDay, true);
  assert.equal(r.name, 'Rest day today');
  assert.deepEqual(r.exercises, []);
  assert.match(r.reason, /rest day/);
  const leave = suggestWorkout({ ...S, rotation: { overrides: { [LEGS_DAY]: { leave: 'annual' } } } }, LEGS_DAY);
  assert.equal(leave.restDay, true, 'booked leave is a rest day');
  assert.match(leave.reason, /leave/i);
  const before = suggestWorkout(S, '2026-01-05');
  assert.equal(before.restDay, true, 'before the pattern starts');
  assert.match(before.reason, /outside your rota/);
  const arms = suggestWorkout({ ...S, rotation: { overrides: { [LEGS_DAY]: { session: 'Arms' } } } }, LEGS_DAY);
  assert.equal(arms.restDay, false);
  assert.deepEqual(arms.exercises, []);
  assert.match(arms.reason, /build your own/);
  assert.equal(suggestWorkout(S, 'nope').restDay, true);
});
t('estimateMinutes leaves optional exercises out', () => {
  assert.equal(estimateMinutes([{ sets: 4 }, { sets: 4, optional: true }]), estimateMinutes([{ sets: 4 }]));
  assert.equal(estimateMinutes([]), 0);
});

// ── Start ──
t('start from the suggestion: programme lifts are PENDING (list untouched), rows pre-filled', () => {
  idn = 0;
  const S = base();
  const sug = suggestWorkout(noHistory(), LEGS_DAY);
  const next = startWorkout(S, { ...suggestedStart(sug), now: 1000, today: LEGS_DAY, ids });
  assert.equal(next.habits, S.habits, 'other keys untouched (same reference)');
  assert.equal(next.vitalsLog, S.vitalsLog);
  assert.equal(next.lifts.log, S.lifts.log, 'the log is not touched by a start');
  assert.equal(next.lifts.sessions, S.lifts.sessions);
  assert.equal(next.lifts.list, S.lifts.list, 'a start never adds lift records (A9)');
  const pend = activeOf(next).exercises.filter(x => x.pending);
  assert.deepEqual(pend.map(x => x.liftId), ['prog-45-hyperextension', 'prog-leg-extension', 'prog-standing-calf-raise', 'prog-walking-dumbbell-lunge', 'prog-ab-crunch-machine']);
  assert.ok(pend.every(x => x.pending.key === x.liftId && x.pending.name), 'the descriptor carries the fixed id and the name');
  assert.equal(pend.find(x => x.liftId === 'prog-walking-dumbbell-lunge').pending.load, 'per_hand');
  assert.deepEqual(pend.find(x => x.liftId === 'prog-leg-extension').pending.muscles, ['Quads']);
  assert.equal(activeOf(next).exercises.find(x => x.liftId === 'seed-leg-press').pending, undefined, 'a lift already in the list is not pending');
  // The screens read a pending exercise through a virtual lift.
  const v = exerciseLift(next.lifts.list, pend[1]);
  assert.deepEqual([v.id, v.name, v.load, v.pending], ['prog-leg-extension', 'Leg extension', 'weight', true]);
  const wl = listWithPending(next.lifts.list, activeOf(next));
  assert.equal(wl.length, S.lifts.list.length + 5);
  assert.equal(listWithPending(S.lifts.list, null), S.lifts.list);
  const a = activeOf(next);
  assert.equal(a.date, LEGS_DAY);
  assert.equal(a.startedAt, 1000);
  assert.equal(a.source, 'suggested');
  assert.equal(a.rotaSession, 'Legs');
  assert.equal(a.shift, 'day');
  assert.equal('restSec' in a, false, 'no rest timer since 2026-10-21');
  assert.equal(a.exercises.length, 6);
  const lp = a.exercises.find(x => x.liftId === 'seed-leg-press');
  assert.deepEqual(lp.sets.map(s => [s.weight, s.reps, s.done]), [[170, 10, false], [180, 8, false], [180, 7, false], [180, 7, false]]);
  assert.equal(lp.target, '8–12');
  assert.equal(a.exercises.find(x => x.liftId === 'prog-walking-dumbbell-lunge').optional, true);
  assert.equal(startWorkout(next, { now: 2, today: LEGS_DAY, ids }), next, 'only one workout at a time');
});
t('start twice on two devices: programme lifts get the same ids', () => {
  const a = startWorkout(base(), { ...suggestedStart(suggestWorkout(noHistory(), LEGS_DAY)), now: 1, today: LEGS_DAY, ids });
  const b = startWorkout(base(), { ...suggestedStart(suggestWorkout(noHistory(), LEGS_DAY)), now: 2, today: LEGS_DAY, ids });
  assert.deepEqual(activeOf(a).exercises.map(x => x.liftId), activeOf(b).exercises.map(x => x.liftId));
  const ta = toggleDone(updateSet(a, 1, 0, { weight: 50, reps: 12 }), 1, 0, 5);
  const tb = toggleDone(updateSet(b, 1, 0, { weight: 40, reps: 10 }), 1, 0, 9);
  assert.deepEqual(ta.lifts.list.map(l => l.id), tb.lifts.list.map(l => l.id), 'created with the same fixed id on both');
});

const started = () => startWorkout(base(), { ...suggestedStart(suggestWorkout(noHistory(), LEGS_DAY)), now: 10_000, today: LEGS_DAY, ids });
const lpIdx = S => activeOf(S).exercises.findIndex(x => x.liftId === 'seed-leg-press');

// ── Lazy lift creation (A9) ──
t('lazy lifts: start → discard leaves the list untouched (suggested, template, recent, fill)', () => {
  const S = base();
  const sug = startWorkout(S, { ...suggestedStart(suggestWorkout(noHistory(), LEGS_DAY)), now: 1, today: LEGS_DAY, ids });
  assert.equal(discardWorkout(sug).lifts.list, S.lifts.list, 'suggested');
  const push = PROGRAMME_TEMPLATES.find(x => x.id === 'prog:Push');
  const tpl = startWorkout(S, { ...templateStart(S, push, LEGS_DAY), now: 1, today: LEGS_DAY, ids });
  assert.ok(activeOf(tpl).exercises.some(x => x.pending), 'Push has programme lifts the fixture list lacks');
  assert.equal(tpl.lifts.list, S.lifts.list, 'template start adds nothing');
  assert.equal(discardWorkout(tpl).lifts.list, S.lifts.list, 'template → discard');
  const rec = startWorkout(S, { ...repeatStart(S, SESSIONS[0], LEGS_DAY), now: 1, today: LEGS_DAY, ids });
  assert.equal(rec.lifts.list, S.lifts.list, 'recent');
  const blank = startWorkout(S, { source: 'blank', now: 1, today: LEGS_DAY, ids });
  const filled = fillEmptyWorkout(blank, templateStart(blank, push, LEGS_DAY));
  assert.ok(activeOf(filled).exercises.length > 0);
  assert.equal(filled.lifts.list, blank.lifts.list, 'Build my own → Library adds nothing');
  assert.equal(discardWorkout(filled).lifts.list, S.lifts.list);
  // a JSON round trip keeps the descriptor (the workout persists across reloads)
  assert.deepEqual(JSON.parse(JSON.stringify(activeOf(tpl))), activeOf(tpl));
});
t('lazy lifts: the first tick creates the lift once; more ticks and Finish add nothing more', () => {
  const S = started();
  const ei = activeOf(S).exercises.findIndex(x => x.liftId === 'prog-leg-extension');
  const before = S.lifts.list.length;
  const T1 = toggleDone(updateSet(S, ei, 0, { weight: 50, reps: 12 }), ei, 0, 77);
  assert.equal(T1.lifts.list.length, before + 1, 'created on the first ticked set');
  const made = T1.lifts.list[T1.lifts.list.length - 1];
  assert.deepEqual([made.id, made.name, made.load, made.muscles, made.createdAt], ['prog-leg-extension', 'Leg extension', 'weight', ['Quads'], 77]);
  for (let k = 0; k < before; k++) assert.equal(T1.lifts.list[k], S.lifts.list[k], 'existing lifts kept, same objects');
  assert.equal(activeOf(T1).exercises[ei].pending, undefined, 'no longer pending');
  assert.equal(activeOf(T1).exercises[ei].liftId, 'prog-leg-extension');
  const T2 = toggleDone(updateSet(T1, ei, 1, { weight: 50, reps: 11 }), ei, 1, 78);
  assert.equal(T2.lifts.list, T1.lifts.list, 'a second tick creates nothing');
  const U = toggleDone(T2, ei, 1, 79);
  assert.equal(U.lifts.list, T1.lifts.list, 'un-tick leaves the lift (it has a done set left)');
  const F = finishWorkout(T2, 99);
  assert.equal(F.lifts.list.filter(l => l.id === 'prog-leg-extension').length, 1, 'finish is idempotent on the list');
  assert.equal(F.lifts.log.filter(e => e.liftId === 'prog-leg-extension').length, 2);
  // a refused tick (nothing typed, no history) creates nothing
  const ri = activeOf(S).exercises.findIndex(x => x.liftId === 'prog-standing-calf-raise');
  const R = updateSet(S, ri, 0, { weight: null, reps: null });
  assert.equal(toggleDone(R, ri, 0, 1), R, 'refused → no write, no lift');
});
t('lazy lifts: Finish creates pending lifts for done sets only; unticked pending exercises create nothing', () => {
  const S = started();
  const ei = activeOf(S).exercises.findIndex(x => x.liftId === 'prog-ab-crunch-machine');
  // a done set that arrived without toggleDone (e.g. merged from another device)
  const a = activeOf(S);
  const ex = { ...a.exercises[ei], sets: a.exercises[ei].sets.map((st, i) => (i === 0 ? { ...st, reps: 15, weight: 30, done: true } : st)) };
  const exercises = a.exercises.slice(); exercises[ei] = ex;
  const M = { ...S, lifts: { ...S.lifts, active: { ...a, exercises } } };
  const F = finishWorkout(M, 500);
  const ids2 = F.lifts.list.map(l => l.id);
  assert.ok(ids2.includes('prog-ab-crunch-machine'), 'created at Finish');
  assert.ok(!ids2.includes('prog-leg-extension') && !ids2.includes('prog-45-hyperextension'), 'unticked programme lifts never created');
  assert.equal(F.lifts.log.filter(e => e.liftId === 'prog-ab-crunch-machine').length, 1);
  assert.equal(F.lifts.sessions[F.lifts.sessions.length - 1].exercises.length, 1);
  // a same-name lift that appeared meanwhile is used, not duplicated
  const twin = { id: 'mine-crunch', name: 'Ab crunch machine', load: 'weight', unit: 'kg', createdAt: 0 };
  const M2 = { ...M, lifts: { ...M.lifts, list: [...M.lifts.list, twin] } };
  const F2 = finishWorkout(M2, 500);
  assert.equal(F2.lifts.list.length, M2.lifts.list.length, 'no duplicate by name');
  assert.ok(F2.lifts.log.some(e => e.liftId === 'mine-crunch'));
  // summarise sees a pending exercise's done sets (virtual lift)
  const sum = summariseWorkout(M, 500);
  assert.equal(sum.setsDone, 1);
  assert.equal(summariseWorkout(M, 500).session.exercises[0].liftId, 'prog-ab-crunch-machine');
});
t('lazy lifts: lifts already in the list behave exactly as before', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press'], { ids });
  const T = toggleDone(S, 0, 0, 10);
  assert.equal(T.lifts.list, S.lifts.list, 'no list write for a known lift');
  assert.equal(activeOf(T).exercises[0].pending, undefined);
  assert.equal(finishWorkout(T, 20).lifts.list, S.lifts.list);
});
t('blank start + add exercises: empty rows (Previous shows what to beat), no duplicates', () => {
  const S = startWorkout(base(), { source: 'blank', name: 'Quick workout', now: 0, today: LEGS_DAY, ids });
  assert.deepEqual(activeOf(S).exercises, []);
  const A = addExercises(S, ['seed-leg-press', 'bench', 'nope', 'bench'], { ids });
  const ex = activeOf(A).exercises;
  assert.deepEqual(ex.map(x => x.liftId), ['seed-leg-press', 'bench']);
  assert.equal(ex[0].sets.length, 2, 'as many sets as last time');
  assert.ok(ex[0].sets.every(s => s.reps == null && s.weight == null && !s.done));
  assert.equal(ex[1].sets.length, 1);
  assert.equal(addExercises(A, ['bench'], { ids }), A, 'already in the workout → no write');
  const B0 = base();
  assert.equal(addExercises(B0, ['bench'], { ids }), B0, 'no active workout → nothing');
});

// ── Editing the active workout ──

t('addSet copies the last row; updateSet cleans numbers; same value → no write', () => {
  let S = started();
  const i = lpIdx(S);
  S = updateSet(S, i, 3, { weight: '185', reps: '8' });
  assert.deepEqual([activeOf(S).exercises[i].sets[3].weight, activeOf(S).exercises[i].sets[3].reps], [185, 8]);
  const T = addSet(S, i, { ids });
  const sets = activeOf(T).exercises[i].sets;
  assert.equal(sets.length, 5);
  assert.deepEqual([sets[4].weight, sets[4].reps, sets[4].done], [185, 8, false]);
  assert.notEqual(sets[4].id, sets[3].id);
  assert.equal(updateSet(T, i, 4, { weight: 185 }), T, 'unchanged → prev');
  const U = updateSet(T, i, 4, { weight: '', reps: '8.6', rpe: '8' });
  assert.deepEqual([activeOf(U).exercises[i].sets[4].weight, activeOf(U).exercises[i].sets[4].reps, activeOf(U).exercises[i].sets[4].rpe], [null, 9, 8]);
  assert.equal(updateSet(U, 99, 0, { reps: 1 }), U, 'no such exercise');
});
t('toggleDone: fills empties from Previous, refuses a non-set, starts no rest timer', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press', 'bench', 'seed-dip'], { ids });
  const T = toggleDone(S, 0, 1, 5000);
  const st = activeOf(T).exercises[0].sets[1];
  assert.deepEqual([st.weight, st.reps, st.done], [180, 8, true], 'set 2 ← Previous set 2 of the last DAY time (the 145 night is not a day reference)');
  assert.equal('rest' in activeOf(T), false, 'the rest timer was removed (2026-10-21)');
  assert.equal(toggleDone(T, 1, 0, 1), T, 'bench: never trained, nothing typed → refused');
  assert.equal(setProblem({ reps: null }, LIST[4]), 'Enter reps');
  assert.equal(setProblem({ reps: 8, weight: null }, LIST[4]), 'Enter a weight');
  assert.equal(setProblem({ reps: 8, weight: null }, LIST[1]), null, 'a dip with no weight is a bodyweight dip');
  assert.equal(setProblem({ reps: 0, weight: 50 }, LIST[4]), 'Reps must be 1–50');
  const R5 = updateSet(T, 1, 0, { reps: 5 });
  assert.equal(toggleDone(R5, 1, 0, 6000), R5, 'reps but no weight on a weighted lift → refused');
  const dip = toggleDone(T, 2, 0, 6000);
  assert.deepEqual([activeOf(dip).exercises[2].sets[0].weight, activeOf(dip).exercises[2].sets[0].reps], [15, 8], 'dips fill from the quick-logged Previous');
  assert.equal(activeOf(toggleDone(updateSet(T, 1, 0, { reps: 5, weight: 60 }), 1, 0, 6000)).exercises[1].sets[0].done, true);
  const U = toggleDone(T, 0, 1, 7000);
  assert.equal(activeOf(U).exercises[0].sets[1].done, false, 'un-tick');
  assert.equal(activeOf(U).exercises[0].sets[1].weight, 180, 'the values stay');
});
t('removeSet / removeExercise / swap / note / rename', () => {
  let S = started();
  const i = lpIdx(S);
  const R = removeSet(S, i, 0);
  assert.equal(activeOf(R).exercises[i].sets.length, 3);
  assert.equal(activeOf(R).exercises[i].sets[0].weight, 180);
  assert.equal(removeSet(R, i, 9), R);
  const W = swapExercise(toggleDone(S, i, 0, 0), i, 'bench');
  const sw = activeOf(W).exercises[i];
  assert.equal(sw.liftId, 'bench');
  assert.equal(sw.sets.length, 4, 'same number of sets');
  assert.ok(sw.sets.every(s => !s.done && s.weight == null), 'nothing ticked, the new lift’s weights (none)');
  assert.deepEqual(sw.sets.map(s => s.reps), [10, 8, 7, 7], 'reps kept');
  assert.equal(swapExercise(S, i, 'prog-leg-extension'), S, 'a lift already in the workout is refused');
  assert.equal(swapExercise(S, i, 'nope'), S);
  const N = setNote(S, i, 'Seat 5');
  assert.equal(activeOf(N).exercises[i].note, 'Seat 5');
  assert.equal(setNote(N, i, 'Seat 5'), N);
  assert.equal('note' in activeOf(setNote(N, i, '')).exercises[i], false);
  assert.equal(activeOf(renameWorkout(S, '  Legs   heavy ')).name, 'Legs heavy');
  assert.equal(renameWorkout(S, ''), S);
  const X = removeExercise(S, 0);
  assert.equal(activeOf(X).exercises.length, 5);
});

// ── Persisted ──
t('the active workout survives a JSON round trip (refresh, sleep, app close)', () => {
  let S = started();
  const i = lpIdx(S);
  S = toggleDone(updateSet(S, i, 0, { weight: 172.5, rpe: 7 }), i, 0, 20_000);
  const R = JSON.parse(JSON.stringify(S));
  assert.deepEqual(R, S);
  assert.deepEqual(activeOf(R), activeOf(S));
  assert.equal(elapsedSec(activeOf(R), 10_000 + 23 * 60_000), 23 * 60);
  // carry on after the "reload" exactly as before it
  const a = finishWorkout(toggleDone(R, i, 1, 30_000), 40_000);
  const b = finishWorkout(toggleDone(S, i, 1, 30_000), 40_000);
  assert.deepEqual(a, b);
});

// ── Finish / discard ──
t('finish: done sets → log entries with sessionId, session pushed, active cleared — once', () => {
  let S = started();
  const i = lpIdx(S);
  const before = S.lifts.log.length;
  S = updateSet(S, i, 1, { weight: 185, reps: 8 });
  S = toggleDone(S, i, 0, 11_000);
  S = toggleDone(S, i, 1, 12_000);
  S = toggleDone(updateSet(S, 1, 0, { weight: 50, reps: 12 }), 1, 0, 13_000);  // leg extension
  S = setNote(S, i, 'Seat 5');
  const a = activeOf(S);
  const F = finishWorkout(S, 10_000 + 52 * 60_000);
  assert.equal(F.lifts.active, null);
  assert.equal(F.habits, S.habits, 'other keys untouched');
  const add = F.lifts.log.slice(before);
  assert.equal(add.length, 3, 'only the three ticked sets');
  for (let k = 0; k < before; k++) assert.equal(F.lifts.log[k], S.lifts.log[k], 'existing entries kept, same objects, same order');
  assert.ok(add.every(x => x.sessionId === a.id && x.date === LEGS_DAY && x.shift === 'day'));
  assert.deepEqual(add.map(x => [x.liftId, x.weight, x.reps]), [['prog-leg-extension', 50, 12], ['seed-leg-press', 170, 10], ['seed-leg-press', 185, 8]], 'in workout order');
  assert.equal(add[1].notes, 'Seat 5', 'the exercise note rides on its first set');
  assert.equal(add[2].notes, undefined);
  assert.ok(add[1].createdAt < add[2].createdAt, 'set order survives as createdAt');
  assert.equal(new Set(add.map(x => x.id)).size, 3);
  const sess = F.lifts.sessions[F.lifts.sessions.length - 1];
  assert.equal(sess.id, a.id);
  assert.equal(sess.durationSec, 52 * 60);
  assert.equal(sess.exercises.length, 2, 'exercises with no ticked set are left out');
  assert.deepEqual(sess.exercises[1].sets.map(s => s.weight), [170, 185]);
  assert.equal(sess.exercises[1].note, 'Seat 5');
  assert.equal(F.lifts.sessions.length, SESSIONS.length + 1);
  // twice: nothing more
  assert.equal(finishWorkout(F, 99_999_999), F, 'no active → the same state');
  // the same active somehow back (a merge from a second device): no duplicate sets
  const again = finishWorkout({ ...F, lifts: { ...F.lifts, active: a } }, 99_999_999);
  assert.equal(again.lifts.log.length, F.lifts.log.length, 'ids already in the log are not re-added');
  assert.equal(again.lifts.sessions.length, F.lifts.sessions.length);
  assert.equal(again.lifts.active, null);
  assert.ok(hasSessionOn(F, LEGS_DAY));
});
t('finish with nothing ticked writes nothing (the UI offers Discard)', () => {
  const S = started();
  assert.equal(finishWorkout(S, 1), S);
});
t('discard leaves the log untouched', () => {
  let S = started();
  S = toggleDone(S, lpIdx(S), 0, 1);
  const D = discardWorkout(S);
  assert.equal(D.lifts.active, null);
  assert.equal(D.lifts.log, S.lifts.log, 'same log, same reference');
  assert.equal(D.lifts.sessions, S.lifts.sessions);
  assert.equal(D.lifts.list, S.lifts.list);
  assert.equal(discardWorkout(D), D);
});
t('sessions keep the last 400; the log is never trimmed', () => {
  const S = base();
  S.lifts.sessions = Array.from({ length: MAX_SESSIONS }, (_, k) => ({ id: `z${k}`, date: '2026-01-01', finishedAt: k, exercises: [] }));
  let T = startWorkout(S, { source: 'blank', now: 0, today: LEGS_DAY, ids });
  T = addExercises(T, ['bench'], { ids });
  T = toggleDone(updateSet(T, 0, 0, { weight: 60, reps: 5 }), 0, 0, 1);
  const F = finishWorkout(T, 2);
  assert.equal(F.lifts.sessions.length, MAX_SESSIONS);
  assert.equal(F.lifts.sessions[0].id, 'z1', 'the oldest session went');
  assert.equal(F.lifts.log.length, S.lifts.log.length + 1, 'every log entry stays');
});

// ── Numbers ──
t('volume: done sets only, per-dumbbell counts both hands, dips the added load', () => {
  const list = LIST;
  const s = { exercises: [
    { liftId: 'seed-leg-press', sets: [{ reps: 10, weight: 170, done: true }, { reps: 8, weight: 180, done: true }, { reps: 8, weight: 180, done: false }] },
    { liftId: 'seed-incline-db-press', sets: [{ reps: 8, weight: 30, done: true }] },
    { liftId: 'seed-dip', sets: [{ reps: 8, weight: 20, done: true }, { reps: 10, weight: 0, done: true }] },
  ] };
  assert.equal(volume(s, list), 1700 + 1440 + 480 + 160);
  assert.equal(volume({ exercises: [] }), 0);
  assert.equal(volume(null), 0);
  assert.equal(volumeText(12450.4), '12,450 kg');
});
t('clock words', () => {
  assert.equal(clock(754), '12:34');
  assert.equal(clock(4000), '1:06:40');
  assert.equal(minutesText(23 * 60 + 5), '23 min');
  assert.equal(minutesText(4000), '1 h 6 min');
});

// ── PBs from a session: real sets only ──
t('sessionPBs: a heavier real set and a rep max; text names the set', () => {
  const S = base();
  const sess = { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 8, weight: 182.5, done: true }, { reps: 8, weight: 185, done: true }, { reps: 12, weight: 150, done: true }] }] };
  const pbs = sessionPBs(S.lifts.log, sess, LIST);
  assert.equal(pbs.length, 1, 'the 185 × 8 holds both records; 182.5 was overtaken in the same session; 150 × 12 beat nothing that existed');
  assert.equal(pbs[0].heaviest, true);
  assert.deepEqual(pbs[0].repMaxes, [1, 3, 5, 8]);
  assert.equal(pbs[0].text, 'New best: Leg press 185 kg × 8 · heaviest ever · new 8RM');
});
t('sessionPBs: a rep-max PB without a heavier set says "new 8RM"', () => {
  const S = base();
  S.lifts.log.push(e('seed-leg-press', '2026-10-09', 190, 3));
  const pbs = sessionPBs(S.lifts.log, { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 8, weight: 185, done: true }] }] }, LIST);
  assert.equal(pbs.length, 1);
  assert.equal(pbs[0].heaviest, false);
  assert.equal(pbs[0].text, 'New best: Leg press 185 kg × 8 · new 8RM');
});
t('sessionPBs: an e1RM-only improvement is NOT a PB; ties are not; a first session is a baseline', () => {
  const S = base();
  // 180 × 9: e1RM 234 beats 180 × 8 (228), but heaviest (180) and 8RM (180) are only tied
  const e1 = sessionPBs(S.lifts.log, { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 9, weight: 180, done: true }] }] }, LIST);
  assert.deepEqual(e1, []);
  const tie = sessionPBs(S.lifts.log, { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 8, weight: 180, done: true }] }] }, LIST);
  assert.deepEqual(tie, []);
  const first = sessionPBs(S.lifts.log, { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'bench', sets: [{ reps: 5, weight: 100, done: true }] }] }, LIST);
  assert.deepEqual(first, [], 'the first bench session sets the baseline');
  const undone = sessionPBs(S.lifts.log, { date: LEGS_DAY, gym: 'dxc', exercises: [{ liftId: 'seed-leg-press', sets: [{ reps: 8, weight: 300, done: false }] }] }, LIST);
  assert.deepEqual(undone, [], 'an unticked set is not a set');
});
t('summariseWorkout matches what finish saves, and its PBs agree with the log afterwards', () => {
  let S = started();
  const i = lpIdx(S);
  S = toggleDone(updateSet(S, i, 0, { weight: 185, reps: 8 }), i, 0, 11_000);
  const sum = summariseWorkout(S, 10_000 + 40 * 60_000);
  assert.equal(sum.durationSec, 40 * 60);
  assert.equal(sum.setsDone, 1);
  assert.equal(sum.setsOpen, activeOf(S).exercises.reduce((k, ex) => k + ex.sets.length, 0) - 1);
  assert.equal(sum.exercises, 1);
  assert.equal(sum.volume, 1480);
  assert.equal(sum.pbs.length, 1);
  const F = finishWorkout(S, 10_000 + 40 * 60_000);
  assert.deepEqual(F.lifts.sessions[F.lifts.sessions.length - 1], sum.session);
  const lift = LIST[0];
  const tl = pbTimeline(F.lifts.log, lift);
  assert.equal(tl[tl.length - 1].entry.sessionId, activeOf(S).id, 'the saved set is the newest PB on the timeline');
  assert.equal(personalBests(F.lifts.log, lift).heaviest.value, 185);
  assert.equal(summariseWorkout(F, 0), null);
});

// ── Track auto-fill ──
t('a finished workout ticks a workout tracker (and an unfinished one does not)', () => {
  const now = new Date(2026, 9, 13, 20, 0, 0);
  let S = { ...started(), trackers: [{ id: 'gym', name: 'Gym', type: 'boolean', auto: { source: 'workout' } }] };
  assert.equal(proposeAutoLogs(S, { now, days: 3 }).filter(p => p.day === LEGS_DAY).length, 0, 'in progress: nothing yet');
  S = toggleDone(S, lpIdx(S), 0, 11_000);
  const F = finishWorkout(S, 20_000);
  const props = proposeAutoLogs(F, { now, days: 3 });
  assert.deepEqual(props.map(p => [p.day, p.value, p.source]), [[LEGS_DAY, true, 'workout']]);
  const T = applyAutoLogs(F, props, { now });
  assert.equal(T.logs[LEGS_DAY].gym, true);
  assert.equal(T.lifts, F.lifts, 'auto-fill never touches the lifts store');
});

// ── Week, templates, recent ──
t('weekStrip: Mon–Sun with the rota session and trained days', () => {
  const S = base();
  const w = weekStrip(S, LEGS_DAY);
  assert.equal(w.length, 7);
  assert.equal(w[0].iso, '2026-10-12');
  assert.equal(w[6].iso, '2026-10-18');
  assert.deepEqual(weekStrip(noHistory(), LEGS_DAY).map(d => d.session), ['Pull', 'Legs', 'Upper', 'Lower', null, null, null], 'no workouts logged: the rota');
  // Workouts are being logged and Sun (Push) + Mon (Pull) passed without one:
  // both are anchors, so they are accepted as missed (Upper picks them up)
  // and the rest of the week keeps the rota.
  assert.deepEqual(w.map(d => d.session), ['Pull', 'Legs', 'Upper', 'Lower', null, null, null]);
  assert.deepEqual(w.map(d => d.moved), [false, false, false, false, false, false, false]);
  assert.equal(w[1].today, true);
  assert.equal(w.filter(d => d.trained).length, 0);
  const w2 = weekStrip(S, '2026-10-05');
  assert.ok(w2.find(d => d.iso === '2026-10-05').trained);
  assert.ok(weekStrip(S, '2026-10-02').find(d => d.iso === '2026-10-02').trained, 'a quick-logged day counts as trained');
  assert.equal(workoutsThisWeek(S, '2026-10-08'), 2);
  assert.equal(workoutsThisWeek(S, LEGS_DAY), 0);
});
t('templates: the five sessions built in; save, replace by name, delete', () => {
  assert.deepEqual(PROGRAMME_TEMPLATES.map(x => x.name), SESSION_CODES);
  assert.ok(PROGRAMME_TEMPLATES.every(x => x.builtIn && x.exercises.length));
  const S = base();
  assert.equal(templatesOf(S).length, 5);
  const tpl = templateFromSession(SESSIONS[0], 'Heavy legs', 'tp1');
  assert.deepEqual(tpl, { id: 'tp1', name: 'Heavy legs', exercises: [{ liftId: 'seed-leg-press', sets: 3, reps: '7–10' }] });
  const A = saveTemplate(S, tpl);
  assert.equal(templatesOf(A).length, 6);
  assert.equal(A.habits, S.habits);
  const B = saveTemplate(A, { ...tpl, id: 'tp2', name: 'heavy legs', exercises: [{ liftId: 'bench', sets: 5 }] });
  assert.equal(B.lifts.templates.length, 1, 'same name → replaced');
  assert.equal(B.lifts.templates[0].id, 'tp1', 'keeping its id');
  assert.equal(saveTemplate(B, { id: 'x', name: '', exercises: [] }), B);
  assert.equal(deleteTemplate(B, 'tp1').lifts.templates.length, 0);
  assert.equal(deleteTemplate(B, 'nope'), B);
  const st = templateStart(S, PROGRAMME_TEMPLATES.find(x => x.name === 'Legs'), LEGS_NIGHT);
  assert.equal(st.source, 'template');
  assert.equal(st.exercises.find(x => x.name === 'Machine leg press').rows[1].weight, 145, 'a template on a night is 80% too');
  const saved = templateStart(A, A.lifts.templates[0], LEGS_DAY);
  assert.deepEqual(saved.exercises[0].rows.map(r => r.weight), [170, 180, 180]);
});
t('recent: last 10 finished, newest first; repeat uses the latest weights', () => {
  const S = base();
  S.lifts.sessions = [...S.lifts.sessions, ...Array.from({ length: 12 }, (_, k) => ({ id: `r${k}`, date: '2026-09-01', finishedAt: 1000 + k, name: `W${k}`, exercises: [{ liftId: 'bench', sets: [{ reps: 5, weight: 100, done: true }] }] }))];
  const r = recentWorkouts(S);
  assert.equal(r.length, 10);
  assert.equal(r[0].id, 'r11');
  const rep = repeatStart(S, SESSIONS[0], LEGS_DAY);
  assert.equal(rep.source, 'recent');
  assert.equal(rep.exercises[0].sets, 3);
  assert.deepEqual(rep.exercises[0].rows.map(x => x.weight), [170, 180, 180]);
  const started2 = startWorkout(S, { ...rep, now: 0, today: LEGS_DAY, ids });
  assert.equal(activeOf(started2).exercises[0].sets.length, 3);
});
t('fillEmptyWorkout: Recent / Library fill a just-started empty workout, keeping its id and clock', () => {
  const S = startWorkout(base(), { source: 'blank', name: 'Workout', now: 5000, today: LEGS_DAY, ids });
  const a = activeOf(S);
  const F = fillEmptyWorkout(S, { ...templateStart(S, PROGRAMME_TEMPLATES[0], LEGS_DAY), ids });
  const b = activeOf(F);
  assert.equal(b.id, a.id);
  assert.equal(b.startedAt, 5000);
  assert.equal(b.source, 'template');
  assert.equal(b.name, 'Push');
  assert.equal(b.exercises.length, PROGRAMME.Push.length);
  assert.equal(fillEmptyWorkout(F, { ...repeatStart(F, SESSIONS[0], LEGS_DAY), ids }), F, 'not once it has exercises');
  const B0 = base();
  assert.equal(fillEmptyWorkout(B0, {}), B0, 'no workout → nothing');
});
t('planFor clamps the set count', () => {
  assert.equal(planFor(base(), LIST[0], { sets: 99 }).rows.length, 20);
  assert.equal(planFor(base(), null, { sets: 0, reps: '8–10' }).rows[0].reps, 8);
});

// ── Previous by shift, set types, per-lift rest ──
t('previousSession: day reads day; night reads night, else day × 0.8 rounded to the step', () => {
  const S = base();
  const day = previousSession(S, 'seed-leg-press', { gym: 'dxc', night: false });
  assert.equal(day.source, 'day');
  assert.deepEqual(day.sets.map(x => x.weight), [170, 180, 180]);
  const night = previousSession(S, 'seed-leg-press', { gym: 'dxc', night: true });
  assert.equal(night.source, 'night');
  assert.deepEqual(night.sets.map(x => x.weight), [145, 145], 'the last NIGHT session as lifted');
  // dips: day history only → night is ×0.8 rounded to 2.5 (15 → 12, 20 → 16 → 15)
  const dip = previousSession(S, 'seed-dip', { night: true });
  assert.equal(dip.source, 'day×0.8');
  assert.equal(dip.scaled, true);
  assert.deepEqual(dip.sets.map(x => x.weight), [12.5, 15]);
  // per dumbbell steps by 1: 31 × 0.8 = 24.8 → 25
  const S2 = { ...S, lifts: { ...S.lifts, log: [...S.lifts.log, e('seed-incline-db-press', '2026-10-06', 31, 8)] } };
  assert.deepEqual(previousSession(S2, 'seed-incline-db-press', { night: true }).sets.map(x => x.weight), [25]);
  // a lift's own step wins: 15 × 0.8 = 12 at step 5 → 10
  const S3 = { ...S, lifts: { ...S.lifts, list: S.lifts.list.map(l => (l.id === 'seed-dip' ? { ...l, step: 5 } : l)) } };
  assert.deepEqual(previousSession(S3, 'seed-dip', { night: true }).sets.map(x => x.weight), [15, 20].map(w => Math.round(w * 0.8 / 5) * 5));
  // night-only history on a day session: shown as lifted, labelled night
  const lat = previousSession(S, 'seed-lat-pulldown', { gym: 'dxc', night: false });
  assert.equal(lat.source, 'night');
  assert.equal(lat.sets[0].weight, 70);
  assert.equal(previousSession(S, 'bench', { night: true }), null);
});
t('night workout: ✓ on an empty row fills from the last NIGHT time', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_NIGHT, shift: 'night', ids });
  S = addExercises(S, ['seed-leg-press', 'seed-dip'], { ids });
  const T = toggleDone(S, 0, 0, 1);
  assert.equal(activeOf(T).exercises[0].sets[0].weight, 145);
  const D = toggleDone(T, 1, 1, 2);
  assert.equal(activeOf(D).exercises[1].sets[1].weight, 15, 'dip: day 20 × 0.8 → 15');
});
t('set types: W / D / F stored on the set, copied to the session and log; warm-ups never a session PB', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press'], { ids });
  S = addSet(addSet(S, 0, { ids }), 0, { ids });
  S = setSetType(S, 0, 0, 'W');
  assert.equal(activeOf(S).exercises[0].sets[0].type, 'W');
  assert.equal(setSetType(S, 0, 0, 'W'), S, 'same type → no write');
  assert.equal('type' in activeOf(setSetType(S, 0, 0, null)).exercises[0].sets[0], false, 'null → a normal set');
  assert.equal('type' in activeOf(setSetType(S, 0, 0, 'X')).exercises[0].sets[0], false, 'unknown → a normal set');
  S = setSetType(S, 0, 2, 'F');
  assert.equal('type' in activeOf(addSet(setSetType(S, 0, 3, 'D'), 0, { ids })).exercises[0].sets[4], false, 'Add set does not copy the type');
  // warm-up at 250 × 10 would beat everything — it must not be a PB; set 2 at 185 × 8 is (beats 180 × 8)
  S = toggleDone(updateSet(S, 0, 0, { weight: 250, reps: 10 }), 0, 0, 1);
  S = toggleDone(updateSet(S, 0, 1, { weight: 185, reps: 8 }), 0, 1, 2);
  S = toggleDone(updateSet(S, 0, 2, { weight: 100, reps: 12 }), 0, 2, 3);
  const sum = summariseWorkout(S, 10);
  assert.ok(sum.pbs.every(p => p.entry.weight !== 250), 'the warm-up is never a PB');
  assert.ok(sum.pbs.some(p => p.entry.weight === 185), 'the working set is');
  assert.equal(sum.volume, 250 * 10 + 185 * 8 + 100 * 12, 'warm-ups still count for volume');
  const F = finishWorkout(S, 10);
  const add = F.lifts.log.slice(-3);
  assert.deepEqual(add.map(x => x.type), ['W', undefined, 'F'], 'type rides onto the log entry');
  assert.deepEqual(F.lifts.sessions[F.lifts.sessions.length - 1].exercises[0].sets.map(x => x.type), ['W', undefined, 'F']);
  const pb = personalBests(F.lifts.log, LIST[0]);
  assert.equal(pb.heaviest.value, 185, 'heaviest ignores the warm-up');
  assert.ok(!pbTimeline(F.lifts.log, LIST[0]).some(ev => ev.entry.type === 'W'));
  assert.equal(previousSets(F, 'seed-leg-press').sets[0].type, 'W', 'Previous shows the warm-up row as a warm-up');
});
t('a lift that still carries restSec starts no timer; RPE steps', () => {
  const B = base();
  B.lifts.list = B.lifts.list.map(l => (l.id === 'seed-leg-press' ? { ...l, restSec: 180 } : l));
  let S = startWorkout(B, { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press'], { ids });
  assert.equal('rest' in activeOf(toggleDone(S, 0, 0, 0)), false);
  assert.equal(S.lifts.list.find(l => l.id === 'seed-leg-press').restSec, 180, 'the saved value is left alone');
  assert.deepEqual(RPE_STEPS, [6, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  assert.equal(liftFromPending(null), null);
});

// ── The live-workout redesign (Phase 2A) ──
t('✓ commits the placeholders the screen showed (opts.fill); typed values win; nothing to commit → refused', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press', 'bench'], { ids });
  const T = toggleDone(S, 0, 0, 1, { fill: { weight: 172.5, reps: 9 } });
  assert.deepEqual(['weight', 'reps', 'done'].map(k => activeOf(T).exercises[0].sets[0][k]), [172.5, 9, true]);
  const U = toggleDone(updateSet(S, 0, 0, { reps: 6 }), 0, 0, 1, { fill: { weight: 172.5, reps: 9 } });
  assert.deepEqual(['weight', 'reps'].map(k => activeOf(U).exercises[0].sets[0][k]), [172.5, 6], 'a typed rep count is kept');
  assert.equal(toggleDone(S, 1, 0, 1, { fill: { weight: null, reps: null } }), S, 'bench: no previous, nothing typed → refused');
  assert.equal(toggleDone(S, 1, 0, 1, { fill: { weight: 60, reps: null } }), S, 'half a set is refused');
});

t('lazy creation holds for the new-workout sheet (empty rows): start → discard leaves the list; first tick creates once', () => {
  const B = base();
  const legs = PROGRAMME_TEMPLATES.find(x => x.id === 'prog:Legs');
  const before = JSON.stringify(B.lifts.list);
  let S = startWorkout(B, { ...templateStart(B, legs, LEGS_DAY), prefill: false, now: 0, today: LEGS_DAY, ids });
  assert.equal(JSON.stringify(S.lifts.list), before, 'start writes no lift');
  assert.ok(activeOf(S).exercises.every(x => x.sets.every(st => st.weight == null && st.reps == null)), 'prefill:false → empty rows');
  assert.equal(JSON.stringify(discardWorkout(S).lifts.list), before, 'discard leaves the list exactly as it was');
  const pi = activeOf(S).exercises.findIndex(x => x.pending);
  const T = toggleDone(updateSet(S, pi, 0, { weight: 40, reps: 10 }), pi, 0, 5);
  assert.equal(T.lifts.list.length, B.lifts.list.length + 1);
  const T2 = toggleDone(updateSet(T, pi, 1, { weight: 40, reps: 10 }), pi, 1, 6);
  assert.equal(T2.lifts.list.length, T.lifts.list.length, 'idempotent');
});

t('minimise / resume: every read the mini-bar and dock make leaves the workout byte-identical', () => {
  let S = startWorkout(base(), { source: 'blank', name: 'Push', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press', 'seed-dip'], { ids });
  S = toggleDone(S, 0, 0, 60_000);
  const snap = JSON.stringify(S);
  const a = activeOf(S);
  const mb = miniBarModel(a, 90_000);
  assert.equal(mb.text, 'PUSH · 1:30 · 1/4');
  assert.equal(miniBarModel({ ...a, rest: { endsAt: 120_000, total: 90 } }, 90_000).text, 'PUSH · 1:30 · 1/4',
    'a workout started before the timer was removed shows no REST segment');
  planProgress(a); nextOpenSet(a, 1); livePbSets(S); summariseWorkout(S, 100);
  assert.equal(JSON.stringify(S), snap, 'reads never write');
  assert.equal(miniBarModel(null, 0), null);
  assert.deepEqual(planProgress(a), { sets: 4, done: 1, exercises: 2, exercisesDone: 0 });
  assert.deepEqual(nextOpenSet(a, 0), { ei: 0, si: 1 });
  assert.deepEqual(nextOpenSet(a, 1), { ei: 1, si: 0 });
});

t('delete + Undo puts the identical set (and exercise) back; never somewhere it never was', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  S = addExercises(S, ['seed-leg-press', 'seed-dip'], { ids });
  S = toggleDone(S, 0, 1, 1);
  const set = activeOf(S).exercises[0].sets[1];
  const D = removeSet(S, 0, 1);
  const R = insertSet(D, 0, 1, set, 'seed-leg-press');
  assert.deepEqual(activeOf(R).exercises[0], activeOf(S).exercises[0]);
  assert.equal(insertSet(R, 0, 1, set, 'seed-leg-press'), R, 'twice → no duplicate');
  assert.equal(insertSet(D, 0, 1, set, 'seed-dip'), D, 'the exercise changed meanwhile → not put back');
  const ex = activeOf(S).exercises[1];
  const X = removeExercise(S, 1);
  assert.deepEqual(activeOf(insertExercise(X, 1, ex)).exercises, activeOf(S).exercises);
  assert.equal(insertExercise(S, 1, ex), S, 'already there → no-op');
});

t('live PB marks: real sets only, the gym for a machine, a first session is a baseline; one toast per exercise', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, gym: 'dxc', ids });
  S = addExercises(S, ['seed-leg-press', 'bench'], { ids });
  S = setSetType(updateSet(S, 0, 0, { weight: 300, reps: 10 }), 0, 0, 'W');
  S = toggleDone(S, 0, 0, 1);
  S = toggleDone(updateSet(S, 0, 1, { weight: 185, reps: 8 }), 0, 1, 2);
  S = toggleDone(updateSet(S, 1, 0, { weight: 100, reps: 5 }), 1, 0, 3);
  const m = livePbSets(S);
  const a = activeOf(S);
  assert.equal(m.has(a.exercises[0].sets[0].id), false, 'the warm-up is never a PB');
  const hit = m.get(a.exercises[0].sets[1].id);
  assert.ok(hit && hit.heaviest, '185 × 8 beats 180');
  assert.deepEqual(hit.was, { weight: 180, reps: 8, date: '2026-10-05' }, 'what it beat ("was 180 × 8")');
  assert.equal(m.has(a.exercises[1].sets[0].id), false, 'bench: first time = baseline');
  // a machine at another gym compares only there (no history at Greenock → baseline)
  const B2 = { ...S, lifts: { ...S.lifts, list: S.lifts.list.map(l => (l.id === 'seed-leg-press' ? { ...l, perGym: true } : l)), active: { ...a, gym: 'greenock' } } };
  assert.equal(livePbSets(B2).size, 0);
  const K = markPbToasted(S, 'seed-leg-press');
  assert.deepEqual(activeOf(K).pbToasted, ['seed-leg-press']);
  assert.equal(markPbToasted(K, 'seed-leg-press'), K, 'once per exercise per session');
});

t('Finish: PBs say what they beat; night compares with the last NIGHT only; estimates are one muted line', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_NIGHT, shift: 'night', ids });
  S = addExercises(S, ['seed-leg-press'], { ids });
  S = toggleDone(updateSet(S, 0, 0, { weight: 147.5, reps: 8 }), 0, 0, 1);
  const sum = summariseWorkout(S, 100);
  assert.deepEqual(sum.night.lines.map(x => [x.name, x.text, x.delta]), [['Leg press', '+2.5 kg', 1]], 'vs the 145 × 8 night, not the 180 day');
  const L = toggleDone(updateSet(S, 0, 0, {}), 0, 0, 1);
  const lighter = toggleDone(updateSet(L, 0, 0, { weight: 145, reps: 7 }), 0, 0, 2);
  assert.equal(summariseWorkout(lighter, 100).night.lines[0].text, '−1 rep', 'a drop is plain words, never a red number');
  let D = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, ids });
  D = addExercises(D, ['seed-leg-press'], { ids });
  D = toggleDone(updateSet(D, 0, 0, { weight: 177.5, reps: 9 }), 0, 0, 1);
  const ds = summariseWorkout(D, 100);
  assert.equal(ds.night, null, 'a day session has no night line');
  assert.equal(ds.pbs.length, 0, '177.5 × 9 is no real-set record …');
  assert.ok(ds.estimate && ds.estimate.to > ds.estimate.from, '… but its estimate rose — one muted line');
  assert.equal(estimateRise([], ds.session, LIST), null, 'no history → nothing to compare');
  assert.equal(nightComparison(D, ds.session, LIST), null);
  assert.equal(ds.setsPlanned, 2, 'two rows from last time; one ticked');
});

t('templates: a saved template carries its id (Update template); a built-in never does', () => {
  const B = saveTemplate(base(), { id: 'tp1', name: 'My push', exercises: [{ liftId: 'bench', sets: 3, reps: '8' }] });
  const st = templateStart(B, B.lifts.templates[0], LEGS_DAY);
  assert.equal(st.templateId, 'tp1');
  assert.equal('templateId' in templateStart(B, PROGRAMME_TEMPLATES[0], LEGS_DAY), false);
  let S = startWorkout(B, { ...st, now: 0, today: LEGS_DAY, ids });
  S = toggleDone(updateSet(S, 0, 0, { weight: 60, reps: 8 }), 0, 0, 1);
  const sum = summariseWorkout(S, 50);
  assert.deepEqual(sum.template, { id: 'tp1', name: 'My push' });
  assert.equal(finishWorkout(S, 50).lifts.sessions.slice(-1)[0].templateId, 'tp1');
});

t('night override: on and off again restores the rota shift; Previous follows', () => {
  let S = startWorkout(base(), { source: 'blank', now: 0, today: LEGS_DAY, shift: 'early', ids });
  S = addExercises(S, ['seed-leg-press'], { ids });
  const N = setWorkoutShift(S, 'night');
  assert.deepEqual([activeOf(N).shift, activeOf(N).shiftWas], ['night', 'early']);
  assert.equal(setWorkoutShift(N, 'night'), N);
  const back = activeOf(setWorkoutShift(N, 'day'));
  assert.deepEqual([back.shift, 'shiftWas' in back], ['early', false]);
  assert.equal(activeOf(toggleDone(N, 0, 0, 1)).exercises[0].sets[0].weight, 145, 'night Previous at once');
});


// ── The exercise library (catalogue) ──
t('the catalogue is well formed and never repeats the programme', () => {
  const idsSeen = new Set();
  const progNames = new Set(Object.keys(PROGRAMME_MUSCLES).map(x => x.toLowerCase()));
  for (const c of CATALOGUE) {
    assert.ok(/^cat-[a-z0-9-]+$/.test(c.id), `${c.name}: id`);
    assert.ok(!idsSeen.has(c.id), `${c.name}: unique id`); idsSeen.add(c.id);
    assert.ok(LOAD_TYPES.includes(c.load), `${c.name}: load`);
    assert.ok(c.muscles.length && c.muscles.every(m => MUSCLES.includes(m)), `${c.name}: muscles`);
    assert.ok(!progNames.has(c.name.toLowerCase()), `${c.name}: already in the programme`);
    assert.ok(c.name.length <= 60, `${c.name}: name fits`);
  }
  assert.ok(CATALOGUE.filter(c => c.muscles.includes('Abs')).length >= 15, 'a real abs section');
  assert.equal(catId('Captain’s chair knee raise'), 'cat-captains-chair-knee-raise');
  assert.equal(catalogueEntry('cat-captains-chair-knee-raise').load, 'bodyweight_plus');
  const offered = catalogueFor([{ id: 'x', name: 'pull-up' }, { id: 'y', name: 'Hammer Curl', archived: true }]).map(c => c.name);
  assert.ok(!offered.includes('Pull-up') && !offered.includes('Hammer curl'), 'names you already have are not offered');
  assert.ok(offered.includes('Chin-up') && offered.every(Boolean));
});
t('a library exercise is added pending and only joins the list once a set is logged', () => {
  const KR = catId('Captain’s chair knee raise');
  const S = startWorkout(base(), { source: 'blank', name: 'Abs', now: 0, today: LEGS_DAY, ids });
  const A = addExercises(S, [KR, 'bench', 'cat-nope'], { ids });
  const ex = activeOf(A).exercises;
  assert.deepEqual(ex.map(x => x.liftId), [KR, 'bench'], 'unknown ids are ignored');
  assert.deepEqual(ex[0].pending, { key: KR, name: 'Captain’s chair knee raise', load: 'bodyweight_plus', muscles: ['Abs'] });
  assert.equal(ex[0].sets.length, 1);
  assert.equal(A.lifts.list, S.lifts.list, 'picking writes nothing to the list');
  assert.equal(addExercises(A, [KR], { ids }), A, 'twice → no write');
  // nothing ticked on it → still not in the list after Finish
  const benchOnly = toggleDone(updateSet(A, 1, 0, { weight: 60, reps: 8 }), 1, 0, 5);
  assert.ok(!finishWorkout(benchOnly, 9).lifts.list.some(l => l.id === KR), 'untouched → never created');
  // a bodyweight set of it → the lift exists, with its muscles, and the log has the set
  const T = toggleDone(updateSet(A, 0, 0, { weight: 0, reps: 12 }), 0, 0, 7);
  const F = finishWorkout(T, 10);
  const lift = F.lifts.list.find(l => l.id === KR);
  assert.ok(lift && lift.load === 'bodyweight_plus' && lift.muscles[0] === 'Abs', 'created on log');
  assert.ok(F.lifts.log.some(e2 => e2.liftId === KR && e2.reps === 12), 'set saved');
  // next time it's an ordinary lift: added by id, not pending, and not offered again
  const S2 = startWorkout(F, { source: 'blank', name: 'Abs', now: 20, today: '2026-10-14', ids });
  const ex2 = activeOf(addExercises(S2, [KR], { ids })).exercises[0];
  assert.equal(ex2.pending, undefined);
  assert.ok(!catalogueFor(F.lifts.list).some(c => c.id === KR));
});
t('a library pick whose name you already have uses your lift', () => {
  const B = base();
  const own = { ...B, lifts: { ...B.lifts, list: [...B.lifts.list, { id: 'mine-crunch', name: 'Cable crunch', load: 'weight', unit: 'kg', createdAt: 0 }] } };
  const S = startWorkout(own, { source: 'blank', name: 'Abs', now: 0, today: LEGS_DAY, ids });
  const ex = activeOf(addExercises(S, [catId('Cable crunch')], { ids })).exercises[0];
  assert.equal(ex.liftId, 'mine-crunch');
  assert.equal(ex.pending, undefined);
});
t('swap to a library exercise', () => {
  const S = addExercises(startWorkout(base(), { source: 'blank', name: 'x', now: 0, today: LEGS_DAY, ids }), ['bench'], { ids });
  const W = swapExercise(S, 0, catId('Hanging leg raise'));
  const ex = activeOf(W).exercises[0];
  assert.equal(ex.liftId, 'cat-hanging-leg-raise');
  assert.equal(ex.pending.name, 'Hanging leg raise');
  assert.equal(swapExercise(S, 0, 'cat-nope'), S);
});

console.log(`workout: ${n} tests passed`);

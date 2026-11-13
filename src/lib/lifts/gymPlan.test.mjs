/**
 * Two gyms, two plans (trainingProgramme.js PROGRAMMES, gymPlan.js): the
 * session plan is the chosen gym's own, a session in progress switches
 * with the gym, and nothing a gym lacks is ever shown there.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  PROGRAMME, PROGRAMME_GREENOCK, PROGRAMMES, BASE_GYM, programmeFor, PROGRAMME_NAMES, GYM_ONLY, SESSION_CODES, assertNoBannedLifts,
} from '../../data/trainingProgramme.js';
import { onlyGymOf, availableAt } from './lifts.js';
import { setOnlyGym, DEFAULT_GYMS, setGymArchived, activeGyms } from './store.js';
import { fitForGym, planOf, switchExercise, isPlanSession } from './gymPlan.js';
import {
  suggestWorkout, suggestedStart, startWorkout, activeOf, templateStart, PROGRAMME_TEMPLATES, progId, setWorkoutGym, gymSwitchPreview,
  followsPlan, toggleDone, updateSet, exerciseLift, finishWorkout,
} from './workout.js';
import { buildAdaptive, sessionGroups, partsOf } from './adaptive.js';
import { dayDetail } from './home.js';
import { musclesOf } from './muscles.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const GYMS = DEFAULT_GYMS.map(g => g.id);
const LIST = PROGRAMME_NAMES.map(name => ({ id: progId(name), name, load: name === 'Dip' ? 'bodyweight_plus' : 'weight', unit: 'kg' }));
const names = xs => xs.map(x => x.name);
const req = list => list.filter(x => !x.optional);
const sets = list => req(list).reduce((a, x) => a + x.sets, 0);
// Default rota: 2026-10-11 Push · 12 Pull · 13 Legs · 14 Upper · 15 Lower.
const DAY = { Push: '2026-10-11', Pull: '2026-10-12', Legs: '2026-10-13', Upper: '2026-10-14', Lower: '2026-10-15' };
const S0 = (list = LIST, extra = {}) => ({ lifts: { list, log: [], sessions: [], ...extra } });
let k = 0;
const ids = p => `${p}_${++k}`;

// ── The two plans ─────────────────────────────────────────────────
t('there is a plan for each gym, DXC is the base, and an unknown gym trains the base', () => {
  assert.deepEqual(Object.keys(PROGRAMMES), ['dxc', 'greenock']);
  assert.equal(BASE_GYM, 'dxc');
  assert.equal(programmeFor('dxc'), PROGRAMME);
  assert.equal(programmeFor('greenock'), PROGRAMME_GREENOCK);
  assert.equal(programmeFor('gym-somewhere'), PROGRAMME);
  assert.equal(programmeFor(null), PROGRAMME);
  for (const id of Object.keys(PROGRAMMES)) assert.ok(GYMS.includes(id), `${id} is one of the gyms`);
  assert.deepEqual(Object.keys(PROGRAMME_GREENOCK).sort(), [...SESSION_CODES].sort());
  assert.ok(isPlanSession('Upper') && !isPlanSession('Arms') && !isPlanSession(null));
});

t('the Greenock plan prescribes nothing that is off the table', () => {
  assert.deepEqual(assertNoBannedLifts(PROGRAMME_GREENOCK), []);
});

t('slot for slot: the same required sets in every session, so a week is the same amount of work at either gym', () => {
  for (const code of SESSION_CODES) {
    assert.equal(sets(PROGRAMME_GREENOCK[code]), sets(PROGRAMME[code]), `${code}: required sets`);
    assert.equal(req(PROGRAMME_GREENOCK[code]).length, req(PROGRAMME[code]).length, `${code}: required exercises`);
    assert.ok(PROGRAMME_GREENOCK[code].length <= 9, `${code}: the owner's cap, optional extras included`);
  }
});

t('every `for` names the DXC exercise in that session, at the same sets', () => {
  for (const code of SESSION_CODES) {
    for (const x of PROGRAMME_GREENOCK[code]) {
      if (!x.for) continue;
      const base = PROGRAMME[code].find(b => b.name === x.for);
      assert.ok(base, `${code} · ${x.name}: "${x.for}" is in DXC's ${code}`);
      assert.equal(x.sets, base.sets, `${code} · ${x.name}: sets`);
      assert.equal(!!x.optional, !!base.optional, `${code} · ${x.name}: optional`);
      assert.notEqual(x.name, x.for);
    }
    // Each DXC slot is filled once at Greenock: by itself or by its stand-in, never both.
    const slots = PROGRAMME_GREENOCK[code].map(x => x.for || x.name);
    assert.equal(new Set(slots).size, slots.length, `${code}: no slot twice`);
    for (const b of PROGRAMME[code]) assert.ok(slots.includes(b.name), `${code}: DXC's ${b.name} has a Greenock slot`);
  }
});

t('each gym’s plan only uses what that gym has', () => {
  for (const code of SESSION_CODES) for (const x of PROGRAMME_GREENOCK[code]) assert.ok(availableAt({ name: x.name }, 'greenock'), `Greenock ${code} · ${x.name}`);
  // DXC: one known gap. Seated leg curl was already in Lower and DXC turns
  // out not to have one; nothing has been named in its place yet.
  const gaps = [];
  for (const code of SESSION_CODES) for (const x of PROGRAMME[code]) if (!availableAt({ name: x.name }, 'dxc')) gaps.push(`${code} · ${x.name}`);
  assert.deepEqual(gaps, ['Lower · Seated leg curl']);
  // The owner's list.
  assert.equal(GYM_ONLY['45° hyperextension'], 'dxc');
  for (const nm of ['Assisted pull-up', 'Assisted dip', 'Lower back machine', 'Seated dip machine', 'Preacher curl machine', 'Seated leg curl',
    'Adductor machine', 'Abductor machine', 'Chest-supported row', 'Pullover machine', 'Belt squat machine', 'Hack squat',
    'Elbow-supported pec deck', 'Incline Smith Machine Bench']) assert.equal(GYM_ONLY[nm], 'greenock', nm);
  for (const id of Object.values(GYM_ONLY)) assert.ok(GYMS.includes(id));
});

t('the Greenock plan is built on the owner’s terms: hyperextension → lower back machine, favourites kept', () => {
  const G = PROGRAMME_GREENOCK;
  assert.equal(G.Legs[0].name, 'Lower back machine');
  assert.equal(G.Legs[0].for, '45° hyperextension');
  assert.ok(names(G.Lower).includes('Lower back machine'));
  for (const code of SESSION_CODES) assert.ok(!names(G[code]).includes('45° hyperextension'), code);
  assert.equal(G.Push[0].name, 'Dip');
  assert.equal(G.Upper[0].name, 'Dip');
  assert.ok(names(G.Pull).includes('Incline dumbbell curl, 21s'));
  assert.ok(names(G.Push).includes('Incline Smith Machine Bench') && !names(G.Push).includes('Incline dumbbell press'));
  assert.equal(G.Upper.find(x => x.name === 'Dumbbell lateral raise').sets, 5, 'the width work is untouched');
  // Each muscle group a session is built around is still trained by it.
  for (const code of SESSION_CODES) {
    const d = sessionGroups(code);
    const g = {};
    for (const x of req(G[code])) for (const [p, w] of Object.entries(partsOf({ name: x.name }))) g[p] = (g[p] || 0) + w * x.sets;
    assert.ok(Object.keys(g).length > 0);
    for (const grp of Object.keys(d)) if (d[grp] >= 3) assert.ok(names(req(G[code])).some(nm => musclesOf({ name: nm }).includes(grp)), `${code}: still trains ${grp}`);
  }
});

// ── Availability ──────────────────────────────────────────────────
t('where a lift can be done: the name default, and the lift’s own choice over it', () => {
  assert.equal(onlyGymOf({ name: 'Hack squat' }), 'greenock');
  assert.equal(onlyGymOf({ name: '  hack   SQUAT ' }), 'greenock');
  assert.equal(onlyGymOf({ name: '45° hyperextension' }), 'dxc');
  assert.equal(onlyGymOf({ name: 'Lat pulldown' }), null);
  assert.equal(availableAt({ name: 'Hack squat' }, 'dxc'), false);
  assert.equal(availableAt({ name: 'Hack squat' }, null), true, 'no gym chosen: nothing is ruled out');
  assert.equal(onlyGymOf({ name: 'Hack squat', only: false }), null, '"any gym", said by hand');
  assert.equal(onlyGymOf({ name: 'Pec Deck', only: 'dxc' }), 'dxc');
  assert.equal(onlyGymOf({ name: 'Pec Deck', only: 'gone' }, GYMS), null, 'a gym no longer in use restricts nothing');
});

t('setOnlyGym writes one key on one lift, and nothing when nothing changes', () => {
  const L = { list: LIST.map(l => ({ ...l })), log: [{ id: 'e1', liftId: LIST[0].id }], sessions: [] };
  const id = progId('Hack squat');
  const a = setOnlyGym(L, id, null);
  assert.equal(a.list.find(l => l.id === id).only, false, 'any gym is stored, so it beats the default');
  assert.equal(a.log, L.log);
  for (const l of L.list) if (l.id !== id) assert.equal(a.list.find(x => x.id === l.id), l, 'other lifts are the same objects');
  assert.equal(setOnlyGym(a, id, null), a);
  assert.equal(setOnlyGym(a, id, 'greenock').list.find(l => l.id === id).only, 'greenock');
  assert.equal(setOnlyGym(L, 'nope', 'dxc'), L);
  assert.equal(setOnlyGym(L, id, 'not-a-gym'), L);
});

// ── The suggestion ────────────────────────────────────────────────
t('the suggestion is the chosen gym’s plan, exercise for exercise', () => {
  const S = S0();
  for (const code of SESSION_CODES) {
    const g = suggestWorkout(S, DAY[code], { gym: 'greenock' });
    assert.equal(g.rotaSession, code);
    assert.deepEqual(names(g.exercises), names(PROGRAMME_GREENOCK[code]), `Greenock ${code}`);
    assert.deepEqual(g.exercises.map(x => [x.sets, x.reps, !!x.optional]), PROGRAMME_GREENOCK[code].map(x => [x.sets, x.reps, !!x.optional]));
    assert.deepEqual(g.gymFit, { swaps: [], dropped: [] }, `Greenock ${code}: nothing to fix up`);
    assert.ok(g.exercises.every(x => !(x.tags || []).some(tg => tg.kind === 'gym')));
    const d = suggestWorkout(S, DAY[code], { gym: 'dxc' });
    const want = names(PROGRAMME[code]).filter(nm => nm !== 'Seated leg curl');
    assert.deepEqual(names(d.exercises), want, `DXC ${code}`);
    assert.deepEqual(d.gymFit.dropped, code === 'Lower' ? ['Seated leg curl'] : []);
  }
  // A gym added later has no plan of its own: it trains the base one, less what only another gym has.
  const other = suggestWorkout(S0(LIST, { gyms: [...DEFAULT_GYMS.map(g => ({ ...g })), { id: 'gym-x', name: 'Elsewhere' }] }), DAY.Push, { gym: 'gym-x' });
  assert.deepEqual(names(other.exercises), names(PROGRAMME.Push));
});

t('weights for a Greenock machine come from Greenock’s own sets', () => {
  const id = progId('Hack squat');
  const log = [{ id: 'e1', liftId: id, date: '2026-10-04', weight: 120, reps: 8, gym: 'greenock', createdAt: 1 }];
  const g = suggestWorkout(S0(LIST, { log }), DAY.Legs, { gym: 'greenock' });
  assert.equal(g.exercises.find(e => e.name === 'Hack squat').weight, 120);
});

t('the built-in sessions follow the gym; a template the owner saved is left as written', () => {
  const S = S0();
  for (const code of SESSION_CODES) {
    const tpl = PROGRAMME_TEMPLATES.find(x => x.name === code);
    assert.deepEqual(names(templateStart(S, tpl, DAY[code], { gym: 'greenock' }).exercises), names(PROGRAMME_GREENOCK[code]), code);
  }
  assert.deepEqual(names(templateStart(S, PROGRAMME_TEMPLATES.find(x => x.name === 'Push'), DAY.Push, { gym: 'dxc' }).exercises), names(PROGRAMME.Push));
  const mine = { id: 'tpl1', name: 'Push - DXC', exercises: [{ liftId: progId('Incline dumbbell press'), sets: 3, reps: '8–10' }] };
  assert.deepEqual(names(templateStart(S, mine, DAY.Push, { gym: 'greenock' }).exercises), ['Incline dumbbell press']);
});

t('the week strip’s day sheet lists the chosen gym’s plan', () => {
  const S = S0();
  const cell = { iso: DAY.Upper, session: 'Upper' };
  assert.deepEqual(names(dayDetail(S, cell, { gym: 'greenock' }).exercises), names(PROGRAMME_GREENOCK.Upper));
  assert.deepEqual(names(dayDetail(S, cell, { gym: 'dxc' }).exercises), names(PROGRAMME.Upper));
  assert.deepEqual(names(dayDetail(S, { iso: DAY.Lower, session: 'Lower' }, { gym: 'dxc' }).exercises), names(PROGRAMME.Lower).filter(nm => nm !== 'Seated leg curl'));
  assert.deepEqual(names(dayDetail(S0(LIST, { lastGym: 'greenock' }), cell).exercises), names(PROGRAMME_GREENOCK.Upper), 'default: the last gym');
});

// ── Switching gym during a session ────────────────────────────────
t('one exercise at the other gym: its counterpart, itself, or nothing', () => {
  assert.deepEqual(switchExercise('Upper', 'Lat pulldown', 'dxc', 'greenock'), { name: 'Assisted pull-up', sets: 4, reps: '6–10' });
  assert.deepEqual(switchExercise('Pull', 'Lat pulldown', 'dxc', 'greenock'), { name: 'Lat pulldown', sets: 4, reps: '8–10' }, 'Pull keeps the pulldown');
  assert.deepEqual(switchExercise('Upper', 'Assisted pull-up', 'greenock', 'dxc'), { name: 'Lat pulldown', sets: 4, reps: '8–10' });
  assert.deepEqual(switchExercise('Legs', '45° hyperextension', 'dxc', 'greenock'), { name: 'Lower back machine', sets: 4, reps: '12–15' });
  assert.deepEqual(switchExercise('Lower', 'Lower back machine', 'greenock', 'dxc'), { name: '45° hyperextension', sets: 2, reps: '12–15' });
  const atDxc = nm => availableAt({ name: nm }, 'dxc');
  assert.equal(switchExercise('Push', 'Elbow-supported pec deck', 'greenock', 'dxc', atDxc), null, 'a Greenock extra has no DXC slot');
  assert.equal(switchExercise('Lower', 'Seated leg curl', 'greenock', 'dxc', atDxc), null, 'DXC has no leg curl');
  assert.equal(switchExercise('Push', 'Cable crossover', 'dxc', 'greenock'), 'keep', 'one the owner added, that both gyms have');
  // Not this session's, and the other gym cannot do it: its counterpart from wherever the plans name one.
  assert.deepEqual(switchExercise('Push', 'Hack squat', 'greenock', 'dxc', atDxc), { name: 'Machine leg press', sets: 4, reps: '8–12' });
});

const start = (S, code, gym) => startWorkout(S, { ...suggestedStart(suggestWorkout(S, DAY[code], { gym })), now: 1000, today: DAY[code], ids });
const liveNames = S => activeOf(S).exercises.map(ex => exerciseLift(S.lifts.list, ex).name);

t('toggle before a set is done: the whole session becomes the other gym’s plan', () => {
  for (const code of SESSION_CODES) {
    const atD = start(S0(), code, 'dxc');
    assert.ok(followsPlan(activeOf(atD)));
    const toG = setWorkoutGym(atD, 'greenock', { ids });
    assert.equal(activeOf(toG).gym, 'greenock');
    // Greenock's plan for the slots DXC had (its optional extras join only when the session is started there).
    const slots = PROGRAMME_GREENOCK[code].filter(x => x.for || names(PROGRAMME[code]).includes(x.name));
    const had = new Set(liveNames(atD));
    const want = slots.filter(x => had.has(x.for || x.name)).map(x => x.name);
    assert.deepEqual(liveNames(toG), want, `${code}: DXC → Greenock`);
    // Sets and reps are the Greenock plan's.
    activeOf(toG).exercises.forEach(ex => {
      const nm = exerciseLift(toG.lifts.list, ex).name;
      const p = PROGRAMME_GREENOCK[code].find(x => x.name === nm);
      assert.equal(ex.sets.length, p.sets, `${code} · ${nm}: sets`);
      assert.equal(ex.target, p.reps, `${code} · ${nm}: reps`);
    });
    // And back again: exactly where it started.
    assert.deepEqual(liveNames(setWorkoutGym(toG, 'dxc', { ids })), liveNames(atD), `${code}: and back`);
  }
});

t('toggle from Greenock: its extras leave, the rest become DXC’s', () => {
  const atG = start(S0(), 'Push', 'greenock');
  assert.ok(liveNames(atG).includes('Elbow-supported pec deck'));
  const pv = gymSwitchPreview(atG, 'dxc');
  assert.deepEqual(pv.swaps, [{ from: 'Incline Smith Machine Bench', to: 'Incline dumbbell press' }]);
  assert.deepEqual(pv.dropped, ['Elbow-supported pec deck']);
  assert.deepEqual(liveNames(setWorkoutGym(atG, 'dxc', { ids })), names(PROGRAMME.Push));
  // Lower at Greenock → DXC: no leg curl there, and the hip machines go.
  const lower = setWorkoutGym(start(S0(), 'Lower', 'greenock'), 'dxc', { ids });
  assert.deepEqual(liveNames(lower), names(PROGRAMME.Lower).filter(nm => nm !== 'Seated leg curl'));
});

t('mid-session: an exercise with a set done stays exactly as it is; the rest switch', () => {
  let S = start(S0(), 'Upper', 'dxc');
  const before = activeOf(S);
  const iPull = liveNames(S).indexOf('Lat pulldown');
  S = toggleDone(updateSet(S, iPull, 0, { weight: 70, reps: 8 }), iPull, 0, 2000);   // one set of pulldowns ticked
  assert.ok(activeOf(S).exercises[iPull].sets[0].done);
  const done = activeOf(S).exercises[iPull];
  const pv = gymSwitchPreview(S, 'greenock');
  assert.ok(!pv.swaps.some(s => s.from === 'Lat pulldown'), 'the started exercise is not in the preview');
  assert.deepEqual(pv.swaps.map(s => s.to), ['Chest-supported row', 'Reverse pec deck (rear delt)', 'Preacher curl machine']);
  const G = setWorkoutGym(S, 'greenock', { ids });
  const a = activeOf(G);
  assert.equal(a.exercises[iPull], done, 'the very same object: sets, numbers, ids');
  assert.deepEqual(liveNames(G), ['Dip', 'Lat pulldown', 'Chest-supported row', 'Dumbbell lateral raise', 'Reverse pec deck (rear delt)', 'Preacher curl machine', 'Single-arm cable triceps pushdown (cuff)']);
  assert.equal(a.exercises.length, before.exercises.length, 'order and count kept');
  assert.equal(a.id, before.id);
  assert.equal(a.startedAt, before.startedAt);
  // Untouched and the same at both gyms: the same exercise object.
  assert.equal(a.exercises[0].liftId, before.exercises[0].liftId);
  // Finishing saves it under Greenock, the swapped lifts included.
  const F = finishWorkout(toggleDone(updateSet(G, 2, 0, { weight: 60, reps: 10 }), 2, 0, 3000), 4000);
  const saved = F.lifts.sessions[F.lifts.sessions.length - 1];
  assert.equal(saved.gym, 'greenock');
  assert.ok(F.lifts.log.every(e => e.gym === 'greenock'));
});

t('a workout that is not following a plan is not rearranged', () => {
  const mine = { id: 'tpl1', name: 'Push - DXC', exercises: [{ liftId: progId('Incline dumbbell press'), sets: 3, reps: '8–10' }, { liftId: progId('45° hyperextension'), sets: 2, reps: '12' }] };
  const S = startWorkout(S0(), { ...templateStart(S0(), mine, DAY.Push, { gym: 'dxc' }), now: 1, today: DAY.Push, ids });
  assert.equal(followsPlan(activeOf(S)), false);
  assert.deepEqual(gymSwitchPreview(S, 'greenock'), { swaps: [], dropped: [] });
  assert.deepEqual(liveNames(setWorkoutGym(S, 'greenock', { ids })), ['Incline dumbbell press', '45° hyperextension']);
  const blank = startWorkout(S0(), { source: 'blank', name: 'Workout', now: 1, today: DAY.Push, ids, gym: 'dxc', exercises: [{ liftId: progId('Lat pulldown'), sets: 2 }] });
  assert.deepEqual(liveNames(setWorkoutGym(blank, 'greenock', { ids })), ['Lat pulldown']);
});

t('an exercise the owner added to a planned session stays when the other gym has it', () => {
  let S = start(S0([...LIST, { id: 'own-fly', name: 'Cable Fly (high to low)', load: 'weight', muscles: ['Chest'] }]), 'Push', 'dxc');
  S = { ...S, lifts: { ...S.lifts, active: { ...activeOf(S), exercises: [...activeOf(S).exercises, { liftId: 'own-fly', sets: [{ id: 'x1', reps: null, weight: null, rpe: null, done: false }] }] } } };
  const G = setWorkoutGym(S, 'greenock', { ids });
  assert.ok(liveNames(G).includes('Cable Fly (high to low)'));
  assert.equal(activeOf(G).exercises.find(ex => ex.liftId === 'own-fly'), activeOf(S).exercises.find(ex => ex.liftId === 'own-fly'));
});

// ── The safety net, and the adaptive build ────────────────────────
t('fitForGym: nothing a gym lacks is shown; with nothing missing the same array comes back', () => {
  const ctx = gym => ({ gym, list: LIST, gymIds: GYMS, gymLabel: gym === 'dxc' ? 'DXC' : 'Greenock' });
  const push = planOf('dxc', 'Push');
  assert.equal(fitForGym(push, ctx('dxc')).exercises, push);
  assert.equal(fitForGym(push, ctx('greenock')).exercises, push);
  assert.equal(fitForGym(push, { ...ctx('dxc'), gym: null }).exercises, push);
  // DXC's Legs handed to Greenock: the plans name the hyperextension's counterpart.
  const legs = fitForGym(planOf('dxc', 'Legs'), ctx('greenock'));
  assert.deepEqual(legs.swaps, [{ from: '45° hyperextension', to: 'Lower back machine' }]);
  assert.equal(legs.exercises[0].sets, 4);
  assert.deepEqual(legs.exercises[0].tags, [{ kind: 'gym', text: 'Not at Greenock: 45° hyperextension' }]);
  // Greenock's Push at DXC: no counterpart is named for a Greenock exercise, so the closest thing DXC has.
  const back = fitForGym([{ name: 'Incline Smith Machine Bench', sets: 3, reps: '8–10' }], ctx('dxc'));
  assert.deepEqual(back.swaps, [{ from: 'Incline Smith Machine Bench', to: 'Incline dumbbell press' }]);
  // Nothing close: left out, and said.
  const lower = fitForGym(planOf('dxc', 'Lower'), ctx('dxc'));
  assert.deepEqual(lower.dropped, ['Seated leg curl']);
  assert.equal(lower.exercises.length, PROGRAMME.Lower.length - 1);
  // A lift the owner ties to one gym later is respected without touching the plans.
  const tied = LIST.map(l => (l.name === 'Machine shoulder press' ? { ...l, only: 'greenock' } : l));
  const f = fitForGym(push, { ...ctx('dxc'), list: tied });
  assert.ok(!names(f.exercises).includes('Machine shoulder press'));
});

t('archiving the gym a lift is tied to frees the lift', () => {
  const L = setGymArchived({ list: LIST, log: [], sessions: [], gyms: DEFAULT_GYMS.map(g => ({ ...g })) }, 'greenock', true).lifts;
  assert.deepEqual(activeGyms(L).map(g => g.id), ['dxc']);
  assert.deepEqual(suggestWorkout({ lifts: L }, DAY.Lower, { gym: 'dxc' }).gymFit, { swaps: [], dropped: [] }, 'with Greenock gone, the leg curl is not ruled out');
});

t('the adaptive Upper and Lower are built from the chosen gym’s plan, and only from what it has', () => {
  const done = (date, code, gym) => ({ id: `w-${date}`, date, startedAt: 1, finishedAt: 2, name: code, rotaSession: code, gym,
    exercises: req(programmeFor(gym)[code]).map(x => ({ liftId: progId(x.name), sets: Array.from({ length: x.sets }, () => ({ reps: 8, weight: 50, done: true })) })) });
  const week = gym => S0(LIST, { sessions: [done('2026-10-05', 'Legs', gym), done(DAY.Push, 'Push', gym), done(DAY.Pull, 'Pull', gym), done(DAY.Legs, 'Legs', gym)] });
  const ctx = gym => ({ gym, gymIds: GYMS });
  for (const gym of GYMS) {
    for (const code of ['Upper', 'Lower']) {
      const r = buildAdaptive(week(gym), DAY[code], code, ctx(gym));
      assert.ok(r && r.exercises.length, `${gym} ${code} builds`);
      for (const x of r.exercises) assert.ok(availableAt({ name: x.name }, gym), `${gym} ${code}: ${x.name} is at ${gym}`);
      const sug = suggestWorkout(week(gym), DAY[code], { gym });
      for (const x of sug.exercises) assert.ok(availableAt({ name: x.name }, gym), `${gym} ${code} suggestion: ${x.name}`);
    }
  }
  // A week on plan at Greenock comes out close to Greenock's written Upper.
  const up = buildAdaptive(week('greenock'), DAY.Upper, 'Upper', ctx('greenock'));
  const written = new Set(names(PROGRAMME_GREENOCK.Upper));
  assert.ok(names(up.exercises).filter(nm => written.has(nm)).length >= 5, names(up.exercises).join(', '));
  // No gym given: the builder is exactly as it was.
  assert.deepEqual(buildAdaptive(week('dxc'), DAY.Upper, 'Upper'), buildAdaptive(week('dxc'), DAY.Upper, 'Upper', {}));
});

t('"machine" no longer reads as a chin-up: an untagged machine bench is chest', () => {
  assert.deepEqual(musclesOf({ name: 'Incline Smith bench machine' }), ['Chest']);
  assert.deepEqual(musclesOf({ name: 'Chin-up' }), ['Back']);
});

console.log(`gym plan: ${n} tests passed`);

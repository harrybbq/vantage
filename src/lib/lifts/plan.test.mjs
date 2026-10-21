/**
 * The session plan (plan.js): derived from the rota, the owner's
 * overrides (which win) and finished workouts — never written to
 * S.rotation. Scenarios: on-plan week, Push on a Legs day, the 48-hour
 * skip, two sessions in a day, training on a rest day, a missed day,
 * a finished block, manual overrides, night shifts, effectiveOverrides
 * leaving the owner's overrides untouched, and the diet planner / plan
 * targets following a swapped session.
 * Invented data only — this file is public. Run: npm run check:lifts
 */
import assert from 'node:assert/strict';
import {
  plannedSessions, plannedOn, blockProgress, effectiveOverrides, doneSessionOn, doneSessionsOn, sessionOfWorkout,
  SESSION_MUSCLES, EXTRA,
} from './plan.js';
import { suggestWorkout, PROGRAMME_MUSCLES, planStrip } from './workout.js';
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { SEQ as SEQ_CHECK } from '../rotation/pattern.js';
import { planDays } from '../diet/planner.js';
import { planDayFor } from '../plan/planDay.js';
import { scheduleOf } from '../rotation/pattern.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};

// Default rota: day block 2026-10-11 Sun Push · 12 Pull · 13 Legs · 14 Upper ·
// 15 Off Lower · 16–18 rest; night block 10-19 Push … 10-23 Lower · 24–26 rest.
const B = { push: '2026-10-11', pull: '2026-10-12', legs: '2026-10-13', upper: '2026-10-14', lower: '2026-10-15', rest1: '2026-10-16', rest2: '2026-10-17' };
// A workout logged before this block: tracking has started, so a training
// day that passes empty here is MISSED (not assumed done).
const ANCHOR = { id: 'w-anchor', date: '2026-10-05', startedAt: 1, finishedAt: 2, name: 'Legs', source: 'suggested', rotaSession: 'Legs',
  exercises: [{ liftId: 'lp', sets: [{ reps: 8, weight: 100, done: true }] }] };

let k = 10;
const W = (date, code, extra = {}) => ({
  id: `w${++k}`, date, startedAt: k * 1000, finishedAt: k * 1000 + 500, name: code || 'Workout', source: code ? 'suggested' : 'blank',
  ...(code ? { rotaSession: code } : {}), exercises: [{ liftId: 'lp', sets: [{ reps: 8, weight: 100, done: true }] }], ...extra,
});
const LIST = [{ id: 'lp', name: 'Machine leg press', load: 'weight' }];
const S_ = (sessions, overrides, extra = {}) => ({
  lifts: { list: LIST, log: [], sessions: [ANCHOR, ...sessions] },
  ...(overrides ? { rotation: { overrides } } : {}),
  ...extra,
});
const sessionsOf = (S, from, days, today) => plannedSessions(S, { from, days, today }).map(p => p.session);
const srcOf = (S, from, days, today) => plannedSessions(S, { from, days, today }).map(p => p.source);

// ── The map ──
t('SESSION_MUSCLES: every primary group is trained by that session in PROGRAMME', () => {
  for (const [code, ms] of Object.entries(SESSION_MUSCLES)) {
    const tagged = new Set(PROGRAMME[code].flatMap(x => PROGRAMME_MUSCLES[x.name] || []));
    for (const m of ms) assert.ok(tagged.has(m), `${code}: ${m} is on one of its exercises`);
  }
  assert.deepEqual(Object.keys(SESSION_MUSCLES), SEQ_CHECK);
  assert.deepEqual(SESSION_MUSCLES.Push, ['Chest', 'Shoulders', 'Triceps']);
  assert.deepEqual(SESSION_MUSCLES.Pull, ['Back', 'Biceps']);
  assert.deepEqual(SESSION_MUSCLES.Legs, ['Quads', 'Hamstrings', 'Calves']);
  assert.deepEqual(SESSION_MUSCLES.Lower, ['Glutes', 'Hamstrings', 'Quads', 'Calves']);
});
t('sessionOfWorkout: rotaSession first, else inferred from the lifts trained', () => {
  assert.equal(sessionOfWorkout({ rotaSession: 'Pull', exercises: [] }), 'Pull');
  assert.equal(sessionOfWorkout({ rotaSession: 'Arms', exercises: [] }), 'Arms', 'a hand-set session stays what it was');
  for (const code of SEQ_CHECK) {
    const list = PROGRAMME[code].map((x, i) => ({ id: `${code}${i}`, name: x.name }));
    const w = { exercises: PROGRAMME[code].map((x, i) => ({ liftId: `${code}${i}`, sets: Array.from({ length: x.sets }, () => ({ done: true })) })) };
    assert.equal(sessionOfWorkout(w, list), code, `a blank workout of the ${code} exercises reads as ${code}`);
  }
  assert.equal(sessionOfWorkout({ exercises: [{ liftId: 'x', sets: [{ done: true }] }] }, [{ id: 'x', name: 'Mystery move' }]), null);
});

// ── No workouts: the rota, untouched ──
t('no workouts logged → the plan is the rota and effectiveOverrides is the owner’s own object', () => {
  const raw = { [B.legs]: { session: 'Arms' } };
  const S = { lifts: { list: LIST, log: [], sessions: [] }, rotation: { overrides: raw } };
  assert.deepEqual(sessionsOf(S, B.push, 8, B.push), ['Push', 'Pull', 'Arms', 'Upper', 'Lower', 'Rest', 'Rest', 'Rest']);
  assert.deepEqual(srcOf(S, B.push, 3, B.push), ['pattern', 'pattern', 'manual']);
  assert.equal(effectiveOverrides(S, { today: B.push }), raw, 'same object — every consumer byte-for-byte as before');
  const bare = effectiveOverrides({}, { today: B.push });
  assert.deepEqual(bare, {});
  assert.equal(effectiveOverrides({}, { today: B.push }), bare, 'stable identity');
  assert.equal(plannedSessions({}, { from: '2026-01-01', days: 3, today: B.push }).length, 0, 'before the pattern: nothing');
});

t('on-plan week: done days, then the rota; nothing derived', () => {
  const S = S_([W(B.push, 'Push'), W(B.pull, 'Pull')]);
  const p = plannedSessions(S, { from: B.push, days: 8, today: B.legs });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Rest', 'Rest']);
  assert.deepEqual(p.map(x => x.source), ['done', 'done', 'pattern', 'pattern', 'pattern', 'pattern', 'pattern', 'pattern']);
  assert.deepEqual(p.map(x => x.trainingDay), [true, true, true, true, true, false, false, false]);
  assert.ok(p.every(x => !x.moved && !x.missed));
  assert.deepEqual(p[0].done, ['Push']);
  const bp = blockProgress(S, B.legs);
  assert.deepEqual(bp.done, ['Push', 'Pull']);
  assert.deepEqual(bp.owed, ['Legs', 'Upper', 'Lower']);
  assert.equal(bp.label, '2 of 5 this block · Legs, Upper, Lower to do');
  assert.equal(bp.start, B.push);
  assert.equal(bp.end, '2026-10-18', 'the rest days after a block belong to it');
  assert.deepEqual(effectiveOverrides(S, { today: B.legs }), {}, 'on plan: nothing to override');
  assert.equal(doneSessionOn(S, B.pull), 'Pull');
  assert.equal(doneSessionOn(S, B.legs), null);
});

t('Push on a Legs day → Legs carried to the next day (the reason says why)', () => {
  // Sun Push missed, Mon Pull done, Tue (Legs day) did Push.
  const S = S_([W(B.pull, 'Pull'), W(B.legs, 'Push')]);
  const p = plannedSessions(S, { from: B.push, days: 5, today: B.upper });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Pull', 'Push', 'Legs', 'Upper']);
  assert.deepEqual(p.map(x => x.source), ['pattern', 'done', 'done', 'dynamic', 'dynamic']);
  assert.equal(p[0].missed, true, 'Sunday passed with no workout');
  assert.equal(p[0].why, 'Push missed here — done later this block', 'a missed anchor done later still counts as Push');
  assert.equal(p[2].moved, true, 'Push on a Legs day');
  assert.equal(p[3].why, 'Legs — moved from yesterday, you did Push yesterday');
  assert.notEqual(p[3].session, 'Upper', 'the day after Push is not Upper');
  const bp = blockProgress(S, B.upper);
  assert.equal(bp.label, '2 of 5 this block · Legs, Upper, Lower to do');
  // The same block seen from Tuesday evening: tomorrow is Legs.
  assert.equal(plannedOn(S, B.upper, B.legs).session, 'Legs');
  assert.match(plannedOn(S, B.upper, B.legs).why, /^Legs — moved from Tuesday, you did Push today$/);
});

t('the 48-hour rule: after Push, tomorrow skips Upper and takes the next owed session', () => {
  // Sun did Legs (swap), Mon Pull, Tue (Legs day) Push → owed Upper, Lower.
  const S = S_([W(B.push, 'Legs'), W(B.pull, 'Pull'), W(B.legs, 'Push')]);
  const p = plannedSessions(S, { from: B.upper, days: 2, today: B.legs });
  assert.deepEqual(p.map(x => x.session), ['Lower', 'Upper'], 'Upper shares chest/shoulders/triceps with Push');
  assert.match(p[0].why, /^Lower — brought forward from Thursday, you did Push today, Upper would hit the same muscles inside 48 h$/);
  assert.equal(p[1].why, 'Upper — moved from Wednesday, you did Push today');
  // Two days later the 48 h are up: nothing is skipped for that reason.
  const strip = planStrip(S, B.legs, 5);
  assert.deepEqual(strip.map(d => d.session), ['Lower', 'Upper', 'Rest', 'Rest', 'Rest']);
  assert.ok(strip[0].moved && strip[1].moved);
});

t('two sessions in one day cross off both', () => {
  const S = S_([W(B.push, 'Push'), W(B.push, 'Pull')]);
  assert.deepEqual(doneSessionsOn(S, B.push), ['Push', 'Pull']);
  assert.equal(doneSessionOn(S, B.push), 'Push');
  assert.deepEqual(sessionsOf(S, B.push, 5, B.push), ['Push', 'Legs', 'Upper', 'Lower', EXTRA]);
  const e = plannedOn(S, B.lower, B.push);
  assert.equal(e.session, EXTRA);
  assert.equal(e.why, 'Every session of this block is done — anything now is extra');
  assert.deepEqual(blockProgress(S, B.push).done, ['Push', 'Pull']);
});

t('training on a rest day reclaims a missed anchor; the rest day stays a rest day', () => {
  const S = S_([W(B.pull, 'Pull'), W(B.legs, 'Legs'), W(B.upper, 'Upper'), W(B.lower, 'Lower')]);
  // Thursday night: Push was missed on Sunday — an anchor, so accepted as missed, not owed.
  assert.deepEqual(blockProgress(S, B.rest1).owed, []);
  assert.deepEqual(blockProgress(S, B.rest1).missed, ['Push']);
  assert.equal(blockProgress(S, B.rest1).label, '4 of 5 this block · block complete · Push missed');
  assert.equal(plannedOn(S, B.rest1, B.rest1).session, 'Rest', 'the plan changes WHAT, not WHETHER');
  const S2 = S_([W(B.pull, 'Pull'), W(B.legs, 'Legs'), W(B.upper, 'Upper'), W(B.lower, 'Lower'), W(B.rest1, 'Push')]);
  const bp = blockProgress(S2, B.rest2);
  assert.equal(bp.label, '5 of 5 this block · block complete');
  assert.equal(bp.extras, 0);
  const d = plannedOn(S2, B.rest1, B.rest2);
  assert.equal(d.source, 'done');
  assert.equal(d.session, 'Push');
  assert.equal(d.trainingDay, false);
  assert.deepEqual(effectiveOverrides(S2, { today: B.rest2 })[B.rest1], { session: 'Push', derived: 'done' });
});

t('a missed anchor is accepted (Upper picks it up); a missed Upper or Lower carries forward', () => {
  const S = S_([]);
  const p = plannedSessions(S, { from: B.push, days: 5, today: B.pull });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Pull', 'Legs', 'Upper', 'Lower'], 'the rota stands: Push is not crammed in');
  assert.equal(p[0].missed, true);
  assert.equal(p[0].why, 'Push missed — Upper picks up a set for each muscle it owed');
  assert.equal(blockProgress(S, B.pull).label, '0 of 5 this block · Pull, Legs, Upper, Lower to do · Push missed');
  const sug = suggestWorkout(S, B.pull);
  assert.equal(sug.name, 'Pull');
  // Upper missed on Wednesday: it carries to Thursday, as before.
  const U = S_([W(B.push, 'Push'), W(B.pull, 'Pull'), W(B.legs, 'Legs')]);
  const q = plannedSessions(U, { from: B.upper, days: 2, today: B.lower });
  assert.deepEqual(q.map(x => x.session), ['Upper', 'Upper']);
  assert.equal(q[0].why, 'Upper missed — it carries forward');
  // A missed Legs points at Lower.
  const G = S_([W(B.push, 'Push'), W(B.pull, 'Pull')]);
  assert.equal(plannedOn(G, B.legs, B.upper).why, 'Legs missed — Lower picks up a set for each muscle it owed');
});

t('before the first workout ever logged, past days count as the rota (no reshuffle on day one)', () => {
  const S = { lifts: { list: LIST, log: [], sessions: [W(B.legs, 'Legs')] } };
  const p = plannedSessions(S, { from: B.push, days: 5, today: B.legs });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Pull', 'Legs', 'Upper', 'Lower']);
  assert.ok(!p[0].missed && !p[1].missed);
  assert.equal(blockProgress(S, B.legs).label, '3 of 5 this block · Upper, Lower to do');
});

t('block completed early → the training days left say Extra; another workout is an extra', () => {
  const S = S_([W(B.push, 'Push'), W(B.push, 'Pull'), W(B.pull, 'Legs'), W(B.pull, 'Upper'), W(B.legs, 'Lower')]);
  assert.deepEqual(sessionsOf(S, B.upper, 2, B.legs), [EXTRA, EXTRA]);
  assert.equal(blockProgress(S, B.legs).label, '5 of 5 this block · block complete');
  const S2 = S_([...S.lifts.sessions.slice(1), W(B.upper, 'Push')]);
  assert.equal(blockProgress(S2, B.upper).label, '5 of 5 this block · block complete · 1 extra');
  const sug = suggestWorkout(S, B.upper);
  assert.equal(sug.name, 'Extra session');
  assert.equal(sug.restDay, false);
  assert.deepEqual(sug.exercises, []);
});

t('manual overrides win over done and over the plan; a future pin is reserved', () => {
  const raw = { [B.pull]: { session: 'Arms' }, [B.legs]: { session: 'Legs', note: 'pinned' } };
  const S = S_([W(B.pull, 'Push')], raw);
  const p = plannedSessions(S, { from: B.push, days: 5, today: B.pull });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Arms', 'Legs', 'Pull', 'Lower']);
  assert.deepEqual(p.map(x => x.source), ['pattern', 'manual', 'manual', 'dynamic', 'pattern']);
  assert.deepEqual(p[1].done, ['Push'], 'the workout still counts — Push is crossed off');
  assert.equal(p[3].session, 'Pull', 'Legs is pinned by hand, so it isn’t placed twice');
  assert.equal(p[4].session, 'Lower', 'Upper would follow Pull (back, biceps) inside 48 h');
  const eff = effectiveOverrides(S, { today: B.pull });
  assert.equal(eff[B.pull], raw[B.pull], 'the owner’s entries are the same objects');
  assert.equal(eff[B.legs], raw[B.legs]);
  assert.deepEqual(eff[B.upper], { session: 'Pull', derived: 'dynamic' });
  assert.equal(eff[B.lower], undefined, 'Lower on the Lower day: nothing to override');
});

t('a hand-set Arms day drops the session it replaced; a hand swap moves it', () => {
  const arms = S_([W(B.push, 'Push')], { [B.legs]: { session: 'Arms' } });
  assert.deepEqual(sessionsOf(arms, B.push, 5, B.pull), ['Push', 'Pull', 'Arms', 'Upper', 'Lower'], 'Legs is not pushed into Upper’s day');
  assert.equal(blockProgress(arms, B.pull).label, '1 of 4 this block · Pull, Upper, Lower to do');
  const swap = S_([W(B.push, 'Push')], { [B.legs]: { session: 'Upper' } });
  const p = plannedSessions(swap, { from: B.push, days: 5, today: B.pull });
  assert.deepEqual(p.map(x => x.session), ['Push', 'Pull', 'Upper', 'Legs', 'Lower'], 'Upper by hand on Tuesday → Legs takes Wednesday');
  assert.equal(p[3].why, 'Legs — moved from Tuesday');
});

t('night shifts keep the 80% load scale on a moved session', () => {
  const NIGHT = { push: '2026-10-19', pull: '2026-10-20' };
  const S = S_([], null, {});
  S.lifts.list = [...LIST, { id: 'pd', name: 'Lat pulldown', load: 'weight' }];
  S.lifts.log = [{ id: 'l1', liftId: 'pd', date: '2026-10-14', weight: 60, reps: 8, createdAt: 1, gym: 'dxc' }];
  const e = plannedOn(S, NIGHT.pull, NIGHT.pull);
  assert.equal(e.session, 'Pull', 'Monday night’s Push was missed — accepted, not carried');
  assert.equal(e.night, true);
  assert.equal(e.loadScale, 0.8);
  const sug = suggestWorkout(S, NIGHT.pull, { gym: 'dxc' });
  assert.equal(sug.name, 'Pull');
  assert.equal(sug.night, true);
  assert.equal(sug.exercises.find(x => x.name === 'Lat pulldown').weight, 47.5, '60 × 0.8 = 48 → 47.5');
});

t('effectiveOverrides leaves the owner’s overrides byte-identical and never writes S', () => {
  const raw = { '2026-10-01': { leave: 'annual', note: 'away' }, [B.legs]: { session: 'Arms' } };
  const S = S_([W('2026-10-06', 'Pull'), W(B.push, 'Legs')], raw);
  const before = JSON.stringify(S);
  const deepFreeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };
  deepFreeze(S);
  const eff = effectiveOverrides(S, { today: B.pull });
  assert.equal(JSON.stringify(S), before, 'nothing in S changed');
  for (const k of Object.keys(raw)) {
    assert.equal(eff[k], raw[k], `${k}: same object`);
    assert.equal(JSON.stringify(eff[k]), JSON.stringify(raw[k]));
  }
  assert.deepEqual(eff['2026-10-06'], { session: 'Pull', derived: 'done' }, 'a past off-plan workout before this block');
  assert.deepEqual(eff[B.push], { session: 'Legs', derived: 'done' });
  assert.deepEqual(eff[B.pull], { session: 'Push', derived: 'dynamic' }, 'Push carried to today');
  assert.notEqual(eff, raw);
  assert.equal(effectiveOverrides(S, { today: B.pull }), eff, 'memoised on its inputs');
  assert.ok(Object.values(eff).every(v => !v.derived || (Object.keys(v).sort().join() === 'derived,session')));
});

t('diet: planner days and the plan’s targets follow a swapped session', () => {
  const S = S_([W(B.pull, 'Pull'), W(B.legs, 'Push')]);
  const S0 = { lifts: { list: LIST, log: [], sessions: [] }, rotation: {} };
  const Sx = { ...S, rotation: {} };
  const schedule = scheduleOf(Sx);
  const eff = effectiveOverrides(Sx, { today: B.upper });
  const days = planDays(B.push, 8, eff, schedule);
  assert.deepEqual(days.map(d => d.session), ['Push', 'Pull', 'Push', 'Legs', 'Upper', 'Rest', 'Rest', 'Rest']);
  assert.deepEqual(planDays(B.push, 8, effectiveOverrides(S0, { today: B.upper }), schedule).map(d => d.session),
    ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Rest', 'Rest'], 'no workouts: the rota');
  // The owner's day targets (planDay) carry the session carb delta: Upper +15 g → Legs +45 g.
  const was = planDayFor(B.upper, S0, { assumeOwner: true, today: B.upper });
  const now = planDayFor(B.upper, Sx, { assumeOwner: true, today: B.upper });
  assert.equal(was.session, 'Upper');
  assert.equal(now.session, 'Legs');
  assert.equal(now.targets.kcal - was.targets.kcal, 120, '+30 g carbs × 4 kcal');
  // A workout on a rest day is fuelled as the training day it was.
  const R = { ...S_([W(B.rest1, 'Push')]), rotation: {} };
  const rd = planDays(B.rest1, 1, effectiveOverrides(R, { today: B.rest2 }), schedule)[0];
  assert.equal(rd.train, true);
  assert.equal(planDays(B.rest1, 1, {}, schedule)[0].train, false);
  // …but a hand-set session on a rest day keeps the plan's rest targets, as before.
  assert.equal(planDays(B.rest1, 1, { [B.rest1]: { session: 'Push' } }, schedule)[0].train, false);
});

console.log(`plan: ${n} tests passed`);

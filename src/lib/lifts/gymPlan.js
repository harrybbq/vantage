/**
 * Two gyms, two plans (owner, 2026-11-13: "We should have 2 lift plans
 * one per gym and the plan simply switches when I toggle what gym I'm
 * at during the lift session").
 *
 * The plans themselves are WRITTEN — trainingProgramme.js PROGRAMME (DXC)
 * and PROGRAMME_GREENOCK — not worked out by matching muscles. This file
 * is the three small things the rest of the logger needs around them:
 *
 *   planOf(gym, session)   the session as that gym's plan writes it
 *   switchExercise(...)    what one exercise becomes at the other gym —
 *                          how a session in progress changes gym
 *   fitForGym(plan, ctx)   the safety net: a planned exercise the gym
 *                          chosen does not have (lifts.js availableAt)
 *                          is never shown there
 *
 * Each exercise in a non-base plan that takes a different exercise's
 * slot carries `for` (the base plan's name for that slot). That one
 * field is the whole mapping between plans.
 *
 * Pure. Nothing is stored: the plan is read for the gym every time.
 */
import { PROGRAMME, programmeFor } from '../../data/trainingProgramme.js';
import { norm } from './muscles.js';
import { partsOf, GROUP_OF } from './adaptive.js';
import { availableAt, bannedRule } from './lifts.js';

/** A stand-in for a missing exercise with a different main part must be at least this close. */
export const MIN_STANDIN = 0.7;

const same = (a, b) => norm(a) === norm(b);
const slotOf = x => x.for || x.name;
const plain = x => { const o = { name: x.name, sets: x.sets, reps: x.reps }; if (x.optional) o.optional = true; return o; };

/** A session as one gym's plan writes it → [{ name, sets, reps, optional? }], or null when it is not a programme session. */
export function planOf(gym, session) {
  const list = programmeFor(gym)[session];
  return Array.isArray(list) ? list.map(plain) : null;
}

/** Is this a session the plans write (Push, Pull, Legs, Upper, Lower)? */
export const isPlanSession = session => !!(session && Array.isArray(PROGRAMME[session]));

/**
 * What an exercise becomes when a session moves from one gym to another.
 * → { name, sets, reps, optional? }  its counterpart in the other plan
 *                                    (the same exercise when both plans
 *                                    write it in that slot)
 *   'keep'                           not a slot of this session's plan,
 *                                    and the other gym has it: leave it
 *   null                             the other gym cannot do it and the
 *                                    plan has nothing in its place
 * `can(name)`: can the exercise be done at the gym being moved TO.
 */
export function switchExercise(session, name, fromGym, toGym, can = () => true) {
  const from = programmeFor(fromGym), to = programmeFor(toGym);
  const mine = (from[session] || []).find(x => same(x.name, name));
  if (mine) {
    const theirs = (to[session] || []).find(x => same(slotOf(x), slotOf(mine)));
    if (theirs) return can(theirs.name) ? plain(theirs) : null;
    return can(name) ? 'keep' : null;          // an extra the other plan has no slot for
  }
  if (can(name)) return 'keep';
  // Not this session's (an adaptive pick, or one the owner added): its counterpart from any session.
  const any = Object.values(from).flat().find(x => same(x.name, name));
  const slot = any ? slotOf(any) : name;
  const theirs = Object.values(to).flat().find(x => same(slotOf(x), slot) && can(x.name));
  return theirs ? plain(theirs) : null;
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
const mainPart = parts => Object.entries(parts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
const liftFor = (x, list) => (x.liftId && list.find(l => l && l.id === x.liftId)) || list.find(l => l && !l.archived && same(l.name, x.name)) || null;

/**
 * The safety net. A planned session, and the gym chosen:
 * → { exercises, swaps: [{ from, to }], dropped: [name] }
 * An exercise this gym does not have becomes its counterpart in this
 * gym's plan, else the closest exercise the gym has (same main muscle
 * part; a lift already used ahead of one that never has been), else it
 * is left out and named in `dropped`. A replaced one keeps its sets and
 * reps and gains `swapFor` and a `{ kind: 'gym' }` tag.
 *
 * The written plans are built to need none of this (trainingProgramme
 * tests check): it is for a lift the owner marks one-gym-only later,
 * for the adaptive build, and for a gap in a plan nobody has filled yet.
 * With no gym chosen, or nothing missing, the very same array comes back.
 *
 *   ctx.gym, ctx.list (S.lifts.list), ctx.gymIds (gyms in use),
 *   ctx.gymLabel ("Greenock"), ctx.used (lift ids with sets)
 */
export function fitForGym(exercises, ctx = {}) {
  const { gym = null, list = [], gymIds = null, gymLabel = '', used = null } = ctx;
  const asIs = { exercises, swaps: [], dropped: [] };
  if (!gym || !Array.isArray(exercises) || !exercises.length) return asIs;
  const lifts = (list || []).filter(l => l && !l.archived && !bannedRule(l));
  const here = x => availableAt(liftFor(x, lifts) || { name: x.name }, gym, gymIds);
  if (exercises.every(here)) return asIs;

  const out = exercises.map(x => ({ ...x }));
  const swaps = [], dropped = [];
  const taken = new Set(out.map(x => norm(x.name)));
  const label = gymLabel || 'this gym';
  const pool = () => {
    const m = new Map();
    for (const l of lifts) if (here(l)) m.set(norm(l.name), { name: l.name, liftId: l.id, parts: partsOf(l), own: true, known: !!(used && used.has(l.id)) });
    for (const x of Object.values(programmeFor(gym)).flat()) {
      const k = norm(x.name);
      if (!m.has(k) && here({ name: x.name })) m.set(k, { name: x.name, parts: partsOf({ name: x.name }), reps: x.reps, own: false, known: false });
    }
    return [...m.values()].filter(c => Object.keys(c.parts).length);
  };
  for (let i = 0; i < out.length; i++) {
    if (here(out[i])) continue;
    const from = out[i].name;
    const lift = liftFor(out[i], lifts);
    let best = null;
    // Its counterpart in this gym's plan, when the plans name one.
    const other = Object.values(programmeFor(gym)).flat().find(x => x.for && same(x.for, from) && here({ name: x.name }) && !taken.has(norm(x.name)));
    if (other) best = { name: other.name, liftId: (liftFor({ name: other.name }, lifts) || {}).id };
    if (!best) {
      const want = partsOf(lift || { name: from });
      const main = mainPart(want);
      for (const c of pool()) {
        if (taken.has(norm(c.name))) continue;
        const sameMain = mainPart(c.parts) === main;
        const cos = cosine(want, c.parts);
        if (!sameMain && !(GROUP_OF[mainPart(c.parts)] === GROUP_OF[main] && cos >= MIN_STANDIN)) continue;
        const score = cos + (sameMain ? 1 : 0) + (c.known ? 0.05 : 0) + (c.own ? 0 : 0.02);
        if (!best || score > best.score + 1e-9) best = { ...c, score };
      }
    }
    taken.delete(norm(from));
    if (!best) { dropped.push(from); out[i] = null; continue; }
    const tags = (out[i].tags || []).filter(t => t.kind !== 'gym');
    const next = { ...out[i], name: best.name, swapFor: from, tags: [...tags, { kind: 'gym', text: `Not at ${label}: ${from}` }] };
    if (best.liftId) next.liftId = best.liftId; else delete next.liftId;
    if (!next.reps && best.reps) next.reps = best.reps;
    out[i] = next;
    taken.add(norm(best.name));
    swaps.push({ from, to: best.name });
  }
  return { exercises: out.filter(Boolean), swaps, dropped };
}

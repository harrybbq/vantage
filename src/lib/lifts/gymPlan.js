/**
 * The session plan, fitted to the gym (owner, 2026-11-13: "the app
 * should adjust the session plan based on what gym is selected").
 *
 * The two gyms do not hold the same kit. DXC is the smaller one and the
 * programme was written to work there; Greenock has all of that and
 * more. A lift can be marked as done at one gym only (lifts.js
 * onlyGymOf: the lift's own `only`, else GYM_ONLY's default for its
 * name). fitForGym takes a planned session and the gym chosen and
 * returns the session as it can actually be run there:
 *
 *   1. NOT HERE. A planned exercise that only another gym has is
 *      replaced by the closest exercise this gym does have: the same
 *      main muscle part, the nearest overall (cosine of the part
 *      weights, adaptive.js partsOf), a lift already used ahead of one
 *      that never has been. Same sets and reps. Nothing close → it is
 *      left out and the plan says so.
 *   2. ONLY HERE. A lift this gym alone has is there to be used, so it
 *      takes the place of the planned exercise it is closest to (same
 *      main part, cosine ≥ MIN_MATCH) — the incline Smith bench for the
 *      incline dumbbell press at Greenock. One for one, best match
 *      first, and never in place of something that is itself only here.
 *
 * The owner can overrule the matching per lift (`lift.swapFor`, set in
 * Manage lifts): a NAME — it replaces exactly that exercise, and is what
 * the lift falls back to at a gym without it; `false` — it replaces
 * nothing (it stays on the list and in the picker, the plan leaves it
 * alone). Absent → the closest match, as above.
 *
 * Every swap is tagged on the exercise (`{ kind: 'gym' }`) and listed in
 * `swaps`, so the card can say what moved and why. Sets, reps and order
 * are the plan's; only WHICH exercise changes. With no gym chosen, or
 * nothing marked, the very same array comes back.
 *
 * Pure. Nothing is stored: the plan is worked out for the gym each time.
 */
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { norm } from './muscles.js';
import { partsOf, GROUP_OF } from './adaptive.js';
import { onlyGymOf, availableAt, bannedRule } from './lifts.js';

/** An only-here lift must be at least this close to the exercise it replaces. */
export const MIN_MATCH = 0.6;
/** A stand-in for a missing exercise with a different main part must be at least this close. */
export const MIN_STANDIN = 0.7;

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
const mainPart = parts => Object.entries(parts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

const PROGRAMME_ROWS = (() => {
  const out = new Map();
  for (const code of Object.keys(PROGRAMME)) for (const x of PROGRAMME[code]) if (!out.has(norm(x.name))) out.set(norm(x.name), x);
  return out;
})();

const liftFor = (x, list) => (x.liftId && list.find(l => l && l.id === x.liftId)) || list.find(l => l && !l.archived && norm(l.name) === norm(x.name)) || null;

/**
 * → { exercises, swaps: [{ from, to, why: 'missing' | 'only' }], dropped: [name] }
 *   exercises   the plan's items; a swapped one keeps its sets / reps /
 *               optional and gains `name`, `liftId` (or none), `swapFor`
 *               (the planned name) and a `{ kind: 'gym', text }` tag
 *   ctx.gym     the gym chosen (null → nothing changes)
 *   ctx.list    S.lifts.list
 *   ctx.gymIds  ids of the gyms in use (a retired gym restricts nothing)
 *   ctx.gymLabel  "Greenock", for the tag
 *   ctx.used    Set of lift ids with sets logged (familiar ones win ties)
 */
export function fitForGym(exercises, ctx = {}) {
  const { gym = null, list = [], gymIds = null, gymLabel = '', used = null } = ctx;
  const same = { exercises, swaps: [], dropped: [] };
  if (!gym || !Array.isArray(exercises) || !exercises.length) return same;
  const lifts = (list || []).filter(l => l && !l.archived && !bannedRule(l));
  const here = l => availableAt(l, gym, gymIds);
  const onlyHere = lifts.filter(l => onlyGymOf(l, gymIds) === gym);
  const missing = exercises.some(x => !here(liftFor(x, lifts) || { name: x.name }));
  if (!missing && !onlyHere.length) return same;

  const out = exercises.map(x => ({ ...x }));
  const swaps = [], dropped = [];
  const taken = new Set(out.map(x => norm(x.name)));
  const label = gymLabel || 'this gym';
  const put = (i, to, why) => {
    const from = out[i].name;
    const tags = (out[i].tags || []).filter(t => t.kind !== 'gym');
    taken.delete(norm(from));
    const next = { ...out[i], name: to.name, swapFor: from, tags: [...tags, { kind: 'gym', text: why === 'only' ? `${label} · for ${from}` : `Not at ${label}: ${from}` }] };
    if (to.liftId) next.liftId = to.liftId; else delete next.liftId;
    if (!next.reps && to.reps) next.reps = to.reps;
    out[i] = next;
    taken.add(norm(to.name));
    swaps.push({ from, to: to.name, why });
  };

  // 1. Not here → the closest exercise this gym has.
  const pool = () => {
    const m = new Map();
    for (const l of lifts) if (here(l)) m.set(norm(l.name), { name: l.name, liftId: l.id, parts: partsOf(l), own: true, known: !!(used && used.has(l.id)) });
    for (const [k, x] of PROGRAMME_ROWS) if (!m.has(k) && here({ name: x.name })) m.set(k, { name: x.name, parts: partsOf({ name: x.name }), reps: x.reps, own: false, known: false });
    return [...m.values()].filter(c => Object.keys(c.parts).length);
  };
  for (let i = 0; i < out.length; i++) {
    const lift = liftFor(out[i], lifts);
    if (here(lift || { name: out[i].name })) continue;
    const want = partsOf(lift || { name: out[i].name });
    const main = mainPart(want);
    let best = null;
    const all = pool();
    // The owner named its counterpart: that, if this gym has it and it is free.
    const named = lift && typeof lift.swapFor === 'string' && lift.swapFor ? all.find(c => norm(c.name) === norm(lift.swapFor) && !taken.has(norm(c.name))) : null;
    if (named) best = named;
    for (const c of best ? [] : all) {
      if (taken.has(norm(c.name))) continue;
      const sameMain = mainPart(c.parts) === main;
      const cos = cosine(want, c.parts);
      if (!sameMain && !(GROUP_OF[mainPart(c.parts)] === GROUP_OF[main] && cos >= MIN_STANDIN)) continue;
      const score = cos + (sameMain ? 1 : 0) + (c.known ? 0.05 : 0) + (c.own ? 0 : 0.02);
      if (!best || score > best.score + 1e-9) best = { ...c, score };
    }
    if (best) put(i, best, 'missing');
    else { dropped.push(out[i].name); taken.delete(norm(out[i].name)); out[i] = null; }
  }

  // 2. Only here → in place of the planned exercise it is closest to.
  const pairs = [];
  for (const l of onlyHere) {
    if (taken.has(norm(l.name)) || l.swapFor === false) continue;
    if (typeof l.swapFor === 'string' && l.swapFor) {
      // Named by the owner: that exercise, when this session has it; nothing otherwise.
      const i = out.findIndex(x => x && !x.swapFor && norm(x.name) === norm(l.swapFor));
      if (i >= 0) pairs.push({ l, i, cos: 2 });
      continue;
    }
    const mine = partsOf(l);
    const main = mainPart(mine);
    if (!main) continue;
    out.forEach((x, i) => {
      if (!x || x.swapFor) return;
      const xl = liftFor(x, lifts);
      if (onlyGymOf(xl || { name: x.name }, gymIds) === gym) return;
      const theirs = partsOf(xl || { name: x.name });
      if (mainPart(theirs) !== main) return;
      const cos = cosine(mine, theirs);
      if (cos >= MIN_MATCH) pairs.push({ l, i, cos });
    });
  }
  pairs.sort((a, b) => b.cos - a.cos || a.i - b.i);
  const usedLift = new Set(), usedSlot = new Set();
  for (const p of pairs) {
    if (usedLift.has(p.l.id) || usedSlot.has(p.i)) continue;
    usedLift.add(p.l.id); usedSlot.add(p.i);
    put(p.i, { name: p.l.name, liftId: p.l.id }, 'only');
  }

  if (!swaps.length && !dropped.length) return same;
  return { exercises: out.filter(Boolean), swaps, dropped };
}

/** "Incline Smith Machine Bench for Incline dumbbell press" — one line per swap, for the card. */
export function swapLines(fit, gymLabel = '') {
  const at = gymLabel || 'this gym';
  return [
    ...(fit.swaps || []).map(s => (s.why === 'only' ? `${s.to} in for ${s.from} (only at ${at})` : `${s.to} in for ${s.from} (not at ${at})`)),
    ...(fit.dropped || []).map(n => `${n} left out: not at ${at}, and nothing close is`),
  ];
}

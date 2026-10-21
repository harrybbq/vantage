/**
 * The body map after a workout: how much of what the programme asks of
 * each muscle this workout delivered. Pure.
 *
 * Owner, Oct 2026: "a heatmap of a body showing where the workout
 * emphasised … if I don't hit the correct amount of exercise per muscle
 * group then that depicts how opaque the colour on each muscle group
 * is." So a muscle's colour is filled in proportion to sets done ÷ sets
 * the session asks of it, and full when the target is met.
 *
 * ── Counting ─────────────────────────────────────────────────────────
 * Working sets only: a warm-up ('W') is not work the target counts. A
 * set credits every muscle tagged on its lift (muscles.js musclesOf):
 * the FIRST tag in full, the others at half — a dip is a chest exercise
 * that also works triceps and shoulders, not three exercises.
 *
 * ── Targets ──────────────────────────────────────────────────────────
 * The workout's session (plan.js sessionOfWorkout — its rotaSession,
 * else inferred from what it trained) and that session's exercises in
 * the programme (src/data/trainingProgramme.js), counted the same way.
 * Optional exercises ("sometimes") are left out: they are not a gap when
 * they are missing, so they cannot be one here either.
 *
 * A muscle the session does not ask for, or a workout that is not one of
 * the five sessions, is measured against the most any session asks of
 * that muscle — the most the programme ever wants of it in one go.
 */
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { musclesOf, PROGRAMME_MUSCLES, MUSCLES } from './muscles.js';
import { sessionOfWorkout } from './plan.js';

const SECONDARY = 0.5;
/** Muscles the figure draws. 'Other' has nowhere to go. */
export const MAP_MUSCLES = MUSCLES.filter(m => m !== 'Other');

const credit = (tags, sets, into) => {
  tags.forEach((m, i) => { into[m] = (into[m] || 0) + sets * (i === 0 ? 1 : SECONDARY); });
  return into;
};
const round1 = n => Math.round(n * 10) / 10;

/** What the programme asks of each muscle in one session → { [muscle]: sets }. */
export function sessionTargets(code) {
  const out = {};
  for (const x of PROGRAMME[code] || []) {
    if (x.optional) continue;
    credit(PROGRAMME_MUSCLES[x.name] || [], Number(x.sets) || 0, out);
  }
  return out;
}

/** The most any session asks of each muscle → { [muscle]: sets }. */
export const PEAK_TARGETS = (() => {
  const out = {};
  for (const code of Object.keys(PROGRAMME)) {
    for (const [m, n] of Object.entries(sessionTargets(code))) out[m] = Math.max(out[m] || 0, n);
  }
  return out;
})();

/** Working sets a finished workout put into each muscle → { [muscle]: sets }. */
export function workoutLoad(w, list = []) {
  const out = {};
  for (const ex of (w && w.exercises) || []) {
    const lift = list.find(l => l && l.id === ex.liftId);
    const n = (ex.sets || []).filter(s => s && s.done !== false && s.type !== 'W').length;
    if (n) credit(musclesOf(lift), n, out);
  }
  return out;
}

/**
 * → { session, muscles: [{ muscle, done, target, ratio, planned }] } —
 * one row per drawable muscle. `ratio` 0‥1 is what the figure fills;
 * `planned` is whether this session asks for the muscle at all.
 */
export function bodyMap(w, list = []) {
  const session = sessionOfWorkout(w, list);
  const targets = session ? sessionTargets(session) : {};
  const load = workoutLoad(w, list);
  const muscles = MAP_MUSCLES.map(muscle => {
    const planned = (targets[muscle] || 0) > 0;
    const target = planned ? targets[muscle] : (PEAK_TARGETS[muscle] || 0);
    const done = load[muscle] || 0;
    const ratio = target > 0 ? Math.min(1, done / target) : done > 0 ? 1 : 0;
    return { muscle, done: round1(done), target: round1(target), ratio, planned };
  });
  return { session, muscles };
}

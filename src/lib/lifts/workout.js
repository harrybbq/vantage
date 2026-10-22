/**
 * The workout logger (Upgrade → Lifts, owner-only) — modelled on the
 * flow of the owner's gym app: a suggested workout for today, a live
 * session with a set table per exercise (Set · Previous · Reps · KG ·
 * RPE · ✓) and a summary on Finish.
 *
 * Pure: no React, no network, no clock. `now`, `today` and id makers are
 * parameters, so workout.test.mjs can pin every number.
 *
 * ── Data (all inside S.lifts, all additive — store.js has the rules) ──
 *   active    the workout in progress, persisted on every edit so a
 *             refresh, a sleeping phone or a closed app never loses it.
 *             { id, date, startedAt, name, source, rotaSession?, shift?,
 *               (restSec / rest on workouts started before 2026-10-21: ignored),
 *               exercises: [{ liftId, note?, target?, pending?: { key, name, load, muscles },
 *                             sets: [{ id, reps, weight, rpe?, type?: 'W'|'D'|'F', done }] }] }
 *             Only one at a time: startWorkout is a no-op while one exists.
 *   sessions  finished workouts (same shape, done sets only, plus
 *             finishedAt and durationSec), newest last, at most 400.
 *   templates saved from a summary: { id, name, exercises: [{ liftId, sets, reps? }] }
 *
 * ── One source of truth for PBs ──────────────────────────────────────
 * Finish appends every DONE set to S.lifts.log as an ordinary entry
 * carrying `sessionId`, pushes the session and clears `active` — in ONE
 * write. So the PB tables, the chart and the home card read the log
 * exactly as they did before workouts existed. Entry ids are derived
 * from the session id (`<sessionId>-<exercise>-<set>`), which makes
 * Finish idempotent: a second call (or the same workout finished on two
 * devices, merged by id) can never append a set twice.
 *
 * ── Suggested workout ────────────────────────────────────────────────
 * Today's rota session (shiftOn: the pattern + the owner's overrides) →
 * PROGRAMME[session] with its target sets × reps. Weights come from the
 * last DAY-shift time that lift was trained; on a night shift they are
 * scaled to NIGHT_LOAD_SCALE (80%) and rounded to the nearest 2.5 kg.
 * (Scaling a night from a night would compound to 64%, so a night base
 * is used as it stands.) Rest day / leave / off-pattern → restDay.
 *
 * Programme exercises not yet in the owner's list are created LAZILY
 * (Oct 2026 — loading a template used to create lift records that
 * survived Discard). Starting a workout never touches S.lifts.list: such
 * an exercise carries `pending: { key, name, load, muscles }` and its
 * liftId is the key. The lift is created — fixed id `prog-<slug>` so two
 * devices merge it by id, load type guessed from the name, muscle tags
 * from PROGRAMME_MUSCLES — when its first set is ticked, or at Finish
 * for done sets. Idempotent; Discard leaves the list exactly as it was.
 * The screens read a pending exercise's lift through exerciseLift /
 * listWithPending, a virtual lift that is never written.
 *
 * ── Previous by shift ────────────────────────────────────────────────
 * A day session's Previous is the last DAY time; a night session's is the
 * last NIGHT time, else the last day time × 0.8 rounded to the lift's step
 * (previousSession). Night is compared with night, never read as a drop.
 *
 * ── Gyms ─────────────────────────────────────────────────────────────
 * A workout is at one gym (`gym` on active / session / every set it
 * writes), defaulting to S.lifts.lastGym. For a perGym lift (a machine)
 * Previous, the pre-filled weights and the summary's PBs come from that
 * gym only; free weights read across gyms (lifts.js has the rule).
 *
 * ── The day's session is the PLAN's (plan.js) ───────────────────────
 * The suggestion follows plannedSessions(today): the rota, the owner's
 * Rotation overrides (which win), and what was actually trained — Push
 * on a Legs day moves Legs on. Nothing is written to S.rotation.
 *
 * Not built (yet): supersets and unilateral logging.
 */
import { PROGRAMME, SESSION_CODES, NIGHT_LOAD_SCALE } from '../../data/trainingProgramme.js';
import { shiftOn } from '../rotation/pattern.js';
import {
  num, isIso, addDays, dayNo, personalBests, pbBasis, pbHeadline, setText, shortLiftName, entriesFor, workingEntries, perGymOf, gymOf,
  stepFor, isWarmup, SET_TYPES,
} from './lifts.js';
import { liftsOf, withLifts, makeEntry, LIMITS, newId, defaultGym, setLastGym, withGyms, gymName, gymList } from './store.js';
import { PROGRAMME_MUSCLES, musclesOf, norm } from './muscles.js';
import { cataloguePending } from './catalogue.js';
import { plannedSessions, blockProgress, EXTRA, ANCHOR_CODES } from './plan.js';
import { buildAdaptive, trimForRed, readinessOn, RED_RPE_CAP } from './adaptive.js';

const ADAPTIVE_CODES = ['Upper', 'Lower'];

export { MUSCLES, PROGRAMME_MUSCLES, musclesOf } from './muscles.js';

const EPS = 1e-9;
export const MAX_SESSIONS = 400;
export const RECENT_N = 10;
export const RPE_CHIPS = [5, 6, 7, 8, 9, 10];
/** The pad's RPE chips (Oct 2026): 6–10 in half steps, one hue. */
export const RPE_STEPS = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];

/** Load type from a name: a dip carries bodyweight, a dumbbell is per hand, else the number on the stack. */
export function guessLoad(name) {
  const n = String(name || '');
  if (/\bdips?\b/i.test(n)) return 'bodyweight_plus';
  if (/dumbbell/i.test(n)) return 'per_hand';
  return 'weight';
}

/** "Incline dumbbell curl, 21s" → "prog-incline-dumbbell-curl-21s" (stable across devices). */
export { gymName };

export const progId = name => `prog-${norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** A target rep string as one number: "8–12" → 8, "7 + 7 + 7" → 21, "10 per leg" → 10. */
export function parseReps(reps) {
  const s = String(reps == null ? '' : reps);
  if (/\d\s*\+\s*\d/.test(s)) return s.split('+').map(x => parseInt(x, 10)).filter(Number.isFinite).reduce((a, b) => a + b, 0) || null;
  const m = /\d+/.exec(s);
  return m ? Number(m[0]) : null;
}

/** Round to the nearest `step` kg (2.5 by default), never below 0. */
export const roundTo = (v, step = 2.5) => Math.max(0, Math.round(num(v) / step) * step);

const findByName = (list, name) => {
  const n = norm(name);
  return list.find(l => !l.archived && norm(l.name) === n) || list.find(l => norm(l.name) === n) || null;
};

// ── Previous ───────────────────────────────────────────────────────

/**
 * The sets of the last time `liftId` was trained → { date, shift,
 * sessionId, sets: [{ reps, weight, rpe }] } | null. "A time" is one
 * finished workout (entries sharing a sessionId) or, for sets logged one
 * at a time with Quick Log, one date. opts.skipNight: the last DAY-shift
 * time instead. opts.before: only times before this ISO date.
 * opts.gym (when present): a perGym lift's times at that gym only.
 * opts.onlyNight: the last NIGHT-shift time. opts.lift: the lift (for a
 * pending exercise, which isn't in the list yet).
 * Each set carries `type` when it was a warm-up / drop / failure set.
 */
export function previousSets(S, liftId, opts = {}) {
  const L = liftsOf(S);
  let all = entriesFor(L.log, { id: liftId });
  if ('gym' in opts && perGymOf(opts.lift || L.list.find(l => l.id === liftId))) all = all.filter(e => gymOf(e) === (opts.gym || null));
  const pool = all.filter(e => (!opts.skipNight || e.shift !== 'night') && (!opts.onlyNight || e.shift === 'night') && (!opts.before || e.date < opts.before));
  if (!pool.length) return null;
  const last = pool[pool.length - 1];
  const key = e => (e.sessionId ? `s:${e.sessionId}` : `d:${e.date}`);
  const k = key(last);
  const sets = pool.filter(e => key(e) === k);
  return {
    date: last.date, shift: last.shift || null, sessionId: last.sessionId || null,
    sets: sets.map(e => {
      const o = { reps: num(e.reps), weight: num(e.weight), rpe: num(e.rpe) };
      if (SET_TYPES.includes(e.type)) o.type = e.type;
      return o;
    }),
  };
}

/**
 * Previous for a workout, by its shift → { date, shift, sessionId, sets,
 * source: 'day'|'night'|'day×0.8', scaled } | null. Same shape as
 * previousSets, so `sets[i]` is "the same set last time".
 *   day session    the last day-shift time; with only night history, that
 *                  (source 'night', as lifted)
 *   night session  the last NIGHT time (source 'night'); else the last day
 *                  time with weights × scale (0.8) rounded to the lift's
 *                  step (source 'day×0.8', scaled: true)
 * opts: { gym, night, scale = NIGHT_LOAD_SCALE, lift }
 */
export function previousSession(S, liftId, opts = {}) {
  const { night = false, scale = NIGHT_LOAD_SCALE } = opts;
  const lift = opts.lift || liftsOf(S).list.find(l => l.id === liftId) || null;
  const g = 'gym' in opts ? { gym: opts.gym || null } : {};
  if (night) {
    const n = previousSets(S, liftId, { ...g, lift, onlyNight: true });
    if (n) return { ...n, source: 'night', scaled: false };
    const d = previousSets(S, liftId, { ...g, lift, skipNight: true });
    if (!d) return null;
    const step = stepFor(lift, opts.gym || null);
    return {
      ...d, source: 'day×0.8', scaled: true,
      sets: d.sets.map(st => ({ ...st, weight: st.weight == null ? null : roundTo(st.weight * scale, step) })),
    };
  }
  const d = previousSets(S, liftId, { ...g, lift, skipNight: true });
  if (d) return { ...d, source: 'day', scaled: false };
  const n = previousSets(S, liftId, { ...g, lift });
  return n ? { ...n, source: 'night', scaled: false } : null;
}

/** The active workout's Previous for one exercise (its gym, its shift). */
export function previousForExercise(S, active, ex) {
  if (!active || !ex) return null;
  return previousSession(S, ex.liftId, { gym: active.gym || null, night: active.shift === 'night', lift: exerciseLift(liftsOf(S).list, ex) });
}

// ── Pending lifts (created on first tick, never on start) ───────────

/** The lift a pending descriptor stands for — the record it WILL be. Never written by this function. */
export function liftFromPending(pending, now = 0) {
  if (!pending || !pending.key || !pending.name) return null;
  const name = String(pending.name).trim().slice(0, LIMITS.name);
  const load = ['weight', 'bodyweight_plus', 'per_hand'].includes(pending.load) ? pending.load : guessLoad(name);
  const lift = { id: pending.key, name, load, unit: 'kg', createdAt: num(now) || 0 };
  if (Array.isArray(pending.muscles) && pending.muscles.length) lift.muscles = pending.muscles.slice(0, 12);
  return lift;
}
/** An exercise's lift: the list's, else a virtual one from `pending` (not in the list yet, `pending: true`), else null. */
export function exerciseLift(list, ex) {
  if (!ex) return null;
  const l = (list || []).find(x => x.id === ex.liftId);
  if (l) return l;
  const v = ex.pending ? liftFromPending(ex.pending) : null;
  return v ? { ...v, pending: true } : null;
}
/** The list plus a virtual lift for each pending exercise of `active` — for READING (names, load types, volume). */
export function listWithPending(list, active) {
  const base = Array.isArray(list) ? list : [];
  if (!active || !Array.isArray(active.exercises)) return base;
  const extra = [];
  for (const ex of active.exercises) {
    if (!ex || !ex.pending || base.some(l => l.id === ex.liftId) || extra.some(l => l.id === ex.liftId)) continue;
    const v = exerciseLift(base, ex);
    if (v) extra.push(v);
  }
  return extra.length ? [...base, ...extra] : base;
}
/**
 * Create the lift a pending exercise stands for → { lifts, ex }. Idempotent:
 * an id already in the list is not added twice; a lift of the same name
 * that appeared meanwhile is used instead (the exercise is re-pointed).
 * The exercise loses `pending` once its lift exists.
 */
function materialise(lifts, ex, now) {
  if (!ex || !ex.pending) return { lifts, ex };
  const list = lifts.list || [];
  const strip = id => { const o = { ...ex, liftId: id }; delete o.pending; return o; };
  if (list.some(l => l.id === ex.liftId)) return { lifts, ex: strip(ex.liftId) };
  const same = findByName(list, ex.pending.name);
  if (same) return { lifts, ex: strip(same.id) };
  const lift = liftFromPending(ex.pending, now);
  if (!lift) return { lifts, ex };
  return { lifts: { ...lifts, list: [...list, lift] }, ex: strip(lift.id) };
}

/** "180×8", "BW+20×8", "32×8" — the Previous column, tight enough for a 360 px phone. */
export function prevText(p, lift) {
  if (!p || num(p.reps) == null) return '—';
  const w = num(p.weight);
  const ws = w == null ? '—' : lift && lift.load === 'bodyweight_plus' ? (w === 0 ? 'BW' : `BW+${trim(w)}`) : trim(w);
  return `${ws}×${p.reps}`;
}
const trim = v => String(Math.round(v * 100) / 100);

/**
 * Pre-filled rows for `sets` sets of a lift: weights from the last
 * day-shift time (scaled to 80% on a night), reps from that time or the
 * target's first number. → { rows: [{ reps, weight }], base, scaled }
 * `gym`: for a perGym lift, only that gym's history.
 */
export function planFor(S, lift, { sets, reps, night = false, gym } = {}) {
  const n = Math.max(1, Math.min(20, Math.round(num(sets) || 1)));
  const id = lift && lift.id;
  const g = gym === undefined ? {} : { gym };
  const dayBase = id ? previousSets(S, id, { skipNight: true, ...g }) : null;
  const anyBase = id ? previousSets(S, id, g) : null;
  const base = dayBase || anyBase;
  const scaled = !!(night && base && base.shift !== 'night');
  const target = parseReps(reps);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const b = base && base.sets.length ? base.sets[Math.min(i, base.sets.length - 1)] : null;
    let w = b ? b.weight : null;
    if (w != null && scaled) w = roundTo(w * NIGHT_LOAD_SCALE, 2.5);
    rows.push({ reps: b && b.reps != null ? b.reps : target, weight: w });
  }
  return { rows, base, scaled };
}

// ── Suggested workout ──────────────────────────────────────────────

/** Rough minutes for a session: ~2.4 min a set (work + 90 s rest) + a minute to set up each exercise, to the nearest 5. */
export function estimateMinutes(exercises) {
  const live = (exercises || []).filter(x => !x.optional);
  const sets = live.reduce((a, x) => a + (num(x.sets) || 0), 0);
  if (!sets) return 0;
  return Math.max(5, Math.round((sets * 2.4 + live.length) / 5) * 5);
}

const agoWords = (iso, today) => {
  const d = dayNo(today) - dayNo(iso);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/**
 * → { name, rotaSession, shift, label, restDay, exercises:
 *     [{ liftKey, liftId, name, sets, reps, optional, weight, rows }], reason, minutes, night,
 *     gym, plan, block }
 * The session is the plan's for today (plan.js): `plan` is that entry
 * (source, why, moved), `block` the block's progress. `weight` is the
 * first set's pre-fill (null when the lift has never been trained at
 * this gym — or anywhere, for a free weight); `rows` every set's.
 * opts.gym: the gym to plan weights for (default: S.lifts.lastGym).
 */
export function suggestWorkout(S, today, opts = {}) {
  const day = isIso(today) ? shiftOn(S, today) : null;
  const L = liftsOf(S);
  const gym = opts.gym !== undefined ? opts.gym : defaultGym(L);
  const plan = day ? plannedSessions(S, { from: today, days: 1, today })[0] || null : null;
  const block = day ? blockProgress(S, today) : null;
  const out = { name: 'Rest day today', rotaSession: null, shift: day ? day.shift : null, label: day ? day.label : '', restDay: true, exercises: [], reason: '', minutes: 0, night: false, gym, plan, block };
  if (!day) return { ...out, reason: 'Today sits outside your rota pattern — build your own if you’re training.' };
  const shiftWord = day.shift === 'off' ? 'Day off' : day.shift === 'leave' ? day.label.split(' · ')[0] : day.label.split(' · ')[0];
  if (plan && plan.source === 'done') {
    const next = plannedSessions(S, { from: addDays(today, 1), days: 7, today }).find(p => p.trainingDay);
    return {
      ...out, name: `${plan.done.join(' + ') || 'Workout'} done`,
      reason: `${plan.why} today.${next ? ` Next: ${next.session} ${dayWord(next.iso, today)}.` : ''}`,
    };
  }
  if (day.shift === 'leave') return { ...out, reason: `${day.label.split(' · ')[0]} on your rota — rest, or build your own.` };
  const session = plan ? plan.session : day.session;
  if (session === 'Rest') return { ...out, reason: `${day.shift === 'off' ? 'Off' : day.label.split(' · ')[0]} · rest day on your rota.` };
  if (session === EXTRA) {
    return { ...out, restDay: false, name: 'Extra session', rotaSession: null, reason: `${shiftWord} · ${plan.why}. Build your own, or take the day.` };
  }
  const prog = PROGRAMME[session];
  if (!prog) {
    return { ...out, restDay: false, name: `${session} day`, rotaSession: session, reason: `${session} isn’t one of the five programme sessions — build your own.` };
  }
  const night = day.shift === 'night';
  // Adaptive training (adaptive.js): Upper / Lower are built from what the
  // week still owes; an anchor on a WHOOP-red day loses a set an exercise.
  const readiness = readinessOn(S, today);
  const red = !!(readiness && readiness.band === 'red');
  const built = ADAPTIVE_CODES.includes(session) ? buildAdaptive(S, today, session) : null;
  const isAnchor = ANCHOR_CODES.includes(session);
  let plan0 = built && built.exercises.length ? built.exercises : prog.map(x => ({ ...x }));
  if (isAnchor && red) plan0 = trimForRed(plan0).map(x => ({ ...x, tags: [{ kind: 'red', text: `≤ RPE ${x.rpeCap}` }] }));
  const exercises = plan0.map(x => {
    const lift = (x.liftId && L.list.find(l => l.id === x.liftId)) || findByName(L.list, x.name);
    const { rows } = planFor(S, lift, { sets: x.sets, reps: x.reps, night, gym });
    const out = {
      liftKey: lift ? lift.id : progId(x.name), liftId: lift ? lift.id : null, name: lift ? lift.name : x.name,
      sets: x.sets, reps: x.reps, optional: !!x.optional, weight: rows[0] ? rows[0].weight : null, rows,
    };
    if (x.why) out.why = x.why;
    if (x.tags && x.tags.length) out.tags = x.tags;
    if (x.setsWas != null && x.setsWas !== x.sets) out.setsWas = x.setsWas;
    if (x.rpeCap) out.rpeCap = x.rpeCap;
    return out;
  });
  const missed = (block && block.missed) || [];
  const adaptive = {
    notes: built ? built.notes : red && isAnchor ? [`WHOOP recovery ${readiness.score}% · red — one set fewer an exercise, every set to about RPE ${RED_RPE_CAP}.`] : [],
    catchUp: built ? built.catchUp : [],
    catchUpSets: built ? built.catchUpSets || 0 : 0,
    missedSets: built ? built.missedSets || 0 : 0,
    belowStandard: missed.length > 0,
    readiness,
    built: !!(built && built.exercises.length),
    red,
  };
  const sessions = L.sessions || [];
  let last = null;
  for (const s of sessions) if (s && s.rotaSession === session && isIso(s.date) && s.date < today && (!last || s.date > last.date)) last = s;
  const lastWords = last ? `Last ${session} ${agoWords(last.date, today)}.` : `Your first ${session} logged here.`;
  const why = plan && plan.source === 'dynamic' ? `${plan.why}.` : `${session} on your rota.`;
  const reason = `${shiftWord} · ${why} ${lastWords}`;
  return {
    ...out, name: session, rotaSession: session, restDay: false, night, exercises, reason,
    minutes: estimateMinutes(exercises), adaptive,
  };
}

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayWord = (iso, today) => {
  const d = dayNo(iso) - dayNo(today);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  const [y, m, dd] = iso.split('-').map(Number);
  return DOW3[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
};

/**
 * The plan for the `n` days after `today`, for the Today card's strip:
 * [{ iso, dow, date, session, shift, chip, night, moved, source, why, trainingDay }].
 */
export function planStrip(S, today, n = 5) {
  if (!isIso(today)) return [];
  return plannedSessions(S, { from: addDays(today, 1), days: n, today }).map(p => {
    const [y, m, d] = p.iso.split('-').map(Number);
    return {
      iso: p.iso, dow: DOW3[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], date: d,
      session: p.trainingDay || p.source === 'manual' ? p.session : 'Rest', shift: p.shift, chip: p.chip, night: p.night,
      moved: p.moved, source: p.source, why: p.why, trainingDay: p.trainingDay,
    };
  });
}

/** Mon–Sun of the week holding `today`: [{ iso, dow, date, session (the plan's), shift, chip, trained, today, moved }]. */
export function weekStrip(S, today) {
  if (!isIso(today)) return [];
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const mon = addDays(today, -dow);
  const plan = new Map(plannedSessions(S, { from: mon, days: 7, today }).map(p => [p.iso, p]));
  const trained = new Set();
  const L = liftsOf(S);
  for (const s of L.sessions || []) if (s && isIso(s.date)) trained.add(s.date);
  for (const e of L.log) if (e && isIso(e.date)) trained.add(e.date);
  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i);
    const r = shiftOn(S, iso);
    const p = plan.get(iso);
    const ses = p ? p.session : r && r.session;
    const session = r && r.shift !== 'leave' && ses && ses !== 'Rest' ? ses : null;
    return { iso, dow: DOW[i], date: Number(iso.slice(8)), session, shift: r ? r.shift : null, chip: r ? r.chip : '', trained: trained.has(iso), today: iso === today, moved: !!(p && p.moved) };
  });
}

/** Finished workouts in the Mon–Sun week holding `today`. */
export function workoutsThisWeek(S, today) {
  const strip = weekStrip(S, today);
  if (!strip.length) return 0;
  const from = strip[0].iso, to = strip[6].iso;
  return (liftsOf(S).sessions || []).filter(s => s && isIso(s.date) && s.date >= from && s.date <= to).length;
}

// ── The active workout ─────────────────────────────────────────────

export const activeOf = S => {
  const a = S && S.lifts && S.lifts.active;
  return a && typeof a === 'object' && Array.isArray(a.exercises) ? a : null;
};

/** Whole seconds since the workout started. */
export const elapsedSec = (active, now) => (active ? Math.max(0, Math.floor((num(now) - num(active.startedAt)) / 1000)) : 0);

/** 754 → "12:34", 4000 → "1:06:40". */
export function clock(sec) {
  const s = Math.max(0, Math.floor(num(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
/** 1380 → "23 min", 4000 → "1 h 6 min". */
export function minutesText(sec) {
  const m = Math.floor(Math.max(0, num(sec) || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function withActive(prev, fn) {
  const a = activeOf(prev);
  if (!a) return prev;
  const next = fn(a);
  if (!next || next === a) return prev;
  return withLifts(prev, l => ({ ...l, active: next }));
}
const mapEx = (a, ei, fn) => {
  const ex = a.exercises[ei];
  if (!ex) return a;
  const nx = fn(ex);
  if (!nx || nx === ex) return a;
  const exercises = a.exercises.slice();
  exercises[ei] = nx;
  return { ...a, exercises };
};
const mapSet = (a, ei, si, fn) => mapEx(a, ei, ex => {
  const st = ex.sets[si];
  if (!st) return ex;
  const ns = fn(st);
  if (!ns || ns === st) return ex;
  const sets = ex.sets.slice();
  sets[si] = ns;
  return { ...ex, sets };
});

const row = (id, reps = null, weight = null) => ({ id, reps: num(reps), weight: num(weight), rpe: null, done: false });

/**
 * Start a workout → next state. A no-op while one is in progress.
 * opts: { now, today, source: 'suggested'|'blank'|'recent'|'template', name,
 *         rotaSession?, shift?, gym?, exercises: [{ liftId? | liftKey?, name?, sets, reps?, rows? }], ids?,
 *         prefill?, templateId? }
 * prefill: false leaves every row EMPTY (the redesigned live table shows
 * Previous as each cell's placeholder and ✓ commits it — the Stronger
 * model); the default keeps the pre-filled rows. templateId (a saved
 * template's id) lets Finish offer "Update template".
 * `gym` defaults to the last gym; it is remembered as lastGym.
 * An exercise naming a lift the list doesn't have (a programme exercise
 * on first use) is added as PENDING — the list is not touched; the lift
 * is created on its first ticked set (toggleDone) or at Finish.
 */
export function startWorkout(prev, opts = {}) {
  if (activeOf(prev)) return prev;
  const { now = 0, today, source = 'blank', name, rotaSession, shift, ids = newId } = opts;
  if (!isIso(today)) return prev;
  return withLifts(prev, l0 => {
    const gym = opts.gym !== undefined ? opts.gym : defaultGym(l0);
    const l = gym ? setLastGym(withGyms(l0), gym) : l0;
    const list = l.list;
    const exercises = [];
    for (const x of opts.exercises || []) {
      const lift = list.find(t => t.id === (x.liftId || x.liftKey)) || (x.name ? findByName(list, x.name) : null);
      let pending = null;
      if (!lift && x.name) {
        const nm = String(x.name).trim().slice(0, LIMITS.name);
        if (!nm) continue;
        const ms = PROGRAMME_MUSCLES[nm] || musclesOf({ name: nm });
        pending = { key: x.liftKey || progId(nm), name: nm, load: guessLoad(nm), muscles: ms.length ? ms : [] };
      }
      const id = lift ? lift.id : pending ? pending.key : null;
      if (!id || exercises.some(e => e.liftId === id)) continue;
      const rows = opts.prefill !== false && Array.isArray(x.rows) && x.rows.length ? x.rows
        : Array.from({ length: Math.max(1, Math.round(num(x.sets) || 1)) }, () => ({ reps: null, weight: null }));
      const ex = { liftId: id, sets: rows.map(r => row(ids('st'), r.reps, r.weight)) };
      if (pending) ex.pending = pending;
      if (x.reps) ex.target = String(x.reps);
      if (x.optional) ex.optional = true;
      exercises.push(ex);
    }
    const active = {
      id: ids('wk'), date: today, startedAt: now, name: String(name || 'Workout').slice(0, LIMITS.name), source,
      exercises,
    };
    if (rotaSession) active.rotaSession = rotaSession;
    if (shift) active.shift = shift;
    if (gym) active.gym = gym;
    if (opts.templateId) active.templateId = String(opts.templateId);
    return { ...l, active };
  }, now);
}

/**
 * "Build my own" starts an empty workout straight away (the clock runs
 * while you choose). Picking Recent or Library then fills it — only
 * while it is still empty, keeping its id and start time.
 */
export function fillEmptyWorkout(prev, opts = {}) {
  const a = activeOf(prev);
  if (!a || a.exercises.length) return prev;
  const next = startWorkout(withLifts(prev, l => ({ ...l, active: null })), {
    ...opts, now: a.startedAt, today: a.date, ids: keepId(a.id, opts.ids || newId), gym: a.gym || opts.gym,
  });
  return activeOf(next) ? next : prev;
}
const keepId = (id, ids) => { let used = false; return p => (p === 'wk' && !used ? (used = true, id) : ids(p)); };

/** The suggestion, ready for startWorkout. `prefill: false` → empty rows (placeholders). */
export function suggestedStart(sug, { prefill = true } = {}) {
  return {
    ...(prefill === false ? { prefill: false } : {}),
    source: 'suggested', name: sug.name, rotaSession: sug.rotaSession, shift: sug.shift, ...(sug.gym ? { gym: sug.gym } : {}),
    exercises: sug.exercises.map(x => ({ liftId: x.liftId, liftKey: x.liftKey, name: x.name, sets: x.sets, reps: x.reps, optional: x.optional, rows: x.rows })),
  };
}

/**
 * Add lifts to the workout, one set each (more if the last time had
 * more), left EMPTY: the Previous column shows what to beat and ✓ on an
 * empty row copies it. Lifts already in the workout are skipped.
 */
export function addExercises(prev, liftIds, { ids = newId } = {}) {
  const want = (liftIds || []).filter(Boolean);
  return withActive(prev, a => {
    const list = liftsOf(prev).list;
    const add = [];
    for (const want0 of want) {
      // A catalogue pick is added pending (its lift is created when a set is
      // ticked); one whose name is already a lift uses that lift instead.
      const cat = list.some(l => l.id === want0) ? null : cataloguePending(want0);
      const same = cat ? findByName(list, cat.name) : null;
      const id = same ? same.id : want0;
      const pending = cat && !same ? cat : null;
      if ((!pending && !list.some(l => l.id === id)) || a.exercises.some(e => e.liftId === id) || add.some(e => e.liftId === id)) continue;
      const p = pending ? null : previousSets(prev, id, { gym: a.gym || null });
      const n = p ? Math.max(1, Math.min(10, p.sets.length)) : 1;
      const ex = { liftId: id, sets: Array.from({ length: n }, () => row(ids('st'))) };
      if (pending) ex.pending = pending;
      add.push(ex);
    }
    return add.length ? { ...a, exercises: [...a.exercises, ...add] } : a;
  });
}

/** Add a set to exercise `ei`, copying the last row's reps and weight. */
export function addSet(prev, ei, { ids = newId } = {}) {
  return withActive(prev, a => mapEx(a, ei, ex => {
    const last = ex.sets[ex.sets.length - 1];
    return { ...ex, sets: [...ex.sets, row(ids('st'), last ? last.reps : null, last ? last.weight : null)] };
  }));
}

const cleanNum = (v, { int = false } = {}) => {
  if (v === '' || v == null) return null;
  const n = num(typeof v === 'string' ? v.replace(',', '.') : v);
  if (n == null) return null;
  return int ? Math.round(n) : Math.round(n * 100) / 100;
};

/** Patch one set's reps / weight / rpe (empty → null). Same values → no write. */
export function updateSet(prev, ei, si, patch = {}) {
  return withActive(prev, a => mapSet(a, ei, si, st => {
    const next = { ...st };
    if ('reps' in patch) next.reps = cleanNum(patch.reps, { int: true });
    if ('weight' in patch) next.weight = cleanNum(patch.weight);
    if ('rpe' in patch) next.rpe = cleanNum(patch.rpe);
    return next.reps === st.reps && next.weight === st.weight && next.rpe === st.rpe ? st : next;
  }));
}

/** Why a set can't be ticked yet, or null. A dip with no weight is a bodyweight dip (0). */
export function setProblem(st, lift) {
  const r = num(st && st.reps);
  if (r == null) return 'Enter reps';
  if (!Number.isInteger(r) || r < LIMITS.reps[0] || r > LIMITS.reps[1]) return 'Reps must be 1–50';
  const w = num(st.weight) ?? (lift && lift.load === 'bodyweight_plus' ? 0 : null);
  if (w == null) return 'Enter a weight';
  if (w < LIMITS.weight[0] || w > LIMITS.weight[1]) return 'Weight must be 0–1000 kg';
  if (st.rpe != null && (num(st.rpe) < LIMITS.rpe[0] || num(st.rpe) > LIMITS.rpe[1])) return 'RPE is 1–10';
  return null;
}


/**
 * ✓ a set (or un-✓ it). Ticking an empty field fills it from Previous
 * (the same set index of the last time — by shift, previousSession), as
 * the gym app does; a set that still isn't a valid set is refused (prev
 * returned — see setProblem). Ticking creates a pending exercise's lift.
 * (It started a rest timer until 2026-10-21; the owner found the timer
 * got in the way and it was removed.)
 */
export function toggleDone(prev, ei, si, now = 0, opts = {}) {
  const a = activeOf(prev);
  const ex = a && a.exercises[ei];
  const st = ex && ex.sets[si];
  if (!st) return prev;
  if (st.done) return withActive(prev, x => mapSet(x, ei, si, s => ({ ...s, done: false })));
  const lift = exerciseLift(liftsOf(prev).list, ex);
  // `opts.fill`: the placeholders the screen showed ({ reps, weight }) — what ✓ commits into empty cells.
  const f = opts.fill && typeof opts.fill === 'object' ? opts.fill : null;
  const p = f ? null : previousForExercise(prev, a, ex);
  const pr = f ? { reps: num(f.reps), weight: num(f.weight) } : p && p.sets.length ? p.sets[Math.min(si, p.sets.length - 1)] : null;
  const filled = {
    ...st,
    reps: st.reps ?? (pr ? pr.reps : null),
    weight: st.weight ?? (pr && pr.weight != null ? pr.weight : lift && lift.load === 'bodyweight_plus' ? 0 : null),
  };
  if (setProblem(filled, lift)) return prev;
  if (filled.weight == null) filled.weight = 0;
  return withLifts(prev, l => {
    const y = mapSet(l.active, ei, si, () => ({ ...filled, done: true }));
    let out = { ...l, active: y };
    if (ex.pending) {
      // The first ticked set of a programme exercise creates its lift (once).
      const m = materialise(out, out.active.exercises[ei], now);
      const exercises = out.active.exercises.slice();
      exercises[ei] = m.ex;
      out = { ...m.lifts, active: { ...out.active, exercises } };
    }
    return out;
  });
}

/** Mark a set warm-up 'W' / drop 'D' / failure 'F'; null (or an unknown type) makes it a normal set. */
export function setSetType(prev, ei, si, type) {
  const t = SET_TYPES.includes(type) ? type : null;
  return withActive(prev, a => mapSet(a, ei, si, st => {
    if ((st.type || null) === t) return st;
    const o = { ...st };
    if (t) o.type = t; else delete o.type;
    return o;
  }));
}

export function removeSet(prev, ei, si) {
  return withActive(prev, a => mapEx(a, ei, ex => (ex.sets[si] ? { ...ex, sets: ex.sets.filter((_, i) => i !== si) } : ex)));
}

export function removeExercise(prev, ei) {
  return withActive(prev, a => (a.exercises[ei] ? { ...a, exercises: a.exercises.filter((_, i) => i !== ei) } : a));
}

/**
 * Swap exercise `ei` for another lift: same number of sets and reps, the
 * new lift's last weights, nothing ticked (a done set of the old lift is
 * not a set of the new one). A lift already in the workout is refused.
 */
export function swapExercise(prev, ei, liftId0) {
  const list = liftsOf(prev).list;
  const cat = list.some(l => l.id === liftId0) ? null : cataloguePending(liftId0);
  const same = cat ? findByName(list, cat.name) : null;
  const liftId = same ? same.id : liftId0;
  const pending = cat && !same ? cat : null;
  if (!pending && !list.some(l => l.id === liftId)) return prev;
  return withActive(prev, a => {
    if (a.exercises.some((e, i) => i !== ei && e.liftId === liftId)) return a;
    return mapEx(a, ei, ex => {
      if (ex.liftId === liftId) return ex;
      const p = pending ? null : previousSession(prev, liftId, { gym: a.gym || null, night: a.shift === 'night' });
      const sets = ex.sets.map((s, i) => {
        const b = p && p.sets.length ? p.sets[Math.min(i, p.sets.length - 1)] : null;
        return { ...s, weight: b ? b.weight : null, rpe: null, done: false };
      });
      const out = { liftId, sets };
      if (pending) out.pending = pending;
      if (ex.target) out.target = ex.target;
      return out;
    });
  });
}

export function setNote(prev, ei, note) {
  const n = String(note || '').slice(0, LIMITS.notes);
  return withActive(prev, a => mapEx(a, ei, ex => {
    if ((ex.note || '') === n) return ex;
    const out = { ...ex };
    if (n.trim()) out.note = n; else delete out.note;
    return out;
  }));
}

export function renameWorkout(prev, name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
  return withActive(prev, a => (!n || a.name === n ? a : { ...a, name: n }));
}

/**
 * Move the workout to another gym. Before any set is ticked this is just
 * a switch; with sets done the UI asks first — the done sets keep their
 * numbers and are saved under the new gym (they're tagged on Finish).
 * Not-done rows of a perGym lift still holding the old gym's pre-fill
 * are re-filled from the new gym's history (a typed number is kept).
 * Remembered as lastGym.
 */
export function setWorkoutGym(prev, gym) {
  const a = activeOf(prev);
  if (!a || !gym || (a.gym || null) === gym) return prev;
  const L = liftsOf(prev);
  if (!gymList(L).some(g => g.id === gym)) return prev;
  const night = a.shift === 'night';
  const exercises = a.exercises.map(ex => {
    const lift = exerciseLift(L.list, ex);
    if (!perGymOf(lift)) return ex;
    const target = ex.target || null;
    const was = planFor(prev, lift, { sets: ex.sets.length, reps: target, night, gym: a.gym || null }).rows;
    const now = planFor(prev, lift, { sets: ex.sets.length, reps: target, night, gym }).rows;
    let changed = false;
    const sets = ex.sets.map((st, i) => {
      if (st.done || num(st.weight) !== num(was[i] && was[i].weight)) return st;
      const w = now[i] ? num(now[i].weight) : null;
      if (w === num(st.weight)) return st;
      changed = true;
      return { ...st, weight: w };
    });
    return changed ? { ...ex, sets } : ex;
  });
  return withLifts(prev, l => ({ ...setLastGym(withGyms(l), gym), active: { ...a, gym, exercises } }));
}

/** Done sets in the workout (how many would be re-tagged by a gym change). */
export const doneSetCount = a => (a ? a.exercises.reduce((k, ex) => k + ex.sets.filter(st => st.done).length, 0) : 0);

/**
 * Override the workout's shift: 'night' (80 % load, night Previous) or
 * back to a day session. Previous follows at once. The rota's own shift
 * ('early', 'off' …) is kept in `shiftWas` while overridden to night, so
 * turning night off restores it rather than flattening it to 'day'.
 */
export function setWorkoutShift(prev, shift) {
  const night = shift === 'night';
  return withActive(prev, a => {
    const isNight = a.shift === 'night';
    if (night === isNight) return a;
    const out = { ...a };
    if (night) {
      if (a.shift) out.shiftWas = a.shift;
      out.shift = 'night';
    } else {
      out.shift = a.shiftWas && a.shiftWas !== 'night' ? a.shiftWas : 'day';
      delete out.shiftWas;
    }
    return out;
  });
}

/** Remember that an exercise's lift has had its PB toast this workout (one per exercise per session). */
export function markPbToasted(prev, liftId) {
  if (!liftId) return prev;
  return withActive(prev, a => {
    const cur = Array.isArray(a.pbToasted) ? a.pbToasted : [];
    return cur.includes(liftId) ? a : { ...a, pbToasted: [...cur, liftId] };
  });
}

/**
 * Put a deleted set back at `si` (the Undo of a delete). `liftId` must
 * still be the exercise's lift — if the exercise moved or was swapped the
 * set is not put somewhere it never was. A set id already present is a no-op.
 */
export function insertSet(prev, ei, si, set, liftId) {
  if (!set || !set.id) return prev;
  return withActive(prev, a => mapEx(a, ei, ex => {
    if (liftId && ex.liftId !== liftId) return ex;
    if (ex.sets.some(s => s.id === set.id)) return ex;
    const sets = ex.sets.slice();
    sets.splice(Math.max(0, Math.min(sets.length, si)), 0, set);
    return { ...ex, sets };
  }));
}

/** Put a removed exercise back at `ei` (Undo). An exercise of the same lift already there is a no-op. */
export function insertExercise(prev, ei, ex) {
  if (!ex || !ex.liftId || !Array.isArray(ex.sets)) return prev;
  return withActive(prev, a => {
    if (a.exercises.some(e => e.liftId === ex.liftId)) return a;
    const exercises = a.exercises.slice();
    exercises.splice(Math.max(0, Math.min(exercises.length, ei)), 0, ex);
    return { ...a, exercises };
  });
}

/**
 * The next set to do: the first unticked set of exercise `from` (the one
 * being worked on), else of the first exercise after it with one, else
 * the first anywhere → { ei, si } | null.
 */
export function nextOpenSet(active, from = 0) {
  if (!active) return null;
  const xs = active.exercises || [];
  const n = xs.length;
  if (!n) return null;
  const start = Math.max(0, Math.min(n - 1, Math.round(num(from) || 0)));
  for (let k = 0; k < n; k++) {
    const ei = (start + k) % n;
    const si = (xs[ei].sets || []).findIndex(s => !s.done);
    if (si >= 0) return { ei, si };
  }
  return null;
}

/** → { sets, done, exercises, exercisesDone } — the stats strip's "7/19 sets · 2/6 ex". */
export function planProgress(active) {
  const xs = (active && active.exercises) || [];
  let sets = 0, done = 0, exercisesDone = 0;
  for (const ex of xs) {
    const all = ex.sets || [];
    const d = all.filter(s => s.done).length;
    sets += all.length; done += d;
    if (all.length && d === all.length) exercisesDone++;
  }
  return { sets, done, exercises: xs.length, exercisesDone };
}

/**
 * What the minimised workout's bar says — read-only, from S.lifts.active:
 * → { name, clock, done, sets, text } | null.
 * Never writes: minimising and resuming leave the workout byte-identical.
 */
export function miniBarModel(active, now) {
  if (!active) return null;
  const p = planProgress(active);
  const name = String(active.name || 'Workout');
  const time = clock(elapsedSec(active, now));
  const parts = [name.toUpperCase(), time, `${p.done}/${p.sets}`];
  return { name, clock: time, done: p.done, sets: p.sets, text: parts.join(' · ') };
}

/** Throw the workout away. The log is not touched — nothing was written to it. */
export function discardWorkout(prev) {
  if (!activeOf(prev)) return prev;
  return withLifts(prev, l => ({ ...l, active: null }));
}

// ── Numbers ────────────────────────────────────────────────────────

const doneSets = ex => (ex.sets || []).filter(s => s && s.done !== false);

/**
 * kg moved: Σ weight × reps over done sets. A per-dumbbell lift counts
 * both dumbbells; a dip counts the added weight (bodyweight isn't load
 * the owner put on). `list` is the lift list, for the load types.
 */
export function volume(session, list = []) {
  let v = 0;
  for (const ex of (session && session.exercises) || []) {
    const lift = list.find(l => l.id === ex.liftId);
    const k = lift && lift.load === 'per_hand' ? 2 : 1;
    for (const s of doneSets(ex)) {
      const w = num(s.weight), r = num(s.reps);
      if (w != null && r != null) v += w * r * k;
    }
  }
  return Math.round(v * 100) / 100;
}

/** "12,450 kg" / "0 kg". */
export const volumeText = v => `${Math.round(num(v) || 0).toLocaleString('en-GB')} kg`;

/**
 * The real-set PBs a session hit, against everything logged before it:
 * [{ liftId, lift, entry, heaviest, repMaxes, text }] — one per set that
 * holds a record when the session ends ("New best: Leg press 185 kg × 8 ·
 * new 8RM"). A lift's first ever session is a baseline, not a PB; a tie
 * is not a PB; the e1RM estimate plays no part. A perGym lift is judged
 * against its sets at the session's gym only.
 */
export function sessionPBs(prevLog, session, list = [], { bwOf } = {}) {
  const out = [];
  const before = Array.isArray(prevLog) ? prevLog : [];
  (session && session.exercises || []).forEach((ex, i) => {
    const lift = list.find(l => l.id === ex.liftId);
    if (!lift) return;
    const mine = doneSets(ex)
      .filter(s => !isWarmup(s) && num(s.reps) != null && num(s.weight) != null)
      .map((s, j) => ({ id: `__pb-${i}-${j}`, liftId: lift.id, date: session.date, weight: num(s.weight), reps: num(s.reps), createdAt: Number.MAX_SAFE_INTEGER - 1000 + j }));
    for (const r of pbHits(before, mine, lift, gymOf(session), bwOf)) {
      const entry = { liftId: lift.id, date: session.date, weight: r.entry.weight, reps: r.entry.reps };
      out.push({
        liftId: lift.id, lift, entry, heaviest: r.heaviest, repMaxes: r.repMaxes, was: r.was,
        text: `New best: ${shortLiftName(lift.name)} ${setText(entry, lift)} · ${pbHeadline(r)}`,
      });
    }
  });
  return out;
}

/**
 * Which of `mine` (a session's working sets, as entries with ids) hold a
 * real-set record at the end, against `before` (the log) — a machine's at
 * `gym` only. → [{ entry, heaviest, repMaxes, was }], `was` being the record
 * it beat ({ weight, reps, date }; the heaviest's when it beat that).
 * A lift's first ever session is a baseline (no hits); ties are not PBs.
 */
function pbHits(before, mine, lift, gym, bwOf) {
  if (!mine.length) return [];
  const prior = workingEntries(before, lift).filter(e => !perGymOf(lift) || gymOf(e) === (gym || null));
  if (!prior.length) return [];
  const ids = new Set(mine.map(e => e.id));
  const basis = pbBasis([...prior, ...mine], lift, bwOf);
  const b = personalBests(prior, lift, { bwOf, basis });
  const a = personalBests([...prior, ...mine], lift, { bwOf, basis });
  const byEntry = new Map();
  const hit = (entry, k) => {
    if (!entry || !ids.has(entry.id)) return;
    const cur = byEntry.get(entry.id) || { entry, heaviest: false, repMaxes: [] };
    if (k === 'h') cur.heaviest = true; else cur.repMaxes.push(k);
    byEntry.set(entry.id, cur);
  };
  if (b.heaviest && a.heaviest.value > b.heaviest.value + EPS) hit(a.heaviest.entry, 'h');
  for (const n of Object.keys(a.repMaxes).map(Number)) {
    if (b.repMaxes[n] && a.repMaxes[n] && a.repLoads[n] > b.repLoads[n] + EPS) hit(a.repMaxes[n], n);
  }
  const out = [];
  for (const r of byEntry.values()) {
    r.repMaxes.sort((x, y) => x - y);
    const top = r.repMaxes.length ? r.repMaxes[r.repMaxes.length - 1] : null;
    const w = r.heaviest ? b.heaviest.entry : top != null ? b.repMaxes[top] : null;
    out.push({ ...r, was: w ? { weight: num(w.weight), reps: num(w.reps), date: w.date } : null });
  }
  return out;
}

/**
 * The PB marks for the live set table: which DONE sets of the workout
 * would hold a real-set record if it ended now → Map(setId → { heaviest,
 * repMaxes, was }). Warm-ups never; a machine against the workout's gym;
 * a lift's first session is a baseline. (sessionPBs' rule, keyed by set.)
 */
export function livePbSets(S, { bwOf } = {}) {
  const a = activeOf(S);
  const out = new Map();
  if (!a) return out;
  const L = liftsOf(S);
  for (const ex of a.exercises) {
    const lift = exerciseLift(L.list, ex);
    if (!lift) continue;
    const mine = ex.sets.filter(s => s.done && !isWarmup(s) && num(s.reps) != null && num(s.weight) != null)
      .map((s, j) => ({ id: s.id, liftId: lift.id, date: a.date, weight: num(s.weight), reps: num(s.reps), createdAt: Number.MAX_SAFE_INTEGER - 1000 + j }));
    for (const r of pbHits(L.log, mine, lift, a.gym || null, bwOf)) {
      out.set(r.entry.id, { heaviest: r.heaviest, repMaxes: r.repMaxes, was: r.was });
    }
  }
  return out;
}

/** A session's best working set of a lift (heaviest; more reps on a tie) → { weight, reps } | null. */
const topSet = sets => {
  let best = null;
  for (const s of sets || []) {
    if (isWarmup(s)) continue;
    const w = num(s.weight), r = num(s.reps);
    if (w == null || r == null) continue;
    if (!best || w > best.weight + EPS || (Math.abs(w - best.weight) <= EPS && r > best.reps)) best = { weight: w, reps: r };
  }
  return best;
};

/**
 * A night session against the last NIGHT time of each lift — like for
 * like, never against a day — → { lines: [{ liftId, name, text, delta }] }
 * | null when the session isn't a night or nothing compares. Each line is
 * the top working set's change: "+2.5 kg" (heavier), "+1 rep" (same
 * weight), "=" or a plain "−1 rep" (never shown as a red drop).
 */
export function nightComparison(S, session, list = []) {
  if (!session || session.shift !== 'night') return null;
  const lines = [];
  for (const ex of session.exercises || []) {
    const lift = list.find(l => l.id === ex.liftId);
    if (!lift) continue;
    const now = topSet(ex.sets);
    const prevN = previousSets(S, ex.liftId, { onlyNight: true, lift, ...(session.gym ? { gym: session.gym } : {}) });
    const was = prevN ? topSet(prevN.sets) : null;
    if (!now || !was) continue;
    let text, delta;
    if (Math.abs(now.weight - was.weight) > EPS) {
      const d = Math.round((now.weight - was.weight) * 100) / 100;
      text = `${d > 0 ? '+' : '−'}${trim(Math.abs(d))} kg`; delta = d > 0 ? 1 : -1;
    } else if (now.reps !== was.reps) {
      const d = now.reps - was.reps;
      text = `${d > 0 ? '+' : '−'}${Math.abs(d)} ${Math.abs(d) === 1 ? 'rep' : 'reps'}`; delta = d > 0 ? 1 : -1;
    } else { text = '='; delta = 0; }
    lines.push({ liftId: lift.id, name: shortLiftName(lift.name), text, delta });
  }
  return lines.length ? { lines } : null;
}

/**
 * The one muted estimate line Finish may show: the biggest rise in the
 * e1RM ESTIMATE this session (best working set ≤ 12 reps vs the best
 * before) → { name, from, to } | null. Never a PB, never gold.
 */
export function estimateRise(prevLog, session, list = [], { bwOf } = {}) {
  let best = null;
  for (const ex of (session && session.exercises) || []) {
    const lift = list.find(l => l.id === ex.liftId);
    if (!lift) continue;
    const prior = workingEntries(prevLog || [], lift).filter(e => !perGymOf(lift) || gymOf(e) === gymOf(session));
    if (!prior.length) continue;
    const b = personalBests(prior, lift, { bwOf });
    const mine = ex.sets.filter(s => !isWarmup(s)).map((s, j) => ({ id: `__e-${j}`, liftId: lift.id, date: session.date, weight: num(s.weight), reps: num(s.reps), createdAt: j }))
      .filter(e => e.weight != null && e.reps != null && e.reps <= 12);
    if (!mine.length || !b.bestE1rm) continue;
    const a = personalBests(mine, lift, { bwOf });
    if (!a.bestE1rm) continue;
    const rise = a.bestE1rm.value - b.bestE1rm.value;
    if (rise > 0.5 && (!best || rise > best.rise)) best = { name: shortLiftName(lift.name), from: b.bestE1rm.value, to: a.bestE1rm.value, rise };
  }
  return best ? { name: best.name, from: best.from, to: best.to } : null;
}

/**
 * What Finish would save, without saving it → { durationSec, volume,
 * setsDone, setsOpen, setsPlanned, exercises, pbs (each with `was`), night
 * (nightComparison), estimate (estimateRise — one muted line at most),
 * template ({ id, name } of the saved template it started from), session }
 * (session = the done sets only, the shape `sessions` stores).
 */
export function summariseWorkout(S, now, { bwOf } = {}) {
  const a = activeOf(S);
  if (!a) return null;
  const L = liftsOf(S);
  const list = listWithPending(L.list, a);
  const session = sessionOf(a, list, now);
  let setsOpen = 0, setsPlanned = 0;
  for (const ex of a.exercises) for (const s of ex.sets) { setsPlanned++; if (!s.done) setsOpen++; }
  const saved = a.templateId ? (L.templates || []).find(t => t && t.id === a.templateId) : null;
  return {
    durationSec: session.durationSec,
    volume: volume(session, list),
    setsDone: session.exercises.reduce((n, ex) => n + ex.sets.length, 0),
    setsOpen,
    setsPlanned,
    exercises: session.exercises.length,
    pbs: sessionPBs(L.log, session, list, { bwOf }),
    night: nightComparison(S, session, list),
    estimate: estimateRise(L.log, session, list, { bwOf }),
    template: saved ? { id: saved.id, name: saved.name } : null,
    session,
  };
}

function sessionOf(a, list, now) {
  const exercises = [];
  for (const ex of a.exercises) {
    const lift = list.find(l => l.id === ex.liftId);
    if (!lift) continue;
    const sets = ex.sets.filter(s => s.done && !setProblem(s, lift)).map(s => {
      const o = { reps: num(s.reps), weight: num(s.weight) ?? 0, done: true };
      if (num(s.rpe) != null) o.rpe = num(s.rpe);
      if (SET_TYPES.includes(s.type)) o.type = s.type;
      return o;
    });
    if (!sets.length) continue;
    const e = { liftId: ex.liftId, sets };
    if (ex.note && ex.note.trim()) e.note = ex.note.trim();
    exercises.push(e);
  }
  const s = {
    id: a.id, date: a.date, startedAt: num(a.startedAt) || 0, finishedAt: num(now) || 0,
    durationSec: Math.max(0, Math.round(((num(now) || 0) - (num(a.startedAt) || 0)) / 1000)),
    name: a.name || 'Workout', source: a.source || 'blank', exercises,
  };
  if (a.rotaSession) s.rotaSession = a.rotaSession;
  if (a.shift) s.shift = a.shift;
  if (a.gym) s.gym = a.gym;
  if (a.templateId) s.templateId = a.templateId;
  return s;
}

/**
 * Finish → next state, in ONE write: every done set appended to the log
 * (with `sessionId`, the workout's date, shift and gym tags), the session
 * pushed to `sessions` (oldest dropped past 400 — never a log entry),
 * `active` cleared. Nothing ticked → prev (the UI offers Discard).
 * Idempotent: no active → prev; ids already in the log are not re-added.
 * A pending exercise with a done set gets its lift created here (the same
 * fixed id toggleDone would have used); one with none creates nothing.
 */
export function finishWorkout(prev, now) {
  const a0 = activeOf(prev);
  if (!a0) return prev;
  const L0 = liftsOf(prev);
  const sessions = Array.isArray(L0.sessions) ? L0.sessions : [];
  if (sessions.some(s => s && s.id === a0.id)) return withLifts(prev, l => ({ ...l, active: null }));
  let L = L0;
  let a = a0;
  const hasDone = (ex, list) => ex.sets.some(st => st.done && !setProblem(st, exerciseLift(list, ex)));
  if (a0.exercises.some(ex => ex.pending && hasDone(ex, L0.list))) {
    const exercises = a0.exercises.map(ex => {
      if (!ex.pending || !hasDone(ex, L.list)) return ex;
      const m = materialise(L, ex, now);
      L = m.lifts;
      return m.ex;
    });
    a = { ...a0, exercises };
  }
  const session = sessionOf(a, L.list, now);
  if (!session.exercises.length) return prev;
  const have = new Set(L.log.map(e => e && e.id));
  const add = [];
  let k = 0;
  session.exercises.forEach((ex, i) => {
    ex.sets.forEach((s, j) => {
      const id = `${a.id}-${i}-${j}`;
      k++;
      if (have.has(id)) return;
      const entry = makeEntry(
        { liftId: ex.liftId, date: a.date, weight: s.weight, reps: s.reps, rpe: s.rpe, type: s.type, notes: j === 0 ? ex.note : undefined },
        { id, now: (num(now) || 0) + k, shift: a.shift || null, gym: a.gym || null },
      );
      add.push({ ...entry, sessionId: a.id });
    });
  });
  const nextSessions = [...sessions, session];
  return withLifts(prev, l => ({
    ...l,
    list: L.list === L0.list ? l.list : L.list,
    log: add.length ? [...l.log, ...add] : l.log,
    sessions: nextSessions.length > MAX_SESSIONS ? nextSessions.slice(-MAX_SESSIONS) : nextSessions,
    active: null,
  }));
}

// ── Templates, recent ──────────────────────────────────────────────

/** The five programme sessions as built-in templates. */
export const PROGRAMME_TEMPLATES = Object.freeze(SESSION_CODES.map(code => Object.freeze({
  id: `prog:${code}`, name: code, builtIn: true, rotaSession: code,
  exercises: PROGRAMME[code].map(x => ({ name: x.name, sets: x.sets, reps: x.reps, optional: !!x.optional })),
})));

const savedTemplates = S => (liftsOf(S).templates || []).filter(t => t && t.id && Array.isArray(t.exercises));

/** Library: the programme sessions, then the owner's saved templates. */
export const templatesOf = S => [...PROGRAMME_TEMPLATES, ...savedTemplates(S)];

/** "8–10" from a session's sets, or "8". */
function repRange(sets) {
  const rs = sets.map(s => num(s.reps)).filter(n => n != null);
  if (!rs.length) return undefined;
  const lo = Math.min(...rs), hi = Math.max(...rs);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function templateFromSession(session, name, id) {
  return {
    id, name: String(name || session.name || 'Workout').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name),
    exercises: (session.exercises || []).map(ex => {
      const o = { liftId: ex.liftId, sets: ex.sets.length };
      const r = repRange(ex.sets);
      if (r) o.reps = r;
      return o;
    }),
  };
}

/** Save a template; one with the same name is replaced in place. */
export function saveTemplate(prev, tpl) {
  if (!tpl || !tpl.id || !tpl.name || !Array.isArray(tpl.exercises) || !tpl.exercises.length) return prev;
  return withLifts(prev, l => {
    const list = Array.isArray(l.templates) ? l.templates : [];
    const i = list.findIndex(t => t && norm(t.name) === norm(tpl.name));
    if (i < 0) return { ...l, templates: [...list, tpl] };
    const next = list.slice();
    next[i] = { ...tpl, id: list[i].id };
    return { ...l, templates: next };
  });
}

export function deleteTemplate(prev, id) {
  const list = liftsOf(prev).templates;
  if (!Array.isArray(list) || !list.some(t => t && t.id === id)) return prev;
  return withLifts(prev, l => ({ ...l, templates: l.templates.filter(t => t && t.id !== id) }));
}

/** A template (built-in or saved), ready for startWorkout. Night shift → 80% weights, as the suggestion does; weights from the workout's gym. */
export function templateStart(S, tpl, today, opts = {}) {
  const L = liftsOf(S);
  const { list } = L;
  const day = isIso(today) ? shiftOn(S, today) : null;
  const night = !!(day && day.shift === 'night');
  const gym = opts.gym !== undefined ? opts.gym : (activeOf(S) && activeOf(S).gym) || defaultGym(L);
  return {
    source: 'template', name: tpl.name, rotaSession: tpl.rotaSession || null, shift: day ? day.shift : null, ...(gym ? { gym } : {}),
    ...(tpl.builtIn || !tpl.id ? {} : { templateId: tpl.id }),
    exercises: tpl.exercises.map(x => {
      const lift = (x.liftId && list.find(l => l.id === x.liftId)) || (x.name ? findByName(list, x.name) : null);
      const { rows } = planFor(S, lift, { sets: x.sets, reps: x.reps, night, gym });
      return { liftId: lift ? lift.id : null, liftKey: lift ? lift.id : x.name ? progId(x.name) : null, name: lift ? lift.name : x.name, sets: x.sets, reps: x.reps, optional: x.optional, rows };
    }).filter(x => x.liftId || x.name),
  };
}

/** The last `n` finished workouts, newest first. */
export function recentWorkouts(S, n = RECENT_N) {
  return (liftsOf(S).sessions || []).filter(s => s && s.id && Array.isArray(s.exercises))
    .slice().sort((a, b) => (num(b.finishedAt) || 0) - (num(a.finishedAt) || 0)).slice(0, n);
}

/** Repeat a finished workout: its lifts and set counts, the latest weights. */
export function repeatStart(S, session, today, opts = {}) {
  const L = liftsOf(S);
  const { list } = L;
  const day = isIso(today) ? shiftOn(S, today) : null;
  const night = !!(day && day.shift === 'night');
  const gym = opts.gym !== undefined ? opts.gym : (activeOf(S) && activeOf(S).gym) || defaultGym(L);
  return {
    source: 'recent', name: session.name, rotaSession: session.rotaSession || null, shift: day ? day.shift : null, ...(gym ? { gym } : {}),
    exercises: session.exercises.filter(ex => list.some(l => l.id === ex.liftId)).map(ex => {
      const lift = list.find(l => l.id === ex.liftId);
      const { rows } = planFor(S, lift, { sets: ex.sets.length, reps: repRange(ex.sets), night, gym });
      return { liftId: lift.id, sets: ex.sets.length, rows };
    }),
  };
}

/** Did a finished Vantage workout happen on `day`? (Track's 'workout' auto-fill reads this too.) */
export const hasSessionOn = (S, day) => (liftsOf(S).sessions || []).some(s => s && s.date === day);


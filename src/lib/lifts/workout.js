/**
 * The workout logger (Upgrade → Lifts, owner-only) — modelled on the
 * flow of the owner's gym app: a suggested workout for today, a live
 * session with a set table per exercise (Set · Previous · Reps · KG ·
 * RPE · ✓), a rest timer, and a summary on Finish.
 *
 * Pure: no React, no network, no clock. `now`, `today` and id makers are
 * parameters, so workout.test.mjs can pin every number.
 *
 * ── Data (all inside S.lifts, all additive — store.js has the rules) ──
 *   active    the workout in progress, persisted on every edit so a
 *             refresh, a sleeping phone or a closed app never loses it.
 *             { id, date, startedAt, name, source, rotaSession?, shift?,
 *               restSec, rest?: { endsAt, total },
 *               exercises: [{ liftId, note?, target?, sets: [{ id, reps, weight, rpe?, done }] }] }
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
 * Programme exercises not yet in the owner's list are created on first
 * use, with fixed ids (`prog-<slug>`) so two devices merge them by id,
 * a load type guessed from the name and muscle tags from PROGRAMME_MUSCLES.
 *
 * Not built (yet): supersets and unilateral logging.
 */
import { PROGRAMME, SESSION_CODES, NIGHT_LOAD_SCALE } from '../../data/trainingProgramme.js';
import { shiftOn } from '../rotation/pattern.js';
import {
  num, isIso, addDays, dayNo, personalBests, pbBasis, pbHeadline, setText, shortLiftName, entriesFor,
} from './lifts.js';
import { liftsOf, withLifts, makeEntry, LIMITS, newId } from './store.js';

const EPS = 1e-9;
export const DEFAULT_REST_SEC = 90;
export const REST_LIMITS = [15, 600];
export const MAX_SESSIONS = 400;
export const RECENT_N = 10;
export const RPE_CHIPS = [5, 6, 7, 8, 9, 10];

/** Muscle targets, in the order the picker lists them. */
export const MUSCLES = ['Shoulders', 'Back', 'Lower back', 'Chest', 'Abs', 'Triceps', 'Biceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Other'];

/** Tags for every exercise in the programme (src/data/trainingProgramme.js). */
export const PROGRAMME_MUSCLES = {
  '45° hyperextension': ['Lower back', 'Glutes', 'Hamstrings'],
  'Leg extension': ['Quads'],
  'Machine leg press': ['Quads', 'Glutes'],
  'Standing calf raise': ['Calves'],
  'Walking dumbbell lunge': ['Quads', 'Glutes'],
  'Ab crunch machine': ['Abs'],
  'Dip': ['Chest', 'Triceps', 'Shoulders'],
  'Incline dumbbell press': ['Chest', 'Shoulders'],
  'Machine shoulder press': ['Shoulders', 'Triceps'],
  'Dumbbell lateral raise': ['Shoulders'],
  'Single-arm cable triceps pushdown (cuff)': ['Triceps'],
  'Overhead cable bar extension': ['Triceps'],
  'Lat pulldown': ['Back', 'Biceps'],
  'Single-arm cable row': ['Back'],
  'Cable bar pullover': ['Back'],
  'Cable archer pull (rear delt)': ['Shoulders', 'Back'],
  'Incline dumbbell curl, 21s': ['Biceps'],
  'Reverse EZ-bar curl': ['Biceps'],
  'Hip thrust': ['Glutes', 'Hamstrings'],
  'Seated leg curl': ['Hamstrings'],
  'Leg press, feet high': ['Glutes', 'Hamstrings', 'Quads'],
  'Reverse lunge': ['Quads', 'Glutes'],
  'Seated calf raise': ['Calves'],
  'Pallof press': ['Abs'],
  'Wide-grip cable row': ['Back'],
};

// Keyword fallback for lifts the owner added by hand without tags.
const MUSCLE_WORDS = [
  [/leg\s*curl|hamstring|\brdl\b|romanian/i, 'Hamstrings'],
  [/calf/i, 'Calves'],
  [/hyperextension|back\s*extension/i, 'Lower back'],
  [/hip\s*thrust|glute/i, 'Glutes'],
  [/squat|leg\s*press|lunge|leg\s*extension/i, 'Quads'],
  [/^(?!.*leg\s*curl).*curl/i, 'Biceps'],
  [/tricep|pushdown|skull|^(?!.*(leg|back|hyper)).*extension/i, 'Triceps'],
  [/row|pulldown|pull-?\s*up|chin|pullover/i, 'Back'],
  [/bench|chest|fly|\bdips?\b|push-?\s*up/i, 'Chest'],
  [/shoulder|lateral|overhead\s*press|delt|arnold/i, 'Shoulders'],
  [/crunch|\babs?\b|plank|pallof|sit-?\s*up/i, 'Abs'],
];

const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

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

/** Load type from a name: a dip carries bodyweight, a dumbbell is per hand, else the number on the stack. */
export function guessLoad(name) {
  const n = String(name || '');
  if (/\bdips?\b/i.test(n)) return 'bodyweight_plus';
  if (/dumbbell/i.test(n)) return 'per_hand';
  return 'weight';
}

/** "Incline dumbbell curl, 21s" → "prog-incline-dumbbell-curl-21s" (stable across devices). */
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
 */
export function previousSets(S, liftId, opts = {}) {
  const log = liftsOf(S).log;
  const all = entriesFor(log, { id: liftId });
  const pool = all.filter(e => (!opts.skipNight || e.shift !== 'night') && (!opts.before || e.date < opts.before));
  if (!pool.length) return null;
  const last = pool[pool.length - 1];
  const key = e => (e.sessionId ? `s:${e.sessionId}` : `d:${e.date}`);
  const k = key(last);
  const sets = pool.filter(e => key(e) === k);
  return {
    date: last.date, shift: last.shift || null, sessionId: last.sessionId || null,
    sets: sets.map(e => ({ reps: num(e.reps), weight: num(e.weight), rpe: num(e.rpe) })),
  };
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
 */
export function planFor(S, lift, { sets, reps, night = false } = {}) {
  const n = Math.max(1, Math.min(20, Math.round(num(sets) || 1)));
  const id = lift && lift.id;
  const dayBase = id ? previousSets(S, id, { skipNight: true }) : null;
  const anyBase = id ? previousSets(S, id) : null;
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
 *     [{ liftKey, liftId, name, sets, reps, optional, weight, rows }], reason, minutes, night }
 * `weight` is the first set's pre-fill (null when the lift has never
 * been trained); `rows` every set's.
 */
export function suggestWorkout(S, today) {
  const day = isIso(today) ? shiftOn(S, today) : null;
  const out = { name: 'Rest day today', rotaSession: null, shift: day ? day.shift : null, label: day ? day.label : '', restDay: true, exercises: [], reason: '', minutes: 0, night: false };
  if (!day) return { ...out, reason: 'Today sits outside your rota pattern — build your own if you’re training.' };
  if (day.shift === 'leave') return { ...out, reason: `${day.label.split(' · ')[0]} on your rota — rest, or build your own.` };
  if (day.session === 'Rest') return { ...out, reason: `${day.shift === 'off' ? 'Off' : day.label.split(' · ')[0]} · rest day on your rota.` };
  const prog = PROGRAMME[day.session];
  if (!prog) {
    return { ...out, restDay: false, name: `${day.session} day`, rotaSession: day.session, reason: `${day.session} isn’t one of the five programme sessions — build your own.` };
  }
  const night = day.shift === 'night';
  const { list } = liftsOf(S);
  const exercises = prog.map(x => {
    const lift = findByName(list, x.name);
    const { rows } = planFor(S, lift, { sets: x.sets, reps: x.reps, night });
    return {
      liftKey: lift ? lift.id : progId(x.name), liftId: lift ? lift.id : null, name: lift ? lift.name : x.name,
      sets: x.sets, reps: x.reps, optional: !!x.optional, weight: rows[0] ? rows[0].weight : null, rows,
    };
  });
  const sessions = liftsOf(S).sessions || [];
  let last = null;
  for (const s of sessions) if (s && s.rotaSession === day.session && isIso(s.date) && s.date < today && (!last || s.date > last.date)) last = s;
  const shiftWord = day.shift === 'off' ? 'Day off' : day.label.split(' · ')[0];
  const reason = `${shiftWord} · ${day.session} on your rota. ${last ? `Last ${day.session} ${agoWords(last.date, today)}.` : `Your first ${day.session} logged here.`}`;
  return {
    ...out, name: day.session, rotaSession: day.session, restDay: false, night, exercises, reason,
    minutes: estimateMinutes(exercises),
  };
}

/** Mon–Sun of the week holding `today`: [{ iso, dow, date, session, shift, chip, trained, today }]. */
export function weekStrip(S, today) {
  if (!isIso(today)) return [];
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const mon = addDays(today, -dow);
  const trained = new Set();
  const L = liftsOf(S);
  for (const s of L.sessions || []) if (s && isIso(s.date)) trained.add(s.date);
  for (const e of L.log) if (e && isIso(e.date)) trained.add(e.date);
  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i);
    const r = shiftOn(S, iso);
    const session = r && r.shift !== 'leave' && r.session !== 'Rest' ? r.session : null;
    return { iso, dow: DOW[i], date: Number(iso.slice(8)), session, shift: r ? r.shift : null, chip: r ? r.chip : '', trained: trained.has(iso), today: iso === today };
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
 *         rotaSession?, shift?, exercises: [{ liftId? | liftKey?, name?, sets, reps?, rows? }], ids? }
 * An exercise naming a lift the list doesn't have (a programme exercise
 * on first use) creates it — additively, with a fixed id.
 */
export function startWorkout(prev, opts = {}) {
  if (activeOf(prev)) return prev;
  const { now = 0, today, source = 'blank', name, rotaSession, shift, ids = newId } = opts;
  if (!isIso(today)) return prev;
  return withLifts(prev, l => {
    let list = l.list;
    const exercises = [];
    for (const x of opts.exercises || []) {
      let lift = list.find(t => t.id === (x.liftId || x.liftKey)) || (x.name ? findByName(list, x.name) : null);
      if (!lift && x.name) {
        const nm = String(x.name).trim().slice(0, LIMITS.name);
        lift = { id: x.liftKey || progId(nm), name: nm, load: guessLoad(nm), unit: 'kg', createdAt: now };
        const ms = PROGRAMME_MUSCLES[nm] || musclesOf({ name: nm });
        if (ms.length) lift.muscles = ms;
        list = [...list, lift];
      }
      if (!lift || exercises.some(e => e.liftId === lift.id)) continue;
      const rows = Array.isArray(x.rows) && x.rows.length ? x.rows
        : Array.from({ length: Math.max(1, Math.round(num(x.sets) || 1)) }, () => ({ reps: null, weight: null }));
      const ex = { liftId: lift.id, sets: rows.map(r => row(ids('st'), r.reps, r.weight)) };
      if (x.reps) ex.target = String(x.reps);
      if (x.optional) ex.optional = true;
      exercises.push(ex);
    }
    const active = {
      id: ids('wk'), date: today, startedAt: now, name: String(name || 'Workout').slice(0, LIMITS.name), source,
      restSec: clampRest(l.restSec ?? DEFAULT_REST_SEC), exercises,
    };
    if (rotaSession) active.rotaSession = rotaSession;
    if (shift) active.shift = shift;
    return { ...l, list, active };
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
    ...opts, now: a.startedAt, today: a.date, ids: keepId(a.id, opts.ids || newId),
  });
  return activeOf(next) ? next : prev;
}
const keepId = (id, ids) => { let used = false; return p => (p === 'wk' && !used ? (used = true, id) : ids(p)); };

/** The suggestion, ready for startWorkout. */
export function suggestedStart(sug) {
  return {
    source: 'suggested', name: sug.name, rotaSession: sug.rotaSession, shift: sug.shift,
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
    for (const id of want) {
      if (!list.some(l => l.id === id) || a.exercises.some(e => e.liftId === id) || add.some(e => e.liftId === id)) continue;
      const p = previousSets(prev, id);
      const n = p ? Math.max(1, Math.min(10, p.sets.length)) : 1;
      add.push({ liftId: id, sets: Array.from({ length: n }, () => row(ids('st'))) });
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
 * (the same set index of the last time), as the gym app does; a set that
 * still isn't a valid set is refused (prev returned — see setProblem).
 * Ticking starts the rest timer.
 */
export function toggleDone(prev, ei, si, now = 0) {
  const a = activeOf(prev);
  const ex = a && a.exercises[ei];
  const st = ex && ex.sets[si];
  if (!st) return prev;
  if (st.done) return withActive(prev, x => mapSet(x, ei, si, s => ({ ...s, done: false })));
  const lift = liftsOf(prev).list.find(l => l.id === ex.liftId);
  const p = previousSets(prev, ex.liftId);
  const pr = p && p.sets.length ? p.sets[Math.min(si, p.sets.length - 1)] : null;
  const filled = {
    ...st,
    reps: st.reps ?? (pr ? pr.reps : null),
    weight: st.weight ?? (pr ? pr.weight : lift && lift.load === 'bodyweight_plus' ? 0 : null),
  };
  if (setProblem(filled, lift)) return prev;
  if (filled.weight == null) filled.weight = 0;
  return withActive(prev, x => {
    const y = mapSet(x, ei, si, () => ({ ...filled, done: true }));
    const total = clampRest(y.restSec ?? DEFAULT_REST_SEC);
    return { ...y, rest: { endsAt: num(now) + total * 1000, total } };
  });
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
export function swapExercise(prev, ei, liftId) {
  const list = liftsOf(prev).list;
  if (!list.some(l => l.id === liftId)) return prev;
  return withActive(prev, a => {
    if (a.exercises.some((e, i) => i !== ei && e.liftId === liftId)) return a;
    return mapEx(a, ei, ex => {
      if (ex.liftId === liftId) return ex;
      const p = previousSets(prev, liftId);
      const sets = ex.sets.map((s, i) => {
        const b = p && p.sets.length ? p.sets[Math.min(i, p.sets.length - 1)] : null;
        return { ...s, weight: b ? b.weight : null, rpe: null, done: false };
      });
      const out = { liftId, sets };
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

export const clampRest = s => Math.max(REST_LIMITS[0], Math.min(REST_LIMITS[1], Math.round(num(s) || DEFAULT_REST_SEC)));

/** Rest length for this workout, remembered (S.lifts.restSec) for the next one. */
export function setRestSec(prev, sec) {
  const v = clampRest(sec);
  const a = activeOf(prev);
  const L = liftsOf(prev);
  if (L.restSec === v && (!a || a.restSec === v)) return prev;
  return withLifts(prev, l => ({ ...l, restSec: v, ...(a ? { active: { ...a, restSec: v } } : {}) }));
}
/** +15 s (or any `sec`) on the running rest timer. */
export function extendRest(prev, sec, now) {
  return withActive(prev, a => {
    if (!a.rest || num(a.rest.endsAt) <= num(now)) return a;
    return { ...a, rest: { endsAt: num(a.rest.endsAt) + sec * 1000, total: num(a.rest.total) + sec } };
  });
}
export function skipRest(prev) {
  return withActive(prev, a => {
    if (!a.rest) return a;
    const out = { ...a };
    delete out.rest;
    return out;
  });
}
/** Seconds left on the rest timer, or 0. */
export const restLeft = (active, now) => (active && active.rest
  ? Math.max(0, Math.min(num(active.rest.total) || Infinity, Math.ceil((num(active.rest.endsAt) - num(now)) / 1000))) : 0);

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
 * is not a PB; the e1RM estimate plays no part.
 */
export function sessionPBs(prevLog, session, list = [], { bwOf } = {}) {
  const out = [];
  const before = Array.isArray(prevLog) ? prevLog : [];
  (session && session.exercises || []).forEach((ex, i) => {
    const lift = list.find(l => l.id === ex.liftId);
    if (!lift) return;
    const mine = doneSets(ex)
      .filter(s => num(s.reps) != null && num(s.weight) != null)
      .map((s, j) => ({ id: `__pb-${i}-${j}`, liftId: lift.id, date: session.date, weight: num(s.weight), reps: num(s.reps), createdAt: Number.MAX_SAFE_INTEGER - 1000 + j }));
    if (!mine.length) return;
    const prior = entriesFor(before, lift);
    if (!prior.length) return;
    const basis = pbBasis([...prior, ...mine], lift, bwOf);
    const b = personalBests(prior, lift, { bwOf, basis });
    const a = personalBests([...prior, ...mine], lift, { bwOf, basis });
    const byEntry = new Map();
    const hit = (entry, k) => {
      if (!entry || !String(entry.id).startsWith('__pb-')) return;
      const cur = byEntry.get(entry.id) || { entry, heaviest: false, repMaxes: [] };
      if (k === 'h') cur.heaviest = true; else cur.repMaxes.push(k);
      byEntry.set(entry.id, cur);
    };
    if (b.heaviest && a.heaviest.value > b.heaviest.value + EPS) hit(a.heaviest.entry, 'h');
    for (const n of Object.keys(a.repMaxes).map(Number)) {
      if (b.repMaxes[n] && a.repMaxes[n] && a.repLoads[n] > b.repLoads[n] + EPS) hit(a.repMaxes[n], n);
    }
    for (const r of byEntry.values()) {
      r.repMaxes.sort((x, y) => x - y);
      const entry = { liftId: lift.id, date: session.date, weight: r.entry.weight, reps: r.entry.reps };
      out.push({
        liftId: lift.id, lift, entry, heaviest: r.heaviest, repMaxes: r.repMaxes,
        text: `New best: ${shortLiftName(lift.name)} ${setText(entry, lift)} · ${pbHeadline(r)}`,
      });
    }
  });
  return out;
}

/**
 * What Finish would save, without saving it → { durationSec, volume,
 * setsDone, setsOpen, exercises, pbs, session } (session = the done
 * sets only, the shape `sessions` stores).
 */
export function summariseWorkout(S, now, { bwOf } = {}) {
  const a = activeOf(S);
  if (!a) return null;
  const L = liftsOf(S);
  const session = sessionOf(a, L.list, now);
  let setsOpen = 0;
  for (const ex of a.exercises) for (const s of ex.sets) if (!s.done) setsOpen++;
  return {
    durationSec: session.durationSec,
    volume: volume(session, L.list),
    setsDone: session.exercises.reduce((n, ex) => n + ex.sets.length, 0),
    setsOpen,
    exercises: session.exercises.length,
    pbs: sessionPBs(L.log, session, L.list, { bwOf }),
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
  return s;
}

/**
 * Finish → next state, in ONE write: every done set appended to the log
 * (with `sessionId`, the workout's date and shift tag), the session
 * pushed to `sessions` (oldest dropped past 400 — never a log entry),
 * `active` cleared. Nothing ticked → prev (the UI offers Discard).
 * Idempotent: no active → prev; ids already in the log are not re-added.
 */
export function finishWorkout(prev, now) {
  const a = activeOf(prev);
  if (!a) return prev;
  const L = liftsOf(prev);
  const sessions = Array.isArray(L.sessions) ? L.sessions : [];
  if (sessions.some(s => s && s.id === a.id)) return withLifts(prev, l => ({ ...l, active: null }));
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
        { liftId: ex.liftId, date: a.date, weight: s.weight, reps: s.reps, rpe: s.rpe, notes: j === 0 ? ex.note : undefined },
        { id, now: (num(now) || 0) + k, shift: a.shift || null },
      );
      add.push({ ...entry, sessionId: a.id });
    });
  });
  const nextSessions = [...sessions, session];
  return withLifts(prev, l => ({
    ...l,
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

/** A template (built-in or saved), ready for startWorkout. Night shift → 80% weights, as the suggestion does. */
export function templateStart(S, tpl, today) {
  const { list } = liftsOf(S);
  const day = isIso(today) ? shiftOn(S, today) : null;
  const night = !!(day && day.shift === 'night');
  return {
    source: 'template', name: tpl.name, rotaSession: tpl.rotaSession || null, shift: day ? day.shift : null,
    exercises: tpl.exercises.map(x => {
      const lift = (x.liftId && list.find(l => l.id === x.liftId)) || (x.name ? findByName(list, x.name) : null);
      const { rows } = planFor(S, lift, { sets: x.sets, reps: x.reps, night });
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
export function repeatStart(S, session, today) {
  const { list } = liftsOf(S);
  const day = isIso(today) ? shiftOn(S, today) : null;
  const night = !!(day && day.shift === 'night');
  return {
    source: 'recent', name: session.name, rotaSession: session.rotaSession || null, shift: day ? day.shift : null,
    exercises: session.exercises.filter(ex => list.some(l => l.id === ex.liftId)).map(ex => {
      const lift = list.find(l => l.id === ex.liftId);
      const { rows } = planFor(S, lift, { sets: ex.sets.length, reps: repRange(ex.sets), night });
      return { liftId: lift.id, sets: ex.sets.length, rows };
    }),
  };
}

/** Did a finished Vantage workout happen on `day`? (Track's 'workout' auto-fill reads this too.) */
export const hasSessionOn = (S, day) => (liftsOf(S).sessions || []).some(s => s && s.date === day);


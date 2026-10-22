/**
 * Adaptive training — the owner's design, agreed 2026-10-21. Pure.
 *
 *   · A WEEK is one block of the rota (plan.js): one shift run, four
 *     shifts and four days off, holding Push, Pull, Legs, Upper, Lower.
 *   · Push, Pull and Legs are ANCHORS and stay as the programme writes
 *     them. Upper and Lower ADAPT: they are built from what the week
 *     still owes each muscle part, after what has been logged and what
 *     the anchors still to come will cover.
 *   · Every muscle at least TWICE a week — a session with 2+ working sets
 *     for it counts as a hit. Upper and Lower defend that first.
 *   · Targets start from what the programme adds up to, and adjust
 *     themselves: +1 set to a part after two weeks at 100% with its main
 *     lift holding or rising; −1 after its main lift drops two weeks
 *     running. Every change carries its reason.
 *   · A MISSED anchor (its day passed, nothing logged, and nowhere left
 *     in the week to do it) is not crammed into Upper / Lower: they carry
 *     +1 set for each muscle group it owed, and the week is marked below
 *     standard.
 *   · WHOOP recovery (S.vitalsLog[date].recovery) only acts when RED
 *     (≤ 33): anchors lose a set per exercise and carry an RPE 7 cap;
 *     Upper / Lower trim to what twice-a-week strictly needs.
 *   · No time cap. Nothing is stored: all of it is worked out from the
 *     logged workouts, the rota and the programme, every time.
 *   · The owner's own workouts are never refused — anything logged
 *     counts, and the rest of the week re-plans around it.
 *
 * Muscle PARTS (upper chest, side delts, triceps long head …) are what
 * the builder aims at; they roll up to the twelve groups the body map
 * and muscles.js use.
 */
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { musclesOf, norm } from './muscles.js';
import { blockProgress, plannedSessions, sessionOfWorkout, ANCHOR_CODES } from './plan.js';
import { liftsOf } from './store.js';
import { addDays, isIso, num, e1rm, bannedRule, dayNo } from './lifts.js';

// ── Parts ─────────────────────────────────────────────────────────

/** Muscle parts, each with the group it rolls up to, in display order. */
export const PARTS = [
  ['Front delts', 'Shoulders'], ['Side delts', 'Shoulders'], ['Rear delts', 'Shoulders'],
  ['Lats', 'Back'], ['Mid-back', 'Back'],
  ['Lower back', 'Lower back'],
  ['Upper chest', 'Chest'], ['Mid & lower chest', 'Chest'],
  ['Abs', 'Abs'], ['Obliques', 'Abs'],
  ['Triceps long head', 'Triceps'], ['Triceps lateral & medial', 'Triceps'],
  ['Biceps', 'Biceps'], ['Brachialis', 'Biceps'],
  ['Rectus femoris', 'Quads'], ['Outer & inner quads', 'Quads'],
  ['Hamstrings', 'Hamstrings'],
  ['Glute max', 'Glutes'], ['Glute medius', 'Glutes'],
  ['Gastrocnemius', 'Calves'], ['Soleus', 'Calves'],
];
export const GROUP_OF = Object.fromEntries(PARTS);
export const GROUPS = [...new Set(PARTS.map(p => p[1]))];
export const UPPER_GROUPS = ['Shoulders', 'Back', 'Chest', 'Triceps', 'Biceps'];
export const LOWER_GROUPS = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs', 'Lower back'];
const ANCHORS = { Upper: ['Push', 'Pull'], Lower: ['Legs'] };

/**
 * The owner's goal is a V-taper — wide shoulders over a narrow waist,
 * a back that is wide and moves (trainingProgramme.js). These parts count
 * extra when Upper / Lower are built, and win ties.
 */
export const PRIORITY = { 'Side delts': 1.5, 'Rear delts': 1.25, Lats: 1.25, 'Upper chest': 1.25 };
const prio = p => PRIORITY[p] || 1;

/** What each programme exercise works, by part (main part first). */
export const EXERCISE_PARTS = {
  '45° hyperextension': { 'Lower back': 1, 'Glute max': 0.5, Hamstrings: 0.5 },
  'Leg extension': { 'Rectus femoris': 1, 'Outer & inner quads': 0.5 },
  'Machine leg press': { 'Outer & inner quads': 1, 'Glute max': 0.5, 'Rectus femoris': 0.25 },
  'Standing calf raise': { Gastrocnemius: 1, Soleus: 0.5 },
  'Walking dumbbell lunge': { 'Outer & inner quads': 1, 'Glute max': 0.5, 'Glute medius': 0.25 },
  'Ab crunch machine': { Abs: 1 },
  Dip: { 'Mid & lower chest': 1, 'Triceps lateral & medial': 0.5, 'Front delts': 0.5 },
  'Incline dumbbell press': { 'Upper chest': 1, 'Front delts': 0.5, 'Triceps lateral & medial': 0.25 },
  'Machine shoulder press': { 'Front delts': 1, 'Side delts': 0.5, 'Triceps lateral & medial': 0.5 },
  'Dumbbell lateral raise': { 'Side delts': 1 },
  'Single-arm cable triceps pushdown (cuff)': { 'Triceps lateral & medial': 1 },
  'Overhead cable bar extension': { 'Triceps long head': 1 },
  'Lat pulldown': { Lats: 1, Biceps: 0.5, 'Mid-back': 0.25 },
  'Single-arm cable row': { Lats: 1, 'Mid-back': 0.5, Biceps: 0.25 },
  'Cable bar pullover': { Lats: 1 },
  'Cable archer pull (rear delt)': { 'Rear delts': 1, 'Mid-back': 0.5 },
  'Incline dumbbell curl, 21s': { Biceps: 1 },
  'Reverse EZ-bar curl': { Brachialis: 1, Biceps: 0.25 },
  'Hip thrust': { 'Glute max': 1, Hamstrings: 0.5 },
  'Seated leg curl': { Hamstrings: 1 },
  'Leg press, feet high': { 'Glute max': 1, Hamstrings: 0.5, 'Outer & inner quads': 0.5 },
  'Reverse lunge': { 'Outer & inner quads': 1, 'Glute max': 0.5, 'Glute medius': 0.25 },
  'Seated calf raise': { Soleus: 1 },
  'Pallof press': { Obliques: 1, Abs: 0.25 },
  'Wide-grip cable row': { 'Mid-back': 1, 'Rear delts': 0.5, Lats: 0.5 },
};
const PROGRAMME_PARTS = Object.fromEntries(Object.entries(EXERCISE_PARTS).map(([k, v]) => [norm(k), v]));

/** Which part of a group a lift's NAME points at, for lifts outside the programme. */
const PART_WORDS = {
  Shoulders: [[/lateral|side\s*raise|upright/i, 'Side delts'], [/rear|face\s*pull|reverse\s*fly|archer/i, 'Rear delts'], [/./, 'Front delts']],
  Back: [[/pull-?\s*down|pull-?\s*up|chin|pullover|straight-?arm/i, 'Lats'], [/./, 'Mid-back']],
  Chest: [[/incline|low-?to-?high|reverse-?grip/i, 'Upper chest'], [/./, 'Mid & lower chest']],
  Triceps: [[/overhead|french|skull|extension/i, 'Triceps long head'], [/./, 'Triceps lateral & medial']],
  Biceps: [[/reverse|hammer|brachial/i, 'Brachialis'], [/./, 'Biceps']],
  Quads: [[/leg\s*extension|sissy/i, 'Rectus femoris'], [/./, 'Outer & inner quads']],
  Glutes: [[/abduct|kickback|side|medius/i, 'Glute medius'], [/./, 'Glute max']],
  Calves: [[/seated|bent-?knee|soleus/i, 'Soleus'], [/./, 'Gastrocnemius']],
  Abs: [[/pallof|oblique|twist|side|rotation|woodchop/i, 'Obliques'], [/./, 'Abs']],
  Hamstrings: [[/./, 'Hamstrings']],
  'Lower back': [[/./, 'Lower back']],
};

/** A lift's parts → { part: weight }: the programme's map, else its muscle tags. */
export function partsOf(lift) {
  if (!lift) return {};
  const p = PROGRAMME_PARTS[norm(lift.name)];
  if (p) return p;
  const out = {};
  musclesOf(lift).forEach((g, i) => {
    const words = PART_WORDS[g];
    if (!words) return;
    const part = words.find(([re]) => re.test(String(lift.name || '')))[1];
    out[part] = Math.max(out[part] || 0, i === 0 ? 1 : 0.5);
  });
  return out;
}
const mainPart = parts => Object.entries(parts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

const round1 = n => Math.round(n * 10) / 10;
const workSets = ex => (ex.sets || []).filter(s => s && s.done !== false && s.type !== 'W').length;

// ── Targets ───────────────────────────────────────────────────────

const addInto = (into, parts, sets) => { for (const [p, w] of Object.entries(parts)) into[p] = (into[p] || 0) + w * sets; return into; };

/**
 * What one programme session asks of each part → { part: sets }.
 * Optional exercises are left out by default — they may not happen, so
 * nothing PROJECTS them (anchors still to come, sessions assumed before
 * the first log, the catch-up). `{ optional: true }` counts them: the
 * week's targets do (the owner tracks triceps long head, whose only
 * programme source is Push's optional overhead extension).
 */
export function sessionParts(code, { optional = false } = {}) {
  const out = {};
  for (const x of PROGRAMME[code] || []) if (optional || !x.optional) addInto(out, partsOf({ name: x.name }), num(x.sets) || 0);
  return out;
}
/** Group sets a programme session gives each group → { group: sets }. */
const groupsOfParts = parts => {
  const out = {};
  for (const [p, n] of Object.entries(parts)) out[GROUP_OF[p]] = (out[GROUP_OF[p]] || 0) + n;
  return out;
};

/**
 * GROUP counting — the body map's rule (bodymap.js): a set credits every
 * muscle tagged on its lift (muscles.js musclesOf), the first tag in full
 * and the others at half. Group sets, group targets and twice-a-week hits
 * all count this way, so the week and "This workout" agree; parts keep
 * their own finer weights (EXERCISE_PARTS).
 */
const creditGroups = (lift, sets, into) => {
  musclesOf(lift).forEach((m, i) => { if (GROUPS.includes(m)) into[m] = (into[m] || 0) + sets * (i === 0 ? 1 : 0.5); });
  return into;
};
/** Group sets one programme session gives → { group: sets } (optional work only with `optional`). */
export function sessionGroups(code, { optional = false } = {}) {
  const out = {};
  for (const x of PROGRAMME[code] || []) if (optional || !x.optional) creditGroups({ name: x.name }, num(x.sets) || 0, out);
  return out;
}
const hitsOf = groupSets => Object.keys(groupSets).filter(g => groupSets[g] >= 2);

/** Targets are whole or half sets. */
export const round05 = n => Math.round(n * 2) / 2;
/** A part the programme gives less than this a week has no target (it's a side effect, not a job). */
export const MIN_TARGET = 1.5;

/**
 * The programme's week → { part: sets }: all five sessions added up,
 * optional exercises included, rounded to the nearest half set. Parts
 * under MIN_TARGET (glute medius from the lunges) get no target.
 */
export const BASE_TARGETS = (() => {
  const sum = {};
  for (const code of Object.keys(PROGRAMME)) for (const [p, n] of Object.entries(sessionParts(code, { optional: true }))) sum[p] = (sum[p] || 0) + n;
  const out = {};
  for (const [p, n] of Object.entries(sum)) if (n >= MIN_TARGET - 1e-9) out[p] = round05(n);
  return out;
})();

/** The programme's week by GROUP (body-map counting, optional work included) → { group: sets }, half-set rounded. */
export const BASE_GROUP_TARGETS = (() => {
  const sum = {};
  for (const code of Object.keys(PROGRAMME)) for (const [g, n] of Object.entries(sessionGroups(code, { optional: true }))) sum[g] = (sum[g] || 0) + n;
  const out = {};
  for (const [g, n] of Object.entries(sum)) if (n >= MIN_TARGET - 1e-9) out[g] = round05(n);
  return out;
})();

// ── The week's tally ──────────────────────────────────────────────

/** id → lift, built once per list (lists are replaced, never mutated, on a write). */
const byIdCache = new WeakMap();
function liftById(list) {
  const arr = Array.isArray(list) ? list : [];
  let m = byIdCache.get(arr);
  if (!m) { m = new Map(arr.filter(l => l && l.id != null).map(l => [l.id, l])); byIdCache.set(arr, m); }
  return m;
}
const liftOfEx = (ids, ex) => ids.get(ex.liftId) || (ex.name ? { name: ex.name } : ex.pending && ex.pending.name ? { name: ex.pending.name } : null);

/** Part sets and per-session group hits from a list of workouts. */
/** Part sets, group sets (body-map counting) and per-session group hits from a list of workouts. */
function tally(workouts, list) {
  const ids = liftById(list);
  const parts = {};
  const groups = {};
  const hits = {};
  for (const w of workouts) {
    const g = {};
    for (const ex of (w && w.exercises) || []) {
      const n = workSets(ex);
      if (!n) continue;
      const lift = liftOfEx(ids, ex);
      addInto(parts, partsOf(lift), n);
      creditGroups(lift, n, g);
    }
    for (const [grp, n] of Object.entries(g)) groups[grp] = (groups[grp] || 0) + n;
    for (const grp of hitsOf(g)) hits[grp] = (hits[grp] || 0) + 1;
  }
  return { parts, groups, hits };
}

/** The week (block) around `today` → { start, end, days, entries, workouts, done, upcoming, missed }. */
function weekAt(S, today) {
  const bp = blockProgress(S, today);
  if (!bp) return null;
  const n = dayNo(bp.end) - dayNo(bp.start) + 1;
  const entries = plannedSessions(S, { from: bp.start, days: n, today });
  const L = liftsOf(S);
  const workouts = (L.sessions || []).filter(w => w && isIso(w.date) && w.date >= bp.start && w.date <= bp.end && w.date <= today);
  const upcoming = entries.filter(e => e.iso > today && e.trainingDay && e.source !== 'done').map(e => e.session);
  const todayEntry = entries.find(e => e.iso === today) || null;
  // Anchors whose day passed empty are accepted as missed by the plan (plan.js).
  const missed = bp.missed || [];
  return { start: bp.start, end: bp.end, label: bp.label, total: bp.total, done: bp.done, entries, workouts, upcoming, missed, todayEntry };
}

/**
 * The plan counts a session as done before the first workout was ever
 * logged (it can't know). Those have no sets; count their programme
 * instead, so the week isn't read as empty.
 */
function assumedLoad(week, list) {
  const logged = new Set(week.workouts.map(w => sessionOfWorkout(w, list)).filter(Boolean));
  const parts = {};
  const groups = {};
  const hits = {};
  for (const code of week.done) {
    if (logged.has(code)) continue;
    addInto(parts, sessionParts(code), 1);
    const g = sessionGroups(code);
    addInto(groups, g, 1);
    for (const grp of hitsOf(g)) hits[grp] = (hits[grp] || 0) + 1;
  }
  return { parts, groups, hits };
}

// ── Self-adjusting targets ────────────────────────────────────────

/** The programme exercise that does most for a part — whose progress moves its target. */
const MAIN_LIFT = (() => {
  const out = {};
  for (const [name, parts] of Object.entries(EXERCISE_PARTS)) {
    for (const [p, w] of Object.entries(parts)) if (w === 1 && !out[p]) out[p] = name;
  }
  return out;
})();

/** Best estimated 1RM per lift name across workouts → Map(normName → kg); nights scaled back up from 80 %. */
function bestE1rms(workouts, ids) {
  const out = new Map();
  for (const w of workouts) {
    const scale = w.shift === 'night' ? 0.8 : 1;
    for (const ex of w.exercises || []) {
      const lift = ids.get(ex.liftId);
      if (!lift) continue;
      const k = norm(lift.name);
      for (const s of ex.sets || []) {
        if (!s || s.done === false || s.type === 'W' || !(num(s.weight) > 0) || !(num(s.reps) > 0)) continue;
        const v = e1rm(num(s.weight) / scale, num(s.reps));
        if (v != null && !(out.get(k) >= v)) out.set(k, v);
      }
    }
  }
  return out;
}

/** How many finished blocks back the targets look (half a year of shift runs). */
export const MAX_HISTORY = 24;
const memo = [];
const kg = v => `${Math.round(v * 2) / 2} kg`;

/**
 * Targets for the week holding `today`, adjusted by the weeks before it
 * → { targets: { part: sets }, changes: [{ part, from, to, why }] } —
 * `changes` are the ones made going INTO this week.
 *   +1  two finished weeks running at 100 % of the part's target, its
 *       main lift's best e1RM holding or rising (capped at 1.5 × base)
 *   −1  the main lift's best e1RM down two weeks running (floor 0.7 × base)
 * Parts the programme gives fewer than 2 sets a week are left alone.
 * Memoised on the store's identity, so the panel, the builder and the
 * stretches share one pass.
 */
export function weekTargets(S, today) {
  const L = liftsOf(S);
  const key = [L.sessions, L.list, S && S.rotation, today];
  const hit = memo.find(m => m.key.every((k, i) => k === key[i]));
  if (hit) return hit.out;
  const out = computeTargets(S, L, today);
  memo.unshift({ key, out });
  if (memo.length > 4) memo.pop();
  return out;
}

function computeTargets(S, L, today) {
  const targets = { ...BASE_TARGETS };
  let changes = [];
  const cur = isIso(today) ? blockProgress(S, today) : null;
  const sessions = (L.sessions || []).filter(w => w && isIso(w.date) && Array.isArray(w.exercises));
  if (!cur || !sessions.length) return { targets, changes };
  const ids = liftById(L.list);
  const firstLog = sessions.reduce((m, w) => (!m || w.date < m ? w.date : m), null);
  // Finished weeks before this one, oldest first.
  const weeks = [];
  let at = addDays(cur.start, -1);
  for (let i = 0; i < MAX_HISTORY && at >= firstLog; i++) {
    const b = blockProgress(S, at);
    if (!b) break;
    weeks.unshift({ start: b.start, workouts: sessions.filter(w => w.date >= b.start && w.date <= b.end) });
    at = addDays(b.start, -1);
  }
  const streak = {}, drops = {}, lastBest = {}, streakFrom = {}, dropFrom = {};
  for (let i = 0; i < weeks.length; i++) {
    const wk = weeks[i];
    const done = tally(wk.workouts, L.list).parts;
    const bests = bestE1rms(wk.workouts, ids);
    const made = [];
    for (const p of Object.keys(BASE_TARGETS)) {
      const base = BASE_TARGETS[p];
      if (base < 2) continue;
      const lift = MAIN_LIFT[p];
      const best = lift ? bests.get(norm(lift)) ?? null : null;
      const prev = lastBest[p] ?? null;
      const trend = best == null || prev == null ? null : best > prev * 1.01 ? 1 : best < prev * 0.99 ? -1 : 0;
      // Full: the week's sets reached the target (slack for the half-set rounding).
      const full = (done[p] || 0) >= targets[p] - 0.25 - 1e-9;
      if (full) { if (!streak[p]) streakFrom[p] = prev ?? best; streak[p] = (streak[p] || 0) + 1; } else streak[p] = 0;
      if (trend === -1) { if (!drops[p]) dropFrom[p] = prev; drops[p] = (drops[p] || 0) + 1; } else if (trend !== null) drops[p] = 0;
      if (best != null) lastBest[p] = best;
      const from = targets[p];
      const name = lift ? lift.toLowerCase() : 'its main lift';
      if (streak[p] >= 2 && trend !== -1) {
        targets[p] = Math.min(round05(base * 1.5), from + 1);
        const a = streakFrom[p], z = lastBest[p];
        streak[p] = 0;
        if (targets[p] !== from) {
          const lift1 = a != null && z != null ? (z > a * 1.01 ? `, ${name} e1RM up ${kg(a)} → ${kg(z)}` : `, ${name} e1RM holding at ${kg(z)}`) : '';
          made.push({ part: p, from, to: targets[p], why: `100% two weeks running${lift1}` });
        }
      } else if (drops[p] >= 2) {
        targets[p] = Math.max(round05(base * 0.7), from - 1);
        const a = dropFrom[p], z = lastBest[p];
        drops[p] = 0;
        streak[p] = 0;
        if (targets[p] !== from) made.push({ part: p, from, to: targets[p], why: `${name} dropped two weeks running${a != null && z != null ? ` (e1RM ${kg(a)} → ${kg(z)})` : ''}` });
      }
    }
    if (i === weeks.length - 1) changes = made;
  }
  return { targets, changes };
}

// ── Readiness ─────────────────────────────────────────────────────

/** WHOOP recovery for a day → { score, band: 'green'|'yellow'|'red' } | null. */
export function readinessOn(S, iso) {
  const day = S && S.vitalsLog && isIso(iso) ? S.vitalsLog[iso] : null;
  const v = day && typeof day === 'object' ? num(day.recovery) : null;
  if (v == null || v < 0 || v > 100) return null;
  // Banded on the score shown, so "34%" never reads red.
  const score = Math.round(v);
  return { score, band: score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red' };
}
export const RED_RPE_CAP = 7;

// ── The week view ─────────────────────────────────────────────────

/**
 * Everything the "This week" panel and the body map's This week tab show
 * → { start, end, label, missed, belowStandard, parts: [{ part, group, done, target }],
 *     groups: [{ group, done, target, hits }], changes } | null outside a block.
 * `extra`: a workout not saved yet (the Finish sheet's), counted in.
 */
export function weekView(S, today, { extra = null } = {}) {
  const week = weekAt(S, today);
  if (!week) return null;
  const L = liftsOf(S);
  const workouts = extra ? [...week.workouts, extra] : week.workouts;
  // The workout being finished may BE a missed anchor: saved, the plan reclaims it.
  const extraCode = extra ? sessionOfWorkout(extra, L.list) : null;
  const missed = week.missed.filter(c => c !== extraCode);
  const t = tally(workouts, L.list);
  const a = assumedLoad({ ...week, workouts }, L.list);
  const { targets, changes } = weekTargets(S, today);
  const parts = PARTS.map(([part, group]) => ({
    part, group,
    done: round1((t.parts[part] || 0) + (a.parts[part] || 0)),
    target: targets[part] || 0,
  })).filter(p => p.target > 0 || p.done > 0);
  // Groups count the body map's way (first muscle tag 1, others ½); a part's
  // self-adjustment moves its group's target by the same amount.
  const groups = GROUPS.map(group => {
    const moved = PARTS.reduce((s, [p, g]) => s + (g === group ? (targets[p] || 0) - (BASE_TARGETS[p] || 0) : 0), 0);
    const base = BASE_GROUP_TARGETS[group] || 0;
    return {
      group,
      done: round1((t.groups[group] || 0) + (a.groups[group] || 0)),
      target: base ? Math.max(0, round05(base + moved)) : 0,
      hits: (t.hits[group] || 0) + (a.hits[group] || 0),
    };
  }).filter(g => g.target > 0 || g.done > 0);
  return {
    start: week.start, end: week.end, label: week.label, missed,
    belowStandard: missed.length > 0, parts, groups, changes,
  };
}

// ── Building Upper / Lower ────────────────────────────────────────

const REPS_OF = (() => {
  const out = {};
  for (const code of Object.keys(PROGRAMME)) for (const x of PROGRAMME[code]) if (!out[norm(x.name)]) out[norm(x.name)] = x.reps;
  return out;
})();
const PER_SESSION_CAP = 10;
/** A gap pick must close at least this much priority-weighted need on its own. */
const MIN_GAIN = 2;
/** Less than a quarter of a set short isn't worth another set (targets are rounded to 0.1). */
const SLACK = 0.25;
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Candidates for a session: the programme's exercises for its groups, then the owner's own lifts. */
function candidates(groups, list, today, sessions = []) {
  const out = new Map();
  for (const code of Object.keys(PROGRAMME)) {
    for (const x of PROGRAMME[code]) {
      const parts = partsOf({ name: x.name });
      const m = mainPart(parts);
      if (!m || !groups.includes(GROUP_OF[m]) || out.has(norm(x.name))) continue;
      out.set(norm(x.name), { name: x.name, parts, main: m, programme: true });
    }
  }
  // The owner's own lifts, if trained in the last 60 days (familiar, and at a gym they use).
  const since = addDays(today, -60);
  const recent = new Set();
  for (const w of sessions) if (w && isIso(w.date) && w.date >= since) for (const ex of w.exercises || []) recent.add(ex.liftId);
  for (const lift of list || []) {
    if (!lift || lift.archived || bannedRule(lift) || out.has(norm(lift.name))) continue;
    const used = recent.has(lift.id);
    const parts = partsOf(lift);
    const m = mainPart(parts);
    if (!m || !groups.includes(GROUP_OF[m]) || !used) continue;
    out.set(norm(lift.name), { name: lift.name, parts, main: m, programme: false, liftId: lift.id });
  }
  return [...out.values()];
}

const listWords = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** "shoulders' second hit", "chest's second hit". */
const poss = g => { const w = g.toLowerCase(); return w.endsWith('s') ? `${w}'` : `${w}'s`; };

/**
 * Build today's Upper or Lower from what the week still owes.
 * → { exercises: [{ name, sets, reps, why, tags: [{ kind: 'need'|'plus', text }], liftId? }],
 *     notes: [string], catchUp: [codes], catchUpSets, missedSets, readiness, belowStandard } | null
 * (null: not a block day, not an adaptive session, or nothing logged yet —
 * until the first workout the rota stands, as in plan.js — use the programme).
 *
 *   1. twice a week first — each group short of its second hit gets an
 *      exercise (2 sets on a red day, its full share otherwise);
 *   2. then the biggest priority-weighted gaps (not on a red day);
 *   3. a missed anchor: +1 set for each group it owed, on that group's
 *      highest-priority pick (not on a red day).
 * The session's own written exercises win ties, so a week on plan comes
 * out close to the programme's Upper / Lower.
 */
export function buildAdaptive(S, today, session) {
  if (!ANCHORS[session] || !isIso(today)) return null;
  const L = liftsOf(S);
  if (!(L.sessions || []).some(w => w && isIso(w.date) && w.date <= today)) return null;
  const week = weekAt(S, today);
  if (!week) return null;
  const groups = session === 'Upper' ? UPPER_GROUPS : LOWER_GROUPS;
  const readiness = readinessOn(S, today);
  const red = !!(readiness && readiness.band === 'red');
  const { targets } = weekTargets(S, today);
  const own = new Set((PROGRAMME[session] || []).map(x => norm(x.name)));

  // Done so far (logged + assumed), and what the anchors still to come will cover.
  const t = tally(week.workouts, L.list);
  const a = assumedLoad(week, L.list);
  const done = {}, hits = {};
  for (const src of [t, a]) {
    for (const [p, n] of Object.entries(src.parts)) done[p] = (done[p] || 0) + n;
    for (const [g, n] of Object.entries(src.hits)) hits[g] = (hits[g] || 0) + n;
  }
  const coming = {};
  for (const code of week.upcoming) {
    if (!ANCHOR_CODES.includes(code)) continue;
    addInto(coming, sessionParts(code), 1);
    for (const g of hitsOf(sessionGroups(code))) hits[g] = (hits[g] || 0) + 1;
  }
  // A missed anchor is accepted as missed: its share comes off the week.
  const catchUp = ANCHORS[session].filter(c => week.missed.includes(c));
  const forgiven = {};
  for (const c of catchUp) addInto(forgiven, sessionParts(c, { optional: true }), 1);

  const need = {};
  for (const [p, g] of PARTS) {
    if (!groups.includes(g)) continue;
    need[p] = Math.max(0, (targets[p] || 0) - (forgiven[p] || 0) - (done[p] || 0) - (coming[p] || 0));
  }
  const need0 = { ...need };
  const mustHit = groups.filter(g => (hits[g] || 0) < 2 && PARTS.some(([p, gg]) => gg === g && (targets[p] || 0) > 0));

  const pool = candidates(groups, L.list, today, L.sessions || []);
  const picked = [];
  const load = {};
  const isPicked = c => picked.some(x => x.name === c.name);
  const take = (c, sets, reason) => {
    const ex = { ...c, sets, reason, tags: [] };
    picked.push(ex);
    for (const [p, w] of Object.entries(c.parts)) { need[p] = Math.max(0, (need[p] || 0) - w * sets); load[p] = (load[p] || 0) + w * sets; }
    return ex;
  };
  const gainOf = (c, sets) => Object.entries(c.parts).reduce((s, [p, w]) => s + prio(p) * Math.min(need[p] || 0, w * sets), 0);
  const bonus = c => (own.has(norm(c.name)) ? 1 : 0) + (c.programme ? 0.1 : 0);
  const setsFor = c => {
    if (red) return 2;
    const top = prio(c.main) > 1.25 ? 5 : 4;
    const want = Math.ceil((need[c.main] || 0) / (c.parts[c.main] || 1) - SLACK);
    return Math.max(2, Math.min(top, want, Math.floor(PER_SESSION_CAP - (load[c.main] || 0) + 1e-9)));
  };

  // 1. Twice a week first: each group short of its second hit gets an exercise.
  for (const g of mustHit) {
    if (picked.some(x => GROUP_OF[x.main] === g)) continue;
    const opts = pool.filter(c => GROUP_OF[c.main] === g && !isPicked(c));
    if (!opts.length) continue;
    const score = c => gainOf(c, setsFor(c)) + bonus(c);
    const best = opts.reduce((x, y) => (score(y) > score(x) + 1e-9 ? y : x));
    take(best, setsFor(best), { kind: 'hit', group: g });
  }
  // 2. Then the biggest priority-weighted gaps (skipped on a red day).
  if (!red) {
    for (let guard = 0; guard < 12; guard++) {
      let best = null, bestScore = 0, bestSets = 0;
      for (const c of pool) {
        if (isPicked(c) || (load[c.main] || 0) >= PER_SESSION_CAP) continue;
        const n = setsFor(c);
        const gain = gainOf(c, n);
        if (gain < MIN_GAIN) continue;          // worth a place on its own, before any tie-break
        const sc = gain + bonus(c);
        if (sc > bestScore + 1e-9) { best = c; bestScore = sc; bestSets = n; }
      }
      if (!best) break;
      take(best, bestSets, { kind: 'gap' });
    }
  }
  // Later picks overlap earlier ones (a row's mid-back, a pulldown's biceps):
  // take back sets an exercise no longer needs for its main part.
  if (!red) {
    for (const x of picked.slice().reverse()) {
      const w = x.parts[x.main] || 1;
      while (x.sets > 2 && (load[x.main] || 0) - (need0[x.main] || 0) >= w - SLACK) {
        x.sets -= 1;
        for (const [p, pw] of Object.entries(x.parts)) load[p] -= pw;
      }
    }
  }
  // 3. A missed anchor: +1 set for each group it owed (none on a red day).
  let catchUpSets = 0;
  if (!red) {
    for (const code of catchUp) {
      const owed = Object.entries(groupsOfParts(sessionParts(code))).filter(([g, n]) => groups.includes(g) && n >= 1).map(([g]) => g);
      for (const g of owed) {
        const ex = picked.filter(x => GROUP_OF[x.main] === g)
          .sort((x, y) => (prio(y.main) - prio(x.main)) || ((y.parts[y.main] || 0) - (x.parts[x.main] || 0)) || (y.sets - x.sets))[0];
        if (ex) { ex.sets += 1; catchUpSets += 1; ex.tags.push({ kind: 'plus', text: `+1 ${code}` }); continue; }
        const c = pool.find(p => GROUP_OF[p.main] === g && !isPicked(p));
        if (c) { take(c, 2, { kind: 'hit', group: g }).tags.push({ kind: 'plus', text: `+2 ${code}` }); catchUpSets += 2; }
      }
    }
  }

  // Order: compounds first, then the taper priorities, then the bigger jobs.
  const compound = x => Object.values(x.parts).filter(w => w >= 0.5).length >= 2;
  picked.sort((x, y) => (compound(y) - compound(x)) || (prio(y.main) - prio(x.main)) || (y.sets - x.sets));

  const exercises = picked.map(x => {
    const target = targets[x.main] || 0;
    const before = round1(done[x.main] || 0);
    const tags = [{ kind: 'need', text: `${x.main.toLowerCase()} ${fmt(before)} / ${fmt(round1(target))}` }, ...x.tags];
    const bits = [];
    if (x.reason.kind === 'hit') bits.push(`${poss(x.reason.group)} second hit`);
    if (prio(x.main) > 1) bits.push('taper priority');
    return { name: x.name, sets: x.sets, reps: REPS_OF[norm(x.name)] || '8–12', why: bits.join(' · '), tags, ...(x.liftId ? { liftId: x.liftId } : {}) };
  });

  const missedSets = catchUp.reduce((n, c) => n + (PROGRAMME[c] || []).filter(x => !x.optional).reduce((k, x) => k + (num(x.sets) || 0), 0), 0);
  const notes = [];
  if (red) notes.push(`WHOOP recovery ${readiness.score}% · red — trimmed to what twice-a-week needs.`);
  if (!red && picked.length) {
    const hitsFor = [...new Set(picked.filter(x => x.reason.kind === 'hit').map(x => x.reason.group.toLowerCase()))];
    const taper = [...new Set(picked.filter(x => prio(x.main) > 1).sort((x, y) => prio(y.main) - prio(x.main)).map(x => x.main.toLowerCase()))].slice(0, 2);
    const bits = [];
    if (hitsFor.length) bits.push(`second hits for ${listWords(hitsFor)}`);
    if (taper.length) bits.push(`leans ${listWords(taper)} for the taper`);
    notes.push(`Built for this week${bits.length ? ` — ${bits.join('; ')}` : ''}.`);
  }
  if (catchUp.length && !red) notes.push(`${catchUp.join(' and ')} ${catchUp.length > 1 ? 'were' : 'was'} missed this week — +1 set for each muscle ${catchUp.length > 1 ? 'they' : 'it'} owed, not the whole session.`);
  return { exercises, notes, catchUp, catchUpSets, missedSets, readiness, belowStandard: week.missed.length > 0 };
}

/** An anchor on a red day: one set fewer an exercise (never below one), RPE capped. */
export function trimForRed(exercises) {
  return exercises.map(x => ({ ...x, sets: Math.max(1, (num(x.sets) || 1) - 1), setsWas: x.sets, rpeCap: RED_RPE_CAP }));
}

// ── Stretches ─────────────────────────────────────────────────────

const PRESS_GROUPS = ['Chest', 'Shoulders', 'Triceps'];
const LEG_GROUPS = ['Quads', 'Glutes', 'Hamstrings'];
/** A week is "press-heavy" / "leg-heavy" once those groups are at half their week's target, today's session included. */
export const HEAVY_SHARE = 0.5;
const stretchKey = name => norm(name).replace(/\s+from the bar$/, '');

/**
 * The stretch block, tuned to the week (owner, 2026-10-21): the session's
 * own moves, plus what the week has loaded — pecs after a press-heavy
 * week, hips after a leg-heavy one — and the longer flow on a red day.
 * Thoracic mobility is always in (the chiropractic constraint) and is
 * never the move a cap drops.
 * `stretches`: { [session]: [ { name, hold, why } ] } (trainingProgramme.js).
 * → [{ name, hold, why, added? }] — `added` says why a move joined.
 * The week is read AFTER today's session (the block is done after it):
 * its programme sets are counted in unless today is already logged.
 */
export function adaptStretches(S, today, session, stretches) {
  const own = (stretches && (stretches[session] || stretches.Rest)) || [];
  const out = own.map(x => ({ ...x }));
  const pool = Object.values(stretches || {}).flat();
  const has = re => out.some(x => re.test(x.name));
  const add = (res, why) => {
    for (const re of res) {
      if (has(re)) return false;
      const s = pool.find(x => re.test(x.name));
      if (s) { out.push({ ...s, added: why }); return true; }
    }
    return false;
  };
  // 1. Thoracic, always — first, so no cap can drop it.
  if (!has(/thoracic|thread the needle/i)) add([/thoracic extension/i, /thread the needle/i], 'mid-back, every session');
  // 2. A red day: the rest-day flow on top.
  const r = readinessOn(S, today);
  const red = !!(r && r.band === 'red');
  if (red) for (const s of stretches.Rest || []) if (!out.some(x => stretchKey(x.name) === stretchKey(s.name))) out.push({ ...s, added: 'red day' });
  // 3. What the week has loaded.
  const cap = red ? 7 : 5;
  const view = isIso(today) ? weekView(S, today, { extra: plannedExtra(S, today, session) }) : null;
  const share = gs => {
    let d = 0, t = 0;
    for (const g of (view && view.groups) || []) if (gs.includes(g.group)) { d += g.done; t += g.target; }
    return t ? d / t : 0;
  };
  const press = share(PRESS_GROUPS), legs = share(LEG_GROUPS);
  const legsFirst = session === 'Legs' || session === 'Lower' || (!PROGRAMME[session] && legs > press);
  for (const k of legsFirst ? ['legs', 'press'] : ['press', 'legs']) {
    if (out.length >= cap) break;
    if (k === 'press' && press >= HEAVY_SHARE) add([/doorway pec/i], 'press-heavy week');
    if (k === 'legs' && legs >= HEAVY_SHARE) add([/90\/90/i, /couch stretch/i], 'leg-heavy week');
  }
  return out.slice(0, cap);
}

/** Today's programme session as an unsaved workout, for reading the week after it — null once today is logged. */
function plannedExtra(S, today, session) {
  if (!PROGRAMME[session]) return null;
  const L = liftsOf(S);
  if ((L.sessions || []).some(w => w && w.date === today)) return null;
  return {
    date: today, rotaSession: session,
    exercises: PROGRAMME[session].filter(x => !x.optional).map(x => ({ name: x.name, sets: Array.from({ length: num(x.sets) || 0 }, () => ({ done: true })) })),
  };
}

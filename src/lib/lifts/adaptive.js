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
import { blockProgress, plannedSessions, sessionOfWorkout } from './plan.js';
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

/** What one programme session asks of each part → { part: sets }. Optional exercises are not owed. */
export function sessionParts(code) {
  const out = {};
  for (const x of PROGRAMME[code] || []) if (!x.optional) addInto(out, partsOf({ name: x.name }), num(x.sets) || 0);
  return out;
}
/** Group sets a programme session gives each group → { group: sets }. */
const groupsOfParts = parts => {
  const out = {};
  for (const [p, n] of Object.entries(parts)) out[GROUP_OF[p]] = (out[GROUP_OF[p]] || 0) + n;
  return out;
};

/** The programme's week → { part: sets }: all five sessions added up. */
export const BASE_TARGETS = (() => {
  const out = {};
  for (const code of Object.keys(PROGRAMME)) for (const [p, n] of Object.entries(sessionParts(code))) out[p] = (out[p] || 0) + n;
  for (const p of Object.keys(out)) out[p] = round1(out[p]);
  return out;
})();

// ── The week's tally ──────────────────────────────────────────────

/** Part sets and per-session group hits from a list of workouts. */
function tally(workouts, list) {
  const parts = {};
  const hits = {};
  for (const w of workouts) {
    const g = {};
    for (const ex of (w && w.exercises) || []) {
      const lift = list.find(l => l && l.id === ex.liftId) || (ex.name ? { name: ex.name } : null);
      const n = workSets(ex);
      if (!n) continue;
      const ps = partsOf(lift);
      addInto(parts, ps, n);
      for (const [p, wt] of Object.entries(ps)) g[GROUP_OF[p]] = (g[GROUP_OF[p]] || 0) + wt * n;
    }
    for (const [grp, n] of Object.entries(g)) if (n >= 2) hits[grp] = (hits[grp] || 0) + 1;
  }
  return { parts, hits };
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
  const hits = {};
  for (const code of week.done) {
    if (logged.has(code)) continue;
    addInto(parts, sessionParts(code), 1);
    for (const [g, n] of Object.entries(groupsOfParts(sessionParts(code)))) if (n >= 2) hits[g] = (hits[g] || 0) + 1;
  }
  return { parts, hits };
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

/** Best estimated 1RM of a lift (by name) across workouts; nights scaled back up from 80 %. */
function bestE1rm(workouts, list, name) {
  let best = null;
  for (const w of workouts) {
    for (const ex of w.exercises || []) {
      const lift = list.find(l => l && l.id === ex.liftId);
      if (!lift || norm(lift.name) !== norm(name)) continue;
      for (const s of ex.sets || []) {
        if (!s || s.type === 'W' || !(num(s.weight) > 0) || !(num(s.reps) > 0)) continue;
        const v = e1rm(num(s.weight) / (w.shift === 'night' ? 0.8 : 1), num(s.reps));
        if (v != null && (best == null || v > best)) best = v;
      }
    }
  }
  return best;
}

const MAX_HISTORY = 40;
const memo = { key: null, out: null };

/**
 * Targets for the week holding `today`, adjusted by the weeks before it
 * → { targets: { part: sets }, changes: [{ part, from, to, why }] } —
 * `changes` are the ones made going INTO this week.
 */
export function weekTargets(S, today) {
  const L = liftsOf(S);
  const key = [L.sessions, L.list, S && S.rotation, today];
  if (memo.key && memo.key.every((k, i) => k === key[i])) return memo.out;
  const cur = blockProgress(S, today);
  const targets = { ...BASE_TARGETS };
  let changes = [];
  if (cur) {
    // Completed weeks before this one, oldest first.
    const weeks = [];
    let at = addDays(cur.start, -1);
    const firstLog = (L.sessions || []).reduce((m, w) => (w && isIso(w.date) && (!m || w.date < m) ? w.date : m), null);
    for (let i = 0; i < MAX_HISTORY && firstLog && at >= firstLog; i++) {
      const b = blockProgress(S, at);
      if (!b) break;
      const workouts = (L.sessions || []).filter(w => w && isIso(w.date) && w.date >= b.start && w.date <= b.end);
      weeks.unshift({ start: b.start, workouts });
      at = addDays(b.start, -1);
    }
    const streak = {}, drops = {}, lastBest = {};
    for (let i = 0; i < weeks.length; i++) {
      const wk = weeks[i];
      const done = tally(wk.workouts, L.list).parts;
      const made = [];
      for (const p of Object.keys(BASE_TARGETS)) {
        const base = BASE_TARGETS[p];
        if (base < 2) continue;
        const lift = MAIN_LIFT[p];
        const best = lift ? bestE1rm(wk.workouts, L.list, lift) : null;
        const prev = lastBest[p];
        const trend = best == null || prev == null ? null : best > prev * 1.01 ? 1 : best < prev * 0.99 ? -1 : 0;
        if (best != null) lastBest[p] = best;
        const ratio = targets[p] > 0 ? (done[p] || 0) / targets[p] : 0;
        streak[p] = ratio >= 1 ? (streak[p] || 0) + 1 : 0;
        drops[p] = trend === -1 ? (drops[p] || 0) + 1 : 0;
        const from = targets[p];
        if (streak[p] >= 2 && trend !== -1) {
          targets[p] = Math.min(round1(base * 1.5), from + 1);
          streak[p] = 0;
          if (targets[p] !== from) made.push({ part: p, from, to: targets[p], why: `100% two weeks running${lift && trend === 1 ? `, ${lift.toLowerCase()} up` : ''}` });
        } else if (drops[p] >= 2) {
          targets[p] = Math.max(round1(base * 0.7), from - 1);
          drops[p] = 0;
          if (targets[p] !== from) made.push({ part: p, from, to: targets[p], why: `${lift ? lift.toLowerCase() : 'its main lift'} dropped two weeks running` });
        }
      }
      if (i === weeks.length - 1) changes = made;
    }
  }
  const out = { targets, changes };
  memo.key = key;
  memo.out = out;
  return out;
}

// ── Readiness ─────────────────────────────────────────────────────

/** WHOOP recovery for a day → { score, band: 'green'|'yellow'|'red' } | null. */
export function readinessOn(S, iso) {
  const v = S && S.vitalsLog && S.vitalsLog[iso] && num(S.vitalsLog[iso].recovery);
  if (v == null) return null;
  return { score: Math.round(v), band: v >= 67 ? 'green' : v >= 34 ? 'yellow' : 'red' };
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
  const t = tally(workouts, L.list);
  const a = assumedLoad({ ...week, workouts }, L.list);
  const { targets, changes } = weekTargets(S, today);
  const parts = PARTS.map(([part, group]) => ({
    part, group,
    done: round1((t.parts[part] || 0) + (a.parts[part] || 0)),
    target: round1(targets[part] || 0),
  })).filter(p => p.target > 0 || p.done > 0);
  const groups = GROUPS.map(group => {
    const ps = parts.filter(p => p.group === group);
    return {
      group,
      done: round1(ps.reduce((s, p) => s + p.done, 0)),
      target: round1(ps.reduce((s, p) => s + p.target, 0)),
      hits: (t.hits[group] || 0) + (a.hits[group] || 0),
    };
  }).filter(g => g.target > 0 || g.done > 0);
  return {
    start: week.start, end: week.end, label: week.label, missed: week.missed,
    belowStandard: week.missed.length > 0, parts, groups, changes,
  };
}

// ── Building Upper / Lower ────────────────────────────────────────

const REPS_OF = (() => {
  const out = {};
  for (const code of Object.keys(PROGRAMME)) for (const x of PROGRAMME[code]) if (!out[norm(x.name)]) out[norm(x.name)] = x.reps;
  return out;
})();
const PER_SESSION_CAP = 10;
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

/**
 * Build today's Upper or Lower from what the week still owes.
 * → { exercises: [{ name, sets, reps, why, tags: [{ kind, text }], liftId? }],
 *     notes: [string], catchUp: [codes], readiness, belowStandard } | null
 * (null: not a block day, or not an adaptive session — use the programme).
 */
export function buildAdaptive(S, today, session) {
  if (!ANCHORS[session] || !isIso(today)) return null;
  const week = weekAt(S, today);
  if (!week) return null;
  const L = liftsOf(S);
  const groups = session === 'Upper' ? UPPER_GROUPS : LOWER_GROUPS;
  const readiness = readinessOn(S, today);
  const red = readiness && readiness.band === 'red';
  const { targets } = weekTargets(S, today);

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
    if (!['Push', 'Pull', 'Legs'].includes(code)) continue;
    addInto(coming, sessionParts(code), 1);
    for (const [g, n] of Object.entries(groupsOfParts(sessionParts(code)))) if (n >= 2) hits[g] = (hits[g] || 0) + 1;
  }
  // A missed anchor is accepted as missed: its share comes off the week.
  const catchUp = (ANCHORS[session] || []).filter(c => week.missed.includes(c));
  const forgiven = {};
  for (const c of catchUp) addInto(forgiven, sessionParts(c), 1);

  const need = {};
  for (const [p, g] of PARTS) {
    if (!groups.includes(g)) continue;
    need[p] = Math.max(0, (targets[p] || 0) - (forgiven[p] || 0) - (done[p] || 0) - (coming[p] || 0));
  }
  const mustHit = groups.filter(g => (hits[g] || 0) < 2 && Object.keys(need).some(p => GROUP_OF[p] === g && (targets[p] || 0) > 0));

  const pool = candidates(groups, L.list, today, L.sessions || []);
  const picked = [];
  const load = {};
  const take = (c, sets, reason) => {
    const ex = { ...c, sets, reason, tags: [] };
    picked.push(ex);
    for (const [p, w] of Object.entries(c.parts)) { need[p] = Math.max(0, (need[p] || 0) - w * sets); load[p] = (load[p] || 0) + w * sets; }
    return ex;
  };
  const gainOf = (c, sets) => Object.entries(c.parts).reduce((s, [p, w]) => s + prio(p) * Math.min(need[p] || 0, w * sets), 0);
  const setsFor = c => {
    const top = prio(c.main) > 1.25 ? 5 : 4;
    const want = Math.ceil((need[c.main] || 0) / (c.parts[c.main] || 1));
    return Math.max(2, Math.min(top, want, PER_SESSION_CAP - (load[c.main] || 0)));
  };

  // 1. Twice a week first: each group short of its second hit gets 2+ sets.
  for (const g of mustHit) {
    if (picked.some(x => GROUP_OF[x.main] === g)) continue;
    const opts = pool.filter(c => GROUP_OF[c.main] === g && !picked.includes(c));
    if (!opts.length) continue;
    const best = opts.reduce((x, y) => (gainOf(y, 2) + (y.programme ? 0.1 : 0) > gainOf(x, 2) + (x.programme ? 0.1 : 0) ? y : x));
    take(best, red ? 2 : setsFor(best), { kind: 'hit', group: g });
  }
  // 2. Then the biggest priority-weighted gaps (skipped on a red day).
  if (!red) {
    for (let guard = 0; guard < 12; guard++) {
      let best = null, bestGain = 0, bestSets = 0;
      for (const c of pool) {
        if (picked.some(x => x.name === c.name)) continue;
        if ((load[c.main] || 0) >= PER_SESSION_CAP) continue;
        const s = setsFor(c);
        const g = gainOf(c, s) + (c.programme ? 0.1 : 0);
        if (g > bestGain + 1e-9) { best = c; bestGain = g; bestSets = s; }
      }
      if (!best || bestGain < 1.5) break;
      take(best, bestSets, { kind: 'gap' });
    }
  }
  // 3. A missed anchor: +1 set for each group it owed (none on a red day).
  if (!red) {
    for (const code of catchUp) {
      const owed = Object.entries(groupsOfParts(sessionParts(code))).filter(([g, n]) => groups.includes(g) && n >= 1).map(([g]) => g);
      for (const g of owed) {
        const ex = picked.filter(x => GROUP_OF[x.main] === g).sort((x, y) => (y.parts[y.main] || 0) - (x.parts[x.main] || 0))[0];
        if (ex) { ex.sets += 1; ex.tags.push({ kind: 'plus', text: `+1 ${code}` }); continue; }
        const c = pool.find(p => GROUP_OF[p.main] === g && !picked.some(x => x.name === p.name));
        if (c) take(c, 2, { kind: 'hit', group: g }).tags.push({ kind: 'plus', text: `+${code}` });
      }
    }
  }

  // Order: compounds first, then the furthest-behind priority work.
  const compound = x => Object.values(x.parts).filter(w => w >= 0.5).length >= 2;
  picked.sort((x, y) => (compound(y) - compound(x)) || (prio(y.main) - prio(x.main)));

  const exercises = picked.map(x => {
    const target = targets[x.main] || 0;
    const before = round1((done[x.main] || 0));
    const tags = [{ kind: 'need', text: `${x.main.toLowerCase()} ${fmt(before)} / ${fmt(round1(target))}` }, ...x.tags];
    const bits = [];
    if (x.reason.kind === 'hit') bits.push(`${x.reason.group.toLowerCase()}'s second hit`);
    if (prio(x.main) > 1) bits.push('taper priority');
    return { name: x.name, sets: x.sets, reps: REPS_OF[norm(x.name)] || '8–12', why: bits.join(' · '), tags, ...(x.liftId ? { liftId: x.liftId } : {}) };
  });

  const notes = [];
  if (red) notes.push(`WHOOP recovery ${readiness.score}% · red — trimmed to what twice-a-week needs.`);
  if (catchUp.length && !red) notes.push(`${catchUp.join(' and ')} ${catchUp.length > 1 ? 'were' : 'was'} missed this week — +1 set for each muscle ${catchUp.length > 1 ? 'they' : 'it'} owed, not the whole session.`);
  return { exercises, notes, catchUp, readiness, belowStandard: week.missed.length > 0 };
}

/** An anchor on a red day: one set fewer an exercise (never below one), RPE capped. */
export function trimForRed(exercises) {
  return exercises.map(x => ({ ...x, sets: Math.max(1, (num(x.sets) || 1) - 1), setsWas: x.sets, rpeCap: RED_RPE_CAP }));
}

// ── Stretches ─────────────────────────────────────────────────────

/**
 * The stretch block, tuned to the week (owner, 2026-10-21): the session's
 * own moves, plus what the week has loaded — pecs after a press-heavy
 * week, hips after a leg-heavy one — and the longer flow on a red day.
 * Thoracic mobility is always in (the chiropractic constraint).
 * `stretches`: { [session]: [ { name, hold, why } ] } (trainingProgramme.js).
 */
export function adaptStretches(S, today, session, stretches) {
  const base = (stretches[session] || stretches.Rest || []).map(x => ({ ...x }));
  const r = readinessOn(S, today);
  const view = isIso(today) ? weekView(S, today) : null;
  const ratio = g => { const x = view && view.groups.find(y => y.group === g); return x && x.target ? x.done / x.target : 0; };
  const pool = Object.values(stretches).flat();
  const find = re => pool.find(x => re.test(x.name));
  const add = (re, why) => {
    if (base.some(x => re.test(x.name))) return;
    const s = find(re);
    if (s) base.push({ ...s, added: why });
  };
  if (r && r.band === 'red') {
    for (const s of stretches.Rest || []) if (!base.some(x => x.name === s.name)) base.push({ ...s, added: 'red day' });
  }
  if (ratio('Chest') >= 0.6 || ratio('Shoulders') >= 0.6) add(/doorway pec/i, 'press-heavy week');
  if (ratio('Quads') >= 0.6 || ratio('Glutes') >= 0.6) add(/couch stretch|90\/90/i, 'leg-heavy week');
  if (!base.some(x => /thoracic|thread the needle/i.test(x.name))) add(/thoracic extension/i, 'mid-back, every session');
  const cap = r && r.band === 'red' ? 7 : 5;
  return base.slice(0, cap);
}

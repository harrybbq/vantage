/**
 * Lifts home — the pure half of Today, the lift list, the lift detail
 * chart and rep maxes, and Quick log's date chip (Oct 2026 redesign,
 * brief §3.3 / §3.8 / §3.9 / §3.10). No React, no DOM, no clock: `today`
 * is always a parameter. lifts.test.mjs pins every rule.
 *
 *   weekPlan        the ONE 7-day strip (Mon–Sun): day + date, the plan's
 *                   session, the shift code (N1–N4 / D1 / Off / AL), trained,
 *                   today, moved, missed — the old 5-day plan and week strip
 *                   merged (A7). Every rule stays plan.js's.
 *   dayDetail       what one strip day holds, for the day sheet
 *   blockPips       "▮▮▮▯▯ 3 of 5 · P P L U L" — done / today / missed / to do
 *   nextTraining    the next training day after today ("next: Pull Tue")
 *   perGymBests     a machine's heaviest per gym, the active gym first
 *   sparkPoints     real top sets per session for a card's sparkline
 *   groupLifts      logged lifts vs the "N not logged yet" group (A12)
 *   sessionE1rms    one estimate per session for the chart (warm-ups out,
 *                   > 12 reps out, 6–12 reps flagged as a looser estimate)
 *   trendSegments   the 5-session rolling median of DAY sessions, broken at
 *                   gaps > 28 days (night sessions never join the trend)
 *   repMaxRows      1/3/5/8/10/12: the best REAL set, its estimate, and a
 *                   muted predicted value where no real set exists
 *   resolveLogDate  Quick log's date chip → an ISO date, never past maxDate
 *   lastSessionSummary  desktop Today's "Last session" lines
 */
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { SEQ } from '../rotation/pattern.js';
import { plannedSessions, blockProgress } from './plan.js';
import { liftsOf } from './store.js';
import {
  num, isIso, addDays, dayNo, workingEntries, entryE1rm, perGymOf, gymOf, gymsUsed, personalBests, REP_MAX_NS,
  LOW_CONFIDENCE_REPS, isWarmup,
} from './lifts.js';

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dowIdx = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
export const dowOf = iso => DOW3[dowIdx(iso)];

/** "Push" → "Push", "Upper" → "Upr", "Lower" → "Lwr" — ≤ 4 characters for a 46 px strip cell. */
export const SESSION_SHORT = Object.freeze({ Push: 'Push', Pull: 'Pull', Legs: 'Legs', Upper: 'Upr', Lower: 'Lwr', Extra: 'Any', Rest: 'Rest' });
export const shortSession = s => (!s ? 'Rest' : SESSION_SHORT[s] || String(s).slice(0, 4));

const trainedDates = S => {
  const L = liftsOf(S);
  const out = new Set();
  for (const s of L.sessions || []) if (s && isIso(s.date)) out.add(s.date);
  for (const e of L.log) if (e && isIso(e.date)) out.add(e.date);
  return out;
};
/** A plan entry's shift code: "N1" / "D2" / "AL" (leave) / "Off". */
const codeOf = p => (!p || !p.shift ? '' : p.shift === 'off' ? 'Off' : p.chip || '');

/**
 * The merged week strip, Mon–Sun of the week holding `today`:
 * [{ iso, dow, date, session (full name | null on rest), short, code, night,
 *    shift, trained, today, past, moved, missed, why, inPattern, trainingDay, source }].
 * A day off the rota pattern reads `inPattern: false`, short '—'.
 */
export function weekPlan(S, today) {
  if (!isIso(today)) return [];
  const mon = addDays(today, -((dowIdx(today) + 6) % 7));
  const plan = new Map(plannedSessions(S, { from: mon, days: 7, today }).map(p => [p.iso, p]));
  const trained = trainedDates(S);
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i);
    const p = plan.get(iso) || null;
    let session = null;
    if (p) {
      if (p.source === 'done') session = p.done[0] || p.session;
      else if (p.trainingDay || p.source === 'manual') session = p.session;
    }
    if (session === 'Rest') session = null;
    return {
      iso, dow: DOW3[dowIdx(iso)], date: Number(iso.slice(8)), session, short: session ? shortSession(session) : p ? 'Rest' : '—',
      code: codeOf(p), night: !!(p && p.night), shift: p ? p.shift : null, trained: trained.has(iso), today: iso === today,
      past: iso < today, moved: !!(p && p.moved), missed: !!(p && p.missed), why: p ? p.why : 'Outside your rota pattern',
      inPattern: !!p, trainingDay: !!(p && p.trainingDay), source: p ? p.source : null,
    };
  });
}

/**
 * One strip day for its sheet → { ...cell, title, exercises: [{ name, sets, reps, optional }],
 * logged: [{ name, sets, gym }], quickSets } — the programme's list for the
 * day's session and whatever was actually logged that day.
 */
export function dayDetail(S, cell) {
  if (!cell) return null;
  const L = liftsOf(S);
  const exercises = cell.session && PROGRAMME[cell.session] ? PROGRAMME[cell.session].map(x => ({ name: x.name, sets: x.sets, reps: x.reps, optional: !!x.optional })) : [];
  const logged = (L.sessions || []).filter(s => s && s.date === cell.iso).map(s => ({
    name: s.name || 'Workout', gym: s.gym || null,
    sets: (s.exercises || []).reduce((k, ex) => k + (ex.sets || []).filter(st => st && st.done !== false).length, 0),
  }));
  const quickSets = L.log.filter(e => e && e.date === cell.iso && !e.sessionId).length;
  const [, m, d] = cell.iso.split('-').map(Number);
  const title = `${DOW3[dowIdx(cell.iso)]} ${d} ${MON3[m - 1]}`;
  return { ...cell, title, exercises, logged, quickSets };
}

/**
 * The block as pips → { pips: [{ code, letter, state: 'done'|'today'|'missed'|'todo', carried }], done, total, label } | null.
 * Missed = a pattern day in this block passed untrained and its session is
 * still owed (it carries forward, `carried`); today's planned session
 * reads 'today' — a missed session moved onto today is 'today' + carried.
 */
export function blockPips(S, today) {
  if (!isIso(today)) return null;
  const bp = blockProgress(S, today);
  if (!bp) return null;
  const span = isIso(bp.start) && isIso(bp.end) ? Math.max(1, Math.min(60, dayNo(bp.end) - dayNo(bp.start) + 1)) : 1;
  const days = isIso(bp.start) ? plannedSessions(S, { from: bp.start, days: span, today }) : [];
  const tp = days.find(d => d.iso === today);
  const missed = new Set(days.filter(d => d.iso < today && d.missed).map(d => d.patternSession));
  const codes = SEQ.filter(c => bp.done.includes(c) || bp.owed.includes(c));
  const pips = codes.map(c => {
    const done = bp.done.includes(c);
    const isToday = !done && !!tp && tp.trainingDay && tp.session === c;
    return { code: c, letter: c[0], state: done ? 'done' : isToday ? 'today' : missed.has(c) ? 'missed' : 'todo', carried: !done && missed.has(c) };
  });
  return { pips, done: bp.done.length, total: bp.total || codes.length, label: bp.label };
}

/** "today" / "tomorrow" / "Tue" for a date after `today`. */
export function dayWord(iso, today) {
  const d = dayNo(iso) - dayNo(today);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return DOW3[dowIdx(iso)];
}
/** The next training day after `today` within two weeks → { session, iso, word } | null. */
export function nextTraining(S, today) {
  if (!isIso(today)) return null;
  const p = plannedSessions(S, { from: addDays(today, 1), days: 14, today }).find(x => x.trainingDay && x.session && x.session !== 'Rest');
  return p ? { session: p.session, iso: p.iso, word: dayWord(p.iso, today) } : null;
}

// ── Lift list ──────────────────────────────────────────────────────

/** Gym ids in display order: the active gym first, then `gymOrder`, then the rest A–Z, unassigned (null) last. */
export function orderGyms(ids, activeGym = null, gymOrder = []) {
  const seen = [...new Set(ids)];
  const out = [];
  if (activeGym && seen.includes(activeGym)) out.push(activeGym);
  for (const g of gymOrder) if (seen.includes(g) && !out.includes(g)) out.push(g);
  for (const g of seen.filter(x => x && !out.includes(x)).sort()) out.push(g);
  if (seen.includes(null)) out.push(null);
  return out;
}

/**
 * A machine's heaviest real set at each gym it was logged at, active gym
 * first — never one combined number (a DXC stack isn't a Greenock stack).
 * → [{ gym, best: { value, entry } }]. A free weight gets [] (its card shows one best).
 */
export function perGymBests(log, lift, { activeGym = null, gymOrder = [], bwOf } = {}) {
  if (!lift || !perGymOf(lift)) return [];
  return orderGyms(gymsUsed(log, lift, gymOrder), activeGym, gymOrder)
    .map(g => ({ gym: g, best: personalBests(log, lift, { gym: g, bwOf }).heaviest }))
    .filter(x => x.best);
}

/**
 * Sparkline points: the heaviest real (working) set of each session, at
 * `gym` for a machine (all gyms for a free weight), the last `n`
 * sessions → [{ x: dayNo, y, date, pb, night, last }]. `pbIds`: ids of
 * sets that were a PB when lifted (a Map or Set) — that session's point is gold.
 */
export function sparkPoints(log, lift, { gym = null, pbIds = null, n = 16 } = {}) {
  if (!lift) return [];
  const machine = perGymOf(lift);
  const byKey = new Map();
  for (const e of workingEntries(log, lift)) {
    if (machine && gymOf(e) !== (gym || null)) continue;
    const k = e.sessionId ? `s:${e.sessionId}` : `d:${e.date}`;
    const cur = byKey.get(k) || { date: e.date, y: -Infinity, pb: false, night: false };
    const w = num(e.weight);
    if (w > cur.y) cur.y = w;
    if (e.date < cur.date) cur.date = e.date;
    if (pbIds && pbIds.has(e.id)) cur.pb = true;
    if (e.shift === 'night') cur.night = true;
    byKey.set(k, cur);
  }
  const pts = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-n)
    .map(p => ({ x: dayNo(p.date), y: p.y, date: p.date, pb: p.pb, night: p.night, last: false }));
  if (pts.length) pts[pts.length - 1].last = true;
  return pts;
}

/** Split lifts in use into those with sets and the empty ones (one grouped row, A12). Order kept; archived left out. */
export function groupLifts(list, countOf) {
  const logged = [], empty = [];
  for (const l of list || []) {
    if (!l || l.archived) continue;
    ((countOf(l.id) || 0) > 0 ? logged : empty).push(l);
  }
  return { logged, empty };
}

/** "3d", "today", "5w", "4mo" — a lift row's last-logged stamp. */
export function agoShort(iso, today) {
  if (!isIso(iso) || !isIso(today)) return '';
  const d = dayNo(today) - dayNo(iso);
  if (d <= 0) return 'today';
  if (d < 14) return `${d}d`;
  if (d < 70) return `${Math.round(d / 7)}w`;
  return `${Math.round(d / 30.4)}mo`;
}

// ── The chart ──────────────────────────────────────────────────────

export const TREND_WINDOW = 5;
export const GAP_DAYS = 28;

/** The session a set belongs to: its workout, or (Quick log) its day at its gym. */
export const sessionKey = e => (e && e.sessionId ? `s:${e.sessionId}` : `d:${e ? e.date : ''}:${gymOf(e) || ''}`);

/**
 * One estimate per session (a workout, or a Quick-log day): the best
 * e1RM among its WORKING sets of 1–12 reps (warm-ups and > 12 reps make
 * none), → [{ key, date, n, value, entry, night, gym, loose }] oldest
 * first. `loose`: the estimate came from 6–12 reps (drawn dotted).
 */
export function sessionE1rms(sets, lift, { bwOf } = {}) {
  const byKey = new Map();
  const bwKg = iso => { if (!bwOf) return null; const r = bwOf(iso); return r == null ? null : typeof r === 'object' ? num(r.kg) : num(r); };
  for (const e of workingEntries(sets, lift)) {
    const r = num(e.reps);
    if (r == null || r > LOW_CONFIDENCE_REPS) continue;
    const v = entryE1rm(e, lift, bwKg(e.date));
    if (v == null) continue;
    const key = sessionKey(e);
    const cur = byKey.get(key);
    if (!cur || v > cur.value + 1e-9) {
      byKey.set(key, { key, date: e.date, n: dayNo(e.date), value: v, entry: e, night: e.shift === 'night', gym: gymOf(e), loose: r >= 6 });
    }
  }
  return [...byKey.values()].sort((a, b) => a.n - b.n || (a.key < b.key ? -1 : 1));
}

/** Median of a non-empty number list. */
export function median(vals) {
  const s = vals.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Split points (sorted by `n`) into runs, starting a new run after a gap longer than `gap` days. */
export function splitByGap(points, gap = GAP_DAYS) {
  const out = [];
  let cur = [];
  for (const p of points) {
    if (cur.length && p.n - cur[cur.length - 1].n > gap) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The trend: a trailing `k`-session rolling median of DAY sessions only
 * (night sessions are drawn but never join it; warm-ups never made a
 * point), restarted after a gap > `gap` days so a layoff breaks the line
 * instead of bridging it → [[{ n, date, value }]] (one array per run).
 */
export function trendSegments(points, { k = TREND_WINDOW, gap = GAP_DAYS } = {}) {
  const day = (points || []).filter(p => !p.night);
  return splitByGap(day, gap).map(run => run.map((p, i) => ({
    n: p.n, date: p.date, value: median(run.slice(Math.max(0, i - k + 1), i + 1).map(q => q.value)),
  })));
}

/**
 * The est. 1RM tile's change over DAY sessions only: the latest trend value
 * against the trend about `weeks` earlier → { delta, weeks, lastNight }.
 * `delta` is null with fewer than 3 day sessions. `lastNight`: the most
 * recent session was a night one (the tile says the trend skips it).
 */
export function trendDelta(points, { weeks = 12, k = TREND_WINDOW, gap = GAP_DAYS } = {}) {
  const pts = points || [];
  const lastNight = !!(pts.length && pts[pts.length - 1].night);
  const flat = trendSegments(pts, { k, gap }).flat();
  if (flat.length < 3) return { delta: null, weeks, lastNight };
  const last = flat[flat.length - 1];
  let base = flat[0];
  for (const p of flat) if (p.n <= last.n - weeks * 7) base = p;
  if (base === last) return { delta: null, weeks, lastNight };
  return { delta: Math.round((last.value - base.value) * 10) / 10, weeks: Math.max(1, Math.round((last.n - base.n) / 7)), lastNight };
}

/** Round, readable Y ticks (3–4) for [lo, hi] → { lo, hi, step, ticks }. */
export function niceTicks(lo, hi, target = 4) {
  let a = num(lo), b = num(hi);
  if (a == null || b == null) return { lo: 0, hi: 10, step: 5, ticks: [0, 5, 10] };
  if (b - a < 2) { a -= 1; b += 1; }
  const STEPS = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const raw = (b - a) / Math.max(1, target - 1);
  const step = STEPS.find(s => s >= raw) || 500;
  const L = Math.floor(a / step) * step, H = Math.ceil(b / step) * step;
  const ticks = [];
  for (let v = L; v <= H + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { lo: L, hi: H, step, ticks };
}

// ── Rep maxes ──────────────────────────────────────────────────────

/** The weight Epley predicts for `reps` from a 1RM (reps 1 → the 1RM itself). */
export const predictWeight = (oneRm, reps) => (num(oneRm) == null ? null : reps <= 1 ? num(oneRm) : num(oneRm) / (1 + reps / 30));

/**
 * The rep-max table → [{ n, entry, est, low, heaviest, pred }]:
 * `entry` the heaviest REAL set of ≥ n reps (null when there is none),
 * `est` its estimated 1RM, `heaviest` when it is the all-time heaviest set,
 * `pred` (only when `entry` is null) the weight predicted for n reps from
 * the best estimate — shown muted as "(pred.)", never a PB, never gold.
 * A dip (bodyweight + added) gets no prediction: its estimate is on total load.
 */
export function repMaxRows(pb, lift, { bwOf, bestE1rm = null } = {}) {
  const bwKg = iso => { if (!bwOf) return null; const r = bwOf(iso); return r == null ? null : typeof r === 'object' ? num(r.kg) : num(r); };
  const best = bestE1rm != null ? num(bestE1rm) : pb && pb.bestE1rm && !pb.bestE1rm.low ? pb.bestE1rm.value : null;
  const canPredict = best != null && !(lift && lift.load === 'bodyweight_plus');
  return REP_MAX_NS.map(n => {
    const e = pb && pb.repMaxes ? pb.repMaxes[n] : null;
    if (e) {
      return { n, entry: e, est: entryE1rm(e, lift, bwKg(e.date)), low: num(e.reps) > LOW_CONFIDENCE_REPS, heaviest: !!(pb.heaviest && pb.heaviest.entry === e), pred: null };
    }
    return { n, entry: null, est: null, low: false, heaviest: false, pred: canPredict ? predictWeight(best, n) : null };
  });
}

// ── Quick log's date chip ──────────────────────────────────────────

/**
 * 'today' | 'yesterday' | 'YYYY-MM-DD' → the ISO date to log, never after
 * `maxDate` (the calendar today). `today` is the TRAINING day (after a
 * night shift it is yesterday's calendar date), so "Today" defaults there.
 */
export function resolveLogDate(choice, { today, maxDate = today } = {}) {
  const max = isIso(maxDate) ? maxDate : today;
  let iso = choice === 'today' ? today : choice === 'yesterday' && isIso(today) ? addDays(today, -1) : choice;
  if (!isIso(iso)) iso = today;
  if (isIso(max) && isIso(iso) && iso > max) iso = max;
  return iso;
}
/** The chip's words: "Today", "Yesterday", "Mon 12 Oct" (year added when it isn't today's). */
export function dateChipLabel(iso, today) {
  if (!isIso(iso)) return 'Pick a date';
  if (iso === today) return 'Today';
  if (isIso(today) && iso === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW3[dowIdx(iso)]} ${d} ${MON3[m - 1]}${isIso(today) && today.slice(0, 4) !== String(y) ? ` ${y}` : ''}`;
}
/**
 * A month for the in-app date sheet (Mon-first weeks) → { ym, label, weeks: [[{ iso, day, inMonth, disabled, today }]] }.
 * Days after `maxDate` are disabled.
 */
export function monthGrid(ym, { maxDate = null, today = null } = {}) {
  const [y, m] = String(ym).split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  if (!isIso(first)) return { ym, label: '', weeks: [] };
  const start = addDays(first, -((dowIdx(first) + 6) % 7));
  const weeks = [];
  let cur = start;
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const inMonth = Number(cur.slice(5, 7)) === m;
      row.push({ iso: cur, day: Number(cur.slice(8)), inMonth, disabled: !!(isIso(maxDate) && cur > maxDate), today: cur === today });
      cur = addDays(cur, 1);
    }
    weeks.push(row);
    if (Number(cur.slice(5, 7)) !== m) break;
  }
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return { ym: first.slice(0, 7), label: `${months[m - 1]} ${y}`, weeks };
}
/** 'YYYY-MM' shifted by `n` months. */
export function addMonths(ym, n) {
  const [y, m] = String(ym).split('-').map(Number);
  const t = (y * 12 + (m - 1)) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// ── Desktop Today: the last session ────────────────────────────────

/**
 * The most recent finished workout on or before `today` → { session, rows:
 * [{ liftId, name, top: { weight, reps }, delta }], more } | null.
 * `top` is the heaviest working set; `delta` its weight against the
 * previous like-for-like session of that lift (night vs night, and the
 * same gym for a machine) — null when there is none.
 */
export function lastSessionSummary(S, { today, n = 4, nameOf = id => id } = {}) {
  const L = liftsOf(S);
  const sessions = (L.sessions || []).filter(s => s && isIso(s.date) && (!isIso(today) || s.date <= today) && Array.isArray(s.exercises));
  if (!sessions.length) return null;
  const order = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (num(a.finishedAt) || 0) - (num(b.finishedAt) || 0));
  const sorted = sessions.slice().sort(order);
  const last = sorted[sorted.length - 1];
  const night = last.shift === 'night';
  const topOf = ex => {
    let top = null;
    for (const st of ex.sets || []) {
      if (!st || st.done === false || isWarmup(st)) continue;
      const w = num(st.weight), r = num(st.reps);
      if (w == null || r == null) continue;
      if (!top || w > top.weight || (w === top.weight && r > top.reps)) top = { weight: w, reps: r };
    }
    return top;
  };
  const rows = [];
  for (const ex of last.exercises) {
    const top = topOf(ex);
    if (!top) continue;
    const lift = L.list.find(l => l.id === ex.liftId) || null;
    let prev = null;
    for (let i = sorted.length - 2; i >= 0 && !prev; i--) {
      const s = sorted[i];
      if ((s.shift === 'night') !== night) continue;
      if (lift && perGymOf(lift) && (s.gym || null) !== (last.gym || null)) continue;
      const pe = s.exercises.find(x => x.liftId === ex.liftId);
      const t = pe ? topOf(pe) : null;
      if (t) prev = t;
    }
    rows.push({ liftId: ex.liftId, name: lift ? lift.name : nameOf(ex.liftId), top, delta: prev ? Math.round((top.weight - prev.weight) * 100) / 100 : null });
  }
  return { session: last, rows: rows.slice(0, n), more: Math.max(0, rows.length - n) };
}

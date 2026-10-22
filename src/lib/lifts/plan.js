/**
 * The session plan — what to train on any date, DERIVED (owner, Oct
 * 2026: "make the logger dynamic with my goal: if I do Push on a Leg day
 * then it'll change the suggestions for the next day").
 *
 * Nothing here is ever written. S.rotation keeps holding exactly what
 * the owner typed; the plan is worked out, every time, from three inputs:
 *
 *   1. the rota pattern (pattern.js — which days train, which session)
 *   2. the owner's manual Rotation overrides — these ALWAYS win
 *   3. finished Vantage workouts (S.lifts.sessions)
 *
 * ── The rules ────────────────────────────────────────────────────────
 *   · Training vs rest stays as the pattern says (a manual override wins
 *     either way). The plan changes WHAT you train, never WHETHER.
 *   · A BLOCK is one PPLUL run: it starts on a pattern day whose session
 *     is SEQ[0] and runs to the day before the next one, so the rest days
 *     after it belong to it. A block owes each of its pattern sessions
 *     once.
 *   · Sessions done in the block — on any day, a rest day included — are
 *     crossed off. A workout that crosses nothing off is an extra.
 *   · A training day that passed with no workout is MISSED. An Upper or
 *     Lower stays owed and carries forward. An ANCHOR — Push, Pull, Legs —
 *     does not (owner, 2026-10-21): it is accepted as missed, the week
 *     runs below standard, and the next Upper (for Push / Pull) or Lower
 *     (for Legs) carries +1 set for each muscle it owed (adaptive.js).
 *     Logged later in the same block after all, it still counts as that
 *     session rather than an extra. Days before the first workout ever
 *     logged here count as done to the pattern (the logger can't know
 *     about them, and treating every one as missed would reshuffle the
 *     first week of using it).
 *   · A day the owner set by hand is their call. A session the block owes
 *     (a swap) is taken there; anything else (Arms, Rest, leave) drops
 *     the pattern session it replaced rather than carrying it.
 *   · Until the first workout is logged nothing moves: the rota stands.
 *   · Future training days in the block (today included, until a workout
 *     is logged) get the owed sessions in SEQ order, skipping one whose
 *     primary muscles overlap the last 48 h — the same day and the day
 *     before; two days before has had its 48 h. If every owed session
 *     overlaps, the least-overlapping one. Future manual days keep their
 *     session, and it counts as planned.
 *   · Nothing owed and a training day left → "Extra" (anything, or rest).
 *   · Night shifts still carry the 80% load scale — the shift is the
 *     pattern's, untouched.
 *
 * effectiveOverrides() turns the plan into the shape every rota consumer
 * already reads (`{ 'YYYY-MM-DD': { session } }`), merged UNDER the
 * owner's overrides: their entries are passed through as the very same
 * objects, and derived ones are marked `derived: 'done' | 'dynamic'` so
 * the Rotation tab can tell them apart. With no workouts logged it
 * returns the owner's overrides object itself, so every consumer is
 * byte-for-byte what it was.
 *
 * Pure: `today` is a parameter (defaulting to the local date only at the
 * edges). No React, no network.
 */
import { SEQ, scheduleOf, patternDay, resolveDay, loadScaleOf, chipText } from '../rotation/pattern.js';
import { PROGRAMME } from '../../data/trainingProgramme.js';
import { musclesOf, PROGRAMME_MUSCLES } from './muscles.js';
import { liftsOf } from './store.js';
import { isIso, addDays, dayNo, num } from './lifts.js';

export const EXTRA = 'Extra';
/** Sessions the programme keeps fixed; Upper and Lower adapt around them (adaptive.js). */
export const ANCHOR_CODES = Object.freeze(['Push', 'Pull', 'Legs']);

/**
 * Each session's PRIMARY muscle groups — what the 48-hour rule protects.
 * From PROGRAMME: every group listed here is tagged on that session's
 * own exercises (plan.test.mjs checks it); Abs, Lower back and Other are
 * left out of all five because no session is built around them.
 */
export const SESSION_MUSCLES = Object.freeze({
  Push: Object.freeze(['Chest', 'Shoulders', 'Triceps']),
  Pull: Object.freeze(['Back', 'Biceps']),
  Legs: Object.freeze(['Quads', 'Hamstrings', 'Calves']),
  Upper: Object.freeze(['Chest', 'Back', 'Shoulders', 'Triceps', 'Biceps']),
  Lower: Object.freeze(['Glutes', 'Hamstrings', 'Quads', 'Calves']),
});
const PRIMARY = new Set(Object.values(SESSION_MUSCLES).flat());

const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Which session was a workout? ───────────────────────────────────

/** Sets-weighted muscle profile of each programme session (for inference). */
const PROFILES = (() => {
  const out = {};
  for (const code of SEQ) {
    const v = {};
    for (const x of PROGRAMME[code] || []) {
      const ms = PROGRAMME_MUSCLES[x.name] || [];
      for (const m of ms) v[m] = (v[m] || 0) + (num(x.sets) || 1) / ms.length;
    }
    out[code] = v;
  }
  return out;
})();
const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};
export const INFER_MIN = 0.6;

/**
 * The session code a finished workout was: its rotaSession (set when it
 * was started from the suggestion or a programme template), else
 * inferred from what it trained — the closest programme session by
 * muscle profile (cosine ≥ 0.6), else null.
 */
export function sessionOfWorkout(w, list = []) {
  if (!w) return null;
  if (typeof w.rotaSession === 'string' && w.rotaSession && w.rotaSession !== EXTRA) return w.rotaSession;
  const v = {};
  for (const ex of w.exercises || []) {
    const lift = list.find(l => l.id === ex.liftId);
    const ms = musclesOf(lift);
    const n = (ex.sets || []).filter(s => s && s.done !== false).length;
    if (!ms.length || !n) continue;
    for (const m of ms) v[m] = (v[m] || 0) + n / ms.length;
  }
  let best = null, score = 0;
  for (const code of SEQ) {
    const c = cosine(v, PROFILES[code]);
    if (c > score + 1e-9) { score = c; best = code; }
  }
  return score >= INFER_MIN ? best : null;
}

/** The primary muscles a finished workout hit (its session's, else its lifts'). */
function workoutMuscles(code, w, list) {
  if (code && SESSION_MUSCLES[code]) return SESSION_MUSCLES[code];
  const out = new Set();
  for (const ex of (w && w.exercises) || []) for (const m of musclesOf(list.find(l => l.id === ex.liftId))) if (PRIMARY.has(m)) out.add(m);
  return [...out];
}

const doneCache = new WeakMap();
const EMPTY_LIST = [];
/**
 * Finished workouts by date → { byDate: Map(iso → [{ code, muscles }]), first }
 * Cached on the sessions array (and the lift list), so a stable store
 * costs nothing to re-read.
 */
function doneIndex(S) {
  const L = liftsOf(S);
  const sessions = Array.isArray(L.sessions) ? L.sessions : EMPTY_LIST;
  const list = L.list || EMPTY_LIST;
  const hit = doneCache.get(sessions);
  if (hit && hit.list === list) return hit.idx;
  const byDate = new Map();
  let first = null;
  const ordered = sessions.filter(s => s && isIso(s.date) && Array.isArray(s.exercises))
    .slice().sort((a, b) => (num(a.startedAt) || 0) - (num(b.startedAt) || 0));
  for (const w of ordered) {
    const code = sessionOfWorkout(w, list);
    const row = byDate.get(w.date) || [];
    row.push({ code, muscles: workoutMuscles(code, w, list), id: w.id });
    byDate.set(w.date, row);
    if (!first || w.date < first) first = w.date;
  }
  const idx = { byDate, first };
  doneCache.set(sessions, { list, idx });
  return idx;
}

/** Every session code trained on `iso`, in the order they were started (uninferable workouts left out). */
export function doneSessionsOn(S, iso) {
  const row = doneIndex(S).byDate.get(iso) || [];
  return [...new Set(row.map(r => r.code).filter(Boolean))];
}
/** The session actually trained on `iso` (the first, when there were two), or null. */
export const doneSessionOn = (S, iso) => doneSessionsOn(S, iso)[0] || null;

// ── Blocks ─────────────────────────────────────────────────────────

const MAX_BLOCK = 60;
function patOf(ctx, iso) {
  let p = ctx.pat.get(iso);
  if (!p) {
    const [y, m, d] = iso.split('-').map(Number);
    p = patternDay(y, m - 1, d, ctx.schedule);
    ctx.pat.set(iso, p);
  }
  return p;
}
function resOf(ctx, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return resolveDay(y, m - 1, d, ctx.raw, ctx.schedule);
}

/** The block holding `iso`: { start, end, days: [iso…], owed: [codes in SEQ order] } | null. */
function blockAt(ctx, iso) {
  if (!patOf(ctx, iso).inPattern) return null;
  let start = null;
  for (let k = 0; k <= MAX_BLOCK; k++) {
    const d = addDays(iso, -k);
    const p = patOf(ctx, d);
    if (!p.inPattern) break;
    if (p.session === SEQ[0]) { start = d; break; }
  }
  if (!start) return null;
  if (ctx.blocks.has(start)) return ctx.blocks.get(start);
  let end = addDays(start, MAX_BLOCK);
  for (let k = 1; k <= MAX_BLOCK; k++) {
    const d = addDays(start, k);
    const p = patOf(ctx, d);
    if (!p.inPattern || p.session === SEQ[0]) { end = addDays(d, -1); break; }
  }
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const inBlock = new Set(days.map(d => patOf(ctx, d).session).filter(s => s !== 'Rest'));
  const owed = SEQ.filter(s => inBlock.has(s));
  const block = { start, end, days, owed };
  block.plan = planBlock(ctx, block);
  ctx.blocks.set(start, block);
  return block;
}

const overlapOf = (a, b) => (a || []).filter(m => (b || []).includes(m)).length;

const relDay = (iso, today) => {
  const diff = dayNo(iso) - dayNo(today);
  if (diff === 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff === 1) return 'tomorrow';
  const [y, m, d] = iso.split('-').map(Number);
  const dow = DOW_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return Math.abs(diff) <= 6 ? `on ${dow}` : `on ${dow.slice(0, 3)} ${d} ${MON_SHORT[m - 1]}`;
};
/** "yesterday" / "Thursday" — relative words only when the day being explained is today. */
const fromWord = (iso, today, about) => {
  if (about !== today) { const [y, m, d] = iso.split('-').map(Number); return DOW_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; }
  const r = relDay(iso, today);
  return r.startsWith('on ') ? r.slice(3) : r;
};

/**
 * The whole block, day by day → { days: Map(iso → entry), crossed: [codes],
 * owed: [codes still owed], extras }.
 */
function planBlock(ctx, block) {
  const { today, first } = ctx;
  const remaining = block.owed.slice();
  const crossed = [];
  let extras = 0;
  const info = new Map();
  const take = code => {
    const i = remaining.indexOf(code);
    if (i < 0) return false;
    remaining.splice(i, 1);
    crossed.push(code);
    return true;
  };

  const dropped = [];
  const drop = code => {
    const i = remaining.indexOf(code);
    if (i >= 0) { remaining.splice(i, 1); dropped.push(code); }
  };
  // Anchors whose day passed empty: not carried, but reclaimed if done later in the block.
  const missedAnchors = [];
  const takeOrReclaim = code => {
    if (take(code)) return true;
    const j = missedAnchors.indexOf(code);
    if (j < 0) return false;
    missedAnchors.splice(j, 1);
    crossed.push(code);
    return true;
  };

  // 1. What happened, and what the owner decided:
  //    · a workout crosses its session off (an extra when nothing is owed);
  //    · a day the owner set by hand is THEIR call: its session is taken
  //      as planned (or done, once past) when the block owes it — a swap —
  //      and otherwise the pattern session it replaced is dropped, not
  //      carried (Arms, Rest or leave instead of Legs means no Legs);
  //    · a training day that passed empty is missed (it stays owed), or
  //      counts as the pattern before the first workout ever logged.
  for (const iso of block.days) {
    const p = patOf(ctx, iso);
    const manual = !!ctx.raw[iso];
    const r = manual ? resOf(ctx, iso) : null;
    const doneRows = iso <= today ? ctx.done.byDate.get(iso) || [] : [];
    const day = { iso, p, r, manual, doneRows, missed: false };
    info.set(iso, day);
    const trainingDay = manual ? (r.shift !== 'leave' && r.session !== 'Rest') : p.session !== 'Rest';
    day.trainingDay = trainingDay;
    if (doneRows.length) {
      for (const row of doneRows) if (!(row.code && takeOrReclaim(row.code))) extras++;
    } else if (manual) {
      if (trainingDay && remaining.includes(r.session)) {
        if (iso < today) take(r.session);
        else { remaining.splice(remaining.indexOf(r.session), 1); day.reserved = true; }
      } else if (p.session !== 'Rest') {
        drop(p.session);
      }
    } else if (iso < today && trainingDay) {
      if (!first || iso < first) { take(p.session); day.assumed = true; } else {
        day.missed = true;
        if (ANCHOR_CODES.includes(p.session) && remaining.includes(p.session)) {
          remaining.splice(remaining.indexOf(p.session), 1);
          missedAnchors.push(p.session);
          day.accepted = true;
        }
      }
    }
  }
  const owedAfterPast = [...remaining, ...block.days.map(d => info.get(d)).filter(d => d.reserved).map(d => d.r.session)];

  // 3. Fill the training days left, in SEQ order, minding the 48 hours.
  const musclesOn = iso => {
    const day = info.get(iso);
    if (day) {
      if (day.doneRows.length) return [...new Set(day.doneRows.flatMap(x => x.muscles))];
      if (day.session) return SESSION_MUSCLES[day.session] || [];
      if (day.manual && iso >= today) return SESSION_MUSCLES[day.r.session] || [];
      return [];
    }
    // the day before the block: a workout, or (if still to come) its plan
    if (iso <= today) return [...new Set((ctx.done.byDate.get(iso) || []).flatMap(x => x.muscles))];
    const r = resOf(ctx, iso);
    return SESSION_MUSCLES[r.session] || [];
  };
  for (const iso of block.days) {
    const day = info.get(iso);
    // Nothing logged yet → nothing to react to: the rota stands as it is.
    if (!first || iso < today || day.doneRows.length || day.manual || day.p.session === 'Rest') continue;
    if (!remaining.length) { day.session = EXTRA; continue; }
    const recent = musclesOn(addDays(iso, -1));
    // The first owed session clear of the last 48 h; if none is, the least overlapping.
    const k = remaining.findIndex(code => overlapOf(SESSION_MUSCLES[code], recent) === 0);
    let pick;
    if (k >= 0) {
      pick = remaining[k];
      day.skipped = remaining.slice(0, k);
    } else {
      pick = remaining.reduce((a, b) => (overlapOf(SESSION_MUSCLES[b], recent) < overlapOf(SESSION_MUSCLES[a], recent) ? b : a));
      day.skipped = [];
    }
    remaining.splice(remaining.indexOf(pick), 1);
    day.session = pick;
  }

  // The latest thing that knocked the block off its pattern, for the "why".
  let cause = null;
  for (const iso of block.days) {
    if (iso > today) break;
    const day = info.get(iso);
    if (day.manual) continue;
    const codes = day.doneRows.map(x => x.code).filter(Boolean);
    if (codes.length && !(codes.length === 1 && codes[0] === day.p.session)) cause = { kind: 'done', iso, codes, p: day.p.session };
    else if (day.missed) cause = { kind: 'missed', iso, p: day.p.session };
  }
  return { info, crossed, owedAfterPast, dropped, extras, cause, missedAnchors };
}

// ── The plan ───────────────────────────────────────────────────────

function makeCtx(S, today) {
  const raw = (S && S.rotation && S.rotation.overrides) || {};
  return { S, today, raw, schedule: scheduleOf(S), done: doneIndex(S), first: doneIndex(S).first, pat: new Map(), blocks: new Map() };
}

function whyOf(entry, block, ctx) {
  const { today } = ctx;
  const { session, source } = entry;
  if (source === 'manual') return 'Set by you on the Rotation tab';
  if (source === 'done') {
    const codes = entry.done.length ? entry.done.join(' + ') : 'A workout';
    return entry.trainingDay && entry.patternSession !== 'Rest' && entry.done[0] !== entry.patternSession
      ? `${codes} logged on a ${entry.patternSession} day` : `${codes} logged`;
  }
  if (session === EXTRA) return 'Every session of this block is done — anything now is extra';
  if (entry.missed) {
    if (ANCHOR_CODES.includes(entry.patternSession) && block.plan.crossed.includes(entry.patternSession)) return `${entry.patternSession} missed here — done later this block`;
    return ANCHOR_CODES.includes(entry.patternSession)
      ? `${entry.patternSession} missed — ${entry.patternSession === 'Legs' ? 'Lower' : 'Upper'} picks up a set for each muscle it owed`
      : `${entry.patternSession} missed — it carries forward`;
  }
  if (source === 'pattern') return `${session} on your rota`;
  // dynamic: where it came from, and what moved it
  const day = block.plan.info.get(entry.iso);
  const at = block.days.find(d => patOf(ctx, d).session === session);
  const parts = [];
  if (at && at !== entry.iso) parts.push(`${at < entry.iso ? 'moved from' : 'brought forward from'} ${fromWord(at, today, entry.iso)}`);
  const c = block.plan.cause;
  if (c && c.kind === 'done') parts.push(`you did ${c.codes.join(' + ')} ${relDay(c.iso, today)}`);
  else if (c && c.kind === 'missed') parts.push(`${c.p} was missed ${relDay(c.iso, today)}`);
  if (day && day.skipped && day.skipped.length) parts.push(`${day.skipped.join(', ')} would hit the same muscles inside 48 h`);
  return parts.length ? `${session} — ${parts.join(', ')}` : `${session} — the next one owed this block`;
}

function entryFor(ctx, iso) {
  const p = patOf(ctx, iso);
  const manual = !!ctx.raw[iso];
  const r = resOf(ctx, iso);
  const doneRows = iso <= ctx.today ? ctx.done.byDate.get(iso) || [] : [];
  const done = [...new Set(doneRows.map(x => x.code).filter(Boolean))];
  const block = p.inPattern ? blockAt(ctx, iso) : null;
  const day = block ? block.plan.info.get(iso) : null;
  const trainingDay = manual ? (r.shift !== 'leave' && r.session !== 'Rest') : p.session !== 'Rest';
  let session = r.session, source = manual ? 'manual' : 'pattern', missed = false;
  if (!manual) {
    if (doneRows.length) { source = 'done'; session = done[0] || p.session; }
    else if (day && day.session) { session = day.session; source = session === p.session ? 'pattern' : 'dynamic'; }
    else if (iso < ctx.today && trainingDay && ctx.first && iso >= ctx.first) missed = true;
  }
  const shift = r.inPattern ? r.shift : null;
  const entry = {
    iso, session, source, shift, shiftNum: r.shiftNum || null, chip: r.inPattern ? chipText(r) : '',
    trainingDay: !!(r.inPattern && trainingDay), inPattern: !!r.inPattern,
    loadScale: shift === 'leave' || !shift ? 1 : loadScaleOf(shift), night: shift === 'night',
    patternSession: p.session, done, missed,
    moved: (source === 'dynamic') || (source === 'done' && trainingDay && !!done[0] && done[0] !== p.session),
    blockStart: block ? block.start : null,
  };
  entry.why = block ? whyOf(entry, block, ctx) : source === 'manual' ? 'Set by you on the Rotation tab' : source === 'done' ? `${done.join(' + ') || 'A workout'} logged` : `${session} on your rota`;
  return entry;
}

/**
 * The plan for `days` dates from `from`:
 *   [{ iso, session, source: 'manual'|'done'|'dynamic'|'pattern', shift, shiftNum, chip,
 *      trainingDay, loadScale, night, patternSession, done: [codes], missed, moved, why, blockStart }]
 * Dates outside the rota pattern are left out.
 */
export function plannedSessions(S, { from, days = 1, today } = {}) {
  const t = isIso(today) ? today : localToday();
  const start = isIso(from) ? from : t;
  const ctx = makeCtx(S, t);
  const out = [];
  for (let i = 0; i < Math.max(0, Math.min(400, days)); i++) {
    const iso = addDays(start, i);
    if (!patOf(ctx, iso).inPattern) continue;
    out.push(entryFor(ctx, iso));
  }
  return out;
}

/** The plan for one date, or null outside the pattern. */
export const plannedOn = (S, iso, today) => plannedSessions(S, { from: iso, days: 1, today: today || iso })[0] || null;

/**
 * Where the current block stands → { start, end, total, done: [codes], owed: [codes],
 * missed: [anchor codes accepted as missed], extras,
 * label: "3 of 5 this block · Legs, Lower to do" } | null outside a block.
 * `owed` is what is still to train (today's included until it's logged).
 */
export function blockProgress(S, today) {
  const t = isIso(today) ? today : localToday();
  const ctx = makeCtx(S, t);
  const block = blockAt(ctx, t);
  if (!block) return null;
  const { crossed, owedAfterPast, extras, dropped, missedAnchors } = block.plan;
  const done = SEQ.filter(s => crossed.includes(s));
  const owed = SEQ.filter(s => owedAfterPast.includes(s));
  const missed = SEQ.filter(s => missedAnchors.includes(s));
  const total = block.owed.length - dropped.length;   // a session the owner swapped for Arms / Rest / leave isn't owed
  const label = `${done.length} of ${total} this block · ${owed.length ? `${owed.join(', ')} to do` : 'block complete'}${missed.length ? ` · ${missed.join(', ')} missed` : ''}${extras ? ` · ${extras} extra` : ''}`;
  return { start: block.start, end: block.end, total, done, owed, missed, extras, label };
}

// ── For every rota consumer ────────────────────────────────────────

const EMPTY = Object.freeze({});
const memo = [];
/**
 * The owner's overrides MERGED with the plan: `{ iso: { session, derived } }`
 * for past days a workout changed (derived 'done') and for the next
 * `horizonDays` the plan moved (derived 'dynamic'). The owner's own
 * entries are the same objects, untouched, and win. No workouts → the
 * owner's overrides object itself. Memoised on its inputs' identity.
 */
export function effectiveOverrides(S, { today, horizonDays = 21 } = {}) {
  const t = isIso(today) ? today : localToday();
  const raw = (S && S.rotation && S.rotation.overrides) || EMPTY;
  const L = S && S.lifts;
  const sessions = L && L.sessions;
  const list = L && L.list;
  const schedule = S && S.rotation && S.rotation.schedule;
  const hit = memo.find(m => m.raw === raw && m.sessions === sessions && m.list === list && m.schedule === schedule && m.t === t && m.h === horizonDays);
  if (hit) return hit.out;
  const out = computeEffective(S, raw, t, horizonDays);
  memo.unshift({ raw, sessions, list, schedule, t, h: horizonDays, out });
  if (memo.length > 6) memo.pop();
  return out;
}

function computeEffective(S, raw, t, horizonDays) {
  const ctx = makeCtx(S, t);
  if (!ctx.first) return raw;
  const out = { ...raw };
  let changed = false;
  const put = (iso, session, derived) => {
    if (raw[iso] || !session) return;
    out[iso] = { session, derived };
    changed = true;
  };
  // Past done days before the current block: what was trained, where it differs.
  const cur = blockAt(ctx, t);
  const from = cur ? cur.start : t;
  for (const [iso, rows] of ctx.done.byDate) {
    if (iso >= from || iso > t || !patOf(ctx, iso).inPattern) continue;
    const code = rows.map(x => x.code).find(Boolean);
    if (code && code !== patOf(ctx, iso).session) put(iso, code, 'done');
  }
  // The current block to the horizon: done and dynamic days.
  const n = dayNo(addDays(t, horizonDays)) - dayNo(from) + 1;
  for (const e of plannedSessions(S, { from, days: n, today: t })) {
    if (e.source === 'done' && e.session !== e.patternSession && e.done.length) put(e.iso, e.session, 'done');
    else if (e.source === 'dynamic' && e.iso >= t) put(e.iso, e.session, 'dynamic');
  }
  return changed ? out : raw;
}

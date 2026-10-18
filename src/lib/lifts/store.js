/**
 * Lifts — the `S.lifts` store and every write to it.
 *
 *   S.lifts = {
 *     list: [{ id, name, load: 'weight'|'bodyweight_plus'|'per_hand', unit: 'kg', archived?: true, createdAt,
 *              muscles?: string[] }],
 *     log:  [{ id, liftId, date: 'YYYY-MM-DD', weight, reps, notes?, rpe?, shift?, createdAt, sessionId? }],
 *     // the workout logger (workout.js) — all additive:
 *     sessions?:  finished workouts, newest last (at most 400; the log is never trimmed)
 *     active?:    the workout in progress, or null
 *     templates?: [{ id, name, exercises: [{ liftId, sets, reps? }] }]
 *     restSec?:   the rest timer length last chosen
 *   }
 *
 * DATA SAFETY (CLAUDE.md #1). `lifts` is a NEW key: nothing existing is
 * read, rewritten or migrated. Every writer here takes the whole state
 * and returns `{ ...prev, lifts }` — it touches `lifts` and nothing else,
 * and returns `prev` itself when there is nothing to change (update()
 * then skips the save). The default list is seeded ONLY when `S.lifts`
 * is absent; an existing list — however short, however odd — is never
 * replaced. Seeded lifts carry fixed ids (`seed-…`), so two devices that
 * each seed before syncing merge into one list by id rather than two.
 *
 * Delete is a remove that hands back exactly what it removed and where,
 * so Undo restores the identical entry in its old place. A lift with
 * sets is archived, never deleted.
 *
 * Pure: `now`, `today` and ids are parameters.
 */
import { LOAD_TYPES, isIso, num } from './lifts.js';

/** The programme's main compound movements (src/data/trainingProgramme.js). */
export const DEFAULT_LIFTS = Object.freeze([
  { id: 'seed-leg-press', name: 'Machine leg press', load: 'weight' },
  { id: 'seed-dip', name: 'Dip', load: 'bodyweight_plus' },
  { id: 'seed-incline-db-press', name: 'Incline dumbbell press', load: 'per_hand' },
  { id: 'seed-shoulder-press', name: 'Machine shoulder press', load: 'weight' },
  { id: 'seed-lat-pulldown', name: 'Lat pulldown', load: 'weight' },
  { id: 'seed-cable-row', name: 'Single-arm cable row', load: 'weight' },
  { id: 'seed-hip-thrust', name: 'Hip thrust', load: 'weight' },
]);

export const LIMITS = { weight: [0, 1000], reps: [1, 50], rpe: [1, 10], name: 60, notes: 500 };

/** A fresh store holding the default lifts and no sets. */
export function seedLifts(now = 0) {
  return { list: DEFAULT_LIFTS.map(l => ({ ...l, unit: 'kg', createdAt: now })), log: [] };
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const hasLifts = S => !!S && isObj(S.lifts);

/**
 * The state with `lifts` seeded — or `prev` itself, untouched, whenever
 * `lifts` already exists in any form. The only place the defaults are written.
 */
export function ensureLifts(prev, now = 0) {
  if (!prev || hasLifts(prev)) return prev;
  return { ...prev, lifts: seedLifts(now) };
}

/** Read view: { list, log } arrays, never null. Absent store → the defaults (not written). */
export function liftsOf(S) {
  if (!hasLifts(S)) return seedLifts(0);
  const l = S.lifts;
  return { ...l, list: Array.isArray(l.list) ? l.list : [], log: Array.isArray(l.log) ? l.log : [] };
}

/**
 * Apply `fn(lifts) → lifts` and return the new state, touching only
 * `lifts`. Unknown keys on the store are carried through. `fn` returning
 * its input means no change → `prev` is returned as-is.
 */
export function withLifts(prev, fn, now = 0) {
  const base = ensureLifts(prev || {}, now);
  const cur = liftsOf(base);
  const next = fn(cur);
  if (!next || next === cur) return base;
  return { ...base, lifts: next };
}

// ── Sets ───────────────────────────────────────────────────────────

/**
 * → { ok, errors: { liftId?, weight?, reps?, date?, rpe?, notes? } }
 * weight 0–1000 kg (0 is a bodyweight dip), whole reps 1–50, a real
 * date not after `today`, optional RPE 1–10.
 */
export function validateEntry(e, today) {
  const errors = {};
  const x = e || {};
  if (!x.liftId) errors.liftId = 'Pick a lift';
  const w = num(x.weight);
  if (w == null) errors.weight = 'Enter a weight';
  else if (w < LIMITS.weight[0] || w > LIMITS.weight[1]) errors.weight = 'Weight must be 0–1000 kg';
  const r = num(x.reps);
  if (r == null || !Number.isInteger(r)) errors.reps = 'Reps must be a whole number';
  else if (r < LIMITS.reps[0] || r > LIMITS.reps[1]) errors.reps = 'Reps must be 1–50';
  if (!isIso(x.date)) errors.date = 'Pick a date';
  else if (isIso(today) && x.date > today) errors.date = 'The date can’t be in the future';
  if (x.rpe != null && x.rpe !== '') {
    const p = num(x.rpe);
    if (p == null || p < LIMITS.rpe[0] || p > LIMITS.rpe[1]) errors.rpe = 'RPE is 1–10';
  }
  if (x.notes != null && String(x.notes).length > LIMITS.notes) errors.notes = `Notes are up to ${LIMITS.notes} characters`;
  return { ok: Object.keys(errors).length === 0, errors };
}

/** A clean set record. Optional keys are left off when empty. */
export function makeEntry(f, { id, now, shift } = {}) {
  const out = {
    id: f.id || id, liftId: f.liftId, date: f.date,
    weight: Math.round(num(f.weight) * 100) / 100, reps: num(f.reps),
    createdAt: num(f.createdAt) ?? now ?? 0,
  };
  const notes = typeof f.notes === 'string' ? f.notes.trim() : '';
  if (notes) out.notes = notes.slice(0, LIMITS.notes);
  const rpe = f.rpe === '' || f.rpe == null ? null : num(f.rpe);
  if (rpe != null) out.rpe = rpe;
  const sh = shift !== undefined ? shift : f.shift;
  if (sh) out.shift = sh;
  return out;
}

/** Add a set, or replace the one with the same id in place. */
export function upsertEntry(lifts, entry) {
  const log = lifts.log || [];
  const i = log.findIndex(e => e && e.id === entry.id);
  if (i < 0) return { ...lifts, log: [...log, entry] };
  const next = log.slice();
  next[i] = entry;
  return { ...lifts, log: next };
}

/** → { lifts, removed: { entry, index } | null } — `removed` is what Undo needs. */
export function removeEntry(lifts, id) {
  const log = lifts.log || [];
  const index = log.findIndex(e => e && e.id === id);
  if (index < 0) return { lifts, removed: null };
  return { lifts: { ...lifts, log: log.filter((_, i) => i !== index) }, removed: { entry: log[index], index } };
}

/** Put a removed set back, identical and where it was. A no-op if it's already there. */
export function restoreEntry(lifts, removed) {
  if (!removed || !removed.entry) return lifts;
  const log = lifts.log || [];
  if (log.some(e => e && e.id === removed.entry.id)) return lifts;
  const at = Math.max(0, Math.min(num(removed.index) ?? log.length, log.length));
  return { ...lifts, log: [...log.slice(0, at), removed.entry, ...log.slice(at)] };
}

// ── Lifts ──────────────────────────────────────────────────────────

const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim();
const sameName = (a, b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

/** → { ok, lifts, error?, id? } */
export function addLift(lifts, { name, load, muscles }, { id, now = 0 } = {}) {
  const n = cleanName(name);
  if (!n) return { ok: false, lifts, error: 'Give it a name' };
  if (n.length > LIMITS.name) return { ok: false, lifts, error: `Names are up to ${LIMITS.name} characters` };
  if (!LOAD_TYPES.includes(load)) return { ok: false, lifts, error: 'Pick how it is loaded' };
  if ((lifts.list || []).some(l => sameName(l.name, n))) return { ok: false, lifts, error: 'You already have a lift with that name' };
  const lift = { id, name: n, load, unit: 'kg', createdAt: now };
  const ms = Array.isArray(muscles) ? [...new Set(muscles.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim()))].slice(0, 12) : [];
  if (ms.length) lift.muscles = ms;
  return { ok: true, id, lifts: { ...lifts, list: [...(lifts.list || []), lift] } };
}

/** → { ok, lifts, error? } */
export function renameLift(lifts, id, name) {
  const n = cleanName(name);
  if (!n) return { ok: false, lifts, error: 'Give it a name' };
  if (n.length > LIMITS.name) return { ok: false, lifts, error: `Names are up to ${LIMITS.name} characters` };
  const list = lifts.list || [];
  const cur = list.find(l => l.id === id);
  if (!cur) return { ok: false, lifts, error: 'That lift is gone' };
  if (cur.name === n) return { ok: true, lifts };
  if (list.some(l => l.id !== id && sameName(l.name, n))) return { ok: false, lifts, error: 'You already have a lift with that name' };
  return { ok: true, lifts: { ...lifts, list: list.map(l => (l.id === id ? { ...l, name: n } : l)) } };
}

/** Archive (true) or bring back (false). Archiving keeps every set. */
export function setArchived(lifts, id, archived) {
  const list = lifts.list || [];
  const cur = list.find(l => l.id === id);
  if (!cur || !!cur.archived === !!archived) return lifts;
  return {
    ...lifts,
    list: list.map(l => {
      if (l.id !== id) return l;
      if (archived) return { ...l, archived: true };
      const rest = { ...l };
      delete rest.archived;
      return rest;
    }),
  };
}

/** Swap with the nearest neighbour of the same archived state (dir −1 up, +1 down). */
export function moveLift(lifts, id, dir) {
  const list = (lifts.list || []).slice();
  const i = list.findIndex(l => l.id === id);
  if (i < 0) return lifts;
  const arch = !!list[i].archived;
  let j = i + (dir < 0 ? -1 : 1);
  while (j >= 0 && j < list.length && !!list[j].archived !== arch) j += dir < 0 ? -1 : 1;
  if (j < 0 || j >= list.length) return lifts;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...lifts, list };
}

/** Only a lift with no sets can go; one with sets is archived instead. → { ok, lifts, error? } */
export function deleteLift(lifts, id) {
  if ((lifts.log || []).some(e => e && e.liftId === id)) return { ok: false, lifts, error: 'It has sets logged — archive it instead' };
  const list = lifts.list || [];
  if (!list.some(l => l.id === id)) return { ok: false, lifts, error: 'That lift is gone' };
  return { ok: true, lifts: { ...lifts, list: list.filter(l => l.id !== id) } };
}

/** Active lifts, the most recently logged first, then the list order. */
export function recentFirst(lifts) {
  const last = {};
  for (const e of lifts.log || []) if (e && e.liftId && (!last[e.liftId] || e.date > last[e.liftId])) last[e.liftId] = e.date;
  const list = (lifts.list || []).filter(l => !l.archived);
  return list
    .map((l, i) => ({ l, i, d: last[l.id] || '' }))
    .sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? 1 : -1))
    .map(x => x.l);
}

/** A unique id: `lf_` + time + randomness (crypto where there is one). */
export function newId(prefix = 'lf') {
  let r = '';
  try { r = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10); } catch { r = Math.random().toString(36).slice(2, 12); }
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

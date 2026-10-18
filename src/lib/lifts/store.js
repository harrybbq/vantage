/**
 * Lifts — the `S.lifts` store and every write to it.
 *
 *   S.lifts = {
 *     list: [{ id, name, load: 'weight'|'bodyweight_plus'|'per_hand', unit: 'kg', archived?: true, createdAt,
 *              muscles?: string[], perGym?: boolean }],
 *     log:  [{ id, liftId, date: 'YYYY-MM-DD', weight, reps, notes?, rpe?, shift?, createdAt, sessionId?, gym? }],
 *     // gyms (Oct 2026) — additive:
 *     gyms?:      [{ id, name, archived?: true }] — seeded with DXC / Greenock (fixed ids)
 *                 the first time a gym is written; until then the read view shows them
 *     lastGym?:   the gym last trained at — the default for the next set / workout
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

/** The owner's two gyms. Fixed ids, so two devices seeding before a sync merge by id. */
export const DEFAULT_GYMS = Object.freeze([
  Object.freeze({ id: 'dxc', name: 'DXC' }),
  Object.freeze({ id: 'greenock', name: 'Greenock' }),
]);

/** A fresh store holding the default lifts and gyms, and no sets. */
export function seedLifts(now = 0) {
  return { list: DEFAULT_LIFTS.map(l => ({ ...l, unit: 'kg', createdAt: now })), log: [], gyms: DEFAULT_GYMS.map(g => ({ ...g })) };
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
export function makeEntry(f, { id, now, shift, gym } = {}) {
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
  const g = gym !== undefined ? gym : f.gym;
  if (typeof g === 'string' && g) out.gym = g;
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

/** → { ok, lifts, error?, id? } — `perGym` stored only when given as a boolean. */
export function addLift(lifts, { name, load, muscles, perGym }, { id, now = 0 } = {}) {
  const n = cleanName(name);
  if (!n) return { ok: false, lifts, error: 'Give it a name' };
  if (n.length > LIMITS.name) return { ok: false, lifts, error: `Names are up to ${LIMITS.name} characters` };
  if (!LOAD_TYPES.includes(load)) return { ok: false, lifts, error: 'Pick how it is loaded' };
  if ((lifts.list || []).some(l => sameName(l.name, n))) return { ok: false, lifts, error: 'You already have a lift with that name' };
  const lift = { id, name: n, load, unit: 'kg', createdAt: now };
  const ms = Array.isArray(muscles) ? [...new Set(muscles.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim()))].slice(0, 12) : [];
  if (ms.length) lift.muscles = ms;
  if (typeof perGym === 'boolean') lift.perGym = perGym;
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

// ── Gyms ───────────────────────────────────────────────────────────

const validGym = g => g && typeof g === 'object' && typeof g.id === 'string' && g.id && typeof g.name === 'string';
/** Every gym (archived too). Absent / empty → DEFAULT_GYMS (a read view; nothing written). */
export function gymList(lifts) {
  const g = lifts && Array.isArray(lifts.gyms) ? lifts.gyms.filter(validGym) : [];
  return g.length ? g : DEFAULT_GYMS.map(x => ({ ...x }));
}
/** Gyms in use (not archived). */
export const activeGyms = lifts => gymList(lifts).filter(g => !g.archived);
/** "DXC" for 'dxc'; "Unassigned" for null; the id itself for a gym that has gone. */
export function gymName(lifts, id) {
  if (!id) return 'Unassigned';
  const g = gymList(lifts).find(x => x.id === id);
  return g ? g.name : String(id);
}
/** The gym the next set / workout defaults to: lastGym while it is in use, else the first gym in use. */
export function defaultGym(lifts) {
  const act = activeGyms(lifts);
  const last = lifts && lifts.lastGym;
  if (last && act.some(g => g.id === last)) return last;
  return act.length ? act[0].id : null;
}
/** The store with `gyms` written out (the defaults the first time) — or itself when it already has them. */
export function withGyms(lifts) {
  return Array.isArray(lifts.gyms) && lifts.gyms.some(validGym) ? lifts : { ...lifts, gyms: gymList(lifts) };
}
/** Is a gym referenced by any set, finished workout or the workout in progress? */
export function gymInUse(lifts, id) {
  return (lifts.log || []).some(e => e && e.gym === id)
    || (lifts.sessions || []).some(s => s && s.gym === id)
    || !!(lifts.active && lifts.active.gym === id);
}
const cleanGymName = s => String(s || '').replace(/\s+/g, ' ').trim();
const gymSlug = name => `gym-${cleanGymName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x'}`;

/** → { ok, lifts, id?, error? } */
export function addGym(lifts, name, { id } = {}) {
  const n = cleanGymName(name);
  if (!n) return { ok: false, lifts, error: 'Give the gym a name' };
  if (n.length > 30) return { ok: false, lifts, error: 'Gym names are up to 30 characters' };
  const list = gymList(lifts);
  if (list.some(g => g.name.toLowerCase() === n.toLowerCase())) return { ok: false, lifts, error: 'You already have a gym with that name' };
  let gid = id || gymSlug(n);
  while (list.some(g => g.id === gid)) gid += '-2';
  return { ok: true, id: gid, lifts: { ...withGyms(lifts), gyms: [...list, { id: gid, name: n }] } };
}
/** → { ok, lifts, error? } */
export function renameGym(lifts, id, name) {
  const n = cleanGymName(name);
  if (!n) return { ok: false, lifts, error: 'Give the gym a name' };
  if (n.length > 30) return { ok: false, lifts, error: 'Gym names are up to 30 characters' };
  const list = gymList(lifts);
  const cur = list.find(g => g.id === id);
  if (!cur) return { ok: false, lifts, error: 'That gym is gone' };
  if (cur.name === n) return { ok: true, lifts };
  if (list.some(g => g.id !== id && g.name.toLowerCase() === n.toLowerCase())) return { ok: false, lifts, error: 'You already have a gym with that name' };
  return { ok: true, lifts: { ...lifts, gyms: list.map(g => (g.id === id ? { ...g, name: n } : g)) } };
}
/** Archive (true) / bring back (false). The last gym in use can't be archived. → { ok, lifts, error? } */
export function setGymArchived(lifts, id, archived) {
  const list = gymList(lifts);
  const cur = list.find(g => g.id === id);
  if (!cur) return { ok: false, lifts, error: 'That gym is gone' };
  if (!!cur.archived === !!archived) return { ok: true, lifts };
  if (archived && list.filter(g => !g.archived).length <= 1) return { ok: false, lifts, error: 'Keep at least one gym in use' };
  const gyms = list.map(g => {
    if (g.id !== id) return g;
    if (archived) return { ...g, archived: true };
    const rest = { ...g };
    delete rest.archived;
    return rest;
  });
  return { ok: true, lifts: { ...lifts, gyms } };
}
/** Delete a gym nothing refers to; one with sets or workouts is archived instead. → { ok, lifts, error? } */
export function deleteGym(lifts, id) {
  const list = gymList(lifts);
  if (!list.some(g => g.id === id)) return { ok: false, lifts, error: 'That gym is gone' };
  if (gymInUse(lifts, id)) return { ok: false, lifts, error: 'It has sets logged — archive it instead' };
  if (list.length <= 1) return { ok: false, lifts, error: 'Keep at least one gym' };
  const out = { ...lifts, gyms: list.filter(g => g.id !== id) };
  if (out.lastGym === id) delete out.lastGym;
  return { ok: true, lifts: out };
}
/** Remember the gym last trained at. */
export function setLastGym(lifts, id) {
  if (!id || !gymList(lifts).some(g => g.id === id)) return lifts;
  const base = withGyms(lifts);
  return base.lastGym === id ? base : { ...base, lastGym: id };
}
/** Per gym (true) or across gyms (false) for one lift — an explicit choice, which then beats the name rule. */
export function setPerGym(lifts, liftId, on) {
  const list = lifts.list || [];
  const cur = list.find(l => l.id === liftId);
  if (!cur || cur.perGym === !!on) return lifts;
  return { ...lifts, list: list.map(l => (l.id === liftId ? { ...l, perGym: !!on } : l)) };
}

/** A unique id: `lf_` + time + randomness (crypto where there is one). */
export function newId(prefix = 'lf') {
  let r = '';
  try { r = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10); } catch { r = Math.random().toString(36).slice(2, 12); }
  return `${prefix}_${Date.now().toString(36)}${r}`;
}

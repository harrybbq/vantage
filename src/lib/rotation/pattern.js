/**
 * Shift rotation + training pattern.
 *
 * Lifted out of public/schedule/shift-rotation-2026.html, which drew the
 * same calendar with a <script> block. That page could only ever show
 * the pattern: every day was computed from the cycle and nothing could
 * be changed, so a week of annual leave or a swapped session had
 * nowhere to live. Making days editable means the pattern has to be a
 * value the app can reason about rather than DOM built on the fly.
 *
 * Pure — no DOM, no React. The interesting part is calendar arithmetic,
 * which is exactly the sort of thing that should be assertable directly.
 *
 * ── The pattern ──────────────────────────────────────────────────────
 * A 16-day cycle, anchored at ANCHOR:
 *
 *   positions  0–3   four night shifts    N1 N2 N3 N4
 *   positions  4–7   four off
 *   positions  8–11  four day shifts      D1 D2 D3 D4
 *   positions 12–15  four off
 *
 * Training is a 5-day PPLUL block slotted from the FIRST SHIFT to the
 * FIRST DAY OFF, twice per cycle:
 *
 *   0  1  2  3  4 | 5  6  7 | 8  9 10 11 12 | 13 14 15
 *   N1 N2 N3 N4 off         | D1 D2 D3 D4 off
 *   P  P  L  U  L  · rest · | P  P  L  U  L  ·  rest ·
 *
 * 10 sessions per 16 days, ~4.4/week, six rest days. Rest is the tail
 * of each off-block — the run-up to going back in — rather than being
 * split across both of its edges.
 *
 * The block length and the sequence length are both five, so each block
 * is exactly one complete PPLUL and the sequence restarts every block.
 * That makes the pattern strictly periodic: Push is always the first
 * shift day, Lower is always the first day off. A continuous roll would
 * produce the identical result here, so the simpler derivation is used.
 *
 * ── The pattern is a VALUE, with versions (Oct 2026) ─────────────────
 * Shifts change. The cycle above used to be hard-coded, so a new rota
 * would have meant editing this file — and silently redrawing every
 * date the calendar had ever shown. It is now data:
 *
 *   S.rotation.schedule = { versions: [{ id, from: 'YYYY-MM-DD',
 *       cycle: [{ shift: 'night'|'day'|'off', days: n }, …], note? }] }
 *
 * A date uses the latest version whose `from` is on or before it, and
 * each version's `from` is cycle position 0 of THAT version — so a
 * change applies from a date forward and the past keeps the pattern it
 * was actually worked on. With no stored schedule, DEFAULT_SCHEDULE is
 * exactly the cycle described above, from ANCHOR, and every date comes
 * out identical to the hard-coded version (pattern.test.mjs checks
 * every day from Jul 2026 to the end of 2027 against a copy of it).
 *
 * Training is derived the same way for any cycle: a PPLUL block starts
 * on the first day of each shift block and runs SEQ.length days, cut
 * short if it would run into the next shift block; everything else is
 * Rest. For the default that IS TRAIN_POS / REST_POS.
 *
 * Every function that reads the pattern takes an optional trailing
 * `schedule` (default DEFAULT_SCHEDULE); callers pass `scheduleOf(S)`,
 * which validates and falls back to the default — a malformed value can
 * never throw or blank a calendar.
 */

const MS = 86400000;

/** Days since the epoch, in UTC — no local-timezone drift. */
export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m, d) / MS);

/* ANCHOR, CYCLE, TRAIN_POS, REST_POS and BLOCK_STARTS describe the
   DEFAULT schedule only. Anything that draws dates reads the schedule
   (scheduleOf(S)); these stay because tests and prose quote the
   original rota, and pattern.test.mjs asserts they still match it. */

/** 15 July 2026: cycle position 0, first night shift. */
export const ANCHOR = dayNum(2026, 6, 15);

export const CYCLE = 16;

/**
 * Positions carrying a training session: the four shift days plus the
 * first day off, for each of the two shift blocks.
 */
export const TRAIN_POS = [0, 1, 2, 3, 4, 8, 9, 10, 11, 12];
/** The six rest days: the tail of each off-block. */
export const REST_POS = new Set([5, 6, 7, 13, 14, 15]);
/** Cycle position each PPLUL block starts on. */
export const BLOCK_STARTS = [0, 8];

/**
 * The PPLUL order.
 *
 * Push → Pull → Legs → Upper → Lower, set by the owner on 2026-08-16.
 *
 * History, because this has moved twice and the reason matters more
 * than the value: it was this order originally, was changed to
 * Legs → Push → Pull → Lower → Upper to match the written recomp plan
 * (which picked that so no muscle group lands on consecutive days), and
 * was then set back here by explicit instruction. The plan document's
 * §2.2 day-by-day table therefore no longer matches what the calendar
 * draws — the SHIFTS still match exactly, only the session labels
 * differ.
 *
 * Changing this re-labels the training on every day the calendar draws
 * and does not move a single shift. The calorie cycling is keyed by
 * session NAME, not by position, so the deltas follow the sessions
 * automatically and the 16-day balance stays at zero — each session
 * still occurs exactly twice per cycle whatever the order.
 */
export const SEQ = ['Push', 'Pull', 'Legs', 'Upper', 'Lower'];
/** Sessions that carry conditioning — upper days, so legs stay fresh. */
export const CARDIO_SESSIONS = new Set(['Push', 'Pull', 'Upper']);

/** Everything a day can be set to by hand. */
export const SESSION_OPTIONS = [...SEQ, 'Arms', 'Shoulders', 'Chest', 'Back', 'Core', 'Cardio', 'Rest'];

/**
 * Leave types. `worked: false` means the day stops counting as a shift
 * in the totals — the point of booking it.
 */
export const LEAVE_TYPES = [
  { id: 'annual', label: 'Annual leave', short: 'AL', tiny: 'AL', worked: false },
  { id: 'toil', label: 'TOIL / lieu', short: 'TOIL', tiny: 'TL', worked: false },
  { id: 'sick', label: 'Sick', short: 'SICK', tiny: 'SK', worked: false },
  { id: 'course', label: 'Course / training', short: 'CRS', tiny: 'CR', worked: true },
  { id: 'other', label: 'Other', short: 'OTH', tiny: 'OT', worked: false },
];
// `tiny` is the two-character form for a phone-width calendar cell,
// where "TOIL" next to a two-digit date does not fit.
export const leaveType = id => LEAVE_TYPES.find(l => l.id === id) || null;

/**
 * The plan numbers the cycle from the first DAY shift; this file
 * anchors position 0 on the first NIGHT shift. Same physical rota, two
 * origins, so the index is re-based rather than the anchor moved —
 * moving the anchor would shift every date the calendar has already
 * drawn.
 *
 *   position 8  → Day 1   (first day shift)
 *   position 0  → Day 9   (first night shift)
 *
 * For any other cycle the same rule: Day 1 is the first DAY-shift
 * position of the version in force on `iso` (position 0 if the cycle
 * has no day shifts). Without `iso` the first version is used, which
 * for the default schedule is the only one.
 */
export const ROTA_DAY_ONE_POS = 8;
export function rotaDayIndex(pos, schedule = DEFAULT_SCHEDULE, iso) {
  if (pos == null) return null;
  const vs = compiled(schedule);
  const v = (isRealIso(iso) && versionAt(vs, isoNum(iso))) || vs[0];
  if (!v) return null;
  return ((((pos - v.dayOnePos) % v.len) + v.len) % v.len) + 1;
}

/** The plan's vocabulary for a shift, used to pick nutrition targets. */
export function dayTypeOf(shift) {
  if (shift === 'night') return 'night_shift';
  if (shift === 'day') return 'day_shift';
  return 'off';           // includes booked leave — not a working night
}

/**
 * Prescribed load multiplier. Night sessions run at 80%: same sets,
 * same reps, lighter bar. Maintenance intent, not progression.
 */
export function loadScaleOf(shift) {
  return shift === 'night' ? 0.8 : 1;
}

/** 'YYYY-MM-DD' for a y/m/d triple (m is 0-based, as everywhere else here). */
export function isoOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ══ The schedule ═════════════════════════════════════════════════ */

export const SHIFT_KINDS = ['night', 'day', 'off'];
/** Validation bounds for a cycle: blocks, days per block, total days. */
export const SCHEDULE_LIMITS = { maxBlocks: 20, maxBlockDays: 28, maxTotal: 60 };

/** Today's rota, as blocks: four nights, four off, four days, four off. */
export const DEFAULT_CYCLE = Object.freeze([
  Object.freeze({ shift: 'night', days: 4 }),
  Object.freeze({ shift: 'off', days: 4 }),
  Object.freeze({ shift: 'day', days: 4 }),
  Object.freeze({ shift: 'off', days: 4 }),
]);
export const DEFAULT_FROM = '2026-07-15';
/** What a missing S.rotation.schedule means — exactly the hard-coded rota. */
export const DEFAULT_SCHEDULE = Object.freeze({
  versions: Object.freeze([Object.freeze({ id: 'default', from: DEFAULT_FROM, cycle: DEFAULT_CYCLE })]),
});

/** A real calendar date as 'YYYY-MM-DD' — "2026-02-30" is not one. */
export function isRealIso(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const isoNum = iso => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return dayNum(y, m - 1, d);
};

/**
 * A cycle cleaned to the rules, or null if it cannot be one.
 * 1–20 blocks, each a known shift for 1–28 whole days, ≤ 60 days total.
 * Anything outside that is rejected rather than clamped: a rota that
 * has been silently "fixed" is a rota that no longer says what was
 * typed.
 */
export function cleanCycle(cycle) {
  if (!Array.isArray(cycle) || cycle.length < 1 || cycle.length > SCHEDULE_LIMITS.maxBlocks) return null;
  const out = [];
  let total = 0;
  for (const b of cycle) {
    if (!b || typeof b !== 'object') return null;
    const days = typeof b.days === 'number' ? b.days : NaN;
    if (!SHIFT_KINDS.includes(b.shift)) return null;
    if (!Number.isInteger(days) || days < 1 || days > SCHEDULE_LIMITS.maxBlockDays) return null;
    total += days;
    out.push({ shift: b.shift, days });
  }
  return total <= SCHEDULE_LIMITS.maxTotal ? out : null;
}

export const cycleLength = cycle => (Array.isArray(cycle) ? cycle : []).reduce((n, b) => n + (Number(b && b.days) || 0), 0);

const normCache = new WeakMap();

/**
 * Validate a stored schedule. Bad versions are skipped, duplicates of
 * one `from` resolve to the last written, and the list comes back in
 * date order. Nothing usable → DEFAULT_SCHEDULE. Never throws.
 * Cached on the object, so a stable S.rotation.schedule gives a stable
 * result (safe as a React dependency).
 */
export function normaliseSchedule(raw) {
  if (raw === DEFAULT_SCHEDULE || !raw || typeof raw !== 'object') return DEFAULT_SCHEDULE;
  if (normCache.has(raw)) return normCache.get(raw);
  let out = DEFAULT_SCHEDULE;
  try {
    if (Array.isArray(raw.versions)) {
      const byFrom = new Map();
      for (const v of raw.versions) {
        if (!v || typeof v !== 'object' || !isRealIso(v.from)) continue;
        const cycle = cleanCycle(v.cycle);
        if (!cycle) continue;
        const clean = { id: (typeof v.id === 'string' && v.id) ? v.id.slice(0, 40) : `v${v.from}`, from: v.from, cycle };
        if (typeof v.note === 'string' && v.note.trim()) clean.note = v.note.trim().slice(0, 120);
        byFrom.set(v.from, clean);
      }
      const versions = [...byFrom.values()].sort((a, b) => a.from.localeCompare(b.from));
      if (versions.length) out = { versions };
    }
  } catch {
    out = DEFAULT_SCHEDULE;
  }
  normCache.set(raw, out);
  return out;
}

/** The schedule a state is on: validated, falling back to the default. */
export function scheduleOf(S) {
  try {
    return normaliseSchedule(S && S.rotation && S.rotation.schedule);
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

/**
 * Expand a cycle into one cell per position: shift, shift number and
 * the training session. Adjacent blocks of the same shift count as one
 * shift block (N1…N6 across "night 3, night 3").
 */
function compileCycle(cycle) {
  const cells = [];
  const starts = [];                       // first position of each shift block
  let prev = null, num = 0;
  for (const b of cycle) {
    for (let i = 0; i < b.days; i++) {
      if (b.shift !== prev) { num = 0; if (b.shift !== 'off') starts.push(cells.length); }
      prev = b.shift;
      num++;
      cells.push({ shift: b.shift, shiftNum: b.shift === 'off' ? null : num, session: 'Rest', cardio: false });
    }
  }
  const len = cells.length;
  // A PPLUL block from the first day of each shift block, cut short at
  // the next one (wrapping into the next cycle for the last block).
  starts.forEach((s, i) => {
    const next = i + 1 < starts.length ? starts[i + 1] : starts[0] + len;
    const run = Math.min(SEQ.length, next - s);
    for (let k = 0; k < run; k++) {
      const c = cells[(s + k) % len];
      c.session = SEQ[k];
      c.cardio = CARDIO_SESSIONS.has(SEQ[k]);
    }
  });
  const dayOne = cells.findIndex(c => c.shift === 'day');
  return {
    len, cells,
    dayOnePos: dayOne < 0 ? 0 : dayOne,
    trainPos: cells.map((c, i) => (c.session !== 'Rest' ? i : -1)).filter(i => i >= 0),
  };
}

const compCache = new WeakMap();
/** Normalised + expanded versions, oldest first. Cached per schedule. */
function compiled(schedule) {
  const sched = normaliseSchedule(schedule);
  if (compCache.has(sched)) return compCache.get(sched);
  const out = sched.versions.map(v => ({ id: v.id, from: v.from, fromNum: isoNum(v.from), ...compileCycle(v.cycle) }));
  compCache.set(sched, out);
  return out;
}

/** The latest version starting on or before day number `n`, or null. */
function versionAt(vs, n) {
  let hit = null;
  for (const v of vs) { if (v.fromNum <= n) hit = v; else break; }
  return hit;
}

/** The stored version in force on a date (null before the first one). */
export function versionOn(schedule, iso) {
  if (!isRealIso(iso)) return null;
  const sched = normaliseSchedule(schedule);
  const vs = compiled(sched);
  const v = versionAt(vs, isoNum(iso));
  return v ? sched.versions[vs.indexOf(v)] : null;
}

function localTodayIso() {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth(), n.getDate());
}

/**
 * The shape of the cycle in force on `iso` (default: today), for the
 * places that want proportions rather than dates — the diet blend, the
 * planned-sessions figure, the split preview. Before the first version
 * it describes the first one.
 *   → { from, len, train, rest, trainPos, cycle, cells }
 */
export function cycleShape(schedule = DEFAULT_SCHEDULE, iso = localTodayIso()) {
  const sched = normaliseSchedule(schedule);
  const vs = compiled(sched);
  const v = (isRealIso(iso) && versionAt(vs, isoNum(iso))) || vs[0];
  const i = vs.indexOf(v);
  return {
    from: v.from, len: v.len,
    train: v.trainPos.length, rest: v.len - v.trainPos.length,
    trainPos: v.trainPos.slice(),
    cycle: sched.versions[i].cycle,
    cells: v.cells.map((c, pos) => ({ pos, ...c })),
  };
}

const SHIFT_WORD = { night: ['night', 'nights'], day: ['day', 'days'], off: ['off', 'off'] };
/** "4 nights · 4 off · 4 days · 4 off" */
export function cycleSummary(cycle) {
  return (Array.isArray(cycle) ? cycle : [])
    .map(b => `${b.days} ${SHIFT_WORD[b.shift] ? SHIFT_WORD[b.shift][b.days === 1 ? 0 : 1] : b.shift}`)
    .join(' · ');
}

const newVersionId = () => {
  try {
    const a = new Uint32Array(2);
    globalThis.crypto.getRandomValues(a);
    return 'sv_' + a[0].toString(36) + a[1].toString(36);
  } catch {
    return 'sv_' + Math.random().toString(36).slice(2, 12);
  }
};

const copyVersion = v => ({ ...v, cycle: v.cycle.map(b => ({ ...b })) });

/** Stored versions that fail validation — carried through a write, never silently dropped. */
function unreadableVersions(prev) {
  const raw = prev && prev.rotation && prev.rotation.schedule;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.versions)) return [];
  return raw.versions.filter(v => !(v && typeof v === 'object' && isRealIso(v.from) && cleanCycle(v.cycle)));
}

function writeVersions(prev, versions) {
  const rotation = (prev && prev.rotation) || {};
  const raw = rotation.schedule && typeof rotation.schedule === 'object' && !Array.isArray(rotation.schedule)
    ? rotation.schedule : {};
  return {
    ...prev,
    rotation: { ...rotation, schedule: { ...raw, versions: [...unreadableVersions(prev), ...versions] } },
  };
}

/**
 * Change the pattern from a date forward. Adds a version, or replaces
 * the one that already starts on `fromIso`. The first write seeds the
 * list with the default version so the past keeps its pattern.
 * Additive: only `rotation.schedule` changes; overrides, holiday blocks
 * and the allowance are spread through untouched. Invalid input →
 * `prev` unchanged.
 */
export function setScheduleFrom(prev, fromIso, cycle, note, opts = {}) {
  const clean = cleanCycle(cycle);
  if (!isRealIso(fromIso) || !clean) return prev;
  const v = { id: opts.id || newVersionId(), from: fromIso, cycle: clean };
  if (typeof note === 'string' && note.trim()) v.note = note.trim().slice(0, 120);
  const kept = scheduleOf(prev).versions.filter(x => x.from !== fromIso).map(copyVersion);
  const versions = [...kept, v].sort((a, b) => a.from.localeCompare(b.from));
  return writeVersions(prev, versions);
}

/**
 * Remove one version. Never the last one — a schedule with no versions
 * would mean "no rota", and removing everything is spelled "go back to
 * the default", which is what an absent schedule already means.
 */
export function removeScheduleVersion(prev, id) {
  if (!(prev && prev.rotation && prev.rotation.schedule)) return prev;
  const sched = scheduleOf(prev);
  if (sched === DEFAULT_SCHEDULE || sched.versions.length <= 1) return prev;
  if (!sched.versions.some(v => v.id === id)) return prev;
  return writeVersions(prev, sched.versions.filter(v => v.id !== id).map(copyVersion));
}

/** The Track-calendar overlay switch. Absent means on. */
export const showsOnCalendar = S => !(S && S.rotation && S.rotation.showOnCalendar === false);
export function setShowOnCalendar(prev, on) {
  return { ...prev, rotation: { ...((prev && prev.rotation) || {}), showOnCalendar: !!on } };
}

const outside = () => ({ inPattern: false, shift: 'off', session: 'Rest', cardio: false, pos: null, cycle: null, shiftNum: null });

/**
 * The pattern's own answer for a date, before any override.
 *
 * @returns { inPattern, pos, cycle, shift: 'night'|'day'|'off',
 *            shiftNum: 1..n|null, session: string, cardio: boolean }
 */
export function patternDay(y, m, d, schedule = DEFAULT_SCHEDULE) {
  const n = dayNum(y, m, d);
  const v = versionAt(compiled(schedule), n);
  if (!v) return outside();
  const diff = n - v.fromNum;
  const pos = diff % v.len;
  const cycle = Math.floor(diff / v.len);
  const c = v.cells[pos];
  return { inPattern: true, pos, cycle, shift: c.shift, shiftNum: c.shiftNum, session: c.session, cardio: c.cardio };
}

/**
 * The pattern with the user's edits applied.
 *
 * Overrides are sparse and keyed by ISO date. Each may carry a
 * `session` (swap the muscle group) and/or a `leave` (this shift is
 * booked off). They are independent: booking leave does not wipe the
 * session, because a rest-day gym session on annual leave is a normal
 * thing to want.
 *
 * @param overrides { 'YYYY-MM-DD': { session?, leave?, note? } }
 */
export function resolveDay(y, m, d, overrides = {}, schedule = DEFAULT_SCHEDULE) {
  const base = patternDay(y, m, d, schedule);
  const iso = isoOf(y, m, d);
  const ov = (overrides || {})[iso];
  if (!ov) return { ...base, iso, edited: false, leave: null };

  const out = { ...base, iso, edited: true, leave: ov.leave || null, note: ov.note || '' };
  if (ov.session) {
    out.session = ov.session;
    out.cardio = CARDIO_SESSIONS.has(ov.session) || ov.session === 'Cardio';
  }
  // Leave replaces the shift but keeps shiftNum out of the label — a
  // booked day is not "N3", it is annual leave that happened to fall on
  // what would have been N3. The original is kept for the tooltip.
  if (ov.leave) {
    out.baseShift = base.shift;
    out.baseShiftNum = base.shiftNum;
    out.shift = 'leave';
    out.shiftNum = null;
  }
  return out;
}

/** Short chip text for a resolved day: N1 / D3 / AL / '' */
export function chipText(day) {
  if (day.shift === 'leave') return leaveType(day.leave)?.short || 'LV';
  if (day.shift === 'night') return 'N' + day.shiftNum;
  if (day.shift === 'day') return 'D' + day.shiftNum;
  return '';
}

/** "Night 2 · Push" / "Off · Lower" / "Annual leave · Rest" for a resolved day. */
export function shiftDayLabel(day) {
  if (!day || !day.inPattern) return '';
  const what = day.shift === 'leave' ? (leaveType(day.leave)?.label || 'Leave')
    : day.shift === 'night' ? `Night ${day.shiftNum}`
    : day.shift === 'day' ? `Day ${day.shiftNum}`
    : 'Off';
  return `${what} · ${day.session}`;
}

/* ══ The Track calendar overlay ═════════════════════════════════════
 * The owner's shifts drawn as a chip on the main Track calendar, so the
 * rota and the rest of the diary are one view. Owner gating lives in
 * the UI (useIsOwner); these are pure and read the same overrides and
 * schedule as the Rotation tab, so the two can never disagree. */

/** The resolved day for an ISO date with chip + label, or null outside the pattern. */
export function shiftOn(S, iso, schedule = scheduleOf(S)) {
  if (!isRealIso(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const r = resolveDay(y, m - 1, d, (S && S.rotation && S.rotation.overrides) || {}, schedule);
  if (!r.inPattern) return null;
  return { ...r, chip: chipText(r), label: shiftDayLabel(r) };
}

/**
 * Chips for a month: { 'YYYY-MM-DD': { chip, tiny, shift, label } } for every
 * day that has one. Off days have no chip and are left out, so a cell
 * looks up one key and draws nothing when it is missing.
 */
export function shiftChipsInMonth(S, y, m) {
  const out = {};
  const schedule = scheduleOf(S);
  const overrides = (S && S.rotation && S.rotation.overrides) || {};
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= dim; d++) {
    const r = resolveDay(y, m, d, overrides, schedule);
    if (!r.inPattern) continue;
    const chip = chipText(r);
    if (!chip) continue;
    const tiny = r.shift === 'leave' ? (leaveType(r.leave)?.tiny || 'LV') : chip;
    out[r.iso] = { chip, tiny, shift: r.shift, label: shiftDayLabel(r) };
  }
  return out;
}

/** Calendar grid for a month: leading blanks then resolved days. */
export function monthGrid(y, m, overrides = {}, schedule = DEFAULT_SCHEDULE) {
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7;           // Monday-first
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(resolveDay(y, m, d, overrides, schedule));
  return cells;
}

/** Every [year, month] from `from` to `to` inclusive. */
export function monthRange(fromY, fromM, toY, toM) {
  const out = [];
  let y = fromY, m = fromM;
  while (y < toY || (y === toY && m <= toM)) {
    out.push([y, m]);
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}

/**
 * Totals across a date range, with overrides applied.
 *
 * Leave is counted separately AND removed from the shift it replaced —
 * otherwise booking a week off would leave the night-shift count
 * unchanged, which is the one number you booked it to reduce.
 */
export function rangeStats(from, to, overrides = {}, schedule = DEFAULT_SCHEDULE) {
  const stats = { night: 0, day: 0, off: 0, leave: 0, sessions: 0, cardio: 0, byLeave: {} };
  const start = new Date(from.getTime());
  while (start <= to) {
    const y = start.getUTCFullYear(), m = start.getUTCMonth(), d = start.getUTCDate();
    const r = resolveDay(y, m, d, overrides, schedule);
    if (r.inPattern) {
      if (r.shift === 'leave') {
        stats.leave++;
        stats.byLeave[r.leave] = (stats.byLeave[r.leave] || 0) + 1;
      } else {
        stats[r.shift]++;
      }
      if (r.session && r.session !== 'Rest') {
        stats.sessions++;
        if (r.cardio) stats.cardio++;
      }
    }
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return stats;
}

/* ══ Holiday blocks and the leave allowance ═════════════════════════ */

/**
 * The yearly allowance. Base entitlement plus the bank holidays that
 * are paid as leave rather than taken — this rota doesn't get them off,
 * so they arrive as days in the pot instead.
 */
export const ALLOWANCE_DEFAULT = { base: 25, extra: 10 };

/** Which leave types are drawn from the allowance. Sick and course are
 *  not holiday; TOIL is time already worked, so it isn't either. */
export const CHARGEABLE = new Set(['annual']);

const isoToNum = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return dayNum(y, m - 1, d);
};
const numToIso = n => {
  const dt = new Date(n * MS);
  return isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
};

/** Every ISO date from a to b inclusive, in order, whichever way round. */
export function datesBetween(isoA, isoB) {
  if (!isoA || !isoB) return [];
  let a = isoToNum(isoA), b = isoToNum(isoB);
  if (a > b) [a, b] = [b, a];
  const out = [];
  for (let n = a; n <= b; n++) out.push(numToIso(n));
  return out;
}

/**
 * The leave YEAR.
 *
 * The allowance resets on 1 January, so "how many days are left" is a
 * question about a year and not about the whole override map — which is
 * what it used to be counted against. Every day booked since the rota
 * page existed was being subtracted from one pot forever, so the number
 * could only ever go down and would have been wrong from next January.
 */
export const leaveYearOf = iso => Number(String(iso).slice(0, 4));

/**
 * Days already spent this leave year BEFORE the app started counting.
 *
 * The rota page arrived on 2026-08-09 with 23 of the 35 days already
 * taken — 12 left. Nothing in the override map knows about those, and
 * back-filling 23 invented bookings on invented dates would have put
 * fiction in the calendar to make one number right. So the opening
 * position is stored as a number, and the map is left to mean what it
 * says: the days booked here.
 *
 * Only 2026 has one. 2027 opens on a clean 35 with nothing subtracted,
 * which is the whole point of making this year-aware.
 */
export const TRACKING_FROM = '2026-08-09';
export const OPENING_LEFT = { 2026: 12 };

/**
 * Allowance usage for one leave year.
 *
 * Counts ONLY real annual-leave bookings made on a day. Holiday blocks
 * (below) are a visual overlay and deliberately do not touch this — you
 * can shade a fortnight to see how far off it is without that being a
 * claim about your entitlement.
 *
 * A day only costs allowance if it replaced a shift you would otherwise
 * have worked. Marking an off day as leave is free, and charging for it
 * would quietly eat days you never actually booked.
 *
 * In a year with an opening position, bookings BEFORE `TRACKING_FROM`
 * are excluded: the opening figure already accounts for them, and
 * counting both would charge the same day twice. Years without one
 * count everything they contain.
 *
 * @param year  the leave year to report on; defaults to the current one
 */
export function allowanceUsed(overrides = {}, allowance = ALLOWANCE_DEFAULT, year = new Date().getFullYear(), schedule = DEFAULT_SCHEDULE) {
  const total = (allowance.base || 0) + (allowance.extra || 0);
  const openingLeft = ((allowance.openingLeft || OPENING_LEFT)[year]);
  const hasOpening = Number.isFinite(openingLeft);
  const opening = hasOpening ? Math.max(0, total - openingLeft) : 0;

  let booked = 0, freeDays = 0;
  for (const [iso, ov] of Object.entries(overrides || {})) {
    if (!ov || !CHARGEABLE.has(ov.leave)) continue;
    if (leaveYearOf(iso) !== year) continue;
    if (hasOpening && iso < TRACKING_FROM) continue;     // already in `opening`
    const [y, m, d] = iso.split('-').map(Number);
    const base = patternDay(y, m - 1, d, schedule);
    if (base.inPattern && (base.shift === 'night' || base.shift === 'day')) booked++;
    else freeDays++;
  }

  const used = opening + booked;
  return {
    year, total, used, booked, opening,
    // Clamped: over-booking is possible and the honest thing is to show
    // "0 left" plus the overspend, not a negative allowance.
    left: Math.max(0, total - used),
    over: Math.max(0, used - total),
    freeDays,
  };
}

/** 1 January next year — when the pot goes back to full. */
export function leaveResetsOn(year = new Date().getFullYear()) {
  return `${year + 1}-01-01`;
}

/** Whole days until the reset, from a given date. */
export function daysUntilReset(fromIso, year = leaveYearOf(fromIso)) {
  return isoToNum(leaveResetsOn(year)) - isoToNum(fromIso);
}

/* ══ Holiday blocks — a visual overlay ══════════════════════════════
 *
 * Stored as explicit ranges rather than as a flag on each day, because
 * a block is the thing being reasoned about: "how far away is the next
 * holiday" is a question about a range, and naming and deleting one
 * should be a single act rather than an edit to fourteen days.
 *
 * They are PURELY VISUAL. They do not book leave, do not change the
 * shift totals and do not draw down the allowance. Shading a fortnight
 * to see how far off it is should not be a claim about entitlement —
 * booking the days themselves is a separate, deliberate act.
 *
 *   S.rotation.holidayBlocks = [{ id, start, end, label }]
 */

/** Normalised so `start` is always the earlier end. */
export function normaliseBlock(b) {
  if (!b || !b.start || !b.end) return null;
  const [start, end] = b.start <= b.end ? [b.start, b.end] : [b.end, b.start];
  return { ...b, start, end };
}

export function blockDays(b) {
  const n = normaliseBlock(b);
  return n ? datesBetween(n.start, n.end).length : 0;
}

/** Every ISO date covered by any block — what the calendar shades. */
export function holidayDaySet(blocks = []) {
  const set = new Set();
  for (const b of blocks) {
    const n = normaliseBlock(b);
    if (n) datesBetween(n.start, n.end).forEach(d => set.add(d));
  }
  return set;
}

/**
 * The next block ending on or after `fromIso`, with the countdown.
 * Blocks you are inside report `active` and count zero days away.
 */
export function nextHoliday(blocks = [], fromIso) {
  const from = isoToNum(fromIso);
  const upcoming = (blocks || [])
    .map(normaliseBlock).filter(Boolean)
    .filter(b => isoToNum(b.end) >= from)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (!upcoming) return null;
  const startsIn = isoToNum(upcoming.start) - from;
  return {
    ...upcoming,
    days: blockDays(upcoming),
    startsIn: Math.max(0, startsIn),
    active: startsIn <= 0,
  };
}

/**
 * How many training sessions a week the rota actually plans.
 *
 * The body-goal projection otherwise takes a number the user typed at
 * setup, which is a guess about a rota that is already written down.
 * This is the same figure the calendar draws — for the version of the
 * pattern in force on `iso` (default today).
 */
export function plannedSessionsPerWeek(schedule = DEFAULT_SCHEDULE, iso) {
  const shape = cycleShape(schedule, iso);
  return Math.round((shape.train / shape.len) * 7 * 100) / 100;
}

/** The default window the page shows: the anchor through Sep 2027. */
export const WINDOW = {
  fromY: 2026, fromM: 6,
  toY: 2027, toM: 8,
  fromDate: new Date(Date.UTC(2026, 6, 15)),
  toDate: new Date(Date.UTC(2027, 8, 30)),
};

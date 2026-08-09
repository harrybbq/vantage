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
 */

const MS = 86400000;

/** Days since the epoch, in UTC — no local-timezone drift. */
export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m, d) / MS);

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
  { id: 'annual', label: 'Annual leave', short: 'AL', worked: false },
  { id: 'toil', label: 'TOIL / lieu', short: 'TOIL', worked: false },
  { id: 'sick', label: 'Sick', short: 'SICK', worked: false },
  { id: 'course', label: 'Course / training', short: 'CRS', worked: true },
  { id: 'other', label: 'Other', short: 'OTH', worked: false },
];
export const leaveType = id => LEAVE_TYPES.find(l => l.id === id) || null;

/** 'YYYY-MM-DD' for a y/m/d triple (m is 0-based, as everywhere else here). */
export function isoOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Which PPLUL block a position belongs to, and how far into it. */
function blockOffset(pos) {
  for (const start of BLOCK_STARTS) {
    const off = pos - start;
    if (off >= 0 && off < SEQ.length) return off;
  }
  return null;
}

/**
 * The pattern's own answer for a date, before any override.
 *
 * @returns { inPattern, pos, cycle, shift: 'night'|'day'|'off',
 *            shiftNum: 1..4|null, session: string, cardio: boolean }
 */
export function patternDay(y, m, d) {
  const diff = dayNum(y, m, d) - ANCHOR;
  if (diff < 0) return { inPattern: false, shift: 'off', session: 'Rest', cardio: false, pos: null, cycle: null, shiftNum: null };
  const pos = ((diff % CYCLE) + CYCLE) % CYCLE;
  const cycle = Math.floor(diff / CYCLE);
  const shift = pos < 4 ? 'night' : pos < 8 ? 'off' : pos < 12 ? 'day' : 'off';
  const shiftNum = pos < 4 ? pos + 1 : (pos >= 8 && pos < 12) ? pos - 7 : null;
  const off = blockOffset(pos);
  if (off == null || REST_POS.has(pos)) {
    return { inPattern: true, pos, cycle, shift, shiftNum, session: 'Rest', cardio: false };
  }
  // One block is exactly one PPLUL, so the offset IS the index.
  const session = SEQ[off];
  return { inPattern: true, pos, cycle, shift, shiftNum, session, cardio: CARDIO_SESSIONS.has(session) };
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
export function resolveDay(y, m, d, overrides = {}) {
  const base = patternDay(y, m, d);
  const iso = isoOf(y, m, d);
  const ov = overrides[iso];
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

/** Calendar grid for a month: leading blanks then resolved days. */
export function monthGrid(y, m, overrides = {}) {
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7;           // Monday-first
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(resolveDay(y, m, d, overrides));
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
export function rangeStats(from, to, overrides = {}) {
  const stats = { night: 0, day: 0, off: 0, leave: 0, sessions: 0, cardio: 0, byLeave: {} };
  const start = new Date(from.getTime());
  while (start <= to) {
    const y = start.getUTCFullYear(), m = start.getUTCMonth(), d = start.getUTCDate();
    const r = resolveDay(y, m, d, overrides);
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
 * Allowance usage.
 *
 * Counts ONLY real annual-leave bookings made on a day. Holiday blocks
 * (below) are a visual overlay and deliberately do not touch this — you
 * can shade a fortnight to see how far off it is without that being a
 * claim about your entitlement.
 *
 * A day only costs allowance if it replaced a shift you would otherwise
 * have worked. Marking an off day as leave is free, and charging for it
 * would quietly eat days you never actually booked.
 */
export function allowanceUsed(overrides = {}, allowance = ALLOWANCE_DEFAULT) {
  const total = (allowance.base || 0) + (allowance.extra || 0);
  let used = 0, freeDays = 0;
  for (const [iso, ov] of Object.entries(overrides)) {
    if (!ov || !CHARGEABLE.has(ov.leave)) continue;
    const [y, m, d] = iso.split('-').map(Number);
    const base = patternDay(y, m - 1, d);
    if (base.inPattern && (base.shift === 'night' || base.shift === 'day')) used++;
    else freeDays++;
  }
  return { total, used, left: total - used, freeDays };
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
 * This is the same figure the calendar draws.
 */
export function plannedSessionsPerWeek() {
  return Math.round((TRAIN_POS.length / CYCLE) * 7 * 100) / 100;
}

/** The default window the page shows: the anchor through Sep 2027. */
export const WINDOW = {
  fromY: 2026, fromM: 6,
  toY: 2027, toM: 8,
  fromDate: new Date(Date.UTC(2026, 6, 15)),
  toDate: new Date(Date.UTC(2027, 8, 30)),
};

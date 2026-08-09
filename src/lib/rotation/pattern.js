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
 * Training runs on all eight shift days plus the middle two days of each
 * off-block — 12 sessions per 16 days, ~5.3/week. Rest lands on the
 * first and last day of each off-block, which is where it is actually
 * wanted: coming off nights, and the day before going back in.
 *
 * The session sequence is PPLUL and rolls CONTINUOUSLY across cycles —
 * it does not reset every 16 days. 12 slots against a 5-long sequence
 * means each cycle starts two further along than the last, so no day of
 * the week is permanently the leg day.
 */

const MS = 86400000;

/** Days since the epoch, in UTC — no local-timezone drift. */
export const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m, d) / MS);

/** 15 July 2026: cycle position 0, first night shift. */
export const ANCHOR = dayNum(2026, 6, 15);

export const CYCLE = 16;

/** Positions within a cycle that carry a training session. */
export const TRAIN_POS = [0, 1, 2, 3, 5, 6, 8, 9, 10, 11, 13, 14];
/** The four rest days: both edges of both off-blocks. */
export const REST_POS = new Set([4, 7, 12, 15]);

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

/** Training slots elapsed before position p, within one cycle. */
const slotsBefore = p => TRAIN_POS.filter(x => x < p).length;

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
  if (REST_POS.has(pos)) return { inPattern: true, pos, cycle, shift, shiftNum, session: 'Rest', cardio: false };
  // Continuous across cycles: count every slot since the anchor, not
  // just the ones in this cycle.
  const idx = (cycle * TRAIN_POS.length + slotsBefore(pos)) % SEQ.length;
  const session = SEQ[idx];
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

/** The default window the page shows: the anchor through Sep 2027. */
export const WINDOW = {
  fromY: 2026, fromM: 6,
  toY: 2027, toM: 8,
  fromDate: new Date(Date.UTC(2026, 6, 15)),
  toDate: new Date(Date.UTC(2027, 8, 30)),
};

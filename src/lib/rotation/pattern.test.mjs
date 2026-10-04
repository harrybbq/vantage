/**
 * The shift pattern as a versioned value (S.rotation.schedule).
 *
 * The load-bearing promise: with no stored schedule, every date comes
 * out EXACTLY as the hard-coded rota drew it. That is checked against a
 * verbatim copy of the old algorithm for every day from 1 Jul 2026 to
 * 31 Dec 2027 — patternDay, resolveDay (with leave and swaps), the day
 * index, the month grids, the range totals and the allowance.
 *
 * Invented data only — this file is public. Run: npm run check:rotation
 */
import assert from 'node:assert/strict';
import {
  ANCHOR, CYCLE, TRAIN_POS, REST_POS, BLOCK_STARTS, SEQ, CARDIO_SESSIONS, ROTA_DAY_ONE_POS,
  DEFAULT_SCHEDULE, DEFAULT_CYCLE, SCHEDULE_LIMITS,
  dayNum, isoOf, patternDay, resolveDay, monthGrid, rangeStats, allowanceUsed, rotaDayIndex,
  plannedSessionsPerWeek, scheduleOf, normaliseSchedule, cleanCycle, cycleShape, cycleSummary,
  setScheduleFrom, removeScheduleVersion, versionOn, isRealIso, chipText,
  shiftOn, shiftChipsInMonth, shiftDayLabel, showsOnCalendar, setShowOnCalendar, ALLOWANCE_DEFAULT,
} from './pattern.js';
import { planDays, nextShiftBlock } from '../diet/planner.js';
import { studyDays } from '../career/pacing.js';
import { blendedDailyKcal } from '../diet/plan.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};

/* ── The old algorithm, copied verbatim from pattern.js before Oct 2026 ── */
const OLD = (() => {
  const blockOffset = pos => {
    for (const start of BLOCK_STARTS) {
      const off = pos - start;
      if (off >= 0 && off < SEQ.length) return off;
    }
    return null;
  };
  function patternDay(y, m, d) {
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
    const session = SEQ[off];
    return { inPattern: true, pos, cycle, shift, shiftNum, session, cardio: CARDIO_SESSIONS.has(session) };
  }
  function resolveDay(y, m, d, overrides = {}) {
    const base = patternDay(y, m, d);
    const iso = isoOf(y, m, d);
    const ov = overrides[iso];
    if (!ov) return { ...base, iso, edited: false, leave: null };
    const out = { ...base, iso, edited: true, leave: ov.leave || null, note: ov.note || '' };
    if (ov.session) {
      out.session = ov.session;
      out.cardio = CARDIO_SESSIONS.has(ov.session) || ov.session === 'Cardio';
    }
    if (ov.leave) {
      out.baseShift = base.shift;
      out.baseShiftNum = base.shiftNum;
      out.shift = 'leave';
      out.shiftNum = null;
    }
    return out;
  }
  const rotaDayIndex = pos => (pos == null ? null : ((pos - ROTA_DAY_ONE_POS + CYCLE) % CYCLE) + 1);
  return { patternDay, resolveDay, rotaDayIndex };
})();

/* ── Invented edits: leave of every kind, swapped sessions, notes ── */
const OVERRIDES = {
  '2026-07-20': { session: 'Arms' },
  '2026-08-03': { leave: 'annual' },
  '2026-08-04': { leave: 'annual', note: 'invented trip' },
  '2026-08-12': { leave: 'sick' },
  '2026-09-01': { leave: 'toil', session: 'Cardio' },
  '2026-10-07': { leave: 'course' },
  '2026-10-10': { leave: 'annual' },             // an off day booked as leave
  '2026-12-24': { leave: 'annual' },
  '2026-12-25': { leave: 'annual' },
  '2027-02-14': { session: 'Core', note: 'swap' },
  '2027-03-03': { leave: 'other' },
  '2027-06-30': { leave: 'annual' },
};

const everyDay = (fromIso, toIso, fn) => {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const end = dayNum(ty, tm - 1, td);
  for (let k = dayNum(fy, fm - 1, fd); k <= end; k++) {
    const dt = new Date(k * 86400000);
    fn(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  }
};

// ── 1. The default reproduces the hard-coded rota, every day ──
t('constants still describe the default cycle', () => {
  const shape = cycleShape(DEFAULT_SCHEDULE, '2026-10-01');
  assert.equal(shape.len, CYCLE);
  assert.deepEqual(shape.trainPos, TRAIN_POS);
  assert.deepEqual(shape.cells.filter(c => c.session === 'Rest').map(c => c.pos), [...REST_POS]);
  assert.equal(DEFAULT_SCHEDULE.versions[0].from, isoOf(2026, 6, 15));
  assert.equal(dayNum(2026, 6, 15), ANCHOR);
  assert.equal(cycleSummary(DEFAULT_CYCLE), '4 nights · 4 off · 4 days · 4 off');
});

t('default patternDay = old patternDay for every day Jul 2026 – Dec 2027', () => {
  const stored = scheduleOf({ rotation: { schedule: { versions: [{ id: 'x', from: '2026-07-15', cycle: [
    { shift: 'night', days: 4 }, { shift: 'off', days: 4 }, { shift: 'day', days: 4 }, { shift: 'off', days: 4 }] }] } } });
  let days = 0;
  everyDay('2026-07-01', '2027-12-31', (y, m, d) => {
    const old = OLD.patternDay(y, m, d);
    assert.deepEqual(patternDay(y, m, d), old, `${y}-${m + 1}-${d} (implicit default)`);
    assert.deepEqual(patternDay(y, m, d, DEFAULT_SCHEDULE), old);
    assert.deepEqual(patternDay(y, m, d, scheduleOf({})), old);
    assert.deepEqual(patternDay(y, m, d, scheduleOf({ rotation: { overrides: {} } })), old);
    assert.deepEqual(patternDay(y, m, d, stored), old, 'a stored copy of the default draws the same');
    days++;
  });
  assert.equal(days, 549);
});

t('default resolveDay (leave, swaps, notes) = old for every day', () => {
  everyDay('2026-07-01', '2027-12-31', (y, m, d, iso) => {
    const old = OLD.resolveDay(y, m, d, OVERRIDES);
    assert.deepEqual(resolveDay(y, m, d, OVERRIDES), old, iso);
    assert.deepEqual(resolveDay(y, m, d, OVERRIDES, scheduleOf({ rotation: { overrides: OVERRIDES } })), old, iso);
    assert.equal(chipText(resolveDay(y, m, d, OVERRIDES)), chipText(old));
  });
});

t('default rotaDayIndex = old for every position and date', () => {
  for (let pos = 0; pos < 16; pos++) assert.equal(rotaDayIndex(pos), OLD.rotaDayIndex(pos));
  assert.equal(rotaDayIndex(null), null);
  everyDay('2026-07-15', '2027-12-31', (y, m, d, iso) => {
    const p = patternDay(y, m, d).pos;
    assert.equal(rotaDayIndex(p, DEFAULT_SCHEDULE, iso), OLD.rotaDayIndex(p));
  });
  assert.equal(rotaDayIndex(8), 1);
  assert.equal(rotaDayIndex(0), 9);
});

t('default monthGrid = old grid for every month', () => {
  for (let y = 2026; y <= 2027; y++) {
    for (let m = y === 2026 ? 6 : 0; m < 12; m++) {
      const grid = monthGrid(y, m, OVERRIDES);
      const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      assert.equal(grid.length, lead + dim);
      for (let d = 1; d <= dim; d++) assert.deepEqual(grid[lead + d - 1], OLD.resolveDay(y, m, d, OVERRIDES));
    }
  }
});

t('default rangeStats, allowance and sessions/week match the old figures', () => {
  const from = new Date(Date.UTC(2026, 6, 15)), to = new Date(Date.UTC(2027, 8, 30));
  const stats = { night: 0, day: 0, off: 0, leave: 0, sessions: 0, cardio: 0, byLeave: {} };
  everyDay('2026-07-15', '2027-09-30', (y, m, d) => {
    const r = OLD.resolveDay(y, m, d, OVERRIDES);
    if (r.shift === 'leave') { stats.leave++; stats.byLeave[r.leave] = (stats.byLeave[r.leave] || 0) + 1; } else stats[r.shift]++;
    if (r.session !== 'Rest') { stats.sessions++; if (r.cardio) stats.cardio++; }
  });
  assert.deepEqual(rangeStats(from, to, OVERRIDES), stats);
  assert.deepEqual(rangeStats(from, to, OVERRIDES, DEFAULT_SCHEDULE), stats);
  for (const year of [2026, 2027]) {
    let booked = 0, freeDays = 0;
    for (const [iso, ov] of Object.entries(OVERRIDES)) {
      if (ov.leave !== 'annual' || Number(iso.slice(0, 4)) !== year) continue;
      if (year === 2026 && iso < '2026-08-09') continue;
      const [y, m, d] = iso.split('-').map(Number);
      const b = OLD.patternDay(y, m - 1, d);
      if (b.inPattern && (b.shift === 'night' || b.shift === 'day')) booked++; else freeDays++;
    }
    const a = allowanceUsed(OVERRIDES, ALLOWANCE_DEFAULT, year);
    assert.equal(a.booked, booked, `booked ${year}`);
    assert.equal(a.freeDays, freeDays, `free ${year}`);
    assert.deepEqual(allowanceUsed(OVERRIDES, ALLOWANCE_DEFAULT, year, DEFAULT_SCHEDULE), a);
  }
  assert.equal(plannedSessionsPerWeek(), Math.round((TRAIN_POS.length / CYCLE) * 7 * 100) / 100);
  assert.equal(plannedSessionsPerWeek(DEFAULT_SCHEDULE, '2027-03-01'), 4.38);
  assert.equal(blendedDailyKcal({}), 2475, 'the documented (2550×10 + 2350×6) / 16');
});

t('before the anchor is outside the pattern, as before', () => {
  const r = patternDay(2026, 6, 14);
  assert.equal(r.inPattern, false);
  assert.deepEqual(r, OLD.patternDay(2026, 6, 14));
});

// ── 2. A version from a future date ──
const NEW_CYCLE = [{ shift: 'night', days: 3 }, { shift: 'off', days: 3 }, { shift: 'day', days: 3 }, { shift: 'off', days: 3 }];
const base = { rotation: { overrides: OVERRIDES, holidayBlocks: [{ id: 'h1', start: '2027-04-01', end: '2027-04-07', label: '' }], allowance: { base: 25, extra: 10 } },
  calendarEvents: [{ id: 'e1', title: 'Invented', date: '2027-01-10' }], coins: 7 };
const withNew = setScheduleFrom(base, '2027-01-05', NEW_CYCLE, 'invented new team', { id: 'v2' });
const SCHED2 = scheduleOf(withNew);

t('a version changes only dates on or after its start', () => {
  assert.equal(SCHED2.versions.length, 2);
  assert.deepEqual(SCHED2.versions.map(v => v.from), ['2026-07-15', '2027-01-05']);
  everyDay('2026-07-01', '2027-01-04', (y, m, d, iso) => {
    assert.deepEqual(patternDay(y, m, d, SCHED2), OLD.patternDay(y, m, d), iso);
  });
  // 5 Jan 2027 is position 0 of the new cycle.
  const d0 = patternDay(2027, 0, 5, SCHED2);
  assert.deepEqual([d0.pos, d0.cycle, d0.shift, d0.shiftNum, d0.session], [0, 0, 'night', 1, 'Push']);
  const want = [
    ['night', 1, 'Push'], ['night', 2, 'Pull'], ['night', 3, 'Legs'], ['off', null, 'Upper'], ['off', null, 'Lower'], ['off', null, 'Rest'],
    ['day', 1, 'Push'], ['day', 2, 'Pull'], ['day', 3, 'Legs'], ['off', null, 'Upper'], ['off', null, 'Lower'], ['off', null, 'Rest'],
  ];
  for (let i = 0; i < 24; i++) {
    const dt = new Date(Date.UTC(2027, 0, 5 + i));
    const r = patternDay(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), SCHED2);
    assert.deepEqual([r.shift, r.shiftNum, r.session], want[i % 12], `day ${i}`);
    assert.equal(r.pos, i % 12);
    assert.equal(r.cycle, Math.floor(i / 12));
  }
  let changed = 0;
  everyDay('2027-01-05', '2027-12-31', (y, m, d) => {
    const a = patternDay(y, m, d, SCHED2), b = OLD.patternDay(y, m, d);
    if (a.shift !== b.shift || a.session !== b.session) changed++;
  });
  assert.ok(changed > 100, 'the new pattern really is different after its start');
  assert.equal(versionOn(SCHED2, '2027-01-04').id, 'default');
  assert.equal(versionOn(SCHED2, '2027-01-05').id, 'v2');
  assert.equal(versionOn(SCHED2, '2026-01-01'), null);
});

t('overrides and leave still apply on top of a changed pattern', () => {
  const ov = { '2027-01-06': { leave: 'annual' }, '2027-01-11': { session: 'Arms' } };
  const r = resolveDay(2027, 0, 6, ov, SCHED2);
  assert.equal(r.shift, 'leave');
  assert.equal(r.baseShift, 'night');
  assert.equal(r.baseShiftNum, 2);
  assert.equal(chipText(r), 'AL');
  const s = resolveDay(2027, 0, 11, ov, SCHED2);
  assert.equal(s.shift, 'day');
  assert.equal(s.shiftNum, 1);
  assert.equal(s.session, 'Arms');
  assert.equal(s.edited, true);
});

t('allowanceUsed respects the schedule', () => {
  // 9–10 Jan 2027 are N2/N3 on the old rota and off days on the new cycle;
  // 11 Jan is off on the old rota and D1 on the new one.
  assert.deepEqual([9, 10, 11].map(d => OLD.patternDay(2027, 0, d).shift), ['night', 'night', 'off']);
  assert.deepEqual([9, 10, 11].map(d => patternDay(2027, 0, d, SCHED2).shift), ['off', 'off', 'day']);
  const ov = { '2027-01-09': { leave: 'annual' }, '2027-01-10': { leave: 'annual' }, '2027-01-11': { leave: 'annual' } };
  const oldWay = allowanceUsed(ov, ALLOWANCE_DEFAULT, 2027);
  const newWay = allowanceUsed(ov, ALLOWANCE_DEFAULT, 2027, SCHED2);
  assert.deepEqual([oldWay.booked, oldWay.freeDays], [2, 1]);
  assert.deepEqual([newWay.booked, newWay.freeDays], [1, 2], 'an off day under the new pattern costs nothing');
  assert.equal(newWay.left, oldWay.left + 1);
});

t('rangeStats, rotaDayIndex and sessions/week follow the schedule', () => {
  const st = rangeStats(new Date(Date.UTC(2027, 0, 5)), new Date(Date.UTC(2027, 0, 16)), {}, SCHED2);
  assert.deepEqual([st.night, st.day, st.off, st.sessions], [3, 3, 6, 10]);
  // Day 1 = first day-shift position (6) of the version in force.
  assert.equal(rotaDayIndex(6, SCHED2, '2027-01-11'), 1);
  assert.equal(rotaDayIndex(0, SCHED2, '2027-01-05'), 7);
  assert.equal(rotaDayIndex(8, SCHED2, '2026-10-01'), 1, 'the old version still numbers from its own day 1');
  const allNights = scheduleOf(setScheduleFrom({}, '2027-01-01', [{ shift: 'night', days: 2 }, { shift: 'off', days: 2 }]));
  assert.equal(rotaDayIndex(0, allNights, '2027-01-01'), 1, 'no day shifts → position 0 is day 1');
  assert.equal(plannedSessionsPerWeek(SCHED2, '2027-02-01'), Math.round((10 / 12) * 7 * 100) / 100);
  assert.equal(plannedSessionsPerWeek(SCHED2, '2026-10-01'), 4.38);
});

t('planner and study pacing read the schedule they are given', () => {
  const pd = planDays('2027-01-05', 12, {}, SCHED2);
  assert.deepEqual(pd.map(d => d.shift), ['night', 'night', 'night', 'off', 'off', 'off', 'day', 'day', 'day', 'off', 'off', 'off']);
  assert.deepEqual(pd.map(d => d.train), [true, true, true, true, true, false, true, true, true, true, true, false]);
  // The default planner train flag = the old TRAIN_POS rule, every day.
  const def = planDays('2026-07-15', 64, OVERRIDES);
  def.forEach(d => assert.equal(d.train, TRAIN_POS.includes(OLD.patternDay(...(([y, m, dd]) => [y, m - 1, dd])(d.iso.split('-').map(Number))).pos), d.iso));
  assert.deepEqual(nextShiftBlock('2027-01-08', {}, SCHED2), { start: '2027-01-11', days: 3 });
  assert.deepEqual(nextShiftBlock('2026-07-19'), { start: '2026-07-23', days: 4 });
  const sd = studyDays('2027-01-05', 7, { schedule: SCHED2 });
  assert.deepEqual(sd.map(d => d.shift), ['night', 'night', 'night', 'off', 'off', 'off', 'day']);
});

// ── 3. Training derivation for other shapes ──
t('a PPLUL block is cut short at the next shift block', () => {
  const s = scheduleOf(setScheduleFrom({}, '2027-01-01', [{ shift: 'night', days: 2 }, { shift: 'off', days: 1 }, { shift: 'day', days: 2 }, { shift: 'off', days: 1 }]));
  const sh = cycleShape(s, '2027-01-01');
  assert.deepEqual(sh.cells.map(c => c.session), ['Push', 'Pull', 'Legs', 'Push', 'Pull', 'Legs']);
});

t('the last block wraps into the next cycle; adjacent same-shift blocks number on', () => {
  const wrap = cycleShape(scheduleOf(setScheduleFrom({}, '2027-01-01', [{ shift: 'off', days: 3 }, { shift: 'night', days: 2 }, { shift: 'off', days: 1 }])), '2027-01-01');
  assert.deepEqual(wrap.cells.map(c => c.session), ['Upper', 'Lower', 'Rest', 'Push', 'Pull', 'Legs']);
  const merged = cycleShape(scheduleOf(setScheduleFrom({}, '2027-01-01', [{ shift: 'night', days: 3 }, { shift: 'night', days: 3 }, { shift: 'off', days: 2 }])), '2027-01-01');
  assert.deepEqual(merged.cells.map(c => c.shiftNum), [1, 2, 3, 4, 5, 6, null, null]);
  assert.deepEqual(merged.cells.map(c => c.session), ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Rest', 'Rest', 'Rest']);
  const allOff = cycleShape(scheduleOf(setScheduleFrom({}, '2027-01-01', [{ shift: 'off', days: 7 }])), '2027-01-01');
  assert.equal(allOff.train, 0);
});

// ── 4. Validation and malformed values ──
t('cycle validation bounds', () => {
  const blk = (k, days = 1) => Array.from({ length: k }, (_, i) => ({ shift: SHIFT(i), days }));
  const SHIFT = i => ['night', 'off', 'day'][i % 3];
  assert.ok(cleanCycle(blk(20)));
  assert.equal(cleanCycle(blk(21)), null);
  assert.equal(cleanCycle([]), null);
  assert.ok(cleanCycle([{ shift: 'night', days: 28 }]));
  assert.equal(cleanCycle([{ shift: 'night', days: 29 }]), null);
  assert.equal(cleanCycle([{ shift: 'night', days: 0 }]), null);
  assert.equal(cleanCycle([{ shift: 'night', days: 2.5 }]), null);
  assert.equal(cleanCycle([{ shift: 'night', days: '4' }]), null);
  assert.equal(cleanCycle([{ shift: 'evening', days: 4 }]), null);
  assert.ok(cleanCycle([{ shift: 'night', days: 28 }, { shift: 'off', days: 28 }, { shift: 'day', days: 4 }]), '60 total is allowed');
  assert.equal(cleanCycle([{ shift: 'night', days: 28 }, { shift: 'off', days: 28 }, { shift: 'day', days: 5 }]), null, '61 is not');
  assert.equal(SCHEDULE_LIMITS.maxTotal, 60);
  assert.deepEqual(cleanCycle([{ shift: 'day', days: 2, junk: 1 }]), [{ shift: 'day', days: 2 }], 'extra keys stripped');
  assert.ok(isRealIso('2028-02-29'));
  assert.ok(!isRealIso('2027-02-29'));
  assert.ok(!isRealIso('2027-13-01'));
  assert.ok(!isRealIso(20270101));
});

t('a malformed schedule falls back to the default and never throws', () => {
  const junk = [null, undefined, 'x', 42, true, [], {}, { versions: 'x' }, { versions: {} }, { versions: [] },
    { versions: [null, 7, 'a', { from: '2026-02-30', cycle: DEFAULT_CYCLE }, { from: '2027-01-01', cycle: [{ shift: 'evening', days: 2 }] },
      { from: '2027-01-01', cycle: [] }, { from: '2027-01-01', cycle: 'nnoo' }, { from: '2027-01-01', cycle: [{ shift: 'night', days: 61 }] }] }];
  for (const raw of junk) {
    const S = { rotation: { schedule: raw } };
    assert.equal(scheduleOf(S), DEFAULT_SCHEDULE, JSON.stringify(raw));
    assert.deepEqual(patternDay(2026, 9, 4, scheduleOf(S)), OLD.patternDay(2026, 9, 4));
    assert.deepEqual(patternDay(2026, 9, 4, raw), OLD.patternDay(2026, 9, 4), 'raw values are normalised too');
    assert.doesNotThrow(() => shiftChipsInMonth(S, 2026, 9));
  }
  for (const S of [null, undefined, {}, { rotation: null }, { rotation: 'x' }]) assert.equal(scheduleOf(S), DEFAULT_SCHEDULE);
  const hostile = { rotation: {} };
  Object.defineProperty(hostile.rotation, 'schedule', { get() { throw new Error('boom'); } });
  assert.equal(scheduleOf(hostile), DEFAULT_SCHEDULE);
  // One good version among junk: only the good one is used.
  const mixed = scheduleOf({ rotation: { schedule: { versions: [{ from: 'nope', cycle: NEW_CYCLE }, { id: 'ok', from: '2027-01-05', cycle: NEW_CYCLE }] } } });
  assert.deepEqual(mixed.versions.map(v => v.id), ['ok']);
  assert.equal(patternDay(2026, 9, 4, mixed).inPattern, false, 'before the only version: outside the pattern');
});

t('normalising: date order, last write wins per date, stable identity', () => {
  const raw = { versions: [
    { id: 'b', from: '2027-05-01', cycle: NEW_CYCLE },
    { id: 'a', from: '2026-07-15', cycle: DEFAULT_CYCLE },
    { id: 'b2', from: '2027-05-01', cycle: [{ shift: 'day', days: 5 }, { shift: 'off', days: 2 }] },
    { from: '2027-09-01', cycle: NEW_CYCLE },
  ] };
  const s = normaliseSchedule(raw);
  assert.deepEqual(s.versions.map(v => v.id), ['a', 'b2', 'v2027-09-01']);
  assert.equal(normaliseSchedule(raw), s, 'cached on the object');
  assert.equal(scheduleOf({ rotation: { schedule: raw } }), s);
});

// ── 5. Updaters are additive ──
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

t('setScheduleFrom touches rotation.schedule only, never mutates prev', () => {
  const prev = deepFreeze(JSON.parse(JSON.stringify(base)));
  const next = setScheduleFrom(prev, '2027-01-05', NEW_CYCLE, 'n');
  assert.equal(next.rotation.overrides, prev.rotation.overrides);
  assert.equal(next.rotation.holidayBlocks, prev.rotation.holidayBlocks);
  assert.equal(next.rotation.allowance, prev.rotation.allowance);
  assert.equal(next.calendarEvents, prev.calendarEvents);
  assert.equal(next.coins, 7);
  assert.equal(prev.rotation.schedule, undefined);
  assert.deepEqual(next.rotation.schedule.versions[0], { id: 'default', from: '2026-07-15', cycle: DEFAULT_CYCLE.map(b => ({ ...b })) },
    'the first write seeds the default so the past keeps it');
  assert.equal(next.rotation.schedule.versions[1].note, 'n');
  assert.match(next.rotation.schedule.versions[1].id, /^sv_/);
});

t('same start date replaces; invalid input is a no-op', () => {
  const again = setScheduleFrom(withNew, '2027-01-05', [{ shift: 'day', days: 4 }, { shift: 'off', days: 4 }], '', { id: 'v3' });
  assert.deepEqual(scheduleOf(again).versions.map(v => v.id), ['default', 'v3']);
  assert.equal(setScheduleFrom(withNew, '2027-02-30', NEW_CYCLE), withNew);
  assert.equal(setScheduleFrom(withNew, '2027-03-01', [{ shift: 'night', days: 40 }]), withNew);
  assert.equal(setScheduleFrom(withNew, '2027-03-01', []), withNew);
  const replacedDefault = setScheduleFrom({}, '2026-07-15', NEW_CYCLE, '', { id: 'base2' });
  assert.deepEqual(scheduleOf(replacedDefault).versions.map(v => v.id), ['base2']);
});

t('removeScheduleVersion never removes the last one', () => {
  const prev = deepFreeze(JSON.parse(JSON.stringify(withNew)));
  const one = removeScheduleVersion(prev, 'v2');
  assert.deepEqual(scheduleOf(one).versions.map(v => v.id), ['default']);
  assert.equal(one.rotation.overrides, prev.rotation.overrides);
  assert.equal(one.calendarEvents, prev.calendarEvents);
  assert.equal(removeScheduleVersion(one, 'default'), one, 'the last version stays');
  assert.equal(removeScheduleVersion(prev, 'nope'), prev);
  assert.equal(removeScheduleVersion(base, 'default'), base, 'nothing stored → nothing to remove');
  assert.equal(removeScheduleVersion({}, 'x').rotation, undefined);
});

t('unreadable stored versions are carried through a write, not dropped', () => {
  const odd = { from: '2027-03-01', cycle: [{ shift: 'evening', days: 4 }], future: true };
  const prev = { rotation: { schedule: { versions: [{ id: 'default', from: '2026-07-15', cycle: DEFAULT_CYCLE }, odd], extra: 'kept' } } };
  const next = setScheduleFrom(prev, '2027-06-01', NEW_CYCLE, '', { id: 'v9' });
  assert.ok(next.rotation.schedule.versions.includes(odd));
  assert.equal(next.rotation.schedule.extra, 'kept');
  assert.deepEqual(scheduleOf(next).versions.map(v => v.id), ['default', 'v9']);
  const removed = removeScheduleVersion(next, 'v9');
  assert.ok(removed.rotation.schedule.versions.includes(odd));
});

t('calendar switch: default on, additive write', () => {
  assert.equal(showsOnCalendar({}), true);
  assert.equal(showsOnCalendar({ rotation: { overrides: {} } }), true);
  const off = setShowOnCalendar(deepFreeze(JSON.parse(JSON.stringify(withNew))), false);
  assert.equal(showsOnCalendar(off), false);
  assert.deepEqual(off.rotation.schedule, withNew.rotation.schedule);
  assert.deepEqual(off.rotation.overrides, withNew.rotation.overrides);
  assert.equal(showsOnCalendar(setShowOnCalendar(off, true)), true);
});

// ── 6. The Track calendar overlay ──
t('shift chips for a month: working days and leave only', () => {
  const S = { rotation: { overrides: { '2026-10-07': { leave: 'annual' }, '2026-10-12': { leave: 'toil' } } } };
  const chips = shiftChipsInMonth(S, 2026, 9);
  everyDay('2026-10-01', '2026-10-31', (y, m, d, iso) => {
    const old = OLD.resolveDay(y, m, d, S.rotation.overrides);
    const want = old.shift === 'off' ? undefined : chipText(old);
    assert.equal(chips[iso] && chips[iso].chip, want, iso);
  });
  assert.equal(chips['2026-10-07'].chip, 'AL');
  assert.equal(chips['2026-10-07'].shift, 'leave');
  assert.equal(chips['2026-10-12'].chip, 'TOIL');
  assert.equal(chips['2026-10-12'].tiny, 'TL', 'phone cells get the two-letter form');
  assert.ok(Object.values(chips).every(c => c.tiny.length <= 2));
  assert.deepEqual(shiftChipsInMonth({}, 2026, 5), {}, 'before the pattern: nothing');
  const after = shiftChipsInMonth(withNew, 2027, 0);
  assert.equal(after['2027-01-05'].chip, 'N1');
  assert.equal(after['2027-01-07'].chip, 'N3');
  assert.equal(after['2027-01-08'], undefined);
});

t('day labels for the menu', () => {
  assert.equal(shiftOn({}, '2026-07-16').label, 'Night 2 · Pull');
  assert.equal(shiftOn({}, '2026-07-27').label, 'Off · Lower');
  assert.equal(shiftOn({}, '2026-07-23').label, 'Day 1 · Push');
  assert.equal(shiftOn({ rotation: { overrides: { '2026-07-16': { leave: 'annual' } } } }, '2026-07-16').label, 'Annual leave · Pull');
  assert.equal(shiftOn({}, '2026-07-01'), null);
  assert.equal(shiftOn({}, 'garbage'), null);
  assert.equal(shiftDayLabel(null), '');
});

console.log(`rotation pattern: ${n} tests passed`);

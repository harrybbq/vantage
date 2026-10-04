// node src/lib/calendar/spans.test.mjs
import assert from 'node:assert/strict';
import {
  makeSpan, cleanSpanPatch, normaliseRange, isRealDate, spansOf, spanEventsOn, spanEventsInMonth,
  addSpan, updateSpan, removeSpan, isContiguous, barLayout, rangeLabel, MAX_SPAN_DAYS, spanLength,
} from './spans.js';
import {
  eventsOn, eventsInMonth, addEvent, removeEvent, updateEvent, eventCount, makeEvent, todayAgenda,
} from './events.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error('FAIL:', name); throw e; }
};

const sp = (id, start, end, extra = {}) => ({
  id, title: id.toUpperCase(), start, end, colour: '#3aa79b', location: '', note: '', kind: 'other', createdAt: 1, ...extra,
});

// ── Normalisation ────────────────────────────────────────────────────
t('real dates only', () => {
  assert.ok(isRealDate('2026-10-05'));
  assert.ok(isRealDate('2028-02-29'));
  assert.ok(!isRealDate('2026-02-29'));
  assert.ok(!isRealDate('2026-02-30'));
  assert.ok(!isRealDate('2026-13-01'));
  assert.ok(!isRealDate('2026-1-5'));
  assert.ok(!isRealDate(null) && !isRealDate(20261005) && !isRealDate(''));
});

t('makeSpan normalises a good span', () => {
  const s = makeSpan({ title: '  Lisbon  ', start: '2026-10-05', end: '2026-10-09', colour: '#3aa79b', location: ' Alfama ' });
  assert.match(s.id, /^sp_/);
  assert.equal(s.title, 'Lisbon');
  assert.equal(s.location, 'Alfama');
  assert.equal(s.start, '2026-10-05');
  assert.equal(s.end, '2026-10-09');
  assert.equal(s.kind, 'other');
  assert.equal(typeof s.createdAt, 'number');
});

t('reversed dates are swapped, not dropped', () => {
  const s = makeSpan({ title: 'x', start: '2026-10-09', end: '2026-10-05' });
  assert.equal(s.start, '2026-10-05');
  assert.equal(s.end, '2026-10-09');
});

t('longer than 366 days is pulled in to 366', () => {
  const s = makeSpan({ title: 'x', start: '2026-01-01', end: '2031-01-01' });
  assert.equal(spanLength(s.start, s.end), MAX_SPAN_DAYS);
  assert.equal(s.end, '2027-01-01');            // 2026 is 365 days, so day 366 is 1 Jan 2027
  const ok = makeSpan({ title: 'x', start: '2026-01-01', end: '2027-01-01' });
  assert.equal(ok.end, '2027-01-01');
});

t('bad dates: no start → null, bad end → one day', () => {
  assert.equal(makeSpan({ title: 'x', start: '2026-02-30', end: '2026-03-02' }), null);
  assert.equal(makeSpan({ title: 'x' }), null);
  assert.equal(makeSpan(), null);
  const one = makeSpan({ title: 'x', start: '2026-03-02', end: 'soon' });
  assert.equal(one.end, '2026-03-02');
  assert.equal(normaliseRange('junk', '2026-01-01'), null);
});

t('junk fields are cleaned', () => {
  const s = makeSpan({ title: 'y'.repeat(400), start: '2026-03-02', end: '2026-03-03', colour: 'red', kind: 'party', note: 'n'.repeat(900), location: 42 });
  assert.equal(s.title.length, 120);
  assert.equal(s.colour, '');
  assert.equal(s.kind, 'other');
  assert.equal(s.note.length, 500);
  assert.equal(s.location, '42');
  assert.equal(makeSpan({ title: 'h', start: '2026-03-02', kind: 'holiday' }).kind, 'holiday');
});

t('cleanSpanPatch keeps only touched keys and drops unreal dates', () => {
  assert.deepEqual(cleanSpanPatch({ title: ' A ' }), { title: 'A' });
  assert.deepEqual(cleanSpanPatch({ start: '2026-02-30', end: '2026-03-01' }), { end: '2026-03-01' });
  assert.deepEqual(cleanSpanPatch({ colour: 'nope' }), { colour: '' });
  assert.deepEqual(cleanSpanPatch(null), {});
});

t('spansOf skips junk on read without touching it', () => {
  const S = { calendarSpans: [null, 7, 'x', { id: 'a' }, { start: '2026-01-01' }, sp('ok', '2026-01-02', '2026-01-01')] };
  const list = spansOf(S);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, '2026-01-01');     // read-normalised
  assert.equal(S.calendarSpans[5].start, '2026-01-02');  // store untouched
  assert.deepEqual(spansOf({ calendarSpans: { a: 1 } }), []);
  assert.deepEqual(spansOf(null), []);
});

// ── Per-day events ───────────────────────────────────────────────────
t('spanEventsOn gives the calendar event shape', () => {
  const S = { calendarSpans: [sp('lis', '2026-10-05', '2026-10-09')] };
  const [ev] = spanEventsOn(S, '2026-10-06');
  assert.equal(ev.id, 'sp:lis:2026-10-06');
  assert.equal(ev.derived, false);
  assert.equal(ev.source, 'span');
  assert.equal(ev.spanId, 'lis');
  assert.equal(ev.dayIndex, 2);
  assert.equal(ev.dayCount, 5);
  assert.equal(ev.span, 'Day 2 of 5');
  assert.equal(ev.isStart, false);
  assert.equal(ev.isEnd, false);
  assert.equal(ev.time, '');
  assert.equal(ev.end, '');                       // end TIME stays empty
  assert.equal(ev.spanEnd, '2026-10-09');
  assert.ok(spanEventsOn(S, '2026-10-05')[0].isStart);
  assert.ok(spanEventsOn(S, '2026-10-09')[0].isEnd);
  assert.deepEqual(spanEventsOn(S, '2026-10-10'), []);
  assert.deepEqual(spanEventsOn(S, 'bad'), []);
});

t('month slicing across a month boundary', () => {
  const S = { calendarSpans: [sp('x', '2026-09-28', '2026-10-03')] };
  const sep = spanEventsInMonth(S, 2026, 8);
  const oct = spanEventsInMonth(S, 2026, 9);
  assert.deepEqual(Object.keys(sep).sort(), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(Object.keys(oct).sort(), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(oct['2026-10-01'][0].dayIndex, 4);
  assert.equal(oct['2026-10-03'][0].span, 'Day 6 of 6');
  assert.deepEqual(spanEventsInMonth(S, 2026, 10), {});
});

t('month slicing across a year boundary', () => {
  const S = { calendarSpans: [sp('ny', '2026-12-29', '2027-01-02')] };
  assert.equal(Object.keys(spanEventsInMonth(S, 2026, 11)).length, 3);
  const jan = spanEventsInMonth(S, 2027, 0);
  assert.deepEqual(Object.keys(jan).sort(), ['2027-01-01', '2027-01-02']);
  assert.equal(jan['2027-01-02'][0].dayIndex, 5);
});

t('a long span covering a whole month fills every day', () => {
  const S = { calendarSpans: [sp('long', '2026-01-15', '2026-03-20')] };
  assert.equal(Object.keys(spanEventsInMonth(S, 2026, 1)).length, 28);
});

t('overlapping spans stack earliest first, longer first', () => {
  const S = { calendarSpans: [sp('b', '2026-10-06', '2026-10-07'), sp('a', '2026-10-05', '2026-10-09'), sp('c', '2026-10-06', '2026-10-20')] };
  assert.deepEqual(spanEventsOn(S, '2026-10-07').map(e => e.spanId), ['a', 'c', 'b']);
});

// ── Merge into events.js ─────────────────────────────────────────────
const merged = () => ({
  holidays: [{ id: 't1', dest: 'Porto', from: '2026-10-06', to: '2026-10-08', status: 'booked' }],
  calendarSpans: [sp('lis', '2026-10-05', '2026-10-09')],
  calendarEvents: {
    '2026-10-06': [
      { id: 'ev_2', title: 'Untimed', time: '', createdAt: 2 },
      { id: 'ev_1', title: 'Dinner', time: '19:00', createdAt: 1 },
    ],
  },
});

t('eventsOn: trips, then spans, then the day sorted', () => {
  const list = eventsOn(merged(), '2026-10-06');
  assert.deepEqual(list.map(e => e.id), ['hol:t1:2026-10-06', 'sp:lis:2026-10-06', 'ev_1', 'ev_2']);
});

t('eventsInMonth includes span-only days', () => {
  const m = eventsInMonth(merged(), 2026, 9);
  assert.ok(m['2026-10-05'] && m['2026-10-05'][0].source === 'span');
  assert.ok(m['2026-10-09']);
  assert.equal(m['2026-10-06'].length, 4);
  assert.equal(m['2026-10-10'], undefined);
});

t('eventCount counts each span once', () => {
  assert.equal(eventCount(merged()), 3);           // 2 stored + 1 span (trip not counted)
  assert.equal(eventCount({ calendarSpans: [sp('a', '2026-01-01', '2026-01-30')] }), 1);
  assert.equal(eventCount({}), 0);
});

t('todayAgenda labels a span day as an all-day line', () => {
  const ag = todayAgenda(merged(), new Date(2026, 9, 7, 9, 0));
  const line = ag.find(e => e.source === 'span');
  assert.equal(line.label, 'LIS · day 3 of 5');
  assert.equal(line.past, false);
  assert.equal(ag.find(e => e.source === 'holiday').label, 'Porto · day 2 of 3');
});

// ── Writers ──────────────────────────────────────────────────────────
t('addSpan is additive and touches only calendarSpans', () => {
  const prev = { ...merged(), calendarSpans: undefined, logs: { a: 1 }, theme: 'dark-os' };
  const s = makeSpan({ title: 'Ibiza', start: '2026-07-01', end: '2026-07-07' });
  const next = addSpan(prev, s);
  assert.equal(next.calendarSpans.length, 1);
  assert.equal(next.calendarEvents, prev.calendarEvents);
  assert.equal(next.holidays, prev.holidays);
  assert.equal(next.logs, prev.logs);
  assert.equal(next.theme, 'dark-os');
  const again = addSpan(next, makeSpan({ title: 'Two', start: '2026-08-01', end: '2026-08-02' }));
  assert.equal(again.calendarSpans.length, 2);
  assert.equal(again.calendarSpans[0], next.calendarSpans[0]);
});

t('addSpan refuses junk and duplicates by returning prev', () => {
  const prev = merged();
  assert.equal(addSpan(prev, null), prev);
  assert.equal(addSpan(prev, { id: 'x', title: '', start: '2026-01-01' }), prev);
  assert.equal(addSpan(prev, { id: 'x', title: 'a', start: 'bad' }), prev);
  assert.equal(addSpan(prev, sp('lis', '2026-01-01', '2026-01-02')), prev);
});

t('updateSpan patches one span and re-checks the pair', () => {
  const prev = merged();
  const next = updateSpan(prev, 'lis', { title: 'Lisboa', start: '2026-10-12' });   // past the old end
  const s = next.calendarSpans[0];
  assert.equal(s.title, 'Lisboa');
  assert.equal(s.start, '2026-10-09');
  assert.equal(s.end, '2026-10-12');
  assert.equal(s.id, 'lis');
  assert.equal(next.calendarEvents, prev.calendarEvents);
  assert.equal(updateSpan(prev, 'nope', { title: 'x' }), prev);
  const idTry = updateSpan(prev, 'lis', { id: 'hacked', createdAt: 99 });
  assert.equal(idTry.calendarSpans[0].id, 'lis');
  assert.equal(idTry.calendarSpans[0].createdAt, 1);
});

t('removeSpan leaves [] and keeps every other key', () => {
  const prev = merged();
  const next = removeSpan(prev, 'lis');
  assert.deepEqual(next.calendarSpans, []);
  assert.ok('calendarSpans' in next);
  assert.equal(next.calendarEvents, prev.calendarEvents);
  assert.equal(next.holidays, prev.holidays);
  assert.equal(removeSpan(prev, 'nope'), prev);
  assert.equal(removeSpan({}, 'x').calendarSpans, undefined);
});

t('single-day writers refuse sp: (and hol:) ids', () => {
  const prev = merged();
  assert.equal(removeEvent(prev, '2026-10-06', 'sp:lis:2026-10-06'), prev);
  assert.equal(updateEvent(prev, '2026-10-06', 'sp:lis:2026-10-06', { title: 'x' }), prev);
  assert.equal(removeEvent(prev, '2026-10-06', 'hol:t1:2026-10-06'), prev);
  assert.notEqual(removeEvent(prev, '2026-10-06', 'ev_1'), prev);
  const added = addEvent(prev, '2026-10-06', makeEvent({ title: 'New' }));
  assert.equal(added.calendarSpans, prev.calendarSpans);
});

// ── Helpers ──────────────────────────────────────────────────────────
t('isContiguous', () => {
  assert.ok(isContiguous(['2026-10-31', '2026-11-01', '2026-10-30']));
  assert.ok(!isContiguous(['2026-10-01', '2026-10-03']));
  assert.ok(!isContiguous(['2026-10-01']));
  assert.ok(!isContiguous(['2026-10-01', '2026-10-01']));
  assert.ok(!isContiguous(['2026-10-01', 'x']));
});

t('rangeLabel', () => {
  assert.equal(rangeLabel('2026-10-05', '2026-10-09'), 'Mon 5 Oct → Fri 9 Oct · 5 days');
  assert.equal(rangeLabel('2026-10-05', '2026-10-05'), 'Mon 5 Oct · 1 day');
  assert.equal(rangeLabel('bad', 'x'), '');
});

// ── Bar layout ───────────────────────────────────────────────────────
t('barLayout keeps a span in the same lane across a week row', () => {
  // Oct 2026 starts on a Thursday. Week 2 = Mon 5 … Sun 11.
  const S = {
    calendarSpans: [
      sp('short', '2026-10-07', '2026-10-08'),
      sp('long', '2026-10-05', '2026-10-14'),     // crosses into week 3
      sp('late', '2026-10-09', '2026-10-11'),
    ],
    holidays: [{ id: 'tr', dest: 'Rome', from: '2026-10-10', to: '2026-10-13', status: 'booked' }],
  };
  const L = barLayout(eventsInMonth(S, 2026, 9), 2026, 9);
  const laneOf = (iso, key) => L[iso].lanes.findIndex(l => l && l.key === key);
  for (const d of ['05', '06', '07', '08', '09', '10', '11']) assert.equal(laneOf(`2026-10-${d}`, 'sp:long'), 0);
  assert.equal(laneOf('2026-10-07', 'sp:short'), 1);
  assert.equal(laneOf('2026-10-08', 'sp:short'), 1);
  assert.equal(laneOf('2026-10-09', 'sp:late'), 1);          // lane 1 freed after "short"
  assert.equal(laneOf('2026-10-10', 'hol:tr'), 2);
  assert.equal(laneOf('2026-10-12', 'sp:long'), 0);          // week 3 re-lays out
  assert.equal(laneOf('2026-10-12', 'hol:tr'), 1);
  // Titles: span start, first cell of each row.
  assert.ok(L['2026-10-05'].lanes[0].showTitle);
  assert.ok(!L['2026-10-06'].lanes[0].showTitle);
  assert.ok(L['2026-10-12'].lanes[0].showTitle);
  assert.equal(L['2026-10-05'].lanes[0].run, 7);
  assert.ok(L['2026-10-05'].lanes[0].isStart && !L['2026-10-05'].lanes[0].isEnd);
  assert.ok(L['2026-10-14'].lanes[0].isEnd);
  // Holes stay explicit: 5 Oct has lane 0 only, 12 Oct has a gap at none.
  assert.equal(L['2026-10-05'].lanes.length, 1);
  assert.equal(L['2026-10-10'].lanes[1].key, 'sp:late');
});

t('barLayout titles a bar crossing in from the previous month on the 1st', () => {
  const S = { calendarSpans: [sp('x', '2026-09-28', '2026-10-03')] };
  const L = barLayout(eventsInMonth(S, 2026, 9), 2026, 9);
  const seg = L['2026-10-01'].lanes[0];
  assert.ok(seg.showTitle && !seg.isStart);
  assert.ok(L['2026-10-03'].lanes[0].isEnd);
  assert.equal(L['2026-10-01'].bars, 1);
});

t('barLayout leaves single-day events alone and survives junk', () => {
  const L = barLayout({ '2026-10-05': [{ id: 'ev_1', title: 'a' }, null] }, 2026, 9);
  assert.equal(L['2026-10-05'].lanes.length, 0);
  assert.equal(L['2026-10-05'].bars, 0);
  assert.ok(barLayout(null, 2026, 9)['2026-10-31']);
});

t('barLayout is cheap on a heavy month', () => {
  const spans = [];
  for (let i = 0; i < 40; i++) spans.push(sp('s' + i, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, `2026-11-${String(1 + (i % 20)).padStart(2, '0')}`));
  const S = { calendarSpans: spans };
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) barLayout(eventsInMonth(S, 2026, 9), 2026, 9);
  assert.ok(Date.now() - t0 < 2000);
});

console.log(`spans: ${n} checks passed`);

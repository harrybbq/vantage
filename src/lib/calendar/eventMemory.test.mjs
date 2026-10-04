// node src/lib/calendar/eventMemory.test.mjs
import assert from 'node:assert/strict';
import {
  normalise, learnEvents, suggest, completion, suggestLocations, locationCompletion,
  describe as describeEntry, fillPlan, usualWeekday, oneEditApart, MAX_EVENTS,
} from './eventMemory.js';

let n = 0;
const t = (name, fn) => {
  try { fn(); n++; } catch (e) { console.error('FAIL:', name); throw e; }
};

const NOW = new Date(2026, 9, 4, 12).getTime();   // Sun 4 Oct 2026, local
const p = x => String(x).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
const daysAgo = k => isoOf(new Date(2026, 9, 4 - k));
let id = 0;
const ev = (title, extra = {}) => ({ id: 'ev_' + (++id), title, time: '', end: '', location: '', colour: '', kind: 'other', createdAt: 0, ...extra });

/** A small, deliberately messy calendar. */
function sample() {
  const cal = {};
  const add = (iso, e) => { (cal[iso] = cal[iso] || []).push(e); };
  // Weekly gym on Mondays, 07:00–08:00, at "PureGym Leeds". 2026-10-05 is a Monday.
  for (let w = 1; w <= 20; w++) {
    const iso = isoOf(new Date(2026, 9, 5 - 7 * w));
    add(iso, ev(w === 3 ? 'gym  SESSION' : 'Gym session', { time: '07:00', end: '08:00', location: 'PureGym Leeds', colour: '#1a7a4a', kind: 'training', createdAt: NOW - w * 7 * 864e5 }));
  }
  // An older spell of evening gym — should be outweighed by the recent mornings.
  for (let w = 40; w < 46; w++) add(daysAgo(w * 7), ev('Gym session', { time: '18:00', end: '19:00', location: 'PureGym Leeds' }));
  add(daysAgo(30), ev('Gymkhana', { location: 'Village green' }));
  add(daysAgo(10), ev('Dentist', { time: '14:30', end: '15:00', location: 'Castle St Surgery', createdAt: NOW - 10 * 864e5 }));
  add(daysAgo(200), ev('dentist', { time: '14:30', end: '15:00', location: 'Castle St Surgery', createdAt: NOW - 200 * 864e5 }));
  add(daysAgo(5), ev("Dinner at Nonna's", { time: '19:30', end: '21:30', location: "Nonna's Kitchen" }));
  add(daysAgo(12), ev('Dinner at Dishoom', { time: '19:30', end: '21:30', location: 'Dishoom Manchester' }));
  add(daysAgo(40), ev("Mum's birthday", {}));
  add(daysAgo(405), ev("Mum's birthday", {}));
  add(daysAgo(3), ev('   ', {}));                  // empty title — ignored
  add(daysAgo(3), ev('', {}));
  add(daysAgo(3), null);                           // malformed
  add(daysAgo(2), { id: 'hol:x', title: 'Lisbon trip' }); // derived — ignored
  add(daysAgo(60), ev('Nap'));
  add(daysAgo(8), ev('Morning yoga', { time: '06:30', end: '07:15', location: 'Café Nero studio' }));
  return cal;
}

t('normalise is case/whitespace/punctuation/accent insensitive', () => {
  assert.equal(normalise('  Gym   SESSION! '), 'gym session');
  assert.equal(normalise("Nonna's"), 'nonnas');
  assert.equal(normalise('Café–Nero'), 'cafe nero');
  assert.equal(normalise(null), '');
});

const idx = learnEvents(sample(), { now: NOW });
const gym = idx.entries.find(e => e.key === 'gym session');

t('groups case/spacing variants and ignores empty, malformed and derived events', () => {
  assert.equal(gym.count, 26);
  assert.ok(!idx.entries.some(e => e.key === ''));
  assert.ok(!idx.entries.some(e => e.key === 'lisbon trip'));
  assert.equal(idx.entries.find(e => e.key === 'dentist').count, 2);
});

t('canonical title is the most recent spelling', () => {
  assert.equal(gym.title, 'Gym session');
  assert.equal(idx.entries.find(e => e.key === 'dentist').title, 'Dentist');
});

t('recency-weighted time pair: recent mornings beat older evenings', () => {
  assert.equal(gym.start, '07:00');
  assert.equal(gym.end, '08:00');
  assert.equal(gym.duration, 60);
  assert.equal(gym.timeCount, 20);
});

t('location, weekday, colour and kind are remembered', () => {
  assert.equal(gym.location, 'PureGym Leeds');
  assert.equal(gym.locationCount, 26);
  assert.equal(usualWeekday(gym), 'Mon');
  assert.equal(gym.colour, '#1a7a4a');
  assert.equal(gym.kind, 'training');
  assert.equal(gym.lastUsed, '2026-09-28');
});

t('an always-all-day event remembers no time', () => {
  const b = idx.entries.find(e => e.key === 'mums birthday');
  assert.equal(b.start, '');
  assert.equal(describeEntry(b).includes('all day'), true);
});

t('"gy" suggests Gym session first, with its usual time', () => {
  const s = suggest(idx, 'gy', { date: '2026-10-05' });
  assert.equal(s[0].title, 'Gym session');
  assert.equal(s[0].start, '07:00');
  assert.ok(s.some(x => x.title === 'Gymkhana'));
  assert.equal(describeEntry(s[0]), 'PureGym Leeds · 07:00–08:00 · usually Mon');
});

t('fewer than 2 characters suggests nothing (empty focused field included)', () => {
  assert.deepEqual(suggest(idx, ''), []);
  assert.deepEqual(suggest(idx, 'g'), []);
  assert.deepEqual(suggest(idx, ' !'), []);
  assert.equal(completion(idx, 'g'), null);
});

t('word prefixes beat substrings', () => {
  // "ses" is a word prefix of "Gym session"; "ym" only a substring.
  assert.equal(suggest(idx, 'ses')[0].title, 'Gym session');
  // "na": "Nap" (word prefix, used once, long ago) still beats the
  // heavier-weighted "Gymkhana" (substring only).
  const s = suggest(idx, 'na');
  assert.deepEqual(s.map(x => x.title), ['Nap', "Dinner at Nonna's", 'Gymkhana']);
  assert.deepEqual(s.map(x => x.tier), [2, 1, 1]);
});

t('substring matches still appear after prefixes', () => {
  const s = suggest(idx, 'ntis');
  assert.equal(s[0].title, 'Dentist');
  assert.equal(s[0].tier, 1);
});

t('one-letter typos of a heavier event are folded out of the list', () => {
  const cal = {};
  for (let w = 1; w <= 6; w++) { const d = daysAgo(w * 7); (cal[d] = cal[d] || []).push(ev('Gym session')); }
  (cal[daysAgo(3)] = []).push(ev('Gym sesion'));
  (cal[daysAgo(4)] = []).push(ev('Gym sessoin'));          // swap — 1 edit
  (cal[daysAgo(5)] = []).push(ev('Gym sessions plus'));    // not a typo
  const i4 = learnEvents(cal, { now: NOW });
  assert.deepEqual(suggest(i4, 'gym').map(x => x.title), ['Gym session', 'Gym sessions plus']);
  assert.equal(oneEditApart('gym', 'gem'), true);
  assert.equal(oneEditApart('abcd', 'abdc'), true);
  assert.equal(oneEditApart('abcd', 'acbe'), false);
  assert.equal(oneEditApart('dentist', 'dentst'), true);
  assert.equal(oneEditApart('dentist', 'dennist2'), false);
});

t('limit is respected', () => {
  assert.equal(suggest(idx, 'gy', { limit: 1 }).length, 1);
  assert.equal(suggest(idx, 'gy', { limit: 0 }).length, 0);
});

t('weekday boost lifts the event usually on that day', () => {
  const cal = {};
  // "Swim club" Tuesdays (×4), "Swim lesson" Saturdays (×4) — same weights.
  for (let w = 1; w <= 4; w++) {
    const tue = isoOf(new Date(2026, 9, 6 - 7 * w));
    const sat = isoOf(new Date(2026, 9, 3 - 7 * w + 7));
    (cal[tue] = cal[tue] || []).push(ev('Swim club'));
    (cal[sat] = cal[sat] || []).push(ev('Swim lesson'));
  }
  const i2 = learnEvents(cal, { now: new Date(2026, 9, 10).getTime() });
  assert.equal(suggest(i2, 'sw', { date: '2026-10-13' })[0].title, 'Swim club');   // a Tuesday
  assert.equal(suggest(i2, 'sw', { date: '2026-10-17' })[0].title, 'Swim lesson'); // a Saturday
});

t('per-weekday habits: the date being added picks that day\'s times', () => {
  const cal = {};
  for (let w = 1; w <= 8; w++) {
    const mon = isoOf(new Date(2026, 9, 5 - 7 * w));
    const thu = isoOf(new Date(2026, 9, 8 - 7 * w));
    (cal[mon] = cal[mon] || []).push(ev('Gym', { time: '07:00', end: '08:00' }));
    if (w <= 6) (cal[thu] = cal[thu] || []).push(ev('Gym', { time: '18:00', end: '19:30' }));
  }
  const i3 = learnEvents(cal, { now: NOW });
  const mon = suggest(i3, 'gy', { date: '2026-10-12' })[0];
  const thu = suggest(i3, 'gy', { date: '2026-10-15' })[0];
  const sun = suggest(i3, 'gy', { date: '2026-10-11' })[0];
  assert.deepEqual([mon.start, mon.end, mon.onDay], ['07:00', '08:00', 'Mon']);
  assert.deepEqual([thu.start, thu.end, thu.duration, thu.onDay], ['18:00', '19:30', 90, 'Thu']);
  assert.equal(describeEntry(thu), '18:00–19:30 · Thursdays');
  assert.deepEqual([sun.start, sun.onDay], ['07:00', null], 'no Sunday habit → overall most common');
  assert.equal(fillPlan(thu, {}, []).end, '19:30');
});

t('completion: confident prefix match returns the rest of the title', () => {
  assert.equal(completion(idx, 'Gy'), 'm session');
  assert.equal(completion(idx, 'gym '), 'session');
  assert.equal(completion(idx, 'dent'), 'ist');
});

t('completion: null when ambiguous, not a prefix, or already complete', () => {
  assert.equal(completion(idx, 'Dinner at '), null, "Nonna's vs Dishoom are close");
  assert.equal(completion(idx, 'ses'), null, 'mid-title word prefix');
  assert.equal(completion(idx, 'Gym session'), null);
  assert.equal(completion(idx, 'gym-s'), null, 'typed text is not literally the start');
  assert.equal(completion(idx, 'zz'), null);
});

t('location suggestions: prefix, boosted for the current title', () => {
  assert.equal(suggestLocations(idx, 'pu')[0].location, 'PureGym Leeds');
  assert.equal(suggestLocations(idx, 'ca', { title: 'Dentist' })[0].location, 'Castle St Surgery');
  assert.equal(suggestLocations(idx, 'ca', { title: 'Morning yoga' })[0].location, 'Café Nero studio');
  assert.equal(locationCompletion(idx, 'Pure'), 'Gym Leeds');
  assert.deepEqual(suggestLocations(idx, 'p'), []);
});

t('fillPlan fills untouched fields only', () => {
  const plan = fillPlan(gym, { title: 'gy', start: '', end: '', location: 'Home gym', colour: '#4d9ec4' }, ['location']);
  assert.deepEqual(plan, { title: 'Gym session', start: '07:00', end: '08:00', colour: '#1a7a4a' });
});

t('fillPlan derives the other end from the duration', () => {
  assert.deepEqual(fillPlan(gym, { title: 'gy', start: '09:00', end: '' }, ['start']),
    { title: 'Gym session', end: '10:00', location: 'PureGym Leeds', colour: '#1a7a4a' });
  assert.deepEqual(fillPlan(gym, { title: 'gy', start: '', end: '12:00' }, new Set(['end', 'colour'])),
    { title: 'Gym session', start: '11:00', location: 'PureGym Leeds' });
  // Would run past midnight — leave it alone.
  assert.equal('end' in fillPlan(gym, { start: '23:30' }, ['start']), false);
});

t('fillPlan never touches times for an all-day event, and omits no-ops', () => {
  const b = idx.entries.find(e => e.key === 'mums birthday');
  assert.deepEqual(fillPlan(b, { title: "Mum's birthday", start: '', end: '' }, []), {});
  assert.deepEqual(fillPlan(null, {}), {});
});

t('excludeId leaves the event being edited out', () => {
  const cal = { '2026-09-01': [ev('Solo thing', { id: 'me' })] };
  assert.equal(learnEvents(cal, { now: NOW, excludeId: 'me' }).entries.length, 0);
});

t('garbage in, empty index out', () => {
  for (const bad of [null, undefined, 'x', 42, [], { '2026-01-01': 'nope' }, { 'not-a-date': [ev('A')] }]) {
    const i = learnEvents(bad, { now: NOW });
    assert.equal(i.entries.length, 0);
    assert.deepEqual(suggest(i, 'ab'), []);
  }
  assert.deepEqual(suggest(null, 'gym'), []);
});

// ── Performance ─────────────────────────────────────────────────────
t('large calendars are capped and stay fast', () => {
  const names = ['Gym session', 'Shift — Ward 7', 'Dentist', 'Dinner at Nonna\'s', 'Team standup', 'Physio', 'Football 5-a-side', 'Call Mum'];
  const big = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const iso = isoOf(new Date(2026, 9, 4 - Math.floor(i / 8)));
    const title = i % 5 === 0 ? `One-off thing number ${i}` : names[i % names.length];
    (big[iso] = big[iso] || []).push(ev(title, { time: '09:00', end: '10:00', location: 'Place ' + (i % 40) }));
  }
  let t0 = performance.now();
  const bi = learnEvents(big, { now: NOW });
  const learnMs = performance.now() - t0;
  assert.equal(bi.size, MAX_EVENTS);
  assert.equal(bi.truncated, true);

  t0 = performance.now();
  const qs = ['gy', 'gym', 'gym s', 'sh', 'shift', 'de', 'din', 'on', 'one-off', 'ca', 'fo', 'ph'];
  const R = 50;
  for (let r = 0; r < R; r++) for (const q of qs) { suggest(bi, q, { date: '2026-10-05' }); completion(bi, q); }
  const perKey = (performance.now() - t0) / (R * qs.length);
  console.log(`  perf: learn ${N} events (capped at ${MAX_EVENTS}, ${bi.entries.length} titles) ${learnMs.toFixed(1)} ms; suggest+completion ${perKey.toFixed(3)} ms/keystroke`);
  assert.ok(learnMs < 250, `learn took ${learnMs}ms`);
  assert.ok(perKey < 10, `suggest took ${perKey}ms`);
});

console.log(`eventMemory: ${n} tests passed`);

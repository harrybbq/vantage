import assert from 'node:assert/strict';
import { isUpcoming, upcomingNew, visitedSummary } from './visited.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };
const NOW = new Date(2026, 8, 26, 9, 0, 0);
const byDest = { Tokyo: 'JP', Kyoto: 'JP', Paris: 'FR', Rome: 'IT', Nowhere: null };
const countryFor = trip => byDest[trip.dest] ?? null;

t('completed trips are not upcoming', () => {
  assert.equal(isUpcoming({ status: 'completed', from: '2027-01-01' }, NOW), false);
});
t('future trips are upcoming', () => {
  assert.equal(isUpcoming({ status: 'booked', from: '2026-12-15', to: '2026-12-29' }, NOW), true);
});
t('a trip under way today is upcoming until its last day', () => {
  assert.equal(isUpcoming({ status: 'booked', from: '2026-09-20', to: '2026-09-26' }, NOW), true);
  assert.equal(isUpcoming({ status: 'booked', from: '2026-09-20', to: '2026-09-25' }, NOW), false);
});
t('an undated plan counts as upcoming', () => {
  assert.equal(isUpcoming({ status: 'planning' }, NOW), true);
});
t('a past trip never marked complete is not upcoming', () => {
  assert.equal(isUpcoming({ status: 'booked', from: '2026-03-01', to: '2026-03-05' }, NOW), false);
});
t('a trip with only a start date uses it', () => {
  assert.equal(isUpcoming({ status: 'booked', from: '2026-10-01' }, NOW), true);
  assert.equal(isUpcoming({ status: 'booked', from: '2026-09-01' }, NOW), false);
});

t('upcomingNew skips countries already visited', () => {
  const trips = [{ dest: 'Paris', status: 'booked', from: '2026-11-01' }, { dest: 'Tokyo', status: 'planning', from: '2027-02-01' }];
  const out = upcomingNew(trips, { FR: {} }, countryFor, NOW);
  assert.deepEqual(Object.keys(out), ['JP']);
});
t('upcomingNew groups trips by country and picks the soonest', () => {
  const a = { dest: 'Kyoto', status: 'planning', from: '2027-05-01' };
  const b = { dest: 'Tokyo', status: 'booked', from: '2026-12-15' };
  const c = { dest: 'Tokyo', status: 'planning' };
  const out = upcomingNew([a, c, b], {}, countryFor, NOW);
  assert.equal(out.JP.trips.length, 3);
  assert.equal(out.JP.next, b);
});
t('upcomingNew ignores trips it cannot place', () => {
  assert.deepEqual(upcomingNew([{ dest: 'Nowhere', status: 'booked', from: '2027-01-01' }], {}, countryFor, NOW), {});
});
t('upcomingNew ignores completed and past trips', () => {
  const trips = [{ dest: 'Rome', status: 'completed', from: '2025-01-01' }, { dest: 'Rome', status: 'booked', from: '2026-01-01', to: '2026-01-05' }];
  assert.deepEqual(upcomingNew(trips, {}, countryFor, NOW), {});
});
t('upcomingNew tolerates missing inputs', () => {
  assert.deepEqual(upcomingNew(undefined, undefined, countryFor, NOW), {});
});

t('visitedSummary counts and rounds to one decimal', () => {
  const v = { FR: { iso2: 'FR', name: 'France', years: [2024] }, IT: { iso2: 'IT', name: 'Italy', years: [] } };
  const s = visitedSummary(v, 249, { JP: {} });
  assert.equal(s.count, 2);
  assert.equal(s.pct, 0.8);
  assert.equal(s.upcoming, 1);
});
t('visitedSummary lists newest trips first, undated after, alphabetically', () => {
  const v = {
    PE: { iso2: 'PE', name: 'Peru', years: [] },
    FR: { iso2: 'FR', name: 'France', years: [2019, 2024] },
    AR: { iso2: 'AR', name: 'Argentina', years: [] },
    IT: { iso2: 'IT', name: 'Italy', years: [2025] },
  };
  assert.deepEqual(visitedSummary(v, 249).recent.map(r => r.iso2), ['IT', 'FR', 'AR', 'PE']);
});
t('visitedSummary caps the list', () => {
  const v = Object.fromEntries('ABCDEFG'.split('').map(k => [k, { iso2: k, name: k, years: [] }]));
  assert.equal(visitedSummary(v, 249, {}, 3).recent.length, 3);
});
t('visitedSummary of nothing is zero, not NaN', () => {
  assert.deepEqual(visitedSummary({}, 0), { count: 0, total: 0, pct: 0, recent: [], upcoming: 0 });
});

console.log(`visited: ${n} passed`);

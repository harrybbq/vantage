// Run: node src/lib/ratings/profile.test.mjs   (npm run check:ratingprofile)
import assert from 'node:assert/strict';
import { categoryProfile, nextStep } from './profile.js';

const T = '2026-10-21';
const tr = (id, category, name) => ({ id, category, name, type: 'boolean' });

// Nothing scored yet: no profile to show.
assert.deepEqual(categoryProfile({ ratings: { brain: 1, finance: 1, fitness: 1, social: 1 } }, { today: T }), { best: null, workOn: null });
assert.deepEqual(categoryProfile({}, { today: T }), { best: null, workOn: null });

// Best is the highest, work-on the lowest of the rest.
{
  const S = { ratings: { brain: 40, finance: 3, fitness: 72, social: 20 }, trackers: [tr('f', 'fitness', 'Gym')] };
  const p = categoryProfile(S, { today: T });
  assert.equal(p.best.id, 'fitness');
  assert.equal(p.workOn.id, 'finance');
  assert.equal(p.workOn.step.kind, 'add-tracker');
  assert.match(p.workOn.step.text, /finance tracker/);
}

// Ties are stable: earlier category wins both ways.
{
  const p = categoryProfile({ ratings: { brain: 30, finance: 30, fitness: 10, social: 10 } }, { today: T });
  assert.equal(p.best.id, 'brain');
  assert.equal(p.workOn.id, 'fitness');
}

// Steps, in order of what pays for longest.
{
  const base = { trackers: [tr('r', 'brain', 'Read 20 pages')] };
  assert.equal(nextStep({ ...base, logs: {} }, 'brain', { today: T }).kind, 'tick');
  assert.match(nextStep({ ...base, logs: {} }, 'brain', { today: T }).text, /Read 20 pages/);
  const ticked = { ...base, logs: { [T]: { r: true } } };
  assert.equal(nextStep(ticked, 'brain', { today: T }).kind, 'self-check');
  assert.equal(nextStep({ ...ticked, brainScore: { result: 104 } }, 'brain', { today: T }).kind, 'keep');
}
{
  const S = { trackers: [tr('s', 'finance', 'No spend')], logs: { [T]: { s: true } }, financeScore: { result: 100 } };
  assert.equal(nextStep(S, 'finance', { today: T }).kind, 'savings');
  assert.equal(nextStep({ ...S, savings: [{ target: 5 }] }, 'finance', { today: T }).kind, 'savings', 'a £5 goal does not count');
  assert.equal(nextStep({ ...S, savings: [{ target: 500 }] }, 'finance', { today: T }).kind, 'keep');
}
{
  const S = { trackers: [tr('c', 'social', 'Call someone')], logs: { [T]: { c: true } }, socialScore: { result: 100 } };
  assert.equal(nextStep(S, 'social', { today: T, friendCount: 1 }).kind, 'friends');
  assert.equal(nextStep(S, 'social', { today: T }).kind, 'keep', 'unknown friend count never nags');
}

console.log('ratings profile: ok');

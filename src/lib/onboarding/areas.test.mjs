// node src/lib/onboarding/areas.test.mjs — the smaller app (Nov 2026).
import assert from 'node:assert/strict';
import { navScope, isScoped, inScope, addableAreas, AREA_NAV, ALWAYS_NAV } from './areas.js';
import { PICK_IDS, setPicks, addArea, areasOf, gettingStarted, finishOverlay } from './onboarding.js';
import { DEFAULT_STATE } from '../../data/initialState.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
const scopedWith = picks => setPicks(fresh(), picks, 1, { scoped: true });
const sorted = set => [...set].sort();

t('every pick has a navigation entry in the table', () => {
  assert.deepEqual(Object.keys(AREA_NAV).sort(), [...PICK_IDS].sort());
});

t('existing accounts are not scoped: no onboarding, or picks from before the cut-over', () => {
  assert.equal(navScope(fresh()), null);
  assert.equal(navScope({}), null);
  assert.equal(navScope(null), null);
  const old = setPicks(fresh(), ['fitness', 'friends'], 1);      // no { scoped } → the key is never written
  assert.equal('scoped' in old.onboarding, false);
  assert.equal(isScoped(old), false);
  assert.equal(navScope(old), null);
  assert.deepEqual(addableAreas(old), []);
  assert.equal(inScope(null, 'habits'), true);
});

t('"Show me everything" is everything', () => {
  const all = finishOverlay(setPicks(fresh(), [], 1, { scoped: true }));
  assert.equal(all.onboarding.scoped, false);
  assert.equal(navScope(all), null);
  assert.deepEqual(addableAreas(all), []);
});

t('Fitness + Friends: Hub, Track, Settings, Leaderboard, Friends', () => {
  const S = scopedWith(['fitness', 'friends']);
  assert.deepEqual(sorted(navScope(S)), sorted([...ALWAYS_NAV, 'leaderboard', 'friends']));
  assert.equal(inScope(navScope(S), 'habits'), false);
  assert.equal(inScope(navScope(S), 'achievements'), false);   // the seeded example goals are not use
  assert.deepEqual(addableAreas(S).map(a => a.id), ['money', 'habits', 'goals', 'trips']);
});

t('Hub, Track and Settings are always there, whatever is picked', () => {
  for (const id of PICK_IDS) {
    const scope = navScope(scopedWith([id]));
    for (const nav of ['hub', 'track', 'settings']) assert.ok(scope.has(nav), `${id}: ${nav}`);
  }
});

t('adding an area turns it on and puts its first thing on the Getting started card', () => {
  let S = scopedWith(['fitness']);
  S = { ...S, onboarding: { ...S.onboarding, hidden: true } };
  assert.equal(inScope(navScope(S), 'habits'), false);
  const next = addArea(S, 'habits');
  assert.deepEqual(next.onboarding.added, ['habits']);
  assert.deepEqual(next.onboarding.picks, ['fitness']);       // the picks themselves are untouched
  assert.equal(next.onboarding.hidden, false);
  assert.equal(inScope(navScope(next), 'habits'), true);
  assert.deepEqual(areasOf(next), ['fitness', 'habits']);
  assert.deepEqual(gettingStarted(next).items.map(i => i.id), ['fitness', 'habits']);
  assert.deepEqual(addableAreas(next).map(a => a.id), ['money', 'goals', 'friends', 'trips']);
  // Unknown or repeated: the same object back, so no save is queued.
  assert.equal(addArea(next, 'habits'), next);
  assert.equal(addArea(next, 'fitness'), next);
  assert.equal(addArea(next, 'nope'), next);
});

t('addArea writes only S.onboarding', () => {
  const S = scopedWith(['fitness']);
  const next = addArea(S, 'trips');
  for (const k of Object.keys(S)) if (k !== 'onboarding') assert.equal(next[k], S[k], k);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(S).sort());
});

t('an area with something in it shows without being picked', () => {
  const base = scopedWith(['fitness']);
  assert.equal(inScope(navScope({ ...base, habits: [{ id: 'h1' }] }), 'habits'), true);
  assert.equal(inScope(navScope({ ...base, shopItems: [{ id: 'x' }] }), 'shop'), true);
  assert.equal(inScope(navScope({ ...base, savings: [{ id: 'p' }] }), 'achievements'), true);
  assert.equal(inScope(navScope({ ...base, achievements: [...base.achievements, { id: 'mine' }] }), 'achievements'), true);
  assert.equal(inScope(navScope({ ...base, ratingInputs: { friends: 2 } }), 'leaderboard'), true);
  assert.equal(inScope(navScope(base, { friends: 1 }), 'friends'), true);
  assert.equal(inScope(navScope({ ...base, ratingInputs: { friends: 'x' } }), 'friends'), false);
});

t('once everything is asked for, nothing is left to add and nothing is hidden', () => {
  let S = scopedWith(['fitness']);
  for (const id of PICK_IDS) S = addArea(S, id);
  assert.deepEqual(addableAreas(S), []);
  for (const nav of ['achievements', 'shop', 'habits', 'leaderboard', 'friends']) assert.ok(navScope(S).has(nav), nav);
});

t('a replay keeps what was added', () => {
  const S = addArea(scopedWith(['fitness']), 'habits');
  const again = setPicks(S, ['friends'], 2, { scoped: true });
  assert.deepEqual(again.onboarding.added, ['habits']);
  assert.equal(inScope(navScope(again), 'habits'), true);
  assert.equal(inScope(navScope(again), 'leaderboard'), true);
});

console.log(`areas: ${n} tests passed`);

// node src/lib/onboarding/onboarding.test.mjs — pick + do onboarding (owner, Oct 2026).
import assert from 'node:assert/strict';
import { DEFAULT_STATE } from '../../data/initialState.js';
import {
  PICKS, PICK_IDS, pickById, picksOf, isDone, stops, gettingStarted,
  setPicks, finishOverlay, markInvited, hideGettingStarted, replay,
} from './onboarding.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));

t('six picks, each with a complete first thing', () => {
  assert.deepEqual(PICK_IDS, ['fitness', 'money', 'habits', 'goals', 'friends', 'trips']);
  for (const p of PICKS) {
    for (const k of ['title', 'body', 'cta', 'section', 'check', 'doneTitle', 'doneBody']) assert.ok(p.first[k], `${p.id}.${k}`);
    assert.equal(typeof p.first.done, 'function');
    assert.ok(p.label && p.line && p.icon);
  }
  // Every modal named is one App/Modals.jsx opens.
  const MODALS = ['addSavingsGoalModal', 'addHabitModal', 'addAchievementModal', 'addHolidayModal'];
  for (const p of PICKS) if (p.first.modal) assert.ok(MODALS.includes(p.first.modal), p.first.modal);
});

t('a brand-new account: nothing is done (the seeded trackers and goals do not count)', () => {
  const S = fresh();
  for (const id of PICK_IDS) assert.equal(isDone(S, id), false, id);
});

t('each first thing counts once the state says so', () => {
  const S = fresh();
  assert.equal(isDone({ ...S, logs: { '2026-10-29': { t1: true } } }, 'fitness'), true);
  assert.equal(isDone({ ...S, logs: { '2026-10-29': { t1: false, t3: 0 } } }, 'fitness'), false, 'an untick is not a log');
  assert.equal(isDone({ ...S, savings: [{ id: 's1' }] }, 'money'), true);
  assert.equal(isDone({ ...S, habits: [{ id: 'h1' }] }, 'habits'), true);
  assert.equal(isDone({ ...S, achievements: [...S.achievements, { id: 'mine' }] }, 'goals'), true, 'your own goal');
  assert.equal(isDone({ ...S, achievements: S.achievements.map(a => (a.id === 'a3' ? { ...a, completed: true } : a)) }, 'goals'), true, 'or a seeded one completed');
  assert.equal(isDone(S, 'friends', { friends: 1 }), true);
  assert.equal(isDone(markInvited(S, 5), 'friends'), true, 'sharing the invite link counts');
  assert.equal(isDone({ ...S, holidays: [{ id: 'h' }] }, 'trips'), true);
  assert.equal(isDone({ ...S, shopItems: [{ id: 'x' }] }, 'trips'), true);
});

t('picks: cleaned, in picker order; stops follow them', () => {
  const S = setPicks(fresh(), ['friends', 'bogus', 'fitness', 'fitness'], 100);
  assert.deepEqual(picksOf(S), ['fitness', 'friends']);
  assert.deepEqual(S.onboarding, { picks: ['fitness', 'friends'], pickedAt: 100, hidden: false });
  assert.deepEqual(stops(S, picksOf(S)).map(s => [s.id, s.done]), [['fitness', false], ['friends', false]]);
  assert.deepEqual(picksOf(fresh()), [], 'no onboarding key → no picks');
  assert.equal(pickById('nope'), null);
});

t('getting started: only for someone who picked, until done or hidden', () => {
  const none = gettingStarted(fresh());
  assert.equal(none.visible, false, 'an account that onboarded before this existed sees no card');
  let S = setPicks(fresh(), ['fitness', 'habits'], 1);
  let g = gettingStarted(S);
  assert.deepEqual([g.visible, g.doneCount, g.total], [true, 0, 2]);
  assert.deepEqual(g.items.map(i => i.label), ['Tick a tracker', 'Start a habit']);
  S = { ...S, habits: [{ id: 'h1' }] };
  g = gettingStarted(S);
  assert.deepEqual([g.visible, g.doneCount], [true, 1]);
  S = { ...S, logs: { d: { t1: true } } };
  assert.equal(gettingStarted(S).visible, false, 'all done → gone');
  const hid = hideGettingStarted(setPicks(fresh(), ['money'], 1));
  assert.equal(gettingStarted(hid).visible, false, 'hidden → gone');
  assert.equal(hideGettingStarted(hid), hid, 'hiding twice changes nothing');
});

t('updaters are additive: only onboarding / tutorialCompleted change', () => {
  const S = { ...fresh(), habits: [{ id: 'h' }], coins: 120, onboarding: { picks: ['money'], invited: 9, hidden: true } };
  const keep = s => { const { onboarding, tutorialCompleted, ...rest } = s; void onboarding; void tutorialCompleted; return rest; };
  for (const next of [setPicks(S, ['habits'], 2), finishOverlay(S), markInvited(S), hideGettingStarted(S), replay(S)]) {
    assert.deepEqual(keep(next), keep(S));
  }
  const again = setPicks(S, ['habits'], 2);
  assert.equal(again.onboarding.invited, 9, 'a replay keeps the invite');
  assert.equal(again.onboarding.hidden, false, 'picking again brings the card back');
  assert.equal(finishOverlay({ ...S, tutorialCompleted: true }).tutorialCompleted, true);
  assert.equal(replay(S).tutorialCompleted, false);
  assert.equal(markInvited(S), S, 'already invited → unchanged');
});

console.log(`onboarding: ${n} tests passed`);

// node src/lib/trackers/done.test.mjs
import assert from 'node:assert/strict';
import { trackerDone, trackerProgress, trackerStep, targetFromName, dailyGoalOf, fmtTrackerValue } from './done.js';
import { countWeekLogs } from '../../utils/helpers.js';

let n = 0;
const t = (name, fn) => { fn(); n++; };

const steps = { id: 's', type: 'number', unit: 'steps', dailyGoal: 10000 };
const saved = { id: 'm', type: 'number', unit: '£', goal: 500 }; // monthly, no daily
const gym = { id: 'g', type: 'boolean' };

t('6k of a 10k daily target is a failed day', () => {
  assert.equal(trackerDone(steps, 6000), false);
  assert.equal(trackerDone(steps, 10000), true);
  assert.equal(trackerDone(steps, 12345), true);
  assert.equal(trackerProgress(steps, 6000), 0.6);
});
t('no daily target: any amount still counts, as before', () => {
  assert.equal(trackerDone(saved, 20), true, 'the monthly `goal` is never read as daily');
  assert.equal(trackerDone(saved, 0), false);
  assert.equal(dailyGoalOf(saved), null);
});
t('booleans', () => {
  assert.equal(trackerDone(gym, true), true);
  assert.equal(trackerDone(gym, undefined), false);
});
t('step is a round twentieth of the target', () => {
  assert.equal(trackerStep(steps), 500);
  assert.equal(trackerStep({ type: 'number', dailyGoal: 8 }), 1);
  assert.equal(trackerStep({ type: 'number', dailyGoal: 2500 }), 100);
  assert.equal(trackerStep({ type: 'number', dailyGoal: 70 }), 5);
  assert.equal(trackerStep({ type: 'number' }, 500), 500, 'auto source step');
  assert.equal(trackerStep({ type: 'number' }), 1);
});
t('a target is guessed from the name, only as a suggestion', () => {
  assert.equal(targetFromName('10k steps'), 10000);
  assert.equal(targetFromName('8 glasses water'), 8);
  assert.equal(targetFromName('Reading'), null);
  assert.equal(targetFromName('2.5k kcal'), 2500);
});
t('weekly count only counts kept days when given the tracker', () => {
  const logs = { '2026-09-28': { s: 6000 }, '2026-09-29': { s: 11000 }, '2026-09-30': { s: 10000 } };
  assert.equal(countWeekLogs(logs, 's', '2026-09-29', steps), 2);
  assert.equal(countWeekLogs(logs, 's', '2026-09-29'), 3, 'old callers unchanged');
});
t('formatting', () => {
  assert.equal(fmtTrackerValue(6000), '6,000');
  assert.equal(fmtTrackerValue(12500, true), '12.5k');
  assert.equal(fmtTrackerValue(10000, true), '10k');
  assert.equal(fmtTrackerValue(950, true), '950');
});

console.log(`tracker done: ${n} passed`);

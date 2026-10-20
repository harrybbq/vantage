/**
 * Console tour copy and first-run checklist (tourSteps.js). Hermetic.
 * Run: npm run check:console
 */
import assert from 'node:assert/strict';
import { TOUR_STEPS, START_ITEMS } from './tourSteps.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('fewer, shorter stops than classic (11 each, up to 400 chars)', () => {
  assert.ok(TOUR_STEPS.length <= 6, `${TOUR_STEPS.length} stops`);
  for (const s of TOUR_STEPS) assert.ok(s.body.length <= 140, `${s.id}: ${s.body.length} chars`);
});

t('one voice: sentence case, no //, no em-dash, no "system init", no emoji', () => {
  for (const s of TOUR_STEPS) {
    const text = `${s.title} ${s.body}`;
    assert.equal(s.title[0], s.title[0].toUpperCase(), `${s.id} title starts upper`);
    assert.notEqual(s.title, s.title.toUpperCase(), `${s.id} title not all caps`);
    assert.ok(!text.includes('//') && !text.includes('—'), s.id);
    assert.ok(!/system (init|ready)/i.test(text), s.id);
    assert.ok(!/\p{Extended_Pictographic}/u.test(text), `${s.id} has emoji`);
  }
});

t('every pointing stop has a target list ending in something a phone has', () => {
  for (const s of TOUR_STEPS.filter(x => x.targets.length)) {
    assert.ok(s.targets.some(x => x.startsWith('tab:')), `${s.id} needs a phone fallback`);
  }
});

t('checklist reads state, never needs to write it', () => {
  const fresh = { hubWidgets: [], mobileWidgets: [], logs: {}, habits: [] };
  assert.deepEqual(START_ITEMS.map(i => i.done(fresh)), [true, false, false, false]);
  const used = { hubWidgets: [{ id: 'x' }], logs: { '2026-10-20': { t1: true } }, habits: [{ id: 'h' }] };
  assert.deepEqual(START_ITEMS.map(i => i.done(used)), [true, true, true, true]);
  // A day of untouched zeros is not a log.
  assert.equal(START_ITEMS[2].done({ logs: { d: { t1: false, t2: 0 } } }), false);
  assert.equal(START_ITEMS[1].done(undefined), false);
});

console.log(`tour: ${n} tests passed`);

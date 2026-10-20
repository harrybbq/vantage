/**
 * The console slot contract (App.jsx imports these names; DesignSlot
 * renders them). Every slot App.jsx names must still be exported by its
 * area entry, as null (classic renders) or a component — a lazy() or a
 * function — never an element. Hermetic. Run: npm run check:console
 *
 * NOTE: once an area swaps a slot for lazy(...), its entry imports React;
 * node can still load it (react is a dependency), and lazy() never runs
 * the import until rendered.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SLOTS = {
  hub: ['ConsoleHub'],
  track: ['ConsoleTrack', 'ConsoleHoliday'],
  sweep: ['ConsoleHabits', 'ConsoleSettings', 'ConsoleAchievements', 'ConsoleShop', 'ConsoleLeaderboard', 'ConsoleFriends',
    'ConsolePaywall', 'ConsoleTutorial'],
};

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

const isComponent = v => v === null || typeof v === 'function'
  || (typeof v === 'object' && v !== null && typeof v.$$typeof === 'symbol' && !('props' in v));

for (const [area, names] of Object.entries(SLOTS)) {
  await t(`${area}: exports ${names.join(', ')} as null or a component`, async () => {
    const mod = await import(join(HERE, area, 'index.js'));
    for (const k of names) {
      assert.ok(k in mod, `${area}/index.js must export ${k} (App.jsx imports it)`);
      assert.ok(isComponent(mod[k]), `${area}.${k} must be null, lazy(...) or a component — not an element`);
    }
  });
}

await t('App.jsx mounts every slot through DesignSlot', () => {
  const app = readFileSync(join(HERE, '../../App.jsx'), 'utf8');
  for (const k of Object.values(SLOTS).flat()) {
    assert.ok(app.includes(`<DesignSlot use={${k}}`), `App.jsx: <DesignSlot use={${k}} …>`);
  }
});

console.log(`slots: ${n} tests passed`);

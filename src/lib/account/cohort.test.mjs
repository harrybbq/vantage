// node src/lib/account/cohort.test.mjs — who gets the smaller app (Nov 2026).
import assert from 'node:assert/strict';
import { isNewCohort, SMALLER_APP_FROM } from './cohort.js';
import { resolveDesign, defaultDesignFor, DEFAULT_DESIGN } from '../design/design.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('accounts from the cut-over on are the new cohort; everything else is not', () => {
  assert.equal(isNewCohort(SMALLER_APP_FROM), true);
  assert.equal(isNewCohort('2026-11-13T09:30:00.000Z'), true);
  assert.equal(isNewCohort('2027-01-01T00:00:00Z'), true);
  assert.equal(isNewCohort('2026-11-12T23:59:59Z'), false);
  assert.equal(isNewCohort('2026-05-03T10:00:00Z'), false);
  assert.equal(isNewCohort(Date.parse('2026-12-01T00:00:00Z')), true);
});

t('an unknown creation time is treated as an existing account', () => {
  for (const v of [null, undefined, '', 'nope', NaN, {}, []]) assert.equal(isNewCohort(v), false, String(v));
});

t('existing accounts: classic by default, the new design still an owner preview', () => {
  const old = '2026-08-01T00:00:00Z';
  assert.equal(DEFAULT_DESIGN, 'classic');
  assert.equal(defaultDesignFor(old), 'classic');
  assert.equal(defaultDesignFor(null), 'classic');
  assert.equal(resolveDesign({}, { defaultDesign: defaultDesignFor(old) }), 'classic');
  assert.equal(resolveDesign({ design: 'console' }, { defaultDesign: defaultDesignFor(old) }), 'classic');
  assert.equal(resolveDesign({ design: 'console' }, { defaultDesign: defaultDesignFor(old), allowConsole: true }), 'console');
});

t('new accounts: the new design by default, with no owner gate and nothing written', () => {
  const fresh = '2026-11-20T00:00:00Z';
  assert.equal(defaultDesignFor(fresh), 'console');
  assert.equal(resolveDesign({}, { defaultDesign: defaultDesignFor(fresh) }), 'console');
  assert.equal(resolveDesign(null, { defaultDesign: defaultDesignFor(fresh) }), 'console');
  // An explicit choice still wins, either way.
  assert.equal(resolveDesign({ design: 'classic' }, { defaultDesign: defaultDesignFor(fresh) }), 'classic');
  assert.equal(resolveDesign({ design: 'console' }, { defaultDesign: defaultDesignFor(fresh) }), 'console');
});

console.log(`account cohort: ${n} tests passed`);

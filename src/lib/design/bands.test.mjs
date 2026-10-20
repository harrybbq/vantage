/**
 * Tier bands for rating colours (lib/ratings/bands.js): same thresholds as
 * the prestige tiers (tiers.js), no band for a missing rating, class and
 * var names. Hermetic. Run: npm run check:console
 */
import assert from 'node:assert/strict';
import { BAND_KEYS, bandOf, bandClass, bandVar } from '../ratings/bands.js';
import { OVR_TIERS, ovrTierKey } from '../ratings/tiers.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('six bands in ascending order, straight from tiers.js', () => {
  assert.deepEqual([...BAND_KEYS], ['bronze', 'silver', 'gold', 'emerald', 'diamond', 'ruby']);
  assert.deepEqual([...BAND_KEYS], OVR_TIERS.map(x => x.key));
});

t('edges match the prestige tiers exactly (no duplicated thresholds)', () => {
  const cases = [[0, 'bronze'], [1, 'bronze'], [19, 'bronze'], [20, 'silver'], [39, 'silver'], [40, 'gold'], [59, 'gold'],
    [60, 'emerald'], [74, 'emerald'], [79, 'emerald'], [80, 'diamond'], [89, 'diamond'], [90, 'ruby'], [99, 'ruby']];
  for (const [v, k] of cases) assert.equal(bandOf(v), k, String(v));
  for (let v = 0; v <= 99; v++) assert.equal(bandOf(v), ovrTierKey(v), `agrees with tiers.js at ${v}`);
});

t('out of range and fractional values follow tiers.js', () => {
  assert.equal(bandOf(-5), 'bronze');
  assert.equal(bandOf(120), 'ruby');
  assert.equal(bandOf('81'), 'diamond', 'numeric strings read as numbers');
  assert.equal(bandOf(79.4), ovrTierKey(79.4));
});

t('a missing rating has no band (never painted bronze)', () => {
  for (const v of [null, undefined, '', NaN, 'abc', Infinity, {}]) {
    assert.equal(bandOf(v), null, String(v));
    assert.equal(bandClass(v), '');
    assert.equal(bandVar(v), null);
  }
});

t('class and var names', () => {
  assert.equal(bandClass(74), 'cx-band-emerald');
  assert.equal(bandClass(95, { bg: true }), 'cx-band-bg-ruby');
  assert.equal(bandClass(5, {}), 'cx-band-bronze');
  assert.equal(bandVar(45), 'var(--band-gold)');
});

console.log(`bands: ${n} tests passed`);

// Run: node netlify/lib/ratingsEpoch.test.mjs   (npm run check:ratingsepoch)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { climbSince, sinceEpoch, FORMULA_EPOCH_ISO } = require('./ratingsEpoch.js');

const MON = '2026-11-02T03:00:00.000Z';
// No prestige: plain difference, falls allowed (callers clamp).
assert.equal(climbSince(50, 40, null, MON), 10);
assert.equal(climbSince(35, 40, null, MON), -5);
// Prestige after the snapshot: 90 → 99 is 9, then 1 → 20 is 19.
assert.equal(climbSince(20, 90, '2026-11-04T12:00:00.000Z', MON), 28);
// Prestige before the snapshot: the snapshot is already post-prestige.
assert.equal(climbSince(20, 5, '2026-11-01T12:00:00.000Z', MON), 15);
// Missing sides.
assert.equal(climbSince(null, 40, null, MON), null);
assert.equal(climbSince(40, undefined, null, MON), null);
// Unparseable times never invent a prestige.
assert.equal(climbSince(20, 90, 'nonsense', MON), -70);
// The league week starts no earlier than the formula change.
const before = new Date(Date.parse(FORMULA_EPOCH_ISO) - 86_400_000);
const after = new Date(Date.parse(FORMULA_EPOCH_ISO) + 86_400_000);
assert.equal(sinceEpoch(before).toISOString(), FORMULA_EPOCH_ISO);
assert.equal(sinceEpoch(after), after);
console.log('ratingsEpoch: ok');

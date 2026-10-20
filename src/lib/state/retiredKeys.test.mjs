/** Retired state keys: removed exactly, nothing else touched, identity when absent. */
import assert from 'node:assert/strict';
import { RETIRED_STATE_KEYS, dropRetiredKeys } from './retiredKeys.js';
import { mergeState } from './merge.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

eq([...RETIRED_STATE_KEYS], ['moodLog'], 'only the owner-retired key is listed');

const S = { trackers: [{ id: 't1' }], logs: { '2026-10-01': { t1: true } }, vitalsLog: { '2026-10-01': { weight: 80 } }, moodLog: { '2026-07-01': 4 }, coins: 12 };
const out = dropRetiredKeys(S);
ok(!('moodLog' in out), 'moodLog removed');
eq({ ...out }, { trackers: S.trackers, logs: S.logs, vitalsLog: S.vitalsLog, coins: 12 }, 'everything else kept');
ok(out.trackers === S.trackers && out.logs === S.logs && out.vitalsLog === S.vitalsLog, 'other values are the same objects (nothing rewritten)');
ok('moodLog' in S, 'the input is not mutated');

const clean = { trackers: [], coins: 0 };
ok(dropRetiredKeys(clean) === clean, 'no retired key → the same object (no save queued)');
ok(dropRetiredKeys(null) === null && dropRetiredKeys(undefined) === undefined, 'nullish passes through');

// The merge keeps the deletion when the other device left moodLog alone.
const base = S;
const local = dropRetiredKeys(S);
const remote = { ...S, coins: 20 };                  // another device changed something else
const merged = mergeState ? mergeState(base, local, remote) : null;
if (merged) {
  const m = merged.state || merged;
  ok(!('moodLog' in m), 'merge: the deletion survives a device that never touched moodLog');
  eq(m.coins, 20, 'merge: the other device’s change still lands');
}

console.log(`retired keys: ${n} passed`);

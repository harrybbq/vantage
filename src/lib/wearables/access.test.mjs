/**
 * node src/lib/wearables/access.test.mjs — item 127 / D7, client half.
 */
import assert from 'node:assert/strict';
import {
  connectResultMessage, showWearablePanel, cleanHandle, cleanNote, accessErrorMessage, providerName,
} from './access.js';
import { hasWearableData } from './strip.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// connect results: never the bare "(denied)" again
ok(!/\(denied\)/.test(connectResultMessage('whoop', 'denied')), 'denied is explained, not echoed');
ok(/reviews Vantage/.test(connectResultMessage('whoop', 'denied')), 'denied names the review limit');
ok(/Oura/.test(connectResultMessage('oura', 'denied')), 'names the provider');
ok(/expired/.test(connectResultMessage('whoop', 'expired')), 'expired');
ok(/try again/.test(connectResultMessage('oura', 'tokenfail')), 'token exchange failure');
ok(/not set up/.test(connectResultMessage('oura', 'notconfigured')), 'not configured');
eq(connectResultMessage('whoop', 'weird'), 'WHOOP connect failed (weird).', 'unknown result still says something');
ok(connectResultMessage('whoop', 'x'.repeat(500)).length < 80, 'unknown result is clipped');
eq(providerName('nope'), 'Wearable', 'unknown provider');

// D7
eq(showWearablePanel({ connectAvailable: true, connected: false }), true, 'web: always');
eq(showWearablePanel({ connectAvailable: false, connected: false }), false, 'native, not linked: absent');
eq(showWearablePanel({ connectAvailable: false, connected: true }), true, 'native, linked: kept so Disconnect works');

// handles
eq(cleanHandle('@Harry_1'), 'Harry_1', 'leading @ dropped');
eq(cleanHandle('  ab  '), null, 'too short');
eq(cleanHandle('has space'), null, 'space refused');
eq(cleanHandle('a'.repeat(21)), null, 'too long');
eq(cleanHandle(null), null, 'null');
eq(cleanNote('  hi '), 'hi', 'note trimmed');
eq(cleanNote('   '), null, 'blank note → null');
eq(cleanNote('x'.repeat(300)).length, 200, 'note clipped');

// owner errors
ok(/wearable_access_2026_10\.sql/.test(accessErrorMessage({ code: 'PGRST202' })), 'SQL not run → names the file');
ok(/owner/.test(accessErrorMessage({ code: '42501' })), 'not owner');
ok(/handle/.test(accessErrorMessage({ code: 'P0002', message: 'no such handle' })), 'no such handle');
ok(/full/.test(accessErrorMessage({ code: '54000', message: 'list is full' })), 'list full');
ok(/connection/.test(accessErrorMessage({ message: 'timeout' })), 'fallback');

// quick band check (D7 visibility)
eq(hasWearableData({}), false, 'empty');
eq(hasWearableData({ vitalsLog: { d: { sleep: 7, weight: 80 } }, burnLog: { d: [{ id: 'm', kcal: 1 }] } }), false, 'manual only');
eq(hasWearableData({ vitalsLog: { d: { hrv: 50 } } }), true, 'band key');
eq(hasWearableData({ burnLog: { d: [{ id: 'oura-1', kcal: 1 }] } }), true, 'band workout');

console.log(`wearable access (client): ${n} checks passed`);

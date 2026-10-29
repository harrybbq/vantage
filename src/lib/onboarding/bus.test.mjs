// node src/lib/onboarding/bus.test.mjs — the "Do it" event the hub card sends App.
import assert from 'node:assert/strict';
import { ONBOARDING_DO_EVENT, requestOnboardingDo } from './bus.js';
import { PICK_IDS } from './onboarding.js';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

t('no window (node, SSR): a no-op that says so, never throws', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(requestOnboardingDo('fitness'), false);
});

// A window stand-in. CustomEvent is shimmed rather than assumed, so the
// test does not depend on the Node version's globals.
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? null; }
  };
}
globalThis.window = new EventTarget();
const seen = [];
window.addEventListener(ONBOARDING_DO_EVENT, e => seen.push(e.detail));

t('the event name App listens for', () => {
  assert.equal(ONBOARDING_DO_EVENT, 'vantage:onboarding-do');
});

t('each pick id goes out as { detail: { id } }, once', () => {
  for (const id of PICK_IDS) assert.equal(requestOnboardingDo(id), true, id);
  assert.deepEqual(seen, PICK_IDS.map(id => ({ id })));
});

t('nothing goes out without an id', () => {
  seen.length = 0;
  for (const bad of [undefined, null, '', 3, {}]) assert.equal(requestOnboardingDo(bad), false);
  assert.deepEqual(seen, []);
});

t('a throwing dispatch is swallowed', () => {
  const real = window.dispatchEvent;
  window.dispatchEvent = () => { throw new Error('boom'); };
  try { assert.equal(requestOnboardingDo('money'), false); } finally { window.dispatchEvent = real; }
});

delete globalThis.window;
console.log(`onboarding bus: ${n} tests passed`);

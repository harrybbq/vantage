/**
 * Consent rules. The properties that matter: only an explicit yes is
 * consent, a write for one kind never disturbs the other, and the patch
 * never reaches outside `consent`.
 */
import assert from 'node:assert/strict';
import { consentStatus, isGranted, consentPatch, shouldAskOnce } from './consent.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const T1 = '2026-09-30T10:00:00.000Z';
const T2 = '2026-10-02T09:00:00.000Z';

// ── Status ──
{
  eq(consentStatus(undefined, 'ai'), 'unasked', 'no consent object');
  eq(consentStatus({}, 'ai'), 'unasked', 'kind absent');
  eq(consentStatus({ ai: null }, 'ai'), 'declined', 'null is a no');
  eq(consentStatus({ ai: false }, 'ai'), 'declined', 'false is a no');
  eq(consentStatus({ ai: T1 }, 'ai'), 'granted', 'timestamp is a yes');
  eq(consentStatus({ ai: '' }, 'ai'), 'unasked', 'empty string is not consent');
  ok(!isGranted({ ai: true }, 'ai'), 'a bare true is not a recorded consent');
  ok(isGranted({ health: T1 }, 'health'), 'granted health');
  ok(!isGranted({ health: T1 }, 'ai'), 'health consent is not AI consent');
}

// ── Patch ──
{
  const a = consentPatch(undefined, { health: true, ai: false }, T1);
  eq(a, { health: T1, ai: null, askedAt: T1 }, 'first answer');

  const b = consentPatch(a, { ai: true }, T2);
  eq(b, { health: T1, ai: T2, askedAt: T1 }, 'granting AI leaves health and askedAt alone');

  const c = consentPatch(b, { health: true }, T2);
  eq(c.health, T1, 're-granting keeps the original time');

  const d = consentPatch(c, { health: false }, T2);
  eq(d, { health: null, ai: T2, askedAt: T1 }, 'withdrawal is null and touches nothing else');

  const e = consentPatch({ ai: T1, extra: 'kept' }, {}, T2);
  eq(e.extra, 'kept', 'unknown keys survive');
  eq(e.askedAt, T2, 'an answer with no choices still records the ask');

  const before = { health: T1 };
  consentPatch(before, { health: false }, T2);
  eq(before, { health: T1 }, 'the previous object is not mutated');
}

// ── When the one-time sheet shows ──
{
  ok(!shouldAskOnce({ tutorialCompleted: true }, false), 'never before the cloud copy is in');
  ok(!shouldAskOnce({ tutorialCompleted: false }, true), 'never on top of the tutorial');
  ok(shouldAskOnce({ tutorialCompleted: true }, true), 'existing user, never asked');
  ok(shouldAskOnce({ tutorialCompleted: true, consent: { ai: T1 } }, true), 'a consent object without askedAt still gets the one-time ask');
  ok(!shouldAskOnce({ tutorialCompleted: true, consent: { askedAt: T1 } }, true), 'answered once → never again');
  ok(!shouldAskOnce(null, true), 'no state');
}

console.log(`consent: ${n} checks passed`);

/**
 * The weekly free allowance: the week boundary, the decision, and the
 * fail-soft paths. No network — fetch is injected.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('./freeAllowance.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── The week is Monday–Sunday UTC ──
{
  eq(A.weekStartIso(new Date('2026-10-05T09:00:00Z')), '2026-10-05', 'Monday starts its own week');
  eq(A.weekStartIso(new Date('2026-10-11T23:59:00Z')), '2026-10-05', 'Sunday night is still that week');
  eq(A.weekStartIso(new Date('2026-10-12T00:00:00Z')), '2026-10-12', 'Monday 00:00 is a new week');
  eq(A.weekStartIso(new Date('2027-01-01T12:00:00Z')), '2026-12-28', 'crosses the year');
  eq(A.resetsOnIso(new Date('2026-10-08T12:00:00Z')), '2026-10-12', 'refills next Monday');
}

// ── Decision ──
{
  eq(A.decide({ paid: true, used: 99, limit: 3 }), { allowed: true, left: null, limit: null }, 'Pro is never limited');
  eq(A.decide({ paid: false, used: 0, limit: 3 }), { allowed: true, left: 3, limit: 3 }, 'fresh week');
  eq(A.decide({ paid: false, used: 2, limit: 3 }), { allowed: true, left: 1, limit: 3 }, 'one left');
  eq(A.decide({ paid: false, used: 3, limit: 3 }), { allowed: false, left: 0, limit: 3 }, 'used up');
  eq(A.decide({ paid: false, used: 7, limit: 3 }), { allowed: false, left: 0, limit: 3 }, 'never negative');
  eq(A.decide({ paid: false, used: null, limit: 3 }), { allowed: true, left: 3, limit: 3 }, 'unknown counts as none used');
  eq(A.FREE_WEEKLY['food-detect'], 3, 'three a week');
}

// ── Counting from ai_usage, and falling back ──
const now = new Date('2026-10-07T10:00:00Z');
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
{
  let asked = '';
  const ok = async url => { asked = url; return { ok: true, json: async () => [{ n: 1 }, { n: 1 }] }; };
  eq(await A.usedThisWeek('food-detect', 'u1', now, ok), { used: 2, source: 'db' }, 'sums the week');
  eq(asked.includes('day=gte.2026-10-05') && asked.includes('bucket=eq.food-detect') && asked.includes('select=n'), true, 'reads only this week, only n');

  A._resetLocal();
  const down = async () => { throw new Error('offline'); };
  eq(await A.usedThisWeek('food-detect', 'u1', now, down), { used: 0, source: 'local' }, 'unreachable → local counter');
  A.noteLocalUse('food-detect', 'u1', now); A.noteLocalUse('food-detect', 'u1', now);
  eq(await A.usedThisWeek('food-detect', 'u1', now, down), { used: 2, source: 'local' }, 'local counter counts');
  eq(await A.usedThisWeek('food-detect', 'u1', new Date('2026-10-13T10:00:00Z'), down), { used: 0, source: 'local' }, 'local counter resets weekly');
  const missing = async () => ({ ok: false, status: 404, json: async () => ({}) });
  eq((await A.usedThisWeek('food-detect', 'u2', now, missing)).source, 'local', 'missing table → local');
}

// ── Tier from profiles, failing to free ──
{
  const pro = async () => ({ ok: true, json: async () => [{ tier: 'pro' }] });
  const life = async () => ({ ok: true, json: async () => [{ tier: 'lifetime' }] });
  const free = async () => ({ ok: true, json: async () => [{ tier: 'free' }] });
  const err = async () => { throw new Error('x'); };
  eq(await A.isPaidUser('u1', pro), true, 'pro');
  eq(await A.isPaidUser('u1', life), true, 'lifetime');
  eq(await A.isPaidUser('u1', free), false, 'free');
  eq(await A.isPaidUser('u1', err), false, 'lookup failure → free');
  eq(await A.isPaidUser('', pro), false, 'no user → free');
}

console.log(`freeAllowance: ${n} checks passed`);

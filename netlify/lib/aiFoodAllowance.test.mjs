/**
 * ai-food-detect end to end with a stubbed network: free accounts get
 * three scans a week, then a 402 the app turns into the paywall; Pro is
 * not limited; a failed Anthropic call doesn't spend a free scan.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test';
process.env.ANTHROPIC_API_KEY = 'anthropic-test';
process.env.OWNER_EMAIL = 'owner@example.com';

// A tiny fake Supabase + Anthropic. `world` is what the stubs read.
const world = { tier: 'free', usage: 0, anthropicOk: true, anthropicCalls: 0, email: 'someone@example.com' };
global.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (b, status = 200) => ({ ok: status < 400, status, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.endsWith('/auth/v1/user')) return json({ id: 'user-1', email: world.email });
  if (u.includes('/rest/v1/profiles')) return json([{ tier: world.tier }]);
  if (u.includes('/rest/v1/ai_usage')) return json(world.usage ? [{ n: world.usage }] : []);
  if (u.includes('/rest/v1/rpc/ai_usage_bump')) { world.usage++; return json(world.usage <= 40); }
  if (u.startsWith('https://api.anthropic.com/')) {
    world.anthropicCalls++;
    if (!world.anthropicOk) return json({ error: 'overloaded' }, 529);
    return json({ content: [{ text: '{"food_name":"Apple","serving_g":150,"calories":52,"protein_g":0.3,"carbs_g":14,"fat_g":0.2}' }] });
  }
  throw new Error('unexpected fetch ' + u);
};

const { handler } = require('../functions/ai-food-detect.js');
const img = 'x'.repeat(200);
const post = () => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t', 'x-forwarded-for': '10.0.0.' + (n % 250) }, body: JSON.stringify({ imageBase64: img }) });
const get = () => handler({ httpMethod: 'GET', headers: { authorization: 'Bearer t' } });
const body = r => JSON.parse(r.body);

// ── Free: three a week ──
{
  let r = await get();
  eq([r.statusCode, body(r).paid, body(r).left, body(r).limit], [200, false, 3, 3], 'fresh free account sees 3 left');
  for (const left of [2, 1, 0]) {
    r = await post();
    eq([r.statusCode, body(r).food_name, body(r).freeScansLeft], [200, 'Apple', left], `scan → ${left} left`);
  }
  const calls = world.anthropicCalls;
  r = await post();
  eq([r.statusCode, body(r).error, body(r).left], [402, 'free_limit', 0], 'fourth scan → 402 free_limit');
  eq(world.anthropicCalls, calls, 'refused BEFORE calling Anthropic');
  eq(typeof body(r).resetsOn, 'string', 'says when it refills');
}

// ── A failed AI call doesn't spend a free scan ──
{
  world.usage = 1; world.anthropicOk = false;
  const r = await post();
  eq(r.statusCode, 502, 'upstream failure surfaces');
  eq(world.usage, 1, 'and is not counted');
  world.anthropicOk = true;
}

// ── Pro and the owner are not limited by the allowance ──
{
  world.tier = 'pro'; world.usage = 10;
  let r = await post();
  eq([r.statusCode, body(r).freeScansLeft], [200, null], 'Pro scans past three');
  r = await get();
  eq([body(r).paid, body(r).left], [true, null], 'Pro sees no allowance');
  world.tier = 'free'; world.email = 'owner@example.com'; world.usage = 10;
  r = await post();
  eq(r.statusCode, 200, 'owner is treated as paid');
  world.email = 'someone@example.com';
}

console.log(`aiFoodAllowance: ${n} checks passed`);

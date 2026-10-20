/**
 * Item 116: which RevenueCat sandbox events may change profiles.tier.
 * The pure rules (lib/reviewSandbox.js), then the real webhook handler
 * with fetch faked — no network, no real env: every SUPABASE_*,
 * REVENUECAT_*, APPLE_* and REVIEW_* variable is cleared first.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

for (const k of Object.keys(process.env)) {
  if (/^(SUPABASE_|VITE_SUPABASE_|REVENUECAT_|APPLE_|REVIEW_)/.test(k)) delete process.env[k];
}

const require = createRequire(import.meta.url);
const RS = require('./reviewSandbox.js');

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const NOW = Date.parse('2026-10-20T12:00:00Z');
const DAY = 86_400_000;

// ── Environment ──
eq(RS.isSandboxEnvironment('SANDBOX'), true, 'SANDBOX');
eq(RS.isSandboxEnvironment(' sandbox '), true, 'case/space-insensitive');
eq(RS.isSandboxEnvironment('PRODUCTION'), false, 'production');
eq(RS.isSandboxEnvironment(undefined), false, 'missing = production (as before)');

// ── Review window ──
eq(RS.reviewWindow('', NOW).state, 'unset', 'empty');
eq(RS.reviewWindow(undefined, NOW).state, 'unset', 'undefined');
eq(RS.reviewWindow('soon', NOW).state, 'invalid', 'garbage');
eq(RS.reviewWindow('2026-10-25T00:00:00Z', NOW).state, 'open', 'future, within cap');
eq(RS.reviewWindow('2026-10-19T00:00:00Z', NOW).state, 'closed', 'past');
eq(RS.reviewWindow('2026-10-20', NOW).state, 'open', 'bare date = end of that day UTC');
eq(RS.reviewWindow('2026-10-19', NOW).state, 'closed', 'bare date yesterday');
eq(RS.reviewWindow('2099-01-01', NOW).state, 'too_far', 'far future is not a permanent switch');
eq(RS.reviewWindow(new Date(NOW + 30 * DAY - 1000).toISOString(), NOW).state, 'open', 'just under the cap');
eq(RS.reviewWindow(new Date(NOW + 31 * DAY).toISOString(), NOW).state, 'too_far', 'over the cap');

// ── Global reason ──
eq(RS.globalSandboxReason({}, NOW), null, 'nothing set');
eq(RS.globalSandboxReason({ REVENUECAT_ALLOW_SANDBOX: 'true' }, NOW), 'legacy_override', 'legacy');
eq(RS.globalSandboxReason({ REVENUECAT_ALLOW_SANDBOX: 'TRUE' }, NOW), null, 'legacy is exact "true", as before');
eq(RS.globalSandboxReason({ REVENUECAT_ALLOW_SANDBOX: 'false' }, NOW), null, 'legacy false');
eq(RS.globalSandboxReason({ REVIEW_WINDOW_UNTIL: '2026-10-30' }, NOW), 'review_window', 'window open');
eq(RS.globalSandboxReason({ REVIEW_WINDOW_UNTIL: '2026-10-01' }, NOW), null, 'window closed');
eq(RS.globalSandboxReason({ REVIEW_WINDOW_UNTIL: '2099-01-01' }, NOW), null, 'window too far = closed');

// ── Decision ──
const d = (environment, env = {}, isReviewer = null) => RS.sandboxDecision({ environment, env, nowMs: NOW, isReviewer });
eq(d('PRODUCTION'), { honour: true, reason: 'production', needsReviewerLookup: false }, 'production always honoured, no lookup');
eq(d('PRODUCTION', {}, false).honour, true, 'production honoured whatever the list says');
eq(d('SANDBOX'), { honour: false, reason: 'pending_reviewer_lookup', needsReviewerLookup: true }, 'sandbox asks for the list');
eq(d('SANDBOX', {}, false), { honour: false, reason: 'sandbox_refused', needsReviewerLookup: false }, 'not a reviewer → refused');
eq(d('SANDBOX', {}, true), { honour: true, reason: 'reviewer', needsReviewerLookup: false }, 'reviewer → honoured');
eq(d('SANDBOX', { REVENUECAT_ALLOW_SANDBOX: 'true' }), { honour: true, reason: 'legacy_override', needsReviewerLookup: false }, 'legacy needs no lookup');
eq(d('SANDBOX', { REVIEW_WINDOW_UNTIL: '2026-10-30' }).reason, 'review_window', 'open window needs no lookup');
eq(d('SANDBOX', { REVIEW_WINDOW_UNTIL: '2026-10-01' }, true).reason, 'reviewer', 'closed window: reviewer still honoured (row has its own expiry)');
eq(d('SANDBOX', { REVIEW_WINDOW_UNTIL: '2026-10-01' }, false).honour, false, 'closed window, not a reviewer → refused');
eq(d('SANDBOX', { REVIEW_WINDOW_UNTIL: '2099-01-01' }, false).honour, false, 'too-far window refuses');

// ── Entitlement filter ──
const future = new Date(NOW + 10 * DAY).toISOString();
const past = new Date(NOW - DAY).toISOString();
const subscriber = {
  entitlements: {
    pro: { product_identifier: 'pro_monthly', expires_date: future },
    lifetime: { product_identifier: 'lifetime_once', expires_date: null },
    old: { product_identifier: 'pro_old', expires_date: past },
    mystery: { product_identifier: 'unknown_pid', expires_date: future },
  },
  subscriptions: {
    pro_monthly: { is_sandbox: true },
    pro_old: { is_sandbox: false },
  },
  non_subscriptions: { lifetime_once: [{ is_sandbox: false }] },
};
eq(RS.activeEntitlementIds(subscriber, NOW).sort(), ['lifetime', 'mystery'], 'sandbox + expired left out by default');
eq(RS.activeEntitlementIds(subscriber, NOW, { includeSandbox: true }).sort(), ['lifetime', 'mystery', 'pro'], 'sandbox counted when honoured');
eq(RS.activeEntitlementIds({ entitlements: { x: { product_identifier: 'p', expires_date: future } }, non_subscriptions: { p: [{ is_sandbox: false }, { is_sandbox: true }] } }, NOW), [], 'any sandbox one-off marks it sandbox');
eq(RS.activeEntitlementIds(null, NOW), [], 'no subscriber');
eq(RS.activeEntitlementIds({ entitlements: { x: { expires_date: 'nope' } } }, NOW), [], 'unparseable expiry = not active');

// ── The real handler, fetch faked ──
const calls = [];
let rpcAnswer = { status: 200, body: false };
let subscriberBody = null;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
  const u = String(url);
  if (u.includes('/rpc/reviewer_sandbox_allowed')) {
    return new Response(JSON.stringify(rpcAnswer.body), { status: rpcAnswer.status });
  }
  if (u.startsWith('https://api.revenuecat.com/')) {
    return new Response(JSON.stringify({ subscriber: subscriberBody }), { status: 200 });
  }
  if (u.includes('/rest/v1/profiles')) {
    return new Response(JSON.stringify([{ id: 'u' }]), { status: 200 });
  }
  return new Response('not faked', { status: 599 });
};

const handler = require('../functions/revenuecat-webhook.js').handler;
const AUTH = 'test-webhook-auth-value-0123456789abcdef';
function baseEnv() {
  for (const k of Object.keys(process.env)) {
    if (/^(SUPABASE_|VITE_SUPABASE_|REVENUECAT_|APPLE_|REVIEW_)/.test(k)) delete process.env[k];
  }
  process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
}
async function send(ev) {
  calls.length = 0;
  const res = await handler({ httpMethod: 'POST', headers: { authorization: AUTH }, body: JSON.stringify({ event: ev }) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
const purchase = (environment, extra = {}) => ({
  type: 'INITIAL_PURCHASE', environment, app_user_id: '00000000-0000-4000-8000-000000000001',
  entitlement_ids: ['pro'], event_timestamp_ms: NOW, ...extra,
});
const patched = () => calls.some(c => c.method === 'PATCH' && c.url.includes('/rest/v1/profiles'));
const rpcCalled = () => calls.some(c => c.url.includes('/rpc/reviewer_sandbox_allowed'));

baseEnv();
{
  const r = await send(purchase('PRODUCTION'));
  eq([r.status, r.body.action, patched(), rpcCalled()], [200, 'applied', true, false], 'production: applied, list never queried');
}
{
  rpcAnswer = { status: 200, body: false };
  const r = await send(purchase('SANDBOX'));
  eq([r.status, r.body.skipped, patched(), rpcCalled()], [200, 'sandbox', false, true], 'sandbox, not a reviewer: skipped after one lookup');
  const rpc = calls.find(c => c.url.includes('/rpc/reviewer_sandbox_allowed'));
  eq(JSON.parse(rpc.body), { p_user_id: '00000000-0000-4000-8000-000000000001' }, 'lookup by the event user id');
}
{
  rpcAnswer = { status: 200, body: true };
  const r = await send(purchase('SANDBOX'));
  eq([r.status, r.body.action, patched()], [200, 'applied', true], 'sandbox, reviewer: applied');
}
{
  rpcAnswer = { status: 404, body: { message: 'not found' } };
  const r = await send(purchase('SANDBOX'));
  eq([r.body.skipped, patched()], ['sandbox', false], 'SQL not run (404) → fails closed');
}
{
  rpcAnswer = { status: 500, body: 'boom' };
  const r = await send(purchase('SANDBOX'));
  eq([r.body.skipped, patched()], ['sandbox', false], 'RPC error → fails closed');
}
{
  rpcAnswer = { status: 200, body: true };
  const r = await send(purchase('SANDBOX', { app_user_id: '$RCAnonymousID:abc' }));
  eq([r.body.skipped, patched(), rpcCalled()], ['sandbox', false, false], 'anonymous sandbox: no lookup, skipped');
}
{
  // The real clock is used by the handler; make the window relative to it.
  process.env.REVIEW_WINDOW_UNTIL = new Date(Date.now() + 3 * DAY).toISOString();
  const r = await send(purchase('SANDBOX'));
  eq([r.body.action, patched(), rpcCalled()], ['applied', true, false], 'open window: applied with no lookup');
  process.env.REVIEW_WINDOW_UNTIL = new Date(Date.now() - DAY).toISOString();
  rpcAnswer = { status: 200, body: false };
  const r2 = await send(purchase('SANDBOX'));
  eq([r2.body.skipped, patched()], ['sandbox', false], 'expired window: refused again');
  delete process.env.REVIEW_WINDOW_UNTIL;
}
{
  process.env.REVENUECAT_ALLOW_SANDBOX = 'true';
  const r = await send(purchase('SANDBOX'));
  eq([r.body.action, rpcCalled()], ['applied', false], 'legacy override still works');
  delete process.env.REVENUECAT_ALLOW_SANDBOX;
}
{
  // With the secret key: a production event must not be decided by a
  // sandbox entitlement.
  process.env.REVENUECAT_SECRET_API_KEY = 'test-rc-key';
  subscriberBody = {
    entitlements: { pro: { product_identifier: 'pro_monthly', expires_date: new Date(Date.now() + DAY).toISOString() } },
    subscriptions: { pro_monthly: { is_sandbox: true } },
  };
  await send(purchase('PRODUCTION'));
  const p = calls.find(c => c.method === 'PATCH');
  eq(JSON.parse(p.body).tier, 'free', 'production event ignores a sandbox entitlement');
  rpcAnswer = { status: 200, body: true };
  await send(purchase('SANDBOX'));
  const p2 = calls.find(c => c.method === 'PATCH');
  eq(JSON.parse(p2.body).tier, 'pro', 'reviewer sandbox event counts it');
  delete process.env.REVENUECAT_SECRET_API_KEY;
}
{
  const r = await send({ type: 'TEST', environment: 'SANDBOX', app_user_id: '$RCAnonymousID:x' });
  eq(r.body.skipped, 'sandbox', 'RC test button in sandbox: acknowledged, as before');
}

console.log(`reviewSandbox: ${n} checks passed`);

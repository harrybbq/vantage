/**
 * Netlify serverless function: revenuecat-webhook
 *
 * Receives subscription lifecycle events from RevenueCat and syncs
 * entitlement state into Supabase `profiles.tier` so the server-side
 * tier source of truth stays accurate.
 *
 * Why this matters:
 *   useSubscription does a one-way client reconcile (RC can upgrade
 *   the in-memory tier on a single device). Without this webhook,
 *   `profiles.tier` only changes when a user opens the app on a
 *   device that has fresh CustomerInfo. Cross-device, post-renewal,
 *   or trial-conversion state would lag indefinitely.
 *
 * Setup (RC dashboard → Project → Integrations → Webhooks):
 *   - URL: https://<your-netlify-site>/.netlify/functions/revenuecat-webhook
 *   - Authorization header value: same string as REVENUECAT_WEBHOOK_AUTH
 *     env var on Netlify. RC sends this in the `Authorization` header
 *     of every event; we reject anything missing or mismatched.
 *
 * Required Netlify env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY     (NOT the anon key — needs to write profiles.tier)
 *   REVENUECAT_WEBHOOK_AUTH       (random string ≥ 32 chars; share with RC dashboard)
 *
 * Event types we handle:
 *   - INITIAL_PURCHASE / RENEWAL / UNCANCELLATION  → upgrade tier
 *   - PRODUCT_CHANGE                               → re-derive (yearly ↔ monthly)
 *   - CANCELLATION                                 → no tier change (active until expiration)
 *   - EXPIRATION                                   → demote to 'free'
 *   - BILLING_ISSUE                                → no tier change (RC's grace period handles it)
 *   - SUBSCRIBER_ALIAS                             → ignore (we identify by Supabase user id, no aliasing)
 *   - NON_RENEWING_PURCHASE                        → upgrade to 'lifetime' if entitlement matches
 *   - TRANSFER                                     → re-derive both donor and recipient
 *
 * The function is idempotent — replaying the same event yields the
 * same tier update. RC retries on 5xx, so non-2xx responses are
 * reserved for genuine failures.
 */

const { safeEqual } = require('../lib/cronAuth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Mirrors src/lib/billing/revenuecat.js → deriveTierFromEntitlements.
// Duplicated rather than imported because Netlify functions and Vite
// client live in separate module systems; the mapping is small enough
// that drift is easy to spot in code review.
const ENTITLEMENT_TIER_PRIORITY = [
  { keys: ['pro_lifetime', 'lifetime'], tier: 'lifetime' },
  { keys: ['pro', 'VisionBoard Pro'],   tier: 'pro' },
];

function deriveTier(entitlementIdsActive = []) {
  // RC webhooks send entitlement IDs in `event.entitlement_ids` for
  // INITIAL_PURCHASE / RENEWAL etc. Lifetime takes priority.
  const set = new Set(entitlementIdsActive);
  for (const { keys, tier } of ENTITLEMENT_TIER_PRIORITY) {
    if (keys.some(k => set.has(k))) return tier;
  }
  return null; // no recognized entitlement; caller decides what to do
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  // Auth: RC sends our shared secret as the Authorization header value.
  const provided = event.headers.authorization || event.headers.Authorization;
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'REVENUECAT_WEBHOOK_AUTH not configured on this Netlify site' }),
    };
  }
  // Constant-time: `!==` returns as soon as two bytes differ, so the
  // time it takes to reject leaks how much of the secret was right.
  // This one grants entitlements, so a guessed value is a free Pro (or
  // lifetime) upgrade for anyone who can hit the URL.
  if (!safeEqual(provided, expected)) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) };
  }

  const e = body.event;
  if (!e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'no event field' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'Supabase env vars missing' }),
    };
  }

  // RC's app_user_id is whatever we passed to Purchases.logIn() —
  // i.e. the Supabase user id (see useSubscription.js → loginRevenueCat).
  // If the user is anonymous (anon RC user prefixed with $RCAnonymousID),
  // we can't sync into profiles — log + 200 so RC stops retrying.
  const userId = e.app_user_id;
  if (!userId || userId.startsWith('$RCAnonymousID')) {
    console.log('Skipping anonymous user event:', e.type, userId);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: 'anonymous' }) };
  }

  const eventType = e.type;
  const activeIds = Array.isArray(e.entitlement_ids) ? e.entitlement_ids : [];

  let nextTier = null;
  switch (eventType) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'NON_RENEWING_PURCHASE':
      nextTier = deriveTier(activeIds) || 'pro';
      break;

    case 'EXPIRATION':
      // Subscription has fully expired (past grace period). Drop to free.
      nextTier = 'free';
      break;

    case 'CANCELLATION':
    case 'BILLING_ISSUE':
      // User cancelled but sub is still active until expiration date.
      // RC's grace period will retry billing. No demotion.
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'no_change' }) };

    case 'TRANSFER':
      // Subscription transferred between RC app users. RC fires
      // separate INITIAL_PURCHASE / EXPIRATION on the recipient and
      // donor respectively, so we don't need to act here.
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'transfer_acked' }) };

    case 'SUBSCRIBER_ALIAS':
      // We don't use RC aliases — we always log in with the Supabase
      // user id. Log + ack.
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'alias_ignored' }) };

    case 'TEST':
      // RC's "Send test webhook" button. Verify auth flow + ack.
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'test_received' }) };

    default:
      console.log('Unhandled RC event type:', eventType);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, action: 'unhandled', type: eventType }) };
  }

  // Patch profiles.tier.
  //
  // Lifetime is a GRANT, never a purchase (supabase/lifetime_grants.sql)
  // — so a grantee has no RevenueCat entitlement backing it. An
  // EXPIRATION for such an account (an old trial finally lapsing, a
  // TRANSFER's donor leg) would set tier='free' and silently revoke a
  // grant nobody meant to touch. The filter makes the demotion skip
  // lifetime rows in the same statement rather than reading first and
  // racing a concurrent event.
  //
  // Upgrades deliberately keep no such guard: those are legitimate.
  const guard = nextTier === 'free' ? '&tier=neq.lifetime' : '';
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}${guard}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      tier: nextTier,
      tier_updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('profiles.tier PATCH failed:', res.status, errText);
    // Return 500 so RC retries — transient Supabase failures shouldn't
    // silently lose a tier update.
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'profile update failed', detail: errText }),
    };
  }

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({ ok: true, user_id: userId, tier: nextTier, event: eventType }),
  };
};

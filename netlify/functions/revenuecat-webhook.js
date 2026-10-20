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
 * Optional (item 116): REVIEW_WINDOW_UNTIL (ISO date, ≤ 30 days ahead),
 *   REVENUECAT_ALLOW_SANDBOX (legacy), REVENUECAT_SECRET_API_KEY.
 *
 * Required Netlify env vars:
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY or legacy service-role key, via lib/sbKeys (NOT the anon key — needs to write profiles.tier)
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
 *
 * ── Hardening (2026-09-30, item 46) ─────────────────────────────────
 *   · SANDBOX events are acknowledged and ignored — a TestFlight
 *     purchase must not grant Pro on the production database — except
 *     for the narrow review routes in lib/reviewSandbox.js (item 116,
 *     2026-10-20): accounts on the owner's reviewer list, an open
 *     REVIEW_WINDOW_UNTIL, or the legacy REVENUECAT_ALLOW_SANDBOX=true.
 *   · A lifetime row is never overwritten, on ANY path: every PATCH
 *     carries tier=neq.lifetime (writing lifetime onto lifetime is a
 *     no-op anyway).
 *   · With REVENUECAT_SECRET_API_KEY set, the event is treated as a
 *     trigger only: the tier comes from GET /v1/subscribers/{id} —
 *     RevenueCat's current view — so a late or replayed event cannot
 *     re-grant or revoke anything. Fails soft to the event logic.
 *   · Without the key, events are ordered by their own timestamp:
 *     tier_updated_at is set to the event's event_timestamp_ms and the
 *     PATCH only applies when the stored stamp is older. A RENEWAL
 *     delivered after the EXPIRATION that followed it is ignored.
 *     No schema change — tier_updated_at already exists and nothing
 *     else in the app writes it.
 */

const sbKeys = require('../lib/sbKeys');
const { safeEqual } = require('../lib/cronAuth');
const { sandboxDecision, globalSandboxReason, activeEntitlementIds } = require('../lib/reviewSandbox');

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

/**
 * The subscriber's tier as RevenueCat sees it NOW, or null when the
 * secret key is unset or the call fails (caller falls back to the
 * event). An entitlement is active while its expires_date is null
 * (lifetime / non-expiring) or in the future.
 */
async function tierFromSubscriberApi(appUserId, { includeSandbox = false } = {}) {
  const rcKey = process.env.REVENUECAT_SECRET_API_KEY;
  if (!rcKey) return null;
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${rcKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.error('revenuecat-webhook: subscriber read failed', res.status);
      return null;
    }
    // Sandbox-backed entitlements count only when sandbox is honoured
    // for this account (lib/reviewSandbox.js) — the API reports both
    // environments, so a TestFlight purchase would otherwise decide the
    // tier on a production event.
    const subscriber = (await res.json())?.subscriber;
    const active = activeEntitlementIds(subscriber, Date.now(), { includeSandbox });
    return deriveTier(active) || 'free';
  } catch (e) {
    console.error('revenuecat-webhook: subscriber read unreachable', e?.message);
    return null;
  }
}

/**
 * Is this account on the owner's active reviewer list? One service-role
 * RPC (supabase/reviewer_access_2026_10.sql). Fails CLOSED: SQL not run
 * yet (404), any error, or no answer → false, i.e. the sandbox event is
 * skipped exactly as it was before item 116.
 */
async function isActiveReviewer(userId, supabaseUrl, serviceKey) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/reviewer_sandbox_allowed`, {
      method: 'POST',
      headers: sbKeys.serviceKeyHeaders(serviceKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_user_id: userId }),
    });
    if (!res.ok) {
      if (res.status !== 404) console.error('revenuecat-webhook: reviewer check failed', res.status);
      return false;
    }
    return (await res.json().catch(() => false)) === true;
  } catch (err) {
    console.error('revenuecat-webhook: reviewer check unreachable', err?.message);
    return false;
  }
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
      body: JSON.stringify({ error: 'not configured' }),
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

  // RC's app_user_id is whatever we passed to Purchases.logIn() —
  // i.e. the Supabase user id (see useSubscription.js → loginRevenueCat).
  // If the user is anonymous (anon RC user prefixed with $RCAnonymousID),
  // we can't sync into profiles — log + 200 so RC stops retrying.
  const userId = typeof e.app_user_id === 'string' ? e.app_user_id : '';
  const anonymous = !userId || userId.startsWith('$RCAnonymousID');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = sbKeys.serviceKey(process.env);

  // Sandbox purchases are free; they reach production tiers only by the
  // narrow review routes (lib/reviewSandbox.js, item 116). The reviewer
  // list is looked up for SANDBOX events only, and only when no global
  // route already decided.
  const nowMs = Date.now();
  let sandbox = sandboxDecision({ environment: e.environment, env: process.env, nowMs });
  if (sandbox.needsReviewerLookup) {
    const isReviewer = !anonymous && supabaseUrl && serviceKey
      ? await isActiveReviewer(userId, supabaseUrl, serviceKey)
      : false;
    sandbox = sandboxDecision({ environment: e.environment, env: process.env, nowMs, isReviewer });
  }
  if (!sandbox.honour) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, skipped: 'sandbox' }) };
  }
  if (sandbox.reason === 'legacy_override') {
    console.warn('revenuecat-webhook: sandbox event honoured by REVENUECAT_ALLOW_SANDBOX=true — prefer the reviewer list or REVIEW_WINDOW_UNTIL (item 116)');
  } else if (sandbox.reason !== 'production') {
    console.log('revenuecat-webhook: sandbox event honoured', sandbox.reason, e.type);
  }

  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'not configured' }),
    };
  }

  if (anonymous) {
    console.log('Skipping anonymous user event:', e.type);
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

  // With the secret key, RevenueCat's CURRENT view of the subscriber
  // decides — the event only tells us to look. Null = could not ask.
  // Sandbox entitlements count when this event was honoured as sandbox,
  // or when sandbox is open for everyone; never for a plain production
  // event otherwise.
  const includeSandbox = sandbox.reason !== 'production' || !!globalSandboxReason(process.env, nowMs);
  const fromApi = await tierFromSubscriberApi(userId, { includeSandbox });
  if (fromApi) nextTier = fromApi;

  // Patch profiles.tier.
  //
  // Lifetime is a GRANT, never a purchase (supabase/lifetime_grants.sql)
  // — so a grantee has no RevenueCat entitlement backing it. Any write
  // here (an EXPIRATION from an old trial, a TRANSFER's donor leg, a
  // Pro renewal) would silently replace a grant nobody meant to touch.
  // The filter skips lifetime rows in the same statement rather than
  // reading first and racing a concurrent event.
  const filters = ['tier=neq.lifetime'];
  let stamp = new Date().toISOString();
  if (!fromApi) {
    // Event-ordered: apply only if nothing newer has been applied.
    const ts = Number(e.event_timestamp_ms);
    if (Number.isFinite(ts) && ts > 0) {
      stamp = new Date(ts).toISOString();
      // Quoted (%22): the timestamp holds PostgREST-reserved . and : characters.
      filters.push(`or=(tier_updated_at.is.null,tier_updated_at.lt.%22${stamp}%22)`);
    }
  }
  const url = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&${filters.join('&')}&select=id`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: sbKeys.serviceKeyHeaders(serviceKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify({
      tier: nextTier,
      tier_updated_at: stamp,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('profiles.tier PATCH failed:', res.status, errText.slice(0, 300));
    // Return 500 so RC retries — transient Supabase failures shouldn't
    // silently lose a tier update.
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'profile update failed' }) };
  }
  const applied = ((await res.json().catch(() => [])) || []).length > 0;

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({
      ok: true, event: eventType,
      // Not applied = lifetime row, no profile, or an older event.
      action: applied ? 'applied' : 'ignored',
      source: fromApi ? 'subscriber_api' : 'event',
    }),
  };
};

/**
 * Which RevenueCat SANDBOX events may change profiles.tier
 * (STARTUP_REQUIREMENTS item 116, store pack gap P2).
 *
 * Sandbox purchases are free. They come from TestFlight, dev builds and
 * App Review — never from a paying customer — so by default a sandbox
 * event must not grant Pro on the production database (item 46). That
 * default broke App Review: a reviewer who buys Pro with Apple's sandbox
 * account got a "Welcome to Pro" toast and then a 403 from the coach,
 * because the server-side tier never moved.
 *
 * The old fix was a global switch (REVENUECAT_ALLOW_SANDBOX=true) that
 * had to be remembered and turned off again. It is replaced by two
 * narrower routes, and kept only as a legacy override:
 *
 *   1. REVIEWER LIST (the normal route). Accounts on the owner-managed
 *      list in `public.reviewer_access` (supabase/reviewer_access_2026_10.sql)
 *      have their sandbox events honoured until that row's own expiry.
 *      These are the demo accounts whose credentials go in the App Store
 *      Connect / Play Console review notes, so they are exactly the
 *      accounts a reviewer buys on. The list lives in the database, not
 *      in env, because it names accounts — and env vars are visible to
 *      everyone with Netlify access while this table is visible to nobody
 *      but the service role.
 *
 *   2. REVIEW WINDOW (the safety net). REVIEW_WINDOW_UNTIL=<ISO date>
 *      honours sandbox events for ANY account until that moment. It
 *      exists because Apple reviewers often try Sign in with Apple with
 *      their own Apple ID — a brand-new account that is on no list — and
 *      may buy from there. It closes ITSELF: once the date passes,
 *      sandbox is refused again with no redeploy and nothing to
 *      remember. A date more than MAX_WINDOW_DAYS ahead is treated as a
 *      mistake (e.g. "2099-01-01" would be the old global switch in
 *      disguise) and the window counts as closed.
 *
 *   3. REVENUECAT_ALLOW_SANDBOX=true still honours everything, with no
 *      expiry, for backward compatibility. It logs a warning every time
 *      it is the reason, so it does not sit on unnoticed.
 *
 * Exposure while a route is open: a sandbox subscription renews on an
 * accelerated clock and stops after a handful of renewals, ending in an
 * EXPIRATION that demotes the account again. Lifetime rows are never
 * written by the webhook at all, so the demo account that holds Pro by
 * grant cannot be demoted by a reviewer's sandbox expiry.
 *
 * Only a SANDBOX event costs a database lookup (the reviewer check), and
 * only when routes 2 and 3 have not already decided — production events
 * never touch the list.
 *
 * Pure: no network, no clock, no process.env reads — callers pass them.
 */

const MAX_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function isSandboxEnvironment(environment) {
  return String(environment || '').trim().toUpperCase() === 'SANDBOX';
}

/**
 * State of REVIEW_WINDOW_UNTIL at `nowMs`.
 *   { state: 'unset' }                     — not configured
 *   { state: 'invalid' }                   — not a date
 *   { state: 'too_far', untilMs }          — more than MAX_WINDOW_DAYS ahead
 *   { state: 'open',   untilMs }           — now < until
 *   { state: 'closed', untilMs }           — passed
 */
function reviewWindow(value, nowMs) {
  const raw = String(value ?? '').trim();
  if (!raw) return { state: 'unset' };
  // A bare date (2026-11-15) means the END of that day in UTC: "until the
  // 15th" should still be open on the 15th.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
  const untilMs = Date.parse(iso);
  if (!Number.isFinite(untilMs)) return { state: 'invalid' };
  if (untilMs - nowMs > MAX_WINDOW_DAYS * DAY_MS) return { state: 'too_far', untilMs };
  return { state: nowMs < untilMs ? 'open' : 'closed', untilMs };
}

/**
 * Sandbox is honoured for everyone right now (legacy override or an open
 * review window)? → reason string, or null. No database needed.
 */
function globalSandboxReason(env = {}, nowMs) {
  if (String(env.REVENUECAT_ALLOW_SANDBOX || '').trim() === 'true') return 'legacy_override';
  if (reviewWindow(env.REVIEW_WINDOW_UNTIL, nowMs).state === 'open') return 'review_window';
  return null;
}

/**
 * The decision for one event.
 *   environment — event.environment ('SANDBOX' | 'PRODUCTION' | …)
 *   env         — the function's environment variables
 *   nowMs       — the clock
 *   isReviewer  — is the event's account on the active reviewer list?
 *                 (true / false / null = not looked up)
 * → { honour: boolean, reason, needsReviewerLookup }
 *
 * needsReviewerLookup is true when the answer depends on the reviewer
 * list and the caller has not supplied it yet — the caller looks it up
 * and asks again. That keeps the lookup off every other path.
 */
function sandboxDecision({ environment, env = {}, nowMs, isReviewer = null }) {
  if (!isSandboxEnvironment(environment)) {
    return { honour: true, reason: 'production', needsReviewerLookup: false };
  }
  const global = globalSandboxReason(env, nowMs);
  if (global) return { honour: true, reason: global, needsReviewerLookup: false };
  if (isReviewer === null || isReviewer === undefined) {
    return { honour: false, reason: 'pending_reviewer_lookup', needsReviewerLookup: true };
  }
  if (isReviewer === true) return { honour: true, reason: 'reviewer', needsReviewerLookup: false };
  return { honour: false, reason: 'sandbox_refused', needsReviewerLookup: false };
}

/**
 * The active entitlement ids in a RevenueCat v1 subscriber object, with
 * sandbox-backed ones left out unless `includeSandbox`.
 *
 * Without this filter, once REVENUECAT_SECRET_API_KEY is set, a
 * TestFlight tester's sandbox entitlement would decide the tier on a
 * PRODUCTION event — the subscriber API reports both environments. An
 * entitlement is sandbox when the product backing it is: the entry in
 * `subscriptions[product]` (subscriptions) or any entry in
 * `non_subscriptions[product]` (one-off purchases) has is_sandbox true.
 * Unknown provenance counts as production, the conservative reading for
 * an entitlement RevenueCat says is active.
 *
 * Active = expires_date null (non-expiring) or in the future.
 */
function activeEntitlementIds(subscriber, nowMs, { includeSandbox = false } = {}) {
  const ents = subscriber?.entitlements || {};
  const subs = subscriber?.subscriptions || {};
  const nonSubs = subscriber?.non_subscriptions || {};
  const out = [];
  for (const [id, v] of Object.entries(ents)) {
    if (!v) continue;
    const exp = v.expires_date == null ? null : Date.parse(v.expires_date);
    if (exp != null && !(Number.isFinite(exp) && exp > nowMs)) continue;
    if (!includeSandbox) {
      const pid = v.product_identifier;
      const sub = pid ? subs[pid] : null;
      const nons = pid && Array.isArray(nonSubs[pid]) ? nonSubs[pid] : [];
      const sandbox = (sub && sub.is_sandbox === true) || nons.some(n => n && n.is_sandbox === true);
      if (sandbox) continue;
    }
    out.push(id);
  }
  return out;
}

module.exports = {
  MAX_WINDOW_DAYS,
  isSandboxEnvironment,
  reviewWindow,
  globalSandboxReason,
  sandboxDecision,
  activeEntitlementIds,
};

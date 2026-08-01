/**
 * Authorisation for functions that are meant to be run by the SCHEDULER,
 * not by whoever finds the URL.
 *
 * Four functions here hold the service-role key and act on every user —
 * push-dispatch, snapshot-ratings, whoop-cron, oura-cron — and three of
 * them had no caller check at all. push-dispatch had one, but it read:
 *
 *   const isScheduled = !event.httpMethod || event.httpMethod === 'GET';
 *
 * so a plain GET was classified as a scheduled run and skipped the
 * secret entirely. The shared secret only ever guarded POST, which is
 * the one method an attacker has no reason to use.
 *
 * What actually distinguishes a scheduled run: Netlify invokes these
 * internally, so `event.httpMethod` is absent — a shape no HTTP client
 * can produce — and documents a `next_run` field in the body. Either
 * signal is accepted, so this keeps working whichever shape the
 * platform sends. Anything else is an ordinary web request and needs
 * the secret.
 *
 * Netlify does not currently route public HTTP to scheduled functions,
 * which is why this is defence in depth rather than an emergency. It
 * stops that being the only thing standing between the open internet
 * and a service-role loop over every account.
 */

const { timingSafeEqual } = require('crypto');

/** Constant-time compare that tolerates unequal lengths. */
function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''));
  const B = Buffer.from(String(b ?? ''));
  if (A.length !== B.length) return false;
  try { return timingSafeEqual(A, B); } catch { return false; }
}

/** True when this looks like the platform's own invocation. */
function isSchedulerInvocation(event) {
  if (!event || !event.httpMethod) return true;
  try {
    if (JSON.parse(event.body || '{}')?.next_run) return true;
  } catch { /* not JSON — an ordinary request */ }
  return false;
}

/**
 * → null when the caller may proceed, or a ready-to-return 401.
 *
 * `secretEnv` names the env var holding the manual-trigger secret. When
 * it isn't set, manual triggering is simply unavailable — refusing is
 * the safe default for an endpoint that writes as the service role.
 */
function requireScheduler(event, CORS, secretEnv = 'CRON_SECRET') {
  if (isSchedulerInvocation(event)) return null;

  const expected = process.env[secretEnv];
  const h = event.headers || {};
  const provided = h['x-cron-secret'] || h['X-Cron-Secret']
    || h['x-dispatch-secret'] || h['X-Dispatch-Secret'];

  if (expected && provided && safeEqual(provided, expected)) return null;

  // Logged so a genuine scheduled run that got rejected is visible in
  // the function log rather than failing silently forever.
  console.warn(`[cronAuth] rejected ${event.httpMethod} invocation; ` +
    `${expected ? 'secret missing or wrong' : `${secretEnv} not configured`}`);

  return {
    statusCode: 401,
    headers: CORS,
    body: JSON.stringify({ error: 'unauthorized' }),
  };
}

module.exports = { requireScheduler, isSchedulerInvocation, safeEqual };

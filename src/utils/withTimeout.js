/**
 * withTimeout — race a promise against a timeout.
 *
 * Supabase/GoTrue calls have no client-side timeout, so when the
 * backend is unhealthy (DB restarting, overloaded) a request can hang
 * ~20-60s before the browser gives up with an opaque "Load failed".
 * Wrapping the call bounds that wait so the UI can surface a clear,
 * retryable message instead of spinning.
 *
 * Rejects with an Error tagged `.isTimeout = true` when the deadline
 * passes; otherwise resolves/rejects with the underlying promise.
 */
export function withTimeout(promise, ms = 15000, label = 'Request timed out') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(label);
      e.isTimeout = true;
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Map a raw auth/network error to a short, human message. Genuine auth
 * errors (wrong password, etc.) pass through unchanged; only the opaque
 * network/timeout failures get rewritten so the user knows to retry
 * rather than thinking their details were wrong.
 */
export function friendlyAuthError(err) {
  const m = (err && err.message) || '';
  if (err?.isTimeout || /load failed|failed to fetch|networkerror|network error|timeout|timed out|deadline/i.test(m)) {
    return 'Our servers are briefly unreachable — please wait a moment and try again.';
  }
  return m || 'Something went wrong.';
}

/**
 * opsMark — write a restore marker into public.ops_log from a function
 * (STARTUP_REQUIREMENTS items 27/82, docs/RESTORE_RUNBOOK.md "Restore
 * markers"). It calls public.ops_mark(kind, label, details) over
 * PostgREST with the service key (supabase/recovery_2026_10b.sql grants
 * that function to service_role only).
 *
 * A mark is a breadcrumb for choosing a point-in-time restore target
 * ("restore to just before the image migration's phase 3 started"), so
 * it must NEVER break the work it records:
 *   · never throws — every failure (no URL/key, SQL not applied yet,
 *     network error, timeout, non-2xx) resolves to null;
 *   · short timeout (default 2.5 s);
 *   · logs one line on failure, without the key, URL or response body.
 *
 * Usage:
 *   const { opsMark } = require('../lib/opsMark');
 *   await opsMark('migration', 'state-size phase 3 — start', { batch: 12 });
 *   // → '2026-10-20T21:04:05.123456+00:00'  or null
 *
 * Where to call it (not wired in yet — those functions belong to other
 * work; add a call when you next touch them):
 *   · each phase of the state-size migration (docs/STATE_SIZE_PLAN.md):
 *     '<phase> — start' before the first write, '<phase> — done' after;
 *   · the retention job (item 96) once per run, with row counts;
 *   · any bulk operation that writes many users' rows (backfills,
 *     cleanups, re-scoring), before it starts.
 * Never put a raw user id, email or any user content in `label` or
 * `details` — ops_log outlives account deletion. Counts, phase names and
 * batch numbers only.
 */
const sbKeys = require('./sbKeys');

const MAX_KIND = 40;
const MAX_LABEL = 300;

/** Build the request (exported for the test). Returns null when unconfigured. */
function buildRequest(kind, label, details, env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  if (!url || !sbKeys.serviceKey(env)) return null;
  const body = {
    kind: String(kind || 'note').slice(0, MAX_KIND),
    label: String(label || '(no label)').slice(0, MAX_LABEL),
    details: details && typeof details === 'object' && !Array.isArray(details) ? details : {},
  };
  return {
    url: `${url.replace(/\/+$/, '')}/rest/v1/rpc/ops_mark`,
    init: {
      method: 'POST',
      headers: sbKeys.serviceHeaders(env, { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(body),
    },
  };
}

/**
 * Write one mark. Resolves to the mark's timestamp (string) or null.
 * opts: { env, fetchImpl, timeoutMs, actor }
 */
async function opsMark(kind, label, details = {}, opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 2500;
  try {
    const d = details && typeof details === 'object' && !Array.isArray(details) ? { ...details } : {};
    if (opts.actor && !d.actor) d.actor = String(opts.actor).slice(0, 80);
    const req = buildRequest(kind, label, d, env);
    if (!req || typeof fetchImpl !== 'function') return null;

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(req.url, ctrl ? { ...req.init, signal: ctrl.signal } : req.init);
      if (!res || !res.ok) {
        // 404 = recovery_2026_10b.sql not run yet. Expected until it is.
        console.warn(`opsMark: not recorded (${res ? res.status : 'no response'})`);
        return null;
      }
      const at = await res.json().catch(() => null);
      return typeof at === 'string' ? at : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    console.warn(`opsMark: not recorded (${e && e.name === 'AbortError' ? 'timeout' : 'error'})`);
    return null;
  }
}

module.exports = { opsMark, buildRequest };

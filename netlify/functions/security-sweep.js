/**
 * Netlify scheduled function: security-sweep — hourly (netlify.toml).
 *
 * Takes the readings the Security console shows, and raises a ticket in
 * public.security_tickets for every condition that needs the owner:
 * database unreachable or slow, disk or connections past 80 %, Security
 * advisor ERRORs, a client-error spike, reports left open over a day, a
 * failed production deploy, slow real-user LCP, and accounts hitting an
 * AI cap day after day. The rules are lib/sweepRules.js; the gathering
 * is lib/securitySweep.js (shared with the console's "Run sweep now").
 *
 * A repeating condition bumps its ticket's count instead of opening a
 * new one; a resolved ticket re-opens if the condition returns.
 *
 * A ticket at or above ALERT_MIN_SEVERITY (default critical) that is NEW
 * or RE-OPENED pings the owner's phone (lib/alertNotify.js — ntfy and/or
 * a webhook, ≤ 6 per run); a repeat does not. Database unreachable pings
 * even though its ticket cannot be stored, once per run. A failed ping is
 * logged and never fails the sweep. The sweep is hourly: an external
 * uptime monitor on /.netlify/functions/health is what catches "the
 * whole site is down" faster than that.
 *
 * Writes ONLY to security_tickets, through security_ticket_raise. Reads
 * nothing from any user's state. Until supabase/security_console_2026_10.sql
 * is run, the RPC is missing and the sweep reports ticketsInstalled:false.
 *
 * Guarded like the other crons (lib/cronAuth.js): the platform's own
 * invocation, or X-Cron-Secret = CRON_SECRET for a manual run.
 */
const { requireScheduler } = require('../lib/cronAuth');
const { supabaseEnv } = require('../lib/securityData');
const { runSweep } = require('../lib/securitySweep');

const CORS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

exports.handler = async (event) => {
  const denied = requireScheduler(event, CORS, 'CRON_SECRET');
  if (denied) return denied;

  const env = supabaseEnv();
  if (!env.supabaseUrl || !env.serviceKey) {
    console.warn('security-sweep: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'not configured' }) };
  }

  const r = await runSweep(env);
  console.info(`security-sweep: ${r.ok ? 'ok' : 'failed'}; raised ${r.raised?.length ?? 0}; skipped ${r.skipped?.length ?? 0}` +
    (r.ticketsInstalled === false ? '; tickets table not installed' : '') +
    (r.alerts && r.alerts.queued ? `; alerts ${r.alerts.sent}/${r.alerts.queued} sent` : ''));
  // The body is for a manual run's caller; a scheduled run ignores it.
  return {
    statusCode: r.ok ? 200 : 503,
    headers: CORS,
    body: JSON.stringify({ ok: r.ok, raised: r.raised?.length ?? 0, skipped: r.skipped?.length ?? 0 }),
  };
};

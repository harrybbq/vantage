/**
 * One sweep: gather the readings, evaluate the rules (sweepRules.js),
 * raise / bump / re-open a ticket per condition.
 *
 * Run hourly by functions/security-sweep.js and on demand from the
 * Security console (POST { action: 'sweep.run' }). Scheduled functions
 * have a hard 30 s limit, so the readings are taken IN PARALLEL (every
 * outbound call has its own ≤ 8 s timeout) and ticket writes stop at a
 * deadline; anything not written is reported as `deferred` and the next
 * hourly run picks it up.
 *
 * Load on the database per sweep, all small: one tiny ping, the cached
 * owner_db_stats() call, three HEAD counts on indexed columns, one
 * bounded web_vitals read (the last day, LCP only, ≤5000 rows), one
 * bounded ai_usage read, the accepted-findings list, and one RPC per
 * condition actually raised. Every reading that cannot be taken is
 * listed under `skipped` and raises nothing.
 */
const D = require('./securityData');
const { evaluateConditions, repeatCapHits, THRESHOLDS } = require('./sweepRules');
const { percentile } = require('./securityShape');
const { DAILY_CAPS } = require('./aiQuota');

const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
const enc = encodeURIComponent;
// Readings take ≤ ~17 s worst case (4 s ping, then the slowest parallel
// task: a 5 s Management API scrape falling back to an 8 s one); each
// ticket write is ≤ 5 s. Stopping new writes at 20 s keeps a run under
// the 30 s scheduled-function limit.
const DEFAULT_BUDGET_MS = 20_000;

async function gather(env) {
  const r = {};
  const skipped = [];

  // DB reachable / fast — first, because everything else in Postgres
  // is pointless if it is not.
  r.db = await D.pingDb(env);
  const up = r.db.reachable;

  const tasks = [
    // Disk + connections
    (async () => {
      if (!up) { skipped.push({ check: 'disk', reason: 'db unreachable' }, { check: 'connections', reason: 'db unreachable' }); return; }
      const h = await D.databaseHealth(env);
      if (h.health.diskUsedPct != null) r.diskUsedPct = h.health.diskUsedPct;
      else skipped.push({ check: 'disk', reason: h.metrics.reason || 'unavailable' });
      const c = h.health.connections;
      if (c.total != null && c.max != null) r.connections = { used: c.total, max: c.max };
      else skipped.push({ check: 'connections', reason: 'unavailable' });
    })(),

    // Security advisor ERRORs not accepted by the owner (needs SUPABASE_ACCESS_TOKEN)
    (async () => {
      const adv = await D.advisorsWithAcceptance(env);
      if (adv.ok) r.advisorErrors = adv.security.filter(l => l.level === 'ERROR' && !l.accepted);
      else skipped.push({ check: 'advisors', reason: adv.reason });
    })(),

    // Client error spike: last hour vs the 24 h before it
    (async () => {
      if (!up) return;
      const [lastHour, prev24h] = await Promise.all([
        D.countRows(env, `client_errors?occurred_at=gte.${enc(iso(3600_000))}`),
        D.countRows(env, `client_errors?occurred_at=gte.${enc(iso(25 * 3600_000))}&occurred_at=lt.${enc(iso(3600_000))}`),
      ]);
      if (lastHour != null && prev24h != null) r.errors = { lastHour, prev24h };
      else skipped.push({ check: 'client_errors', reason: 'not_configured' });
    })(),

    // Reports open longer than a day
    (async () => {
      if (!up) return;
      const staleCut = iso(THRESHOLDS.staleReportHours * 3600_000);
      const [stale, oldest] = await Promise.all([
        D.countRows(env, `reports?status=eq.open&created_at=lt.${enc(staleCut)}`),
        D.rest(env, 'reports?status=eq.open&select=created_at&order=created_at.asc&limit=1')
          .then(res => (res.ok ? res.json() : [])).catch(() => []),
      ]);
      if (stale != null) r.staleReports = { count: stale, oldestAt: oldest?.[0]?.created_at || null };
      else skipped.push({ check: 'reports', reason: 'not_configured' });
    })(),

    // LCP p75 over the last day
    (async () => {
      if (!up) return;
      try {
        const v = await D.readVitalsRows(env, iso(86400_000), 'lcp');
        if (v.ok) {
          const lcps = v.rows.map(x => Number(x.lcp)).filter(Number.isFinite);
          r.vitals = { lcpP75: percentile(lcps, 0.75), samples: lcps.length };
        } else {
          skipped.push({ check: 'web_vitals', reason: v.reason });
        }
      } catch {
        skipped.push({ check: 'web_vitals', reason: 'unavailable' });
      }
    })(),

    // AI caps hit on several of the last three days
    (async () => {
      if (!up) return;
      try {
        const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
        const minCap = Math.min(...Object.values(DAILY_CAPS));
        const res = await D.rest(env,
          `ai_usage?day=gte.${since}&n=gte.${minCap}&select=user_id,bucket,day,n&limit=1000`);
        if (res.ok) r.aiCaps = repeatCapHits(await res.json(), DAILY_CAPS);
        else skipped.push({ check: 'ai_usage', reason: D.missing(res) ? 'not_configured' : 'unavailable' });
      } catch {
        skipped.push({ check: 'ai_usage', reason: 'unavailable' });
      }
    })(),

    // Latest production deploy (needs NETLIFY_AUTH_TOKEN)
    (async () => {
      const dep = await D.latestProductionDeploy();
      if (dep.ok) r.latestDeploy = dep.deploy;
      else skipped.push({ check: 'deploy', reason: dep.reason });
    })(),
  ];
  if (!up) skipped.push({ check: 'postgres readings', reason: 'db unreachable' });

  // Each task catches its own failures; allSettled is the backstop.
  const settled = await Promise.allSettled(tasks);
  settled.forEach((s, i) => { if (s.status === 'rejected') skipped.push({ check: `task ${i}`, reason: 'unavailable' }); });
  return { readings: r, skipped };
}

/**
 * → { ok, raised:[{fingerprint, severity, title, result}], deferred, skipped, ticketsInstalled }
 * Never throws.
 */
async function runSweep(env, { budgetMs = DEFAULT_BUDGET_MS } = {}) {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  try {
    const { readings, skipped } = await gather(env);
    const candidates = evaluateConditions(readings);
    const raised = [];
    const deferred = [];
    let ticketsInstalled = true;
    // Most severe first (evaluateConditions sorts), so a deadline drops
    // the least important writes.
    for (const c of candidates) {
      if (Date.now() - t0 > budgetMs) { deferred.push(c.fingerprint); continue; }
      const result = ticketsInstalled ? await D.raiseTicket(env, c) : 'missing';
      if (result === 'missing') ticketsInstalled = false;
      raised.push({ fingerprint: c.fingerprint, severity: c.severity, title: c.title, result });
    }
    return {
      ok: true, startedAt, finishedAt: new Date().toISOString(), tookMs: Date.now() - t0,
      raised, deferred, skipped, ticketsInstalled,
    };
  } catch (e) {
    console.error('security sweep:', e?.message);
    return { ok: false, startedAt, reason: 'unavailable' };
  }
}

module.exports = { runSweep, gather };

/**
 * The auto-raise rules: readings in, ticket candidates out.
 * Pure: no fetch, no env. Tested by sweepRules.test.mjs
 * (npm run check:secsweep). The IO half is lib/securitySweep.js.
 *
 * A candidate is { fingerprint, kind, severity, title, detail }. The
 * fingerprint is the ticket's identity: the same condition on the next
 * sweep bumps that ticket's count and last_seen_at instead of opening a
 * second one, and a resolved ticket re-opens when its condition comes
 * back (security_ticket_raise in supabase/security_console_2026_10.sql).
 * So a fingerprint names the CONDITION, never the time — anything that
 * changes hour to hour (a count, a timestamp) goes in `detail`.
 *
 * A reading that is null/undefined means "could not check" and raises
 * nothing: a sweep that cannot see a thing must not report it as broken.
 */

const THRESHOLDS = {
  dbSlowMs: 1500,
  diskPct: 80,
  diskCriticalPct: 90,
  connPct: 80,
  errorSpikeFactor: 3,
  errorSpikeMin: 10,
  staleReportHours: 24,
  lcpPoorMs: 4000,
  lcpMinSamples: 20,
  aiCapDays: 2,          // hit the cap on at least this many of the window's days
};

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** Stable, short, safe identity: `kind:part:part`, lowercased. */
function fingerprint(kind, ...parts) {
  return [kind, ...parts]
    .map(p => String(p ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join(':')
    .slice(0, 200);
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object} r  readings, every field optional:
 *   db            { reachable:boolean, ms:number }
 *   diskUsedPct   number
 *   connections   { used:number, max:number }
 *   advisorErrors [{ name, title }]                   (Security advisor ERRORs)
 *   errors        { lastHour:number, prev24h:number }  (client_errors)
 *   staleReports  { count:number, oldestAt:string }
 *   latestDeploy  { id, state, title, errorMessage, branch, createdAt }
 *   vitals        { lcpP75:number, samples:number }
 *   aiCaps        [{ userId, bucket, days:number, cap:number }]
 * @returns candidates, most severe first
 */
function evaluateConditions(r = {}, t = THRESHOLDS) {
  const out = [];

  if (r.db && r.db.reachable === false) {
    out.push({
      fingerprint: fingerprint('db', 'unreachable'),
      kind: 'db_unreachable',
      severity: 'critical',
      title: 'Database unreachable',
      detail: { message: 'The REST endpoint did not answer the health ping.' },
    });
  } else if (r.db && isNum(r.db.ms) && r.db.ms > t.dbSlowMs) {
    out.push({
      fingerprint: fingerprint('db', 'slow'),
      kind: 'db_slow',
      severity: 'high',
      title: `Database slow: health ping took ${Math.round(r.db.ms)} ms`,
      detail: { ms: Math.round(r.db.ms), thresholdMs: t.dbSlowMs },
    });
  }

  if (isNum(r.diskUsedPct) && r.diskUsedPct > t.diskPct) {
    out.push({
      fingerprint: fingerprint('db', 'disk'),
      kind: 'db_disk',
      severity: r.diskUsedPct > t.diskCriticalPct ? 'critical' : 'high',
      title: `Database disk ${Math.round(r.diskUsedPct)}% full`,
      detail: { usedPct: r.diskUsedPct, thresholdPct: t.diskPct },
    });
  }

  const c = r.connections;
  if (c && isNum(c.used) && isNum(c.max) && c.max > 0 && (100 * c.used) / c.max > t.connPct) {
    out.push({
      fingerprint: fingerprint('db', 'connections'),
      kind: 'db_connections',
      severity: 'high',
      title: `Database connections at ${c.used} of ${c.max}`,
      detail: { used: c.used, max: c.max, thresholdPct: t.connPct },
    });
  }

  for (const a of Array.isArray(r.advisorErrors) ? r.advisorErrors : []) {
    out.push({
      fingerprint: fingerprint('advisor', a.name || a.title),
      kind: 'advisor_error',
      severity: 'high',
      title: `Security advisor: ${String(a.title || a.name).slice(0, 100)}`,
      detail: { name: a.name || null, detail: a.detail || null, remediation: a.remediation || null },
    });
  }

  const e = r.errors;
  if (e && isNum(e.lastHour) && isNum(e.prev24h)) {
    const hourlyAvg = e.prev24h / 24;
    if (e.lastHour >= t.errorSpikeMin && e.lastHour > t.errorSpikeFactor * hourlyAvg) {
      out.push({
        fingerprint: fingerprint('app', 'client-errors-spike'),
        kind: 'client_errors_spike',
        severity: 'high',
        title: `Client errors spiking: ${e.lastHour} in the last hour`,
        detail: { lastHour: e.lastHour, trailingHourlyAvg: Math.round(hourlyAvg * 10) / 10 },
      });
    }
  }

  if (r.staleReports && isNum(r.staleReports.count) && r.staleReports.count > 0) {
    out.push({
      fingerprint: fingerprint('moderation', 'stale-reports'),
      kind: 'reports_stale',
      severity: 'medium',
      title: `${r.staleReports.count} report${r.staleReports.count === 1 ? '' : 's'} open longer than ${t.staleReportHours} h`,
      detail: { count: r.staleReports.count, oldestAt: r.staleReports.oldestAt || null },
    });
  }

  const d = r.latestDeploy;
  if (d && d.id && d.state === 'error') {
    out.push({
      fingerprint: fingerprint('deploy', 'failed', d.id),
      kind: 'deploy_failed',
      severity: 'high',
      title: `Production deploy failed${d.title ? `: ${String(d.title).slice(0, 80)}` : ''}`,
      detail: { deployId: d.id, branch: d.branch || null, error: d.errorMessage || null, createdAt: d.createdAt || null },
    });
  }

  const v = r.vitals;
  if (v && isNum(v.lcpP75) && isNum(v.samples) && v.samples >= t.lcpMinSamples && v.lcpP75 > t.lcpPoorMs) {
    out.push({
      fingerprint: fingerprint('vitals', 'lcp'),
      kind: 'vitals_lcp_poor',
      severity: 'medium',
      title: `Slow loading: LCP p75 ${(v.lcpP75 / 1000).toFixed(1)} s over the last day`,
      detail: { lcpP75Ms: Math.round(v.lcpP75), samples: v.samples, thresholdMs: t.lcpPoorMs },
    });
  }

  for (const a of Array.isArray(r.aiCaps) ? r.aiCaps : []) {
    if (!a || !a.userId || !isNum(a.days) || a.days < t.aiCapDays) continue;
    out.push({
      fingerprint: fingerprint('ai-cap', a.userId, a.bucket),
      kind: 'ai_cap_repeat',
      severity: 'low',
      title: `AI cap hit on ${a.days} days: ${a.bucket}`,
      detail: { userId: a.userId, bucket: a.bucket, days: a.days, cap: a.cap ?? null },
    });
  }

  return out.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

/**
 * ai_usage rows [{ user_id, bucket, day, n }] → users at or over their
 * bucket's cap on `minDays` or more distinct days.
 */
function repeatCapHits(rows, caps, minDays = THRESHOLDS.aiCapDays) {
  const hits = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const cap = caps[r.bucket];
    if (!cap || !r.user_id || !(Number(r.n) >= cap)) continue;
    const k = `${r.user_id}|${r.bucket}`;
    if (!hits.has(k)) hits.set(k, { userId: r.user_id, bucket: r.bucket, cap, daySet: new Set() });
    hits.get(k).daySet.add(String(r.day));
  }
  return [...hits.values()]
    .map(h => ({ userId: h.userId, bucket: h.bucket, cap: h.cap, days: h.daySet.size }))
    .filter(h => h.days >= minDays)
    .sort((a, b) => b.days - a.days);
}

module.exports = { evaluateConditions, repeatCapHits, fingerprint, THRESHOLDS, SEVERITY_RANK };

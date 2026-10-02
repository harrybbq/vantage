/**
 * Reading the security-console function. What matters most: a missing
 * function reads as "not installed", a panel without its token reads as
 * "not configured" with its hint, and nothing here throws on junk.
 */
import assert from 'node:assert/strict';
import {
  readPanel, part, pillState, deployPill, meterTone, cacheTone, normSeverity, advisorLevel,
  sortAdvisors, safeHref, normaliseTicket, sortTickets, filterTickets, countTickets, detailRows, overviewLine,
  verdictOf, ticketTrend, advisorBuckets, deployHeadline, deployDuration,
} from './status.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// ── Whole responses ──
eq(readPanel(404, '').state, 'not-installed', '404');
eq(readPanel(501, '{"error":"x"}').state, 'not-installed', '501');
eq(readPanel(200, '<!doctype html><html></html>').state, 'not-installed', 'SPA shell');
eq(readPanel(401, '{"error":"unauthorized"}').state, 'forbidden', '401');
eq(readPanel(403, '').state, 'forbidden', '403');
eq(readPanel(429, '').state, 'error', '429');
eq(readPanel(500, '{"error":"security console failed"}').error, 'security console failed', 'generic error carried');
eq(readPanel(502, 'garbage').error, "The console didn't answer (HTTP 502).", 'unparseable error');
eq(readPanel(200, 'not json').state, 'error', 'unparseable 200');
eq(readPanel(200, '').state, 'error', 'empty 200');
eq(readPanel(200, '{"ok":false,"reason":"not_configured","hint":"Add NETLIFY_AUTH_TOKEN"}'),
  { state: 'not_configured', hint: 'Add NETLIFY_AUTH_TOKEN' }, 'panel not configured');
eq(readPanel(200, '{"ok":false,"reason":"something_else"}').state, 'unavailable', 'unknown reason is unavailable');
eq(readPanel(200, '{"counts":{}}'), { state: 'ok', data: { counts: {} } }, 'ok');

// ── Sections ──
eq(part(null), { state: 'missing' }, 'null section');
eq(part({ ok: false, reason: 'not_configured', hint: 'h' }), { state: 'not_configured', hint: 'h' }, 'section not configured');
eq(part({ ok: false, reason: 'unavailable' }), { state: 'unavailable', hint: '' }, 'section unavailable');
eq(part({ series: [] }).state, 'ok', 'section ok');

// ── Pills ──
eq(pillState('ok').key, 'ok', 'ok');
eq(pillState('HEALTHY').key, 'ok', 'case-insensitive');
eq(pillState('degraded').key, 'degraded', 'degraded');
eq(pillState('down').key, 'down', 'down');
eq(pillState('not_configured').key, 'off', 'not configured');
eq(pillState(undefined).key, 'unknown', 'missing');
eq(pillState(true).key, 'ok', 'boolean true');
eq(pillState(false).key, 'down', 'boolean false');
eq(pillState({ state: 'degraded', detail: 'DB 1.9 s' }), { key: 'degraded', label: 'Degraded', detail: 'DB 1.9 s' }, 'object');
eq(pillState({ ok: false, reason: 'not_configured', hint: 'Add X' }).key, 'off', 'fail-soft envelope');
eq(pillState({ ok: true }).key, 'ok', 'ok envelope');
eq(deployPill('ready').label, 'Published', 'ready');
eq(deployPill('error').key, 'down', 'error');
eq(deployPill('building').key, 'busy', 'building');
eq(deployPill('enqueued').label, 'Queued', 'queued');
eq(deployPill('cancelled').key, 'off', 'cancelled');
eq(deployPill('weird').label, 'Weird', 'unknown state shown as-is');
eq(deployPill(null).label, 'Unknown', 'null');

// ── Tones ──
eq(meterTone(50), 'ok', 'meter ok');
eq(meterTone(70), 'warn', 'meter warn at threshold');
eq(meterTone(85), 'bad', 'meter bad at threshold');
eq(meterTone(null), null, 'meter missing');
eq(meterTone(81, 80, 90), 'warn', 'custom thresholds');
eq(cacheTone(99.5), 'ok', 'cache ok');
eq(cacheTone(95), 'warn', 'cache warn');
eq(cacheTone(80), 'bad', 'cache bad');

// ── Severity & advisors ──
eq(normSeverity('HIGH'), 'high', 'severity case');
eq(normSeverity('bogus'), 'low', 'unknown severity is low');
eq(advisorLevel('ERROR').key, 'bad', 'ERROR');
eq(advisorLevel('WARN').key, 'warn', 'WARN');
eq(advisorLevel('INFO').key, 'info', 'INFO');
eq(advisorLevel(undefined).key, 'info', 'missing level');
eq(sortAdvisors([{ level: 'INFO', title: 'a' }, null, { level: 'ERROR', title: 'b' }, { level: 'WARN', title: 'c' }, { level: 'ERROR', title: 'd' }])
  .map(a => a.title), ['b', 'd', 'c', 'a'], 'errors first, stable');
eq(sortAdvisors('nope'), [], 'non-array');
eq(safeHref('https://supabase.com/docs/x'), 'https://supabase.com/docs/x', 'https kept');
eq(safeHref('javascript:alert(1)'), null, 'javascript: dropped');
eq(safeHref('http://x'), null, 'plain http dropped');

// ── Tickets ──
{
  eq(normaliseTicket(null), null, 'null ticket');
  eq(normaliseTicket({ title: 'x' }), null, 'no id');
  const t = normaliseTicket({ id: 1, severity: 'CRITICAL', status: 'weird', count: '4', created_at: '2026-10-01T00:00:00Z' });
  eq([t.severity, t.status, t.count, t.title, t.lastSeenAt, t.source],
    ['critical', 'open', 4, 'Untitled ticket', '2026-10-01T00:00:00Z', 'auto'], 'defaults and coercion');
  eq(normaliseTicket({ id: 2, count: 0 }).count, 1, 'count never below 1');

  const rows = [
    { id: 'a', status: 'resolved', severity: 'critical', lastSeenAt: '2026-10-02' },
    { id: 'b', status: 'open', severity: 'low', lastSeenAt: '2026-10-02' },
    { id: 'c', status: 'open', severity: 'critical', lastSeenAt: '2026-09-01' },
    { id: 'd', status: 'ack', severity: 'high', lastSeenAt: '2026-10-01' },
    { id: 'e', status: 'open', severity: 'critical', lastSeenAt: '2026-10-01' },
  ];
  eq(sortTickets(rows).map(r => r.id), ['e', 'c', 'b', 'd', 'a'], 'open → ack → resolved, severity, recency');
  eq(filterTickets(rows, { status: 'open' }).map(r => r.id), ['b', 'c', 'e'], 'status filter');
  eq(filterTickets(rows, { status: 'all', severity: 'critical' }).map(r => r.id), ['a', 'c', 'e'], 'severity filter');
  const c = countTickets(rows);
  eq([c.open, c.ack, c.resolved, c.all, c.critical, c.high], [3, 1, 1, 5, 2, 1], 'counts (severity excludes resolved)');
}
eq(detailRows(null), [], 'no detail');
eq(detailRows('plain'), [['', 'plain']], 'string detail');
eq(detailRows({ p75_lcp_ms: 4200, pages: ['/a'] }), [['p75 lcp ms', '4200'], ['pages', '["/a"]']], 'object detail');

// ── Home card line ──
eq(overviewLine({ status: { db: 'ok', netlify: 'ok', app: 'ok' }, counts: { openTickets: 2, criticalTickets: 0 } }).line,
  '2 tickets open · all systems ok', 'the spec example');
eq(overviewLine({ status: { db: 'down', netlify: 'not_configured', app: 'ok' }, counts: { openTickets: 3, criticalTickets: 1 } }),
  { line: '1 critical · DB down', sub: '1 critical · DB down', tone: 'bad' }, 'critical + down');
eq(overviewLine({ status: { db: 'ok', netlify: 'not_configured' }, counts: { openTickets: 0 } }).line,
  'no open tickets · all systems ok', 'not configured is not a problem');
eq(overviewLine({ status: { netlify: 'degraded' }, counts: { openTickets: 1 } }).tone, 'warn', 'degraded is warn');
eq(overviewLine(null).line, 'Security console', 'nothing at all');
eq(overviewLine({ counts: { openReports: 2 } }).line, '2 reports open', 'reports when nothing else');

// ── Verdict ──
eq(verdictOf({ status: { db: 'ok', netlify: 'ok', app: 'ok' }, counts: {} }),
  { key: 'ok', text: 'All systems operational', issues: [] }, 'healthy');
{
  const v = verdictOf({ status: { db: { state: 'degraded', detail: 'Disk 83%' }, netlify: 'down', app: 'ok' }, counts: { criticalTickets: 1 } });
  eq([v.key, v.text, v.issues.length], ['bad', '3 issues need attention', 3], 'derived issues');
  eq(v.issues[0], 'Database is degraded: Disk 83%', 'issue wording');
}
eq(verdictOf({ status: { db: 'ok' }, counts: { advisorsError: 1 } }).text, '1 issue needs attention', 'singular');
eq(verdictOf({ verdict: { state: 'warn', text: 'Backend says so' }, issues: ['a', { title: 'b' }] }),
  { key: 'warn', text: 'Backend says so', issues: ['a', 'b'] }, 'backend verdict wins');
eq(verdictOf(null).key, 'unknown', 'nothing known');
eq(verdictOf({ status: { db: 'not_configured', netlify: 'ok' } }).key, 'ok', 'not configured is not an issue');

// ── Trend ──
{
  const now = Date.parse('2026-10-02T12:00:00Z');
  const t = (o) => ({ status: 'open', count: 1, createdAt: '2026-10-02T10:00:00Z', ...o });
  eq(ticketTrend(t({}), now), 'New', 'first sighting today');
  eq(ticketTrend(t({ count: 4 }), now), 'Ongoing', 'repeating');
  eq(ticketTrend(t({ createdAt: '2026-09-01T00:00:00Z' }), now), 'Ongoing', 'old');
  eq(ticketTrend(t({ count: 9 }), now, { count_24h: 6, prev_count_24h: 2 }), 'Escalating', 'rising');
  eq(ticketTrend(t({ count: 9 }), now, { count_24h: 2, prev_count_24h: 6 }), 'Ongoing', 'falling');
  eq(ticketTrend(t({}), now, { trend: 'escalating' }), 'Escalating', 'backend trend wins');
  eq(ticketTrend(t({ status: 'resolved' }), now), null, 'resolved has no trend');
}

// ── Advisor buckets ──
{
  const adv = {
    security: [
      { level: 'ERROR', title: 'Security Definer View', detail: 'View `public.v` is…', cache_key: 'k1', metadata: { schema: 'public', name: 'v', type: 'view' }, remediation: 'https://x' },
      { level: 'WARN', title: 'Search path', detail: 'Function `public.f` has…', cache_key: 'k2' },
      { level: 'WARN', title: 'Accepted one', cache_key: 'k3', accepted: true },
      null,
    ],
    performance: [{ level: 'INFO', title: 'Unused index', cache_key: 'k4', categories: ['PERFORMANCE'] }, { level: 'WARN', title: 'x', cache_key: 'k5' }],
  };
  const b = advisorBuckets(adv, ['k5']);
  eq([b.bad.length, b.warn.length, b.info.length, b.accepted.length], [1, 1, 1, 2], 'bucketed, accepted out of the counts');
  eq([b.bad[0].entity, b.bad[0].entityType, b.bad[0].category, b.bad[0].remediation], ['public.v', 'view', 'SECURITY', 'https://x'], 'entity from metadata');
  eq(b.warn[0].entity, 'public.f', 'entity from detail backticks');
  eq(advisorBuckets(null), { bad: [], warn: [], info: [], accepted: [] }, 'nothing');
  eq(advisorBuckets({ security: [{ level: 'ERROR', cache_key: 'z' }], accepted: [{ cache_key: 'z' }] }).accepted.length, 1, 'accepted list of objects');
}

// ── Deploy rows ──
eq(deployHeadline({ branch: 'master', commit: 'a1b2c3d4e5', context: 'production' }), 'Production: master@a1b2c3d', 'production');
eq(deployHeadline({ branch: 'feat', commit: 'ffff0000aa', context: 'deploy-preview', reviewId: 219 }), 'Deploy Preview #219: feat@ffff000', 'preview');
eq(deployHeadline({ branch: 'x', context: 'branch-deploy' }), 'Branch deploy: x', 'branch deploy');
eq(deployHeadline({ branch: 'main' }), 'Production: main', 'main without context');
eq(deployDuration({ deployTimeSec: 28 }), 28, 'deploy time given');
eq(deployDuration({ createdAt: '2026-10-02T12:00:00Z', publishedAt: '2026-10-02T12:01:30Z' }), 90, 'published − created');
eq(deployDuration({ createdAt: '2026-10-02T12:00:00Z' }), null, 'unknown');
eq(deployPill('accepted').key, 'busy', 'accepted is in flight');

console.log(`security status: ${n} checks passed`);

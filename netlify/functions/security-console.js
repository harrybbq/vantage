/**
 * Netlify function: security-console — the owner's Security console
 * (Upgrade → Security). OWNER-ONLY on every route.
 *
 * ══ What was verified, and where (2026-10-02) ═══════════════════════
 * supabase.com, api.supabase.com, docs.netlify.com and
 * open-api.netlify.com are blocked from the build container, so the
 * sources below were read through Supabase's own docs search (the
 * official Supabase MCP `search_docs`), GitHub code search over
 * Supabase's repos, the official npm packages, and web search snippets
 * of the official pages.
 *
 * 1. Privileged metrics — GET https://<ref>.supabase.co/customer/v1/privileged/metrics,
 *    HTTP Basic, username `service_role`, password a Secret API key
 *    (sb_secret_…); Prometheus text format; updates every minute; beta,
 *    "metric names and labels might evolve".
 *    https://supabase.com/docs/guides/observability/metrics
 *    https://supabase.com/docs/guides/telemetry/metrics
 *    Metric names (node_cpu_seconds_total{cpu,mode}, node_load1,
 *    node_memory_MemAvailable_bytes / _MemTotal_bytes,
 *    node_filesystem_avail_bytes / _size_bytes{mountpoint},
 *    pg_stat_database_num_backends, node_time_seconds,
 *    node_boot_time_seconds) from Supabase's published dashboard and
 *    sample scrape: https://github.com/supabase/supabase-grafana
 *    (dashboard.json, metrics.md, docs/metrics.md).
 *    UNVERIFIED: whether a LEGACY service_role JWT is still accepted as
 *    the password (older guides said so; the current page says a
 *    sb_secret_ key). If refused, the panel falls back to the RPC below
 *    and says so in `source.metrics`.
 * 2. Management API traffic — GET https://api.supabase.com/v1/projects/{ref}/
 *    analytics/endpoints/usage.api-counts?interval=, interval one of
 *    15min|30min|1hr|3hr|1day|3day|7day; Bearer personal access token.
 *    https://supabase.com/docs/reference/api/v1-get-project-usage-api-count
 *    Enum from the Management API schema shipped in supabase/supabase
 *    (apps/ui-library/…/management-api-schema.d.ts). Row fields
 *    total_rest_requests / total_auth_requests / total_storage_requests
 *    / total_realtime_requests / timestamp under `result`, from Studio's
 *    own consumer (apps/studio/data/analytics/project-log-stats-query.ts).
 * 3. Advisors — GET https://api.supabase.com/v1/projects/{ref}/advisors/security
 *    and /advisors/performance → { lints: [{ name, title, level, facing,
 *    categories, description, detail, remediation, metadata, cache_key }] }.
 *    Paths from the official @supabase/mcp-server-supabase 0.13.0
 *    (getSecurityAdvisors / getPerformanceAdvisors); fields from the
 *    Management API schema (detail, remediation, facing 'EXTERNAL',
 *    categories PERFORMANCE|SECURITY) and pg-meta's lint SQL (level
 *    'ERROR'|'WARN'|'INFO').
 *    Personal access tokens: classic = whole account; scoped (public
 *    alpha) = chosen orgs/projects/permissions.
 *    https://supabase.com/docs/guides/platform/personal-access-tokens
 * 4. Auth admin ban — PUT {SUPABASE_URL}/auth/v1/admin/users/{id} with
 *    { ban_duration: '<Go duration, e.g. 876000h>' | 'none' } and the
 *    service-role apikey + Bearer. From @supabase/auth-js 2.117.2:
 *    GoTrueAdminApi.updateUserById (PUT `${url}/admin/users/${uid}`) and
 *    AdminUserAttributes.ban_duration ("'none' lifts the ban"; units
 *    ns/us/ms/s/m/h). GET of the same path returns the user (email,
 *    banned_until).
 * 5. Netlify API — https://api.netlify.com/api/v1, `Authorization:
 *    Bearer <personal access token>`.
 *    https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
 *    GET /sites/{site_id} (getSite) and GET /sites/{site_id}/deploys
 *    (listSiteDeploys: page, per_page, production, state, branch…),
 *    deploy fields id, state, branch, commit_ref, commit_url, title,
 *    error_message, context, created_at, published_at, updated_at;
 *    site fields name, url, ssl_url, admin_url, state, published_deploy.
 *    From @netlify/open-api 2.60.0 (dist/swagger.json). NOT in that
 *    schema: `deploy_time` and `available_functions` — used when present,
 *    derived / omitted otherwise.
 * 6. SITE_ID is a read-only variable available to functions at runtime
 *    (with SITE_NAME). https://docs.netlify.com/build/functions/environment-variables/
 * 7. Scheduled functions: `[functions."name"] schedule = "<cron>"` in
 *    netlify.toml, UTC; the invocation body is JSON with `next_run`.
 *    https://docs.netlify.com/build/functions/scheduled-functions/
 * 8. Web-vitals thresholds (p75): LCP 2.5 s / 4 s, INP 200 / 500 ms,
 *    CLS 0.1 / 0.25 — https://web.dev/articles/vitals ; FCP 1.8 / 3 s
 *    and TTFB 0.8 / 1.8 s per web.dev/articles/fcp and /ttfb.
 *
 * Confirmed later the same day by the coordinator's research pass
 * against the live specs (api.supabase.com/api/v1-json,
 * open-api.netlify.com, docs) — and adopted here:
 *  · The same Prometheus scrape is on the Management API:
 *    GET https://api.supabase.com/v1/projects/{ref}/analytics/endpoints/metrics
 *    (Bearer PAT, scoped permission analytics_logs_read). Preferred; the
 *    privileged endpoint is the fallback (lib/securityData.scrapeText).
 *    https://supabase.com/docs/reference/api/v1-scrape-project-metrics
 *  · Scoped PAT permissions for this console: analytics_usage_read,
 *    advisors_read, analytics_logs_read. usage.api-counts is limited to
 *    30 requests/minute (cached 90 s here) and may carry `error` on a 200.
 *  · Advisors are EXPERIMENTAL; `cache_key` is each finding's stable id
 *    (used for "accept"); lints may also carry observed_at.
 *  · max_connections_connection_count and the uptime metrics are
 *    UNVERIFIED — owner_db_stats() covers both.
 *  · A ban blocks sign-in and refresh but does NOT end a live session:
 *    the access token works against PostgREST until expiry (~1 h).
 *  · Netlify: send a User-Agent; 500 requests/minute; PATs cannot be
 *    scoped (full account) — set an expiry. `state` is a free string.
 *    There is NO API for Observability, function invocations or (on
 *    credit plans) bandwidth, so the Netlify panel returns dashboard
 *    `links` instead. https://docs.netlify.com/manage/monitoring/observability/overview/
 *  · Scheduled functions: 30 s hard limit, not URL-invokable in
 *    production — the sweep lives in lib/securitySweep.js so this
 *    function can run it on demand.
 *  · Legacy anon/service_role keys are deprecated by end of 2026; new
 *    sb_secret_ keys are not JWTs, go in `apikey`, and are refused with a
 *    browser User-Agent. Nothing here forwards the client's User-Agent.
 *    https://supabase.com/docs/guides/api/api-keys
 * ═════════════════════════════════════════════════════════════════════
 *
 *   GET ?panel=overview | database | netlify | moderation | tickets
 *       overview: also { verdict:'operational'|'degraded'|'down', issues, nextRefreshSec }
 *       database: &range= (or &interval=) 15min|30min|1hr|3hr|1day|3day|7day (traffic)
 *       netlify:  &days=1..28 (web vitals window, default 7)
 *       moderation: &page=N
 *       tickets:  &status=open|ack|resolved|all &severity=critical|high|medium|low
 *   POST { action, ... }
 *       ticket.update { id, status:'open'|'ack'|'resolved', note? }
 *       ticket.create { severity, title, detail? }
 *       report.decide { id, decision:'dismiss'|'action', suspend?, note? }
 *                     (moderation.js's POST, with `decision` in place of
 *                     its `action`, which names the console action here)
 *       user.suspend  { userId, on:boolean, note? }
 *       user.ban      { userId, on:boolean, note? }   (Auth ban + suspended_at)
 *       advisor.accept   { cache_key, note? }   — the finding stops counting
 *       advisor.unaccept { cache_key }
 *       sweep.run
 *
 * Sub-sections fail soft independently. Any part that cannot answer is
 * `{ ok:false, reason:'not_configured'|'unavailable', hint }` in place of
 * its normal object (arrays stay arrays, empty). The panel itself is
 * still 200. Only a whole-request failure is a 5xx, with a generic body.
 *
 * A non-owner gets exactly the 401 a bad token gets.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { isOwnerEmail } = require('../lib/owner');
const D = require('../lib/securityData');
const M = require('../lib/moderationCore');
const { runSweep } = require('../lib/securitySweep');
const { verdictOf } = require('../lib/securityShape');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const denied = () => reply(401, { error: 'session expired — sign in again' });

const UUID = /^[0-9a-f-]{36}$/i;
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'ack', 'resolved'];
const enc = encodeURIComponent;
const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
// Long enough to be permanent; Go durations top out near 292 years.
const BAN_DURATION = '876000h';

// ── Overview ─────────────────────────────────────────────────────────

const overviewCache = { at: 0, value: null };
const OVERVIEW_TTL = 30_000;
const OVERVIEW_POLL_SEC = 60;     // what the UI is told to wait before polling again

async function overview(env) {
  if (overviewCache.value && Date.now() - overviewCache.at < OVERVIEW_TTL) return overviewCache.value;

  const ping = await D.pingDb(env);
  const [openTickets, criticalTickets, openReports, suspended, errors24h, errorsLastHour] = ping.reachable
    ? await Promise.all([
      D.countRows(env, 'security_tickets?status=eq.open'),
      D.countRows(env, 'security_tickets?status=in.(open,ack)&severity=eq.critical'),
      D.countRows(env, 'reports?status=eq.open'),
      D.countRows(env, 'profiles?suspended_at=not.is.null'),
      D.countRows(env, `client_errors?occurred_at=gte.${enc(iso(86400_000))}`),
      D.countRows(env, `client_errors?occurred_at=gte.${enc(iso(3600_000))}`),
    ])
    : [null, null, null, null, null, null];

  // Advisors only from the cache-backed reader (10 min) — never a fresh
  // Management API call per 60 s poll. Accepted findings don't count.
  const adv = D.mgmtConfig().ok ? await D.advisorsWithAcceptance(env) : null;
  const advisorsError = adv && adv.ok ? adv.counts.securityErrors : null;

  // Netlify's own status is the latest PRODUCTION deploy. An API we
  // cannot reach is not the site being down, so it reads 'degraded'.
  let netlify = 'not_configured';
  let latestDeploy = null;
  if (D.netlifyConfig().ok) {
    const nf = await D.readNetlify();
    if (!nf.ok) netlify = 'degraded';
    else {
      latestDeploy = nf.deploys.find(d => d.context === 'production') || nf.deploys[0] || null;
      netlify = latestDeploy && latestDeploy.state === 'error' ? 'degraded' : 'ok';
    }
  }

  const db = !ping.reachable ? 'down' : ping.ms > 1500 ? 'degraded' : 'ok';
  const errorSpike = errors24h != null && errorsLastHour != null && errorsLastHour >= 10
    && errorsLastHour > 3 * ((errors24h - errorsLastHour) / 23 || 0);
  const app = db === 'down' ? 'down' : (criticalTickets > 0 || errorSpike) ? 'degraded' : 'ok';
  const status = { db, netlify, app };
  const counts = { openTickets, criticalTickets, openReports, suspended, errors24h, advisorsError };

  const value = {
    ok: true,
    status,
    counts,
    ...verdictOf(status, counts),          // verdict: 'operational'|'degraded'|'down', issues: n
    nextRefreshSec: OVERVIEW_POLL_SEC,
    db: { ms: ping.ms },
    latestDeploy,
    generatedAt: new Date().toISOString(),
  };
  overviewCache.at = Date.now();
  overviewCache.value = value;
  return value;
}

// ── Database ─────────────────────────────────────────────────────────

async function database(env, q) {
  const [h, traffic, advisors] = await Promise.all([
    D.databaseHealth(env),
    D.readTraffic(q.range || q.interval || '1day'),
    D.advisorsWithAcceptance(env),
  ]);
  const healthPart = h.metricsSource
    ? h.health
    : D.fail(h.rpc.reason === 'not_configured' ? 'not_configured' : 'unavailable',
      `${h.metrics.hint || 'Metrics unavailable.'} ${h.rpc.hint || ''}`.trim());
  return {
    ok: true,
    health: healthPart,
    tables: h.tables,
    traffic,
    advisors: advisors.ok
      ? {
        ok: true, security: advisors.security, performance: advisors.performance,
        counts: advisors.counts, acceptedInstalled: advisors.acceptedInstalled,
      }
      : advisors,
    source: {
      metrics: h.metricsSource,                 // 'privileged-metrics' | 'rpc' | null
      metricsVia: h.metricsVia,                 // 'management-api' | 'privileged' | null (same scrape, two routes)
      rpc: h.rpc.ok ? 'rpc' : null,
      traffic: traffic.ok ? 'management-api' : null,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── Netlify ──────────────────────────────────────────────────────────

async function netlifyPanel(env, q) {
  const [nf, vitals, ping] = await Promise.all([
    D.readNetlify(),
    D.readVitals(env, parseInt(q.days, 10) || 7),
    D.pingDb(env),
  ]);
  return {
    ok: true,
    site: nf.ok ? nf.site : nf,
    deploys: nf.ok ? nf.deploys : [],
    functions: nf.ok ? nf.functions : nf,
    // Netlify has no API for Observability, function invocations or
    // bandwidth — these open the dashboard pages instead (SITE_NAME is a
    // runtime variable, so they work without a token).
    links: (nf.ok && nf.links) || D.siteLinks(),
    webVitals: vitals,
    health: { ok: ping.reachable, dbMs: ping.ms },
    generatedAt: new Date().toISOString(),
  };
}

// ── Moderation ───────────────────────────────────────────────────────

async function crestCount(env) {
  return D.countRows(env, 'groups?crest_status=eq.pending');
}

/** Auth ban state for up to 25 users, one admin read each (cheap PK reads). */
async function banStates(env, ids) {
  const out = new Map();
  for (const id of ids.slice(0, 25)) {
    try {
      const res = await D.timed(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, {
        headers: { apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
      }, 4000);
      if (res.ok) {
        const u = await res.json();
        const until = u?.banned_until || null;
        out.set(id, until && Date.parse(until) > Date.now() ? until : null);
      }
    } catch { /* unknown — leave unset */ }
  }
  return out;
}

async function moderationPanel(env, q) {
  const page = Math.max(0, Math.min(1000, parseInt(q.page, 10) || 0));
  const [[code, rep], suspendedRows, crests] = await Promise.all([
    M.listOpenReports(env, page).catch(() => [503, null]),
    M.listSuspended(env, 100).catch(() => undefined),
    crestCount(env),
  ]);
  let suspended = [];
  if (Array.isArray(suspendedRows)) {
    const bans = await banStates(env, suspendedRows.map(r => r.id));
    suspended = suspendedRows.map(r => ({
      id: r.id,
      handle: r.handle || null,
      display_name: r.display_name || null,
      suspended_at: r.suspended_at,
      banned_until: bans.has(r.id) ? bans.get(r.id) : undefined,
    }));
  }
  return {
    ok: true,
    reports: code === 200 ? rep.items : [],
    reportsPage: code === 200 ? { page: rep.page, pageSize: rep.pageSize, total: rep.total } : null,
    reportsState: code === 200 ? { ok: true }
      : code === 501 ? D.fail('not_configured', 'Run supabase/audit_schema_2026_10.sql.')
        : D.fail('unavailable', 'Could not read the report queue.'),
    suspended,
    suspendedState: suspendedRows === null ? D.fail('not_configured', 'Run supabase/audit_schema_2026_10.sql.')
      : suspendedRows === undefined ? D.fail('unavailable', 'Could not read suspended accounts.') : { ok: true },
    crests: { count: crests },
    generatedAt: new Date().toISOString(),
  };
}

// ── Tickets ──────────────────────────────────────────────────────────

const TICKET_COLS = 'id,created_at,updated_at,source,kind,severity,title,detail,status,count,last_seen_at,note,reporter_id,resolved_at';

async function ticketsPanel(env, q) {
  const status = ['open', 'ack', 'resolved', 'all'].includes(q.status) ? q.status : 'open';
  const severity = SEVERITIES.includes(q.severity) ? q.severity : null;
  let filter = status === 'all' ? '' : `&status=eq.${status}`;
  if (severity) filter += `&severity=eq.${severity}`;
  const res = await D.rest(env,
    `security_tickets?select=${TICKET_COLS}${filter}&order=last_seen_at.desc.nullslast,created_at.desc&limit=200`);
  if (D.missing(res)) return { ...D.fail('not_configured', D.HINTS.sql), tickets: [], counts: { open: null, ack: null, resolved: null } };
  if (!res.ok) throw new Error(`tickets read ${res.status}`);
  const rows = await res.json();

  // Who raised the user tickets (handle only), one query.
  const reporterIds = [...new Set(rows.map(r => r.reporter_id).filter(Boolean))].slice(0, 100);
  let handles = new Map();
  if (reporterIds.length) {
    const pRes = await D.rest(env, `profiles?id=in.(${reporterIds.join(',')})&select=id,handle,display_name`);
    if (pRes.ok) handles = new Map((await pRes.json()).map(p => [p.id, p]));
  }

  const [open, ack, resolved] = await Promise.all(
    STATUSES.map(s => D.countRows(env, `security_tickets?status=eq.${s}`)));
  return {
    ok: true,
    tickets: rows.map(r => ({
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      source: r.source,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      status: r.status,
      count: r.count,
      last_seen_at: r.last_seen_at,
      note: r.note,
      resolved_at: r.resolved_at,
      reporter: r.reporter_id
        ? { id: r.reporter_id, handle: handles.get(r.reporter_id)?.handle || null, name: handles.get(r.reporter_id)?.display_name || null }
        : null,
    })),
    counts: { open, ack, resolved },
    filter: { status, severity },
    generatedAt: new Date().toISOString(),
  };
}

async function ticketUpdate(env, ownerId, b) {
  const id = String(b.id || '');
  if (!UUID.test(id)) return [400, { error: 'ticket id required' }];
  if (!STATUSES.includes(b.status)) return [400, { error: 'status must be open, ack or resolved' }];
  const now = new Date().toISOString();
  const patch = { status: b.status, updated_at: now };
  if (typeof b.note === 'string') patch.note = b.note.slice(0, 1000) || null;
  if (b.status === 'resolved') { patch.resolved_at = now; patch.resolved_by = ownerId; }
  else { patch.resolved_at = null; patch.resolved_by = null; }
  const res = await D.rest(env, `security_tickets?id=eq.${id}&select=id,status`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (D.missing(res)) return [501, { error: 'tickets not installed', hint: D.HINTS.sql }];
  if (!res.ok) throw new Error(`ticket update ${res.status}`);
  const rows = await res.json();
  if (!rows.length) return [404, { error: 'no such ticket' }];
  overviewCache.at = 0;
  return [200, { ok: true, id, status: b.status }];
}

async function ticketCreate(env, b) {
  const severity = SEVERITIES.includes(b.severity) ? b.severity : null;
  const title = String(b.title || '').trim().slice(0, 120);
  if (!severity) return [400, { error: 'severity must be critical, high, medium or low' }];
  if (title.length < 3) return [400, { error: 'title required' }];
  const detailText = typeof b.detail === 'string' ? b.detail.slice(0, 2000) : null;
  const now = new Date().toISOString();
  const res = await D.rest(env, 'security_tickets?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      source: 'owner', kind: 'manual', severity, title,
      detail: detailText ? { text: detailText } : {},
      status: 'open', last_seen_at: now,
    }),
  });
  if (D.missing(res)) return [501, { error: 'tickets not installed', hint: D.HINTS.sql }];
  if (!res.ok) throw new Error(`ticket create ${res.status}`);
  overviewCache.at = 0;
  return [200, { ok: true, id: (await res.json())[0]?.id || null }];
}

// ── Users: suspend / ban ─────────────────────────────────────────────

async function adminUser(env, id, init = {}) {
  return D.timed(`${env.supabaseUrl}/auth/v1/admin/users/${id}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

async function userAction(env, ownerId, b, ban) {
  const userId = String(b.userId || '');
  if (!UUID.test(userId)) return [400, { error: 'userId required' }];
  if (typeof b.on !== 'boolean') return [400, { error: 'on must be true or false' }];
  if (userId === ownerId) return [409, { error: 'you cannot do that to your own account' }];
  const note = String(b.note || '').slice(0, 500);

  if (ban) {
    // Look the account up first: it must exist, and an owner can never
    // be banned from here (a slip of the finger would lock the console).
    const look = await adminUser(env, userId);
    if (look.status === 404) return [404, { error: 'no such user' }];
    if (!look.ok) throw new Error(`admin user read ${look.status}`);
    const u = await look.json();
    if (isOwnerEmail(u?.email)) return [409, { error: 'owner accounts cannot be banned' }];

    const res = await adminUser(env, userId, {
      method: 'PUT',
      body: JSON.stringify({ ban_duration: b.on ? BAN_DURATION : 'none' }),
    });
    if (!res.ok) throw new Error(`ban ${res.status}`);
  }

  // Ban implies suspended (hidden from public boards); lifting a ban
  // lifts the suspension too. Suspend alone never touches auth.
  const out = await M.setSuspended(env, userId, b.on);
  overviewCache.at = 0;
  console.info(`security-console: ${ban ? 'ban' : 'suspend'} ${b.on ? 'on' : 'off'} by owner${note ? ' (with note)' : ''}`);
  // A ban blocks sign-in and token refresh; it does NOT end a session
  // already open — that access token keeps working (default ≤ 1 h).
  const message = ban
    ? (b.on ? 'Sign-in blocked; an existing session may last up to an hour.' : 'Ban lifted; they can sign in again.')
    : (b.on ? 'Hidden from every public board.' : 'Suspension lifted.');
  if (out === 'missing') {
    return ban
      ? [200, { ok: true, banned: b.on, suspended: null, message, warning: 'profiles.suspended_at not installed — auth ban applied only' }]
      : [501, { error: 'moderation schema not installed' }];
  }
  if (out === 'nouser') {
    return ban ? [200, { ok: true, banned: b.on, suspended: null, message, warning: 'no profile row' }] : [404, { error: 'no such user' }];
  }
  return [200, { ok: true, suspended: b.on, ...(ban ? { banned: b.on } : {}), message }];
}

// ── Handler ──────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!isOwnerEmail(auth.email)) return denied();
  if (!underLimit('security-console', auth.userId, 120)) return tooMany(CORS);

  const env = D.supabaseEnv();
  if (!env.supabaseUrl || !env.serviceKey) return reply(500, { error: 'not configured' });

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      switch (q.panel) {
        case 'overview': return reply(200, await overview(env));
        case 'database': return reply(200, await database(env, q));
        case 'netlify': return reply(200, await netlifyPanel(env, q));
        case 'moderation': return reply(200, await moderationPanel(env, q));
        case 'tickets': return reply(200, await ticketsPanel(env, q));
        default: return reply(400, { error: 'unknown panel' });
      }
    }

    if (Buffer.byteLength(event.body || '', 'utf8') > 16 * 1024) return reply(413, { error: 'too large' });
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
    if (!b || typeof b !== 'object') return reply(400, { error: 'invalid body' });

    let out;
    switch (b.action) {
      case 'ticket.update': out = await ticketUpdate(env, auth.userId, b); break;
      case 'ticket.create': out = await ticketCreate(env, b); break;
      case 'report.decide': {
        out = await M.decideReport(env, auth.userId, { id: b.id, action: b.decision || b.reportAction, suspend: b.suspend, note: b.note });
        overviewCache.at = 0;
        break;
      }
      case 'user.suspend': out = await userAction(env, auth.userId, b, false); break;
      case 'user.ban': out = await userAction(env, auth.userId, b, true); break;
      case 'advisor.accept':
      case 'advisor.unaccept': {
        const key = typeof b.cache_key === 'string' ? b.cache_key.trim().slice(0, 300) : '';
        if (!key) return reply(400, { error: 'cache_key required' });
        const on = b.action === 'advisor.accept';
        const r = await D.setAccepted(env, auth.userId, key, on, typeof b.note === 'string' ? b.note.slice(0, 500) : null);
        if (r === 'missing') { out = [501, { error: 'accepted findings not installed', hint: D.HINTS.sql }]; break; }
        overviewCache.at = 0;
        out = [200, { ok: true, cache_key: key, accepted: on }];
        break;
      }
      case 'sweep.run': {
        if (!underLimit('security-sweep-manual', auth.userId, 4)) return tooMany(CORS);
        const r = await runSweep(env);
        overviewCache.at = 0;
        out = [r.ok ? 200 : 503, r];
        break;
      }
      default: return reply(400, { error: 'unknown action' });
    }
    return reply(out[0], out[1]);
  } catch (e) {
    console.error('security-console:', e?.message);
    return reply(500, { error: 'failed' });
  }
};

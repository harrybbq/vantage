/**
 * The Security console's data sources — every outbound call, in one
 * place, shared by functions/security-console.js (the owner's view) and
 * functions/security-sweep.js (the hourly auto-raise).
 *
 * Rules every reader here keeps:
 *   · Each source fails SOFT on its own: a reader returns
 *     { ok:false, reason:'not_configured'|'unavailable', hint } and never
 *     throws to the caller, so one dead source never blanks a panel.
 *   · Every secret stays server-side. Upstream bodies are PROJECTED
 *     (securityShape.js) — nothing is spread into a response.
 *   · Micro compute: projections, small LIMITs, HEAD count queries, and
 *     module-scope caches (per warm instance) on anything expensive.
 *   · Every outbound call has a timeout.
 *
 * Verified endpoints and their sources: see the header of
 * functions/security-console.js.
 */
const { parsePrometheus, metricsHealth } = require('./prom');
const {
  projectRefFromUrl, API_COUNT_INTERVALS, shapeApiCounts, shapeLints, apiCountsError,
  shapeDeploy, shapeSite, shapeFunctions, summariseVitals, netlifyLinks,
  supabaseLinks, groupClientErrors,
} = require('./securityShape');

const TIMEOUT_MS = 8000;

function supabaseEnv() {
  return {
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function timed(url, init = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const fail = (reason, hint) => ({ ok: false, reason, hint });

const HINTS = {
  sql: 'Run supabase/security_console_2026_10.sql in the Supabase SQL editor.',
  supabasePat:
    'Add SUPABASE_ACCESS_TOKEN in Netlify → Site configuration → Environment variables (Functions scope only), ' +
    'then redeploy. Create it at supabase.com/dashboard/account/tokens as a SCOPED token: this project only, ' +
    'permissions analytics_usage_read, advisors_read, analytics_logs_read (all read-only), with an expiry. ' +
    'A classic token carries your whole account (every org and project) — treat any PAT as a top-tier secret, ' +
    'server-side only.',
  supabaseRef:
    'The project ref could not be read from SUPABASE_URL (custom domain?). Set SUPABASE_PROJECT_REF.',
  netlifyToken:
    'Add NETLIFY_AUTH_TOKEN in Netlify → Site configuration → Environment variables (Functions scope only), ' +
    'then redeploy. Create it at Netlify → User settings → Applications → Personal access tokens and SET AN ' +
    'EXPIRY. Netlify tokens cannot be scoped: it is full access to every site and team you can reach — keep ' +
    'it server-side only. (If Netlify refuses the NETLIFY_ name, use VANTAGE_NETLIFY_TOKEN.)',
  netlifySite:
    'No site id: Netlify provides SITE_ID to functions at runtime, so this only happens outside Netlify. ' +
    'Set NETLIFY_SITE_ID to override.',
};

// ── Supabase REST (service role) ─────────────────────────────────────

function rest(env, path, init = {}, ms = TIMEOUT_MS) {
  return timed(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  }, ms);
}

const missing = res => res.status === 400 || res.status === 404;

/**
 * Row count via HEAD + Prefer: count=exact (PostgREST answers in
 * Content-Range "*\/N" with no body). → number, or null when the table
 * or column is not there / the read failed.
 */
async function countRows(env, tableAndFilter) {
  try {
    const res = await rest(env, tableAndFilter, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    if (!res.ok) return null;
    const n = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The same one-row read health.js times. → { reachable, ms }. */
async function pingDb(env) {
  const t0 = Date.now();
  try {
    const res = await rest(env, 'config?select=key&limit=1', {}, 4000);
    return { reachable: res.status < 500, ms: Date.now() - t0 };
  } catch {
    return { reachable: false, ms: Date.now() - t0 };
  }
}

// ── Database health: privileged metrics + owner_db_stats() ──────────

let cpuPrev = null;            // last cpuTotals(), for a CPU delta
let cpuLastPct = null;         // last computed CPU %, reused while the source has not refreshed
const metricsCache = { at: 0, value: null };
const statsCache = { at: 0, value: null };
const HEALTH_TTL = 30_000;

/**
 * The Prometheus scrape, two ways, same data:
 *   1. Management API  GET api.supabase.com/v1/projects/{ref}/analytics/endpoints/metrics
 *      (Bearer SUPABASE_ACCESS_TOKEN, scoped permission analytics_logs_read) — preferred:
 *      keeps the service key out of the monitoring path;
 *   2. privileged endpoint  {SUPABASE_URL}/customer/v1/privileged/metrics
 *      (HTTP Basic service_role:<SUPABASE_SERVICE_ROLE_KEY>).
 * → { ok, health, via: 'management-api'|'privileged' } or a fail().
 */
async function scrapeText(env) {
  const cfg = mgmtConfig();
  if (cfg.ok) {
    try {
      const res = await timed(`https://api.supabase.com/v1/projects/${cfg.ref}/analytics/endpoints/metrics`, {
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'text/plain' },
      }, 5000);
      if (res.ok) return { text: await res.text(), via: 'management-api' };
    } catch { /* fall through to the privileged endpoint */ }
  }
  const auth = Buffer.from(`service_role:${env.serviceKey}`).toString('base64');
  const res = await timed(`${env.supabaseUrl}/customer/v1/privileged/metrics`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'text/plain' },
  });
  // 401/403 here: the endpoint wants a new-style secret key (sb_secret_…)
  // and SUPABASE_SERVICE_ROLE_KEY holds a legacy JWT, or vice versa.
  if (!res.ok) return { status: res.status };
  return { text: await res.text(), via: 'privileged' };
}

async function readMetrics(env) {
  if (Date.now() - metricsCache.at < HEALTH_TTL && metricsCache.value) return metricsCache.value;
  let value;
  try {
    const s = await scrapeText(env);
    if (s.text == null) {
      value = fail('unavailable', `Metrics endpoint answered ${s.status}.`);
    } else {
      const { health, cpu } = metricsHealth(parsePrometheus(s.text), cpuPrev);
      // The source refreshes once a minute; a scrape that has not moved
      // keeps the previous sample (and repeats the last figure) so the
      // next real change still has something to diff against.
      if (cpu && (!cpuPrev || cpu.total !== cpuPrev.total)) {
        if (health.cpuPct != null) cpuLastPct = health.cpuPct;
        cpuPrev = cpu;
      } else if (cpu && cpuPrev && cpu.total === cpuPrev.total && cpuLastPct != null) {
        health.cpuPct = cpuLastPct;
        health.cpuBasis = 'delta';
      }
      value = { ok: true, health, via: s.via };
    }
  } catch {
    value = fail('unavailable', 'Metrics endpoint unreachable.');
  }
  metricsCache.at = Date.now();
  metricsCache.value = value;
  return value;
}

/** public.owner_db_stats() — service role only (security_console_2026_10.sql). */
async function readDbStats(env) {
  if (Date.now() - statsCache.at < HEALTH_TTL && statsCache.value) return statsCache.value;
  let value;
  try {
    const res = await rest(env, 'rpc/owner_db_stats', { method: 'POST', body: '{}' });
    if (missing(res)) value = fail('not_configured', HINTS.sql);
    else if (!res.ok) value = fail('unavailable', `owner_db_stats answered ${res.status}.`);
    else value = { ok: true, stats: await res.json() };
  } catch {
    value = fail('unavailable', 'owner_db_stats unreachable.');
  }
  statsCache.at = Date.now();
  statsCache.value = value;
  return value;
}

const n = v => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Merge both sources into the panel's `health` + `tables`.
 * Metrics answer CPU / memory / disk; the RPC answers size, connection
 * states, cache hit and dead tuples. Either alone still fills what it can.
 */
async function databaseHealth(env) {
  const [m, s] = await Promise.all([readMetrics(env), readDbStats(env)]);
  const mh = m.ok ? m.health : null;
  const st = s.ok ? s.stats || {} : null;
  const conn = st?.connections || {};
  const health = {
    cpuPct: mh?.cpuPct ?? null,
    cpuBasis: mh?.cpuBasis ?? null,
    load1: mh?.load1 ?? null,
    cores: mh?.cores ?? null,
    memPct: mh?.memPct ?? null,
    diskUsedPct: mh?.diskUsedPct ?? null,
    diskUsedBytes: mh?.diskUsedBytes ?? null,
    diskSizeBytes: mh?.diskSizeBytes ?? null,
    dbSizeBytes: n(st?.db_size_bytes),
    connections: {
      active: n(conn.active) ?? mh?.connections?.active ?? null,
      idle: n(conn.idle),
      total: n(conn.total) ?? mh?.connections?.active ?? null,
      max: n(st?.max_connections) ?? mh?.connections?.max ?? null,
    },
    cacheHitPct: n(st?.cache_hit_pct),
    uptimeSec: mh?.uptimeSec ?? n(st?.uptime_sec),
    deadTupleRatio: n(st?.dead_tuple_ratio),
  };
  const tables = Array.isArray(st?.tables)
    ? st.tables.slice(0, 10).map(t => ({ name: String(t.name), rows: n(t.rows), bytes: n(t.bytes) }))
    : [];
  return {
    health,
    tables,
    metricsSource: m.ok ? 'privileged-metrics' : s.ok ? 'rpc' : null,
    metricsVia: m.ok ? m.via : null,
    metrics: m.ok ? { ok: true } : m,
    rpc: s.ok ? { ok: true } : s,
  };
}

// ── Supabase Management API (optional PAT) ───────────────────────────

function mgmtConfig() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) return fail('not_configured', HINTS.supabasePat);
  const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(process.env.SUPABASE_URL);
  if (!ref) return fail('not_configured', HINTS.supabaseRef);
  return { ok: true, token, ref };
}

async function mgmtGet(cfg, path) {
  const res = await timed(`https://api.supabase.com/v1/projects/${cfg.ref}${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error('mgmt auth'); e.hint = 'SUPABASE_ACCESS_TOKEN was refused — expired, revoked or missing a scope.'; throw e;
  }
  if (res.status === 429) { const e = new Error('mgmt rate'); e.hint = 'Management API rate limit — try again in a minute.'; throw e; }
  if (!res.ok) { const e = new Error(`mgmt ${res.status}`); e.hint = `Management API answered ${res.status}.`; throw e; }
  return res.json();
}

const trafficCache = new Map();   // interval → { at, value }
// usage.api-counts allows 30 requests a minute; one per interval per
// warm instance per 90 s keeps the console far below that.
const TRAFFIC_TTL = 90_000;

/** GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts?interval= */
async function readTraffic(interval = '1day') {
  const iv = API_COUNT_INTERVALS[interval] != null ? interval : '1day';
  const cfg = mgmtConfig();
  if (!cfg.ok) return cfg;
  const hit = trafficCache.get(iv);
  if (hit && Date.now() - hit.at < TRAFFIC_TTL) return hit.value;
  let value;
  try {
    const body = await mgmtGet(cfg, `/analytics/endpoints/usage.api-counts?interval=${iv}`);
    // `error` can be set on a 200; series may then be empty or partial.
    const upstreamError = apiCountsError(body);
    const shaped = shapeApiCounts(body, iv);
    value = upstreamError && !shaped.series.length
      ? fail('unavailable', `Supabase analytics: ${upstreamError}`)
      : { ok: true, ...shaped, ...(upstreamError ? { warning: upstreamError } : {}) };
  } catch (e) {
    value = fail('unavailable', e.hint || 'Management API unreachable.');
  }
  trafficCache.set(iv, { at: Date.now(), value });
  return value;
}

const advisorsCache = { at: 0, value: null };
const ADVISORS_TTL = 10 * 60_000;   // lints are computed upstream; they change on schema edits

/** GET /v1/projects/{ref}/advisors/security and /advisors/performance. */
async function readAdvisors({ fresh = false } = {}) {
  const cfg = mgmtConfig();
  if (!cfg.ok) return cfg;
  if (!fresh && advisorsCache.value && Date.now() - advisorsCache.at < ADVISORS_TTL) return advisorsCache.value;
  let value;
  try {
    const [sec, perf] = await Promise.all([
      mgmtGet(cfg, '/advisors/security'),
      mgmtGet(cfg, '/advisors/performance'),
    ]);
    value = { ok: true, security: shapeLints(sec), performance: shapeLints(perf) };
  } catch (e) {
    value = fail('unavailable', e.hint || 'Management API unreachable.');
  }
  advisorsCache.at = Date.now();
  advisorsCache.value = value;
  return value;
}

// ── Accepted advisor findings (public.security_accepted_findings) ────

/**
 * cache_keys the owner has accepted (a known, deliberate finding that
 * should stop counting). → Set, or null when the table is not there.
 */
async function readAccepted(env) {
  try {
    const res = await rest(env, 'security_accepted_findings?select=cache_key&limit=2000');
    if (!res.ok) return null;
    return new Set((await res.json()).map(r => r.cache_key));
  } catch {
    return null;
  }
}

/** Advisors with `accepted` marked on each lint, and the unaccepted ERROR count. */
async function advisorsWithAcceptance(env, opts) {
  const adv = await readAdvisors(opts);
  if (!adv.ok) return adv;
  const keys = await readAccepted(env);
  const mark = l => ({ ...l, accepted: !!(keys && l.cache_key && keys.has(l.cache_key)) });
  const security = adv.security.map(mark);
  const performance = adv.performance.map(mark);
  return {
    ok: true,
    security,
    performance,
    acceptedInstalled: keys !== null,
    counts: {
      securityErrors: security.filter(l => l.level === 'ERROR' && !l.accepted).length,
      accepted: [...security, ...performance].filter(l => l.accepted).length,
    },
  };
}

/** → 'ok' | 'missing'. Throws on other failures. */
async function setAccepted(env, ownerId, cacheKey, on, note) {
  const res = on
    ? await rest(env, 'security_accepted_findings', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        cache_key: cacheKey, note: note || null, accepted_by: ownerId, accepted_at: new Date().toISOString(),
      }),
    })
    : await rest(env, `security_accepted_findings?cache_key=eq.${encodeURIComponent(cacheKey)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });
  if (missing(res)) return 'missing';
  if (!res.ok) throw new Error(`accept ${res.status}`);
  return 'ok';
}

// ── Netlify API (optional PAT) ───────────────────────────────────────

/** Dashboard links from SITE_NAME (a read-only runtime variable) — no token needed. */
function siteLinks() {
  return netlifyLinks(process.env.SITE_NAME);
}

function netlifyConfig() {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.VANTAGE_NETLIFY_TOKEN;
  if (!token) return fail('not_configured', HINTS.netlifyToken);
  // SITE_ID is a read-only variable Netlify provides to functions at runtime.
  const siteId = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  if (!siteId) return fail('not_configured', HINTS.netlifySite);
  return { ok: true, token, siteId };
}

async function netlifyGet(cfg, path) {
  const res = await timed(`https://api.netlify.com/api/v1${path}`, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      'User-Agent': 'Vantage security console',
    },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error('netlify auth'); e.hint = 'NETLIFY_AUTH_TOKEN was refused — expired or revoked.'; throw e;
  }
  if (!res.ok) { const e = new Error(`netlify ${res.status}`); e.hint = `Netlify API answered ${res.status}.`; throw e; }
  return res.json();
}

const netlifyCache = { at: 0, value: null };
const NETLIFY_TTL = 60_000;

/** GET /sites/{id} + /sites/{id}/deploys?per_page=10 → { site, deploys, functions }. */
async function readNetlify() {
  const cfg = netlifyConfig();
  if (!cfg.ok) return cfg;
  if (netlifyCache.value && Date.now() - netlifyCache.at < NETLIFY_TTL) return netlifyCache.value;
  let value;
  try {
    const sid = encodeURIComponent(cfg.siteId);
    const [site, deploys] = await Promise.all([
      netlifyGet(cfg, `/sites/${sid}`),
      netlifyGet(cfg, `/sites/${sid}/deploys?per_page=10`),
    ]);
    value = {
      ok: true,
      site: shapeSite(site),
      deploys: (Array.isArray(deploys) ? deploys : []).slice(0, 10).map(shapeDeploy),
      functions: shapeFunctions(site),
      links: netlifyLinks(site?.name) || siteLinks(),
    };
  } catch (e) {
    value = fail('unavailable', e.hint || 'Netlify API unreachable.');
  }
  netlifyCache.at = Date.now();
  netlifyCache.value = value;
  return value;
}

/** Latest PRODUCTION deploy (the sweep's question), from the same cache when warm. */
async function latestProductionDeploy() {
  const cfg = netlifyConfig();
  if (!cfg.ok) return cfg;
  try {
    const list = await netlifyGet(cfg, `/sites/${encodeURIComponent(cfg.siteId)}/deploys?per_page=1&production=true`);
    const d = Array.isArray(list) && list[0];
    return { ok: true, deploy: d ? shapeDeploy(d) : null };
  } catch (e) {
    return fail('unavailable', e.hint || 'Netlify API unreachable.');
  }
}

// ── Web vitals (public.web_vitals) ───────────────────────────────────

const vitalsCache = new Map();    // days → { at, value }
const VITALS_TTL = 5 * 60_000;
const VITALS_ROW_CAP = 5000;

async function readVitalsRows(env, sinceIso, cols = 'path,device,lcp,inp,cls,ttfb,fcp') {
  const res = await rest(env,
    `web_vitals?occurred_at=gte.${encodeURIComponent(sinceIso)}&select=${cols}` +
    `&order=occurred_at.desc&limit=${VITALS_ROW_CAP}`);
  if (missing(res)) return fail('not_configured', HINTS.sql);
  if (!res.ok) return fail('unavailable', `web_vitals read ${res.status}.`);
  return { ok: true, rows: await res.json() };
}

async function readVitals(env, days = 7) {
  const d = Math.max(1, Math.min(28, Math.round(days) || 7));
  const hit = vitalsCache.get(d);
  if (hit && Date.now() - hit.at < VITALS_TTL) return hit.value;
  let value;
  try {
    const since = new Date(Date.now() - d * 86400_000).toISOString();
    const r = await readVitalsRows(env, since);
    value = r.ok ? { ok: true, ...summariseVitals(r.rows, { windowDays: d }), capped: r.rows.length >= VITALS_ROW_CAP } : r;
  } catch {
    value = fail('unavailable', 'web_vitals unreachable.');
  }
  vitalsCache.set(d, { at: Date.now(), value });
  return value;
}

// ── Tickets ──────────────────────────────────────────────────────────

/**
 * Raise (or bump, or re-open) an auto ticket by fingerprint, atomically,
 * via public.security_ticket_raise.
 * → { result: 'ok'|'missing'|'failed', row: { id, status, count } | null }
 * The RPC returns the row AFTER the upsert: count 1 means new.
 */
async function raiseTicketRow(env, c) {
  try {
    const res = await rest(env, 'rpc/security_ticket_raise', {
      method: 'POST',
      body: JSON.stringify({
        p_fingerprint: c.fingerprint, p_kind: c.kind, p_severity: c.severity,
        p_title: c.title, p_detail: c.detail || {},
      }),
    }, 5000);
    if (missing(res)) return { result: 'missing', row: null };
    if (!res.ok) return { result: 'failed', row: null };
    let row = null;
    try {
      const b = await res.json();
      const r = Array.isArray(b) ? b[0] : b;
      if (r && typeof r === 'object' && r.id) row = { id: String(r.id), status: r.status || null, count: Number(r.count) || null };
    } catch { /* an empty body still means it was written */ }
    return { result: 'ok', row };
  } catch {
    return { result: 'failed', row: null };
  }
}

/** → 'ok' | 'missing' | 'failed' (the older shape, kept for callers). */
async function raiseTicket(env, c) {
  return (await raiseTicketRow(env, c)).result;
}

/**
 * Current status of the tickets behind these fingerprints, BEFORE a
 * sweep writes — the RPC's return cannot tell "re-opened" from "still
 * open", and a re-opened critical is worth a ping. One small indexed
 * read (fingerprint is unique), only for candidates at the alert
 * threshold. → Map fingerprint → status; empty on any failure.
 */
async function ticketStatuses(env, fingerprints) {
  const fps = [...new Set((fingerprints || []).filter(f => typeof f === 'string' && /^[a-z0-9_.:-]{1,200}$/.test(f)))].slice(0, 50);
  if (!fps.length) return new Map();
  try {
    const list = fps.map(f => `"${f}"`).join(',');
    const res = await rest(env, `security_tickets?fingerprint=in.(${encodeURIComponent(list)})&select=fingerprint,status`, {}, 3000);
    if (!res.ok) return new Map();
    return new Map((await res.json()).map(r => [r.fingerprint, r.status]));
  } catch {
    return new Map();
  }
}

// ── Client error groups (public.client_errors) ───────────────────────

const errorGroupsCache = new Map();   // window → { at, value }
const ERROR_GROUPS_TTL = 60_000;
const ERROR_ROW_CAP = 1000;
const ERROR_WINDOWS = { '1h': 3600_000, '24h': 86400_000 };

/**
 * The top error groups for the last hour / day — what the
 * client_errors_spike ticket points at, and what a triage agent needs to
 * find the bug. user_id is NEVER selected. One bounded read (newest
 * 1,000 rows of the window), cached a minute per warm instance.
 * → { ok, window, total, sampled, capped, groups } | fail()
 */
async function readErrorGroups(env, windowKey = '24h') {
  const w = ERROR_WINDOWS[windowKey] ? windowKey : '24h';
  const hit = errorGroupsCache.get(w);
  if (hit && Date.now() - hit.at < ERROR_GROUPS_TTL) return hit.value;
  let value;
  try {
    const since = new Date(Date.now() - ERROR_WINDOWS[w]).toISOString();
    const res = await rest(env,
      `client_errors?occurred_at=gte.${encodeURIComponent(since)}&select=message,stack,url,release,kind,occurred_at` +
      `&order=occurred_at.desc&limit=${ERROR_ROW_CAP}`, { headers: { Prefer: 'count=exact' } });
    if (missing(res)) value = fail('not_configured', 'Run supabase/audit_schema_2026_10.sql (client_errors).');
    else if (!res.ok) value = fail('unavailable', `client_errors read ${res.status}.`);
    else {
      const rows = await res.json();
      const total = parseInt((res.headers.get('content-range') || '').split('/')[1], 10);
      value = {
        ok: true,
        window: w,
        total: Number.isFinite(total) ? total : rows.length,
        sampled: rows.length,
        capped: rows.length >= ERROR_ROW_CAP,
        groups: groupClientErrors(rows, { limit: 10 }),
      };
    }
  } catch {
    value = fail('unavailable', 'client_errors unreachable.');
  }
  errorGroupsCache.set(w, { at: Date.now(), value });
  return value;
}

// ── Links out (no tokens needed) ─────────────────────────────────────

/**
 * Where "go to source" may send the owner outside the app: the Netlify
 * site's dashboard (SITE_NAME, a runtime variable — or the cached API
 * answer when the token is set) and the Supabase project's dashboard
 * (ref from SUPABASE_URL / SUPABASE_PROJECT_REF). Neither is secret;
 * both are derived here so the client never hard-codes them.
 */
async function consoleLinks() {
  let siteName = process.env.SITE_NAME || null;
  if (!siteName && netlifyConfig().ok && netlifyCache.value && netlifyCache.value.ok) {
    siteName = netlifyCache.value.site?.name || null;
  }
  const nl = netlifyLinks(siteName);
  const ref = process.env.SUPABASE_PROJECT_REF || projectRefFromUrl(process.env.SUPABASE_URL);
  return {
    netlifySite: nl ? siteName : null,
    netlify: nl,
    supabase: supabaseLinks(ref),
  };
}

module.exports = {
  supabaseEnv, timed, fail, HINTS, rest, missing, countRows, pingDb,
  readMetrics, readDbStats, databaseHealth,
  mgmtConfig, readTraffic, readAdvisors, readAccepted, advisorsWithAcceptance, setAccepted,
  netlifyConfig, readNetlify, latestProductionDeploy, siteLinks,
  readVitals, readVitalsRows, raiseTicket, raiseTicketRow, ticketStatuses,
  readErrorGroups, consoleLinks, ERROR_WINDOWS,
};

/**
 * Shaping upstream answers into the Security console's response shapes.
 * Pure: no fetch, no env. Tested by securityShape.test.mjs
 * (npm run check:secshape).
 *
 * Everything that leaves here is a PROJECTION: named fields copied
 * across, nothing spread. The Netlify site object in particular carries
 * build_settings.env and default_hooks_data.access_token — spreading it
 * into a response would hand those to the browser.
 */

// ── Supabase ─────────────────────────────────────────────────────────

/** `https://abcdefghijkl.supabase.co` → 'abcdefghijkl'; anything else → null. */
function projectRefFromUrl(url) {
  try {
    const host = new URL(String(url)).hostname;
    const m = host.match(/^([a-z0-9]{10,40})\.supabase\.(co|in)$/i);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * `interval` values accepted by GET /v1/projects/{ref}/analytics/
 * endpoints/usage.api-counts (Management API schema:
 * '15min' | '30min' | '1hr' | '3hr' | '1day' | '3day' | '7day'),
 * with the window each one covers in hours.
 */
const API_COUNT_INTERVALS = {
  '15min': 0.25, '30min': 0.5, '1hr': 1, '3hr': 3, '1day': 24, '3day': 72, '7day': 168,
};

/** Any timestamp shape analytics endpoints use → ISO string, or null. */
function toIso(ts) {
  if (ts == null || ts === '') return null;
  let ms;
  if (typeof ts === 'number' || /^\d+$/.test(String(ts))) {
    const n = Number(ts);
    // microseconds (Logflare), milliseconds, or seconds
    ms = n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000;
  } else {
    const s = String(ts);
    // "2026-10-01 12:00:00" / "2026-10-01T12:00:00" without a zone is UTC.
    const zoned = /([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
    ms = Date.parse(zoned);
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * usage.api-counts → { windowHours, series:[{t,rest,auth,storage,realtime}], totals }.
 * Response rows carry total_rest_requests, total_auth_requests,
 * total_storage_requests, total_realtime_requests and timestamp, under
 * `result` (Studio's UsageApiCounts type).
 */
function shapeApiCounts(body, interval = '1day') {
  const rows = Array.isArray(body?.result) ? body.result : Array.isArray(body) ? body : [];
  const series = rows
    .map(r => ({
      t: toIso(r.timestamp),
      rest: num(r.total_rest_requests),
      auth: num(r.total_auth_requests),
      storage: num(r.total_storage_requests),
      realtime: num(r.total_realtime_requests),
    }))
    .filter(r => r.t)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const totals = { rest: 0, auth: 0, storage: 0, realtime: 0, all: 0 };
  for (const p of series) {
    totals.rest += p.rest; totals.auth += p.auth;
    totals.storage += p.storage; totals.realtime += p.realtime;
  }
  totals.all = totals.rest + totals.auth + totals.storage + totals.realtime;
  return { windowHours: API_COUNT_INTERVALS[interval] ?? 24, interval, series, totals };
}

const LEVEL_ORDER = { ERROR: 0, WARN: 1, INFO: 2 };
const MAX_LINTS = 150;

/** A flat object of short scalar values, or null — lint metadata is display-only. */
function smallObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  for (const [k, v] of Object.entries(o).slice(0, 8)) {
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

/**
 * usage.api-counts can answer 200 with `error` set (a string, or
 * { code, errors, message, status }). → a short message, or null.
 */
function apiCountsError(body) {
  const e = body?.error;
  if (e == null || e === '') return null;
  if (typeof e === 'string') return e.slice(0, 200);
  return String(e.message || e.code || 'error').slice(0, 200);
}

/**
 * Advisors (GET /v1/projects/{ref}/advisors/security|performance) answer
 * `{ lints: [{ name, title, level: 'ERROR'|'WARN'|'INFO', facing,
 * categories, description, detail, remediation, metadata, cache_key }] }`.
 * → [{ level, title, detail, remediation, name, categories }], errors first.
 */
function shapeLints(body) {
  const lints = Array.isArray(body?.lints) ? body.lints : Array.isArray(body) ? body : [];
  return lints
    .filter(l => l && typeof l === 'object')
    .map(l => ({
      level: String(l.level || 'INFO').toUpperCase(),
      title: String(l.title || l.name || 'Advisor finding').slice(0, 200),
      detail: String(l.detail || l.description || '').slice(0, 1000),
      remediation: typeof l.remediation === 'string' ? l.remediation.slice(0, 500) : null,
      name: l.name ? String(l.name).slice(0, 100) : null,
      categories: Array.isArray(l.categories) ? l.categories.map(String).slice(0, 5) : [],
      // cache_key is the finding's stable identity (what "accept" stores).
      cache_key: l.cache_key ? String(l.cache_key).slice(0, 300) : null,
      metadata: smallObject(l.metadata),
      observed_at: l.observed_at ? String(l.observed_at).slice(0, 40) : null,
    }))
    .sort((a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3))
    .slice(0, MAX_LINTS);
}

/**
 * Supabase dashboard pages for one project — where an alert's "go to
 * source" sends the owner. The ref is derived server-side from
 * SUPABASE_URL (projectRefFromUrl / SUPABASE_PROJECT_REF), so the client
 * never needs it hard-coded. The project root always resolves; the
 * sub-pages are where the dashboard keeps them today.
 */
function supabaseLinks(ref) {
  const r = typeof ref === 'string' && /^[a-z0-9]{10,40}$/i.test(ref) ? ref.toLowerCase() : null;
  if (!r) return null;
  const root = `https://supabase.com/dashboard/project/${r}`;
  return {
    project: root,
    reports: `${root}/reports/database`,
    advisors: `${root}/advisors/security`,
    tableEditor: `${root}/editor`,
  };
}

// ── Client errors (public.client_errors) → issue groups ─────────────

/**
 * The first frame of a stack that points at code, normalised so the
 * same bug groups together across visits: origin dropped (paths only),
 * query strings and fragments dropped, line:column kept.
 *   "TypeError: x\n    at Hub (https://site/assets/index-ab12.js:1:2345)"
 *     → "Hub (/assets/index-ab12.js:1:2345)"
 * → string, or null when there is no usable frame.
 */
function firstFrame(stack) {
  if (typeof stack !== 'string' || !stack) return null;
  const lines = stack.split('\n').map(l => l.trim()).filter(Boolean);
  // Chrome puts the message on line 1 and frames as "at …"; Firefox and
  // Safari write "fn@url:line:col".
  const frame = lines.find(l => /^at\s/.test(l)) || lines.find(l => /@\S*:\d+/.test(l));
  if (!frame) return null;
  const out = frame
    .replace(/^at\s+/, '')
    .replace(/https?:\/\/[^/\s)]+/g, '')
    .replace(/[?#][^:\s)]*(?=:\d)/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return out || null;
}

/** A message as a grouping key: trimmed, ids and long numbers collapsed. */
function messageKey(m) {
  return String(m || '').trim()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':id')
    .replace(/\b\d{4,}\b/g, ':n')
    .slice(0, 200);
}

/**
 * rows [{ message, stack, url, release, kind, occurred_at }] → the top
 * issue groups, most frequent first:
 *   [{ message, frame, kind, count, firstSeen, lastSeen, sampleUrl, release, releases }]
 * Grouped by message + first stack frame, the way Sentry groups by
 * stack. Callers must not select user_id: nothing here would pass it on,
 * but a column never read is a column that cannot leak. `sampleUrl` is
 * the latest occurrence's URL (client-error.js already dropped its
 * query and fragment).
 */
function groupClientErrors(rows, { limit = 10 } = {}) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || (!r.message && !r.stack)) continue;
    const message = messageKey(r.message) || '(no message)';
    const frame = firstFrame(r.stack);
    const key = `${message}\u0000${frame || ''}`;
    const at = Date.parse(r.occurred_at);
    let g = groups.get(key);
    if (!g) {
      g = { message, frame, kind: r.kind ? String(r.kind).slice(0, 32) : null, count: 0, firstMs: Infinity, lastMs: -Infinity, sampleUrl: null, rel: new Map() };
      groups.set(key, g);
    }
    g.count++;
    const url = r.url ? String(r.url).slice(0, 300) : null;
    if (Number.isFinite(at)) {
      if (at < g.firstMs) g.firstMs = at;
      if (at >= g.lastMs) { g.lastMs = at; g.sampleUrl = url || g.sampleUrl; }
    } else if (!g.sampleUrl) g.sampleUrl = url;
    const rel = r.release ? String(r.release).slice(0, 64) : null;
    if (rel) g.rel.set(rel, (g.rel.get(rel) || 0) + 1);
  }
  return [...groups.values()]
    .map(g => {
      const releases = [...g.rel.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
      return {
        message: g.message,
        frame: g.frame,
        kind: g.kind,
        count: g.count,
        firstSeen: Number.isFinite(g.firstMs) ? new Date(g.firstMs).toISOString() : null,
        lastSeen: Number.isFinite(g.lastMs) ? new Date(g.lastMs).toISOString() : null,
        sampleUrl: g.sampleUrl,
        release: releases[0] || null,
        releases: releases.slice(0, 5),
      };
    })
    .sort((a, b) => b.count - a.count || String(b.lastSeen).localeCompare(String(a.lastSeen)))
    .slice(0, Math.max(1, limit));
}

// ── Netlify ──────────────────────────────────────────────────────────

const str = (v, n = 300) => (v == null || v === '' ? null : String(v).slice(0, n));

/** Seconds a deploy took: the API's own deploy_time when present, else derived. */
function deploySeconds(d) {
  if (Number.isFinite(Number(d?.deploy_time)) && d.deploy_time !== null) return Math.round(Number(d.deploy_time));
  const start = Date.parse(d?.created_at);
  const end = Date.parse(d?.published_at || (d?.state === 'ready' || d?.state === 'error' ? d?.updated_at : ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function shapeDeploy(d) {
  return {
    id: str(d?.id, 64),
    state: str(d?.state, 32),
    createdAt: str(d?.created_at, 40),
    publishedAt: str(d?.published_at, 40),
    deployTimeSec: deploySeconds(d),
    branch: str(d?.branch, 120),
    commit: str(d?.commit_ref, 64),
    commitUrl: str(d?.commit_url, 300),
    title: str(d?.title, 200),
    errorMessage: str(d?.error_message, 500),
    context: str(d?.context, 40),
  };
}

function shapeSite(s) {
  const pd = s?.published_deploy || {};
  return {
    name: str(s?.name, 120),
    url: str(s?.ssl_url || s?.url, 300),
    adminUrl: str(s?.admin_url, 300),
    state: str(s?.state, 32),
    publishedAt: str(pd.published_at, 40),
    branch: str(pd.branch, 120),
    commit: str(pd.commit_ref, 64),
    deployId: str(pd.id, 64),
  };
}

/**
 * Function names from the published deploy. `available_functions`
 * (objects with an `n` name) is what the API returns in practice but is
 * NOT in the published OpenAPI schema; `function_schedules` is. So: the
 * first when present, the scheduled ones otherwise, null if neither.
 */
function shapeFunctions(site) {
  const pd = site?.published_deploy || {};
  if (Array.isArray(pd.available_functions)) {
    const names = pd.available_functions.map(f => str(f?.n || f?.name, 80)).filter(Boolean).sort();
    return { count: names.length, names, basis: 'deploy' };
  }
  if (Array.isArray(pd.function_schedules)) {
    const names = pd.function_schedules.map(f => str(f?.name, 80)).filter(Boolean).sort();
    return { count: null, names, scheduled: pd.function_schedules.map(f => ({ name: str(f?.name, 80), cron: str(f?.cron, 40) })), basis: 'schedules' };
  }
  return { count: null, names: [], basis: null };
}

/**
 * Overview's one-line verdict.
 *   status  { db, netlify, app }: 'ok'|'degraded'|'down'|'not_configured'
 *   counts  { criticalTickets, advisorsError } (null = unknown)
 * issues = parts degraded/down + open critical tickets + unaccepted
 * advisor ERRORs. 'down' when the database or the app is down;
 * 'degraded' when there is any issue; else 'operational'.
 */
function verdictOf(status = {}, counts = {}) {
  const parts = ['db', 'netlify', 'app'].map(k => status[k]);
  const statusIssues = parts.filter(s => s === 'degraded' || s === 'down').length;
  const issues = statusIssues + (Number(counts.criticalTickets) || 0) + (Number(counts.advisorsError) || 0);
  const verdict = status.db === 'down' || status.app === 'down' ? 'down' : issues > 0 ? 'degraded' : 'operational';
  return { verdict, issues };
}

/**
 * Netlify has no API for Observability, function invocations or (on
 * credit plans, officially) bandwidth, so the console links out. The
 * site root and /deploys are long-standing dashboard paths; the others
 * are where the dashboard keeps them today and may move — the root
 * always resolves.
 */
function netlifyLinks(siteName) {
  const name = typeof siteName === 'string' && /^[a-z0-9-]{1,63}$/i.test(siteName) ? siteName : null;
  if (!name) return null;
  const root = `https://app.netlify.com/sites/${name}`;
  return {
    dashboard: root,
    deploys: `${root}/deploys`,
    functions: `${root}/logs/functions`,
    observability: `${root}/observability`,
    webSecurity: `${root}/security`,
  };
}

// ── Web vitals ───────────────────────────────────────────────────────

const VITALS = ['lcp', 'inp', 'cls', 'ttfb', 'fcp'];

/**
 * Google's thresholds at the 75th percentile (web.dev/articles/vitals,
 * /lcp, /inp, /cls, /fcp, /ttfb): [good ≤, poor >]. ms except CLS.
 */
const VITAL_THRESHOLDS = {
  lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25], fcp: [1800, 3000], ttfb: [800, 1800],
};

/** Linear-interpolated percentile (same as Postgres percentile_cont). */
function percentile(values, p) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

function rate(metric, value) {
  if (value == null) return null;
  const [good, poor] = VITAL_THRESHOLDS[metric];
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-improvement';
}

function p75Of(rows) {
  const out = {};
  for (const m of VITALS) {
    const p = percentile(rows.map(r => (r[m] == null ? NaN : Number(r[m]))), 0.75);
    out[m] = p == null ? null : m === 'cls' ? Math.round(p * 1000) / 1000 : Math.round(p);
  }
  return out;
}

/**
 * rows [{ path, device, lcp, inp, cls, ttfb, fcp }] →
 * { p75, ratings, samples, byPage:[{path, samples, p75}], byDevice }.
 */
function summariseVitals(rows, { pages = 15, windowDays = 7 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const p75 = p75Of(list);
  const ratings = {};
  for (const m of VITALS) ratings[m] = rate(m, p75[m]);

  const groups = new Map();
  for (const r of list) {
    const k = r.path || '/';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const byPage = [...groups.entries()]
    .map(([path, rs]) => ({ path, samples: rs.length, p75: p75Of(rs) }))
    .sort((a, b) => b.samples - a.samples || (a.path < b.path ? -1 : 1))
    .slice(0, pages);

  const byDevice = {};
  for (const d of ['mobile', 'tablet', 'desktop']) {
    const rs = list.filter(r => r.device === d);
    if (rs.length) byDevice[d] = { samples: rs.length, p75: p75Of(rs) };
  }
  return { windowDays, p75, ratings, thresholds: VITAL_THRESHOLDS, samples: list.length, byPage, byDevice };
}

const NAV_TYPES = new Set(['navigate', 'reload', 'back_forward', 'back-forward', 'prerender', 'restore', 'back-forward-cache']);
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);

/** Path only, no query/fragment, ids collapsed, short. Null if unusable. */
function cleanPath(p) {
  if (typeof p !== 'string' || !p) return null;
  let s = p.split(/[?#]/)[0];
  if (!s.startsWith('/')) return null;
  s = s
    .split('/')
    .map(seg => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{3,}$/.test(seg) || seg.length > 40 ? ':id' : seg))
    .join('/')
    .replace(/[^\w/.:-]/g, '')
    .slice(0, 120);
  return s || '/';
}

function clampMetric(v, max) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 1000) / 1000;
}

/**
 * Validate one beacon body into a web_vitals row, or null to drop it.
 * Nothing but these eight fields is ever stored — no user, no IP, no UA.
 */
function shapeVitalsRow(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const path = cleanPath(b.path);
  if (!path) return null;
  const row = {
    path,
    lcp: clampMetric(b.lcp, 120000),
    inp: clampMetric(b.inp, 60000),
    cls: clampMetric(b.cls, 50),
    ttfb: clampMetric(b.ttfb, 120000),
    fcp: clampMetric(b.fcp, 120000),
    nav_type: NAV_TYPES.has(b.nav) ? String(b.nav).replace('_', '-') : null,
    device: DEVICES.has(b.device) ? b.device : null,
  };
  if (VITALS.every(m => row[m] == null)) return null;
  return row;
}

module.exports = {
  projectRefFromUrl, supabaseLinks, firstFrame, groupClientErrors,
  API_COUNT_INTERVALS, toIso, shapeApiCounts, shapeLints,
  shapeDeploy, shapeSite, shapeFunctions, deploySeconds, netlifyLinks, apiCountsError, verdictOf,
  VITALS, VITAL_THRESHOLDS, percentile, summariseVitals, shapeVitalsRow, cleanPath,
};

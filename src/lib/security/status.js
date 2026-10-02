/**
 * Reading what /.netlify/functions/security-console answers, and the
 * small state derivations every panel of the Security console shares.
 *
 * The function is new and lands independently of this UI, its SQL is
 * run by hand, and each of its panels fails soft on its own:
 *   { ok:false, reason:'not_configured'|'unavailable', hint }
 * So nothing here trusts a field to exist. A missing endpoint (404,
 * 501, or the SPA's index.html under `vite` alone) reads as
 * "not installed", never as an error and never as a healthy zero.
 *
 * Pure: status.test.mjs pins it (npm run check:secstatus).
 */
import { num, toMs } from './format.js';

// ── Whole-response reading ────────────────────────────────────────

/**
 * @returns {{ state: 'ok'|'not_configured'|'unavailable'|'not-installed'|'forbidden'|'error',
 *             data?: object, hint?: string, error?: string }}
 */
export function readPanel(status, raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (/^\s*<(?:!doctype|html)/i.test(text)) return { state: 'not-installed' };
  if (status === 404 || status === 501) return { state: 'not-installed' };
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (status === 401 || status === 403) return { state: 'forbidden', error: 'Owner only — sign in again if this is you.' };
  if (status === 429) return { state: 'error', error: 'Too many requests — try again in a minute.' };
  if (status < 200 || status >= 300) {
    return { state: 'error', error: (body && typeof body.error === 'string' && body.error) || `The console didn't answer (HTTP ${status}).` };
  }
  if (!body || typeof body !== 'object') return { state: 'error', error: 'The console sent something unreadable.' };
  const sub = part(body);
  if (sub.state !== 'ok') return sub;
  return { state: 'ok', data: body };
}

/**
 * One section inside a panel (e.g. database.traffic) — the same
 * fail-soft envelope, one level down.
 * @returns {{ state: 'ok'|'not_configured'|'unavailable'|'missing', data?: any, hint?: string }}
 */
export function part(x) {
  if (x == null) return { state: 'missing' };
  if (typeof x === 'object' && x.ok === false) {
    const reason = x.reason === 'not_configured' ? 'not_configured' : 'unavailable';
    return { state: reason, hint: typeof x.hint === 'string' ? x.hint : '' };
  }
  return { state: 'ok', data: x };
}

// ── State pills ───────────────────────────────────────────────────

export const PILL = {
  ok: { key: 'ok', label: 'OK' },
  degraded: { key: 'degraded', label: 'Degraded' },
  down: { key: 'down', label: 'Down' },
  off: { key: 'off', label: 'Not configured' },
  busy: { key: 'busy', label: 'Working' },
  unknown: { key: 'unknown', label: 'Unknown' },
};

const OK = new Set(['ok', 'healthy', 'up', 'ready', 'pass', 'passing', 'green', 'operational', 'good']);
const DEGRADED = new Set(['degraded', 'slow', 'warn', 'warning', 'partial', 'amber', 'yellow']);
const DOWN = new Set(['down', 'error', 'failed', 'fail', 'unreachable', 'critical', 'red', 'outage']);
const OFF = new Set(['not_configured', 'not-configured', 'unconfigured', 'disabled', 'off']);

/**
 * A system's state from whatever the backend sent: a string, a boolean,
 * or an object carrying `state`/`status` (+ an optional `detail`).
 * → { key, label, detail }
 */
export function pillState(v) {
  let raw = v, detail = '';
  if (v && typeof v === 'object') {
    raw = v.state ?? v.status ?? (v.ok === true ? 'ok' : v.ok === false ? (v.reason || 'down') : null);
    detail = typeof v.detail === 'string' ? v.detail : typeof v.hint === 'string' ? v.hint : '';
  }
  if (raw === true) raw = 'ok';
  if (raw === false) raw = 'down';
  const s = String(raw ?? '').toLowerCase().trim();
  const base = OK.has(s) ? PILL.ok : DEGRADED.has(s) ? PILL.degraded : DOWN.has(s) ? PILL.down
    : OFF.has(s) ? PILL.off : PILL.unknown;
  return { ...base, detail };
}

/** Netlify deploy state → pill. https://docs.netlify.com deploy states. */
export function deployPill(state) {
  const s = String(state || '').toLowerCase();
  if (s === 'ready' || s === 'published') return { key: 'ok', label: 'Published' };
  if (s === 'error' || s === 'failed') return { key: 'down', label: 'Failed' };
  if (s === 'rejected') return { key: 'down', label: 'Rejected' };
  if (s === 'cancelled' || s === 'canceled') return { key: 'off', label: 'Cancelled' };
  if (s === 'skipped') return { key: 'off', label: 'Skipped' };
  if (['building', 'processing', 'processed', 'uploading', 'uploaded', 'enqueued', 'new', 'prepared', 'preparing', 'retrying', 'pending_review', 'accepted'].includes(s)) {
    return { key: 'busy', label: s === 'enqueued' || s === 'new' ? 'Queued' : 'Building' };
  }
  return { key: 'unknown', label: s ? s[0].toUpperCase() + s.slice(1) : 'Unknown' };
}

/** A utilisation percentage → 'ok' | 'warn' | 'bad' | null. */
export function meterTone(pct, warn = 70, bad = 85) {
  const n = num(pct);
  if (n == null) return null;
  if (n >= bad) return 'bad';
  if (n >= warn) return 'warn';
  return 'ok';
}

/** Cache hit ratio is the other way up: high is good. */
export function cacheTone(pct) {
  const n = num(pct);
  if (n == null) return null;
  if (n < 90) return 'bad';
  if (n < 99) return 'warn';
  return 'ok';
}

// ── Severity ──────────────────────────────────────────────────────

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export function normSeverity(s) {
  const v = String(s || '').toLowerCase();
  return SEVERITIES.includes(v) ? v : 'low';
}
export const sevRank = s => SEVERITIES.indexOf(normSeverity(s));

/** Supabase advisor level (ERROR / WARN / INFO) → tone + label. */
export function advisorLevel(level) {
  const v = String(level || '').toUpperCase();
  if (v === 'ERROR') return { key: 'bad', label: 'Error' };
  if (v === 'WARN' || v === 'WARNING') return { key: 'warn', label: 'Warn' };
  return { key: 'info', label: 'Info' };
}

/** Advisors, errors first, then warnings, then info — stable within a level. */
export function sortAdvisors(list) {
  const rank = l => ({ bad: 0, warn: 1, info: 2 })[advisorLevel(l).key];
  return (Array.isArray(list) ? list : [])
    .filter(a => a && typeof a === 'object')
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a.level) - rank(y.a.level) || x.i - y.i)
    .map(x => x.a);
}

/** Only an https remediation link is followed; anything else is dropped. */
export function safeHref(u) {
  return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null;
}

// ── Tickets ───────────────────────────────────────────────────────

export const TICKET_STATUSES = ['open', 'ack', 'resolved'];

export function normaliseTicket(t) {
  if (!t || typeof t !== 'object' || t.id == null) return null;
  const status = TICKET_STATUSES.includes(t.status) ? t.status : 'open';
  return {
    id: t.id,
    createdAt: t.created_at || t.createdAt || null,
    updatedAt: t.updated_at || t.updatedAt || null,
    lastSeenAt: t.last_seen_at || t.lastSeenAt || t.updated_at || t.created_at || null,
    source: ['auto', 'user', 'owner'].includes(t.source) ? t.source : 'auto',
    kind: typeof t.kind === 'string' ? t.kind : '',
    severity: normSeverity(t.severity),
    title: typeof t.title === 'string' && t.title ? t.title : 'Untitled ticket',
    detail: t.detail ?? null,
    status,
    count: Math.max(1, num(t.count) ?? 1),
    note: typeof t.note === 'string' ? t.note : '',
  };
}

/** Open before acknowledged before resolved; then severity; then most recent. */
export function sortTickets(list) {
  const sRank = s => TICKET_STATUSES.indexOf(s);
  return [...(list || [])].sort((a, b) =>
    sRank(a.status) - sRank(b.status)
    || sevRank(a.severity) - sevRank(b.severity)
    || (toMs(b.lastSeenAt) ?? 0) - (toMs(a.lastSeenAt) ?? 0));
}

export function filterTickets(list, { status = 'open', severity = 'all' } = {}) {
  return (list || []).filter(t =>
    (status === 'all' || t.status === status) && (severity === 'all' || t.severity === severity));
}

export function countTickets(list) {
  const c = { open: 0, ack: 0, resolved: 0, all: 0, critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of list || []) {
    c.all++;
    c[t.status]++;
    if (t.status !== 'resolved') c[t.severity]++;
  }
  return c;
}

/** Ticket detail (jsonb) → [label, value] rows for the drawer. */
export function detailRows(detail) {
  if (detail == null) return [];
  if (typeof detail === 'string') return detail ? [['', detail]] : [];
  if (typeof detail !== 'object') return [['', String(detail)]];
  if (Array.isArray(detail)) return detail.map((v, i) => [String(i + 1), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  return Object.entries(detail).slice(0, 30).map(([k, v]) => [
    k.replace(/_/g, ' '),
    v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
  ]);
}

/**
 * Sentry-style trend word under a ticket's count. Uses the backend's own
 * `trend` when it sends one; otherwise only what the row can support:
 * Escalating needs a recent-vs-previous count (count_24h / prev_count_24h),
 * New is a first sighting under a day old, Ongoing is anything still
 * open that has repeated or is older. Resolved tickets get no word.
 */
export function ticketTrend(t, now = Date.now(), raw = {}) {
  if (!t || t.status === 'resolved') return null;
  const given = String(raw.trend || '').toLowerCase();
  if (['new', 'ongoing', 'escalating', 'regressed'].includes(given)) return given[0].toUpperCase() + given.slice(1);
  const recent = num(raw.count_24h ?? raw.count24h), prev = num(raw.prev_count_24h ?? raw.prevCount24h);
  if (recent != null && prev != null && recent > prev && recent >= 3) return 'Escalating';
  const age = now - (toMs(t.createdAt) ?? now);
  if (t.count <= 1 && age < 86400e3) return 'New';
  return 'Ongoing';
}

// ── Advisors: counted tabs, accepted findings ─────────────────────

/** One lint, whatever subset of the Management API's shape arrived. */
export function normaliseLint(a, category) {
  if (!a || typeof a !== 'object') return null;
  const meta = a.metadata && typeof a.metadata === 'object' ? a.metadata : {};
  const entity = meta.schema && meta.name ? `${meta.schema}.${meta.name}`
    : meta.name || (String(a.detail || '').match(/`([^`]+)`/) || [])[1] || '';
  return {
    key: String(a.cache_key || a.cacheKey || `${a.name || a.title}:${entity}`),
    level: advisorLevel(a.level).key,
    title: a.title || a.name || 'Finding',
    name: a.name || '',
    category: String((Array.isArray(a.categories) && a.categories[0]) || category || '').toUpperCase(),
    entity,
    entityType: meta.type || '',
    issue: a.detail || '',
    description: a.description || '',
    remediation: safeHref(a.remediation),
    accepted: !!(a.accepted || a.accepted_at),
    acceptedNote: typeof a.accepted_note === 'string' ? a.accepted_note : (typeof a.note === 'string' ? a.note : ''),
  };
}

/**
 * Security + performance lints → { bad, warn, info, accepted } buckets.
 * Accepted findings (the owner said "known, fine") leave the counted
 * tabs — that is the point of accepting — and sit under Accepted.
 * `accepted` may also arrive as a separate list of cache keys.
 */
export function advisorBuckets(adv, acceptedKeys = null) {
  const keys = new Set((Array.isArray(acceptedKeys) ? acceptedKeys : (adv && adv.accepted) || [])
    .map(x => (x && typeof x === 'object' ? x.cache_key || x.cacheKey : x)).filter(Boolean));
  const out = { bad: [], warn: [], info: [], accepted: [] };
  for (const [cat, list] of [['SECURITY', adv && adv.security], ['PERFORMANCE', adv && adv.performance]]) {
    for (const raw of Array.isArray(list) ? list : []) {
      const l = normaliseLint(raw, cat);
      if (!l) continue;
      if (l.accepted || keys.has(l.key)) out.accepted.push({ ...l, accepted: true });
      else out[l.level].push(l);
    }
  }
  return out;
}

// ── Deploys ───────────────────────────────────────────────────────

/** Netlify's row heading: "Production: master@a1b2c3d", "Deploy Preview #219: branch@sha". */
export function deployHeadline(d) {
  if (!d) return 'Deploy';
  const sha = typeof d.commit === 'string' ? d.commit.slice(0, 7) : '';
  const ref = `${d.branch || '—'}${sha ? `@${sha}` : ''}`;
  const ctx = String(d.context || '').toLowerCase();
  if (ctx === 'deploy-preview') return `Deploy Preview${d.reviewId ? ` #${d.reviewId}` : ''}: ${ref}`;
  if (ctx === 'branch-deploy') return `Branch deploy: ${ref}`;
  if (ctx === 'production' || d.branch === 'master' || d.branch === 'main') return `Production: ${ref}`;
  return ref;
}

/** Build time in seconds: deployTimeSec, else published − created, else null. */
export function deployDuration(d) {
  if (!d) return null;
  const t = num(d.deployTimeSec);
  if (t != null && t >= 0) return t;
  const a = toMs(d.createdAt), b = toMs(d.publishedAt);
  return a != null && b != null && b >= a ? Math.round((b - a) / 1000) : null;
}

// ── Overview verdict ──────────────────────────────────────────────

/**
 * The one sentence the console opens on (Better Stack / UptimeRobot).
 * Uses overview.verdict / overview.issues when the backend sends them;
 * otherwise derives from the status strip and the counts.
 * → { key: 'ok'|'warn'|'bad'|'unknown', text, issues: string[] }
 */
export function verdictOf(ov) {
  const st = (ov && ov.status) || {};
  const c = (ov && ov.counts) || {};
  const given = Array.isArray(ov && ov.issues)
    ? ov.issues.map(i => (typeof i === 'string' ? i : i && (i.title || i.text))).filter(Boolean) : null;
  const issues = given || [];
  let bad = false, warn = false, known = 0;
  for (const [k, name] of SYS) {
    const p = pillState(st[k]);
    if (p.key === 'down') { bad = true; if (!given) issues.push(`${name === 'DB' ? 'Database' : name} is down${p.detail ? `: ${p.detail}` : ''}`); }
    else if (p.key === 'degraded') { warn = true; if (!given) issues.push(`${name === 'DB' ? 'Database' : name} is degraded${p.detail ? `: ${p.detail}` : ''}`); }
    if (p.key !== 'unknown') known++;
  }
  const crit = num(c.criticalTickets) || 0;
  if (crit) { bad = true; if (!given) issues.push(`${crit} critical ticket${crit === 1 ? '' : 's'}`); }
  const adv = num(c.advisorsError) || 0;
  if (adv) { warn = true; if (!given) issues.push(`${adv} security advisor error${adv === 1 ? '' : 's'}`); }
  let key = bad ? 'bad' : warn || issues.length ? 'warn' : known ? 'ok' : 'unknown';
  const v = ov && typeof ov.verdict === 'object' && ov.verdict ? ov.verdict : null;
  // The backend sends a state word ('operational'|'degraded'|'down'), not a
  // sentence: map it to a key and let the sentence below be written here.
  const WORD = { operational: 'ok', ok: 'ok', degraded: 'warn', down: 'bad' };
  const raw = typeof (ov && ov.verdict) === 'string' ? ov.verdict : null;
  if (raw && WORD[raw]) key = WORD[raw];
  const vText = raw && !WORD[raw] ? raw : v && v.text;
  if (v && ['ok', 'warn', 'bad'].includes(v.state || v.key)) key = v.state || v.key;
  const n = issues.length;
  const text = vText || (key === 'ok' ? 'All systems operational'
    : key === 'unknown' ? 'Status unknown'
      : `${n || 1} issue${n === 1 || !n ? '' : 's'} need${n === 1 || !n ? 's' : ''} attention`);
  return { key, text, issues };
}

// ── Overview → the home card's live line ──────────────────────────

const SYS = [['db', 'DB'], ['netlify', 'Netlify'], ['app', 'App']];

/**
 * → { line, sub, tone } for Upgrade's home menu.
 *   "2 tickets open · all systems ok", "1 critical · DB down"
 * Systems that aren't configured are left out of the line — they are
 * not a problem, and the home card is not the place to nag about setup.
 */
export function overviewLine(ov) {
  const st = (ov && ov.status) || {};
  const c = (ov && ov.counts) || {};
  const open = num(c.openTickets);
  const crit = num(c.criticalTickets) || 0;
  const reports = num(c.openReports) || 0;
  const bad = [], warn = [];
  let ok = 0;
  for (const [k, name] of SYS) {
    const p = pillState(st[k]);
    if (p.key === 'down') bad.push(`${name} down`);
    else if (p.key === 'degraded') warn.push(`${name} degraded`);
    else if (p.key === 'ok') ok++;
  }
  const systems = bad.length || warn.length ? [...bad, ...warn].join(' · ') : ok ? 'all systems ok' : null;
  const tickets = crit ? `${crit} critical` : open == null ? null : open ? `${open} ticket${open === 1 ? '' : 's'} open` : 'no open tickets';
  const parts = [tickets, systems].filter(Boolean);
  if (!parts.length && reports) parts.push(`${reports} report${reports === 1 ? '' : 's'} open`);
  const tone = bad.length || crit ? 'bad' : warn.length || open ? 'warn' : 'ok';
  const subBits = [];
  if (crit) subBits.push(`${crit} critical`);
  else if (open) subBits.push(`${open} ticket${open === 1 ? '' : 's'}`);
  if (bad.length) subBits.push(bad[0]);
  return { line: parts.join(' · ') || 'Security console', sub: subBits.length ? subBits.join(' · ') : null, tone };
}

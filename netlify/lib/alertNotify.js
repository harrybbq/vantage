/**
 * Critical alerts → the owner's phone.
 *
 * ══ Setup (three steps) ══════════════════════════════════════════════
 *  1. Install the ntfy app (iOS App Store / Google Play — free, no
 *     account) or open https://ntfy.sh in a browser.
 *  2. Make a long random topic name and subscribe to it in the app:
 *         openssl rand -hex 16          → e.g. vantage-3f9c…(32 hex)
 *     The topic IS the password: anyone who knows it can read the
 *     pings and send fake ones. Never commit it, never put it in a
 *     VITE_ variable, rotate it (new topic, re-subscribe) if it leaks.
 *  3. Netlify → Site configuration → Environment variables, scope
 *     Functions: ALERT_NTFY_TOPIC = that topic. Redeploy. Then press
 *     "Send test alert" in Upgrade → Security → Tickets.
 *
 * Optional env:
 *   ALERT_NTFY_SERVER   default https://ntfy.sh (a self-hosted server: https only)
 *   ALERT_NTFY_TOKEN    Bearer access token (tk_…) for a protected topic/server
 *   ALERT_MIN_SEVERITY  'critical' (default) or 'high'
 *   ALERT_WEBHOOK_URL   https URL; receives POST JSON {severity,title,headline,url}
 *                       (a Discord/Slack/Telegram bridge later)
 *   APP_URL             the app's base URL for the Click link; falls back
 *                       to OAUTH_REDIRECT_BASE, then Netlify's own URL.
 *
 * ══ ntfy's HTTP API (checked 2026-10-04 via docs.ntfy.sh/publish search
 *    results — the docs host itself is blocked from the build container) ══
 *   POST {server}/{topic}, body = the message (UTF-8 text).
 *   Headers: Title (X-Title), Priority (X-Priority) 1–5 or
 *   min|low|default|high|urgent (5 = max/urgent), Tags (X-Tags,
 *   comma-separated, emoji shortcodes), Click (X-Click, URL opened on
 *   tap), Authorization: Bearer tk_… for access tokens.
 *   Non-ASCII headers: "ntfy supports UTF-8 in HTTP headers, but not every
 *   library does" — any header may be RFC 2047 encoded
 *   (=?UTF-8?B?…?=, server ≥ 2.6.2). Node's fetch refuses header bytes
 *   over 0xFF, so a Title with an em dash is sent RFC 2047-encoded.
 *
 * ══ What a ping contains ═════════════════════════════════════════════
 * The ticket title and a plain headline (lib/alertText.js), e.g.
 * "Database unreachable" / "The database isn’t answering — the app
 * can’t load or save". NO user data, no ids beyond the ticket's own,
 * no secrets. Click opens /?upgrade=security&ticket=<id>.
 *
 * notifyOwner never throws: a failed ping is logged and the caller
 * carries on. createNotifier caps pings per run (the sweep uses 6).
 */
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const TIMEOUT_MS = 3000;
const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sevRank = s => SEVERITIES.indexOf(String(s || '').toLowerCase());

/** Is `severity` at or above `min`? Unknown severities never qualify. */
function atOrAbove(severity, min = 'critical') {
  const r = sevRank(severity);
  return r >= 0 && r >= Math.max(0, sevRank(min));
}

function httpsUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * What is configured — booleans only, so it can be shown in the console
 * without revealing the topic or any URL.
 */
function alertConfig(env = process.env) {
  const topic = String(env.ALERT_NTFY_TOPIC || '').trim();
  const server = httpsUrl(env.ALERT_NTFY_SERVER || 'https://ntfy.sh');
  const ntfy = TOPIC.test(topic) && !!server;
  const webhook = !!httpsUrl(env.ALERT_WEBHOOK_URL);
  const min = String(env.ALERT_MIN_SEVERITY || '').trim().toLowerCase();
  const minSeverity = min === 'high' ? 'high' : 'critical';
  const channels = [ntfy && 'ntfy', webhook && 'webhook'].filter(Boolean);
  return {
    configured: channels.length > 0,
    channels,
    minSeverity,
    // A topic was set but is not usable — say so rather than staying silent.
    topicInvalid: !!topic && !TOPIC.test(topic),
    weakTopic: ntfy && topic.length < 20,
  };
}

/** Base URL for links back into the app. */
function appBase(env = process.env) {
  const raw = env.APP_URL || env.OAUTH_REDIRECT_BASE || env.URL || '';
  const u = httpsUrl(raw);
  return u ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : '';
}

/** Where tapping the ping lands: the ticket, or the Security overview. */
function ticketLink(ticketId, env = process.env) {
  const base = appBase(env);
  if (!base) return '';
  return UUID.test(String(ticketId || ''))
    ? `${base}/?upgrade=security&ticket=${ticketId}`
    : `${base}/?upgrade=security&sec=overview`;
}

/** RFC 2047 for any header value that is not plain printable ASCII. */
function headerSafe(v) {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

const PRIORITY = { critical: '5', high: '4', medium: '3', low: '2' };
const TAGS = { critical: 'rotating_light', high: 'warning', medium: 'information_source', low: 'information_source' };

/**
 * The ntfy request, built without sending it (pure — tested).
 * → { url, init } or null when ntfy is not configured.
 */
function buildNtfyRequest(alert, env = process.env) {
  const cfg = alertConfig(env);
  if (!cfg.channels.includes('ntfy')) return null;
  const server = httpsUrl(env.ALERT_NTFY_SERVER || 'https://ntfy.sh');
  const base = `${server.origin}${server.pathname.replace(/\/+$/, '')}`;
  const sev = SEVERITIES.includes(alert.severity) ? alert.severity : 'high';
  const title = String(alert.title || 'Vantage alert').slice(0, 120);
  const body = String(alert.headline || alert.title || 'Something needs looking at.').slice(0, 400);
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    Title: headerSafe(`Vantage: ${title}`),
    Priority: PRIORITY[sev],
    Tags: [TAGS[sev], alert.test ? 'test_tube' : null, 'vantage'].filter(Boolean).join(','),
  };
  const click = alert.url || ticketLink(alert.ticketId, env);
  if (click) headers.Click = click;
  const token = String(env.ALERT_NTFY_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    url: `${base}/${String(env.ALERT_NTFY_TOPIC).trim()}`,
    init: { method: 'POST', headers, body },
  };
}

/** The generic webhook request: POST JSON {severity,title,headline,url}. */
function buildWebhookRequest(alert, env = process.env) {
  const u = httpsUrl(env.ALERT_WEBHOOK_URL);
  if (!u) return null;
  return {
    url: u.toString(),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        severity: SEVERITIES.includes(alert.severity) ? alert.severity : 'high',
        title: String(alert.title || 'Vantage alert').slice(0, 120),
        headline: String(alert.headline || '').slice(0, 400),
        url: alert.url || ticketLink(alert.ticketId, env) || null,
        test: alert.test ? true : undefined,
      }),
    },
  };
}

async function send(fetchImpl, req, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(req.url, { ...req.init, signal: ctl.signal });
    return res && res.ok;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ping the owner. → { sent: string[], failed: string[], skipped?: reason }
 * NEVER throws.
 *
 * @param {object} alert  { severity, title, headline, ticketId?, kind?, url?, test? }
 * @param {object} [o]    { env, fetchImpl, force } — `force` skips the
 *                        severity threshold (the console's test button).
 */
async function notifyOwner(alert, { env = process.env, fetchImpl = globalThis.fetch, force = false, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const a = alert && typeof alert === 'object' ? alert : {};
    const cfg = alertConfig(env);
    if (!cfg.configured) return { sent: [], failed: [], skipped: 'not_configured' };
    if (!force && !atOrAbove(a.severity, cfg.minSeverity)) return { sent: [], failed: [], skipped: 'below_threshold' };
    const reqs = [
      ['ntfy', buildNtfyRequest(a, env)],
      ['webhook', buildWebhookRequest(a, env)],
    ].filter(([, r]) => r);
    const results = await Promise.allSettled(reqs.map(([, r]) => send(fetchImpl, r, timeoutMs)));
    const sent = [], failed = [];
    results.forEach((r, i) => (r.status === 'fulfilled' && r.value ? sent : failed).push(reqs[i][0]));
    if (failed.length) console.warn(`alertNotify: ${failed.join(', ')} ping failed${a.kind ? ` (${a.kind})` : ''}`);
    return { sent, failed };
  } catch (e) {
    console.warn('alertNotify: ping failed', e?.message);
    return { sent: [], failed: ['error'] };
  }
}

/**
 * A per-run notifier with a cap: the first `max` alerts are sent (in
 * parallel by flush()), the rest are counted as dropped. Queuing rather
 * than sending inline keeps the pings off the sweep's 30 s critical path.
 */
function createNotifier({ max = 6, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const queue = [];
  let dropped = 0;
  return {
    add(alert) {
      if (queue.length >= max) { dropped++; return false; }
      queue.push(alert);
      return true;
    },
    get size() { return queue.length; },
    async flush() {
      const results = await Promise.all(queue.map(a => notifyOwner(a, { env, fetchImpl })));
      const sent = results.filter(r => r.sent.length).length;
      if (dropped) console.warn(`alertNotify: ${dropped} alert(s) over the per-run cap of ${max} not sent`);
      return { queued: queue.length, sent, dropped };
    },
  };
}

module.exports = {
  SEVERITIES, atOrAbove, alertConfig, appBase, ticketLink, headerSafe,
  buildNtfyRequest, buildWebhookRequest, notifyOwner, createNotifier,
};

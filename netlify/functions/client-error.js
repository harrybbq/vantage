/**
 * Netlify function: client-error — where the app reports its own crashes.
 *
 * With one error boundary for the whole app (item 58), a widget crash in
 * someone's pocket was invisible to us unless they wrote in. The client
 * posts a small record here; it lands in public.client_errors
 * (supabase/audit_schema_2026_10.sql), insertable by the service role
 * only, so the table cannot be read or spammed from a browser directly.
 *
 * POST { kind, message, stack, url, release }
 *   · 8 KB body cap; every field trimmed to a sane length.
 *   · Per IP (lib/ipLimit.js, per instance — a brake, not a wall): 30 a
 *     minute and 200 an hour (item 95).
 *   · Durable cap across instances: once retention_2026_10b.sql is run,
 *     a trigger refuses inserts past 1,000 an hour in total; the refusal
 *     (a 400) backs this instance off for ten minutes, the same path as
 *     "table not installed yet".
 *   · Bogus input dropped (item 95): not a JSON object, no message and no
 *     stack, a message that is only whitespace, no User-Agent (a browser
 *     always sends one), or the same report from the same IP inside a
 *     minute (a crash loop is one row a minute, not hundreds).
 *   · Signed in? A valid JWT attaches user_id (lib/sessionCache.js —
 *     verified with Supabase Auth, verdict cached by token hash, so a
 *     crash loop doesn't mean one Auth call per report). A bad or
 *     missing token is fine — crashes before sign-in matter too.
 *   · URL query strings and fragments are dropped before storing: they
 *     are where tokens and emails turn up.
 *
 * Always 204 for anything accepted or dropped, including when the table
 * does not exist yet: an error reporter that can itself throw errors at
 * the app is worse than none. 413 / 429 only for oversize / over-limit.
 *
 * Retention: rows older than 30 days are deleted by the weekly
 * retention-prune function (item 96).
 */
const crypto = require('node:crypto');
const sbKeys = require('../lib/sbKeys');
const { createIpLimiter, clientIp } = require('../lib/ipLimit');
const { sessionUserId } = require('../lib/sessionCache');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const done = () => ({ statusCode: 204, headers: CORS, body: '' });

const MAX_BODY = 8 * 1024;
// The server's own vocabulary plus the kinds src/ actually sends
// (reportError('window.onerror' | 'root' | 'save-blocked' | 'save-failed')),
// which used to all land as 'other'. Anything else is still 'other'.
const KINDS = new Set(['error', 'unhandledrejection', 'boundary', 'chunk', 'network', 'other',
  'window.onerror', 'root', 'save-blocked', 'save-failed']);

const limiter = createIpLimiter([{ ms: 60_000, max: 30 }, { ms: 60 * 60_000, max: 200 }]);

// Same report from the same IP within DEDUPE_MS → dropped.
const DEDUPE_MS = 60_000;
const recent = new Map(); // sha1(ip|kind|message|stack head) → at
function duplicate(sig, now) {
  const at = recent.get(sig);
  recent.set(sig, now);
  if (recent.size > 5000) for (const [k, v] of recent) if (now - v > DEDUPE_MS) recent.delete(k);
  return at != null && now - at < DEDUPE_MS;
}

// Table missing (404/400) or the durable cap reached (trigger → 400):
// stop sending for ten minutes on this instance.
let backoffUntil = 0;

const text = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n) || null;

function stripUrl(v) {
  const s = text(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return s.split(/[?#]/)[0].slice(0, 300);
  }
}

/** → the row to store, or null when the input is bogus. Pure; exported for tests. */
function shapeErrorRow(b, ua) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  if (!ua || !String(ua).trim()) return null;
  const message = text(b.message, 1000);
  const stack = text(b.stack, 4000);
  if (!(message && message.trim()) && !(stack && stack.trim())) return null;
  const release = text(b.release, 64);
  return {
    kind: KINDS.has(b.kind) ? b.kind : 'other',
    message: message && message.trim() ? message : null,
    stack: stack && stack.trim() ? stack : null,
    url: stripUrl(b.url),
    ua: text(ua, 300),
    // Build ids are hashed bundle names / modes; anything else is noise.
    release: release && /^[\w.+-]{1,64}$/.test(release) ? release : null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return done();
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY) return { statusCode: 413, headers: CORS, body: '' };
  const ip = clientIp(event);
  if (!limiter.hit(ip).allowed) return { statusCode: 429, headers: CORS, body: '' };

  const url = process.env.SUPABASE_URL;
  const key = sbKeys.serviceKey(process.env);
  if (!url || !key || Date.now() < backoffUntil) return done();

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return done(); }
  const shaped = shapeErrorRow(b, event.headers?.['user-agent'] || event.headers?.['User-Agent']);
  if (!shaped) return done();

  const sig = crypto.createHash('sha1')
    .update(`${ip}|${shaped.kind}|${shaped.message || ''}|${(shaped.stack || '').slice(0, 300)}`).digest('hex');
  if (duplicate(sig, Date.now())) return done();

  const row = { user_id: await sessionUserId(event), ...shaped };

  try {
    const res = await fetch(`${url}/rest/v1/client_errors`, {
      method: 'POST',
      headers: sbKeys.serviceKeyHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    // 404/400 = table not installed yet, or the hourly cap: back off.
    if (res.status === 404 || res.status === 400) backoffUntil = Date.now() + 10 * 60_000;
    else if (!res.ok) console.error('client-error: insert', res.status);
  } catch (e) {
    console.error('client-error: insert unreachable', e?.message);
  }
  return done();
};

exports._test = { shapeErrorRow, reset: () => { backoffUntil = 0; recent.clear(); } };

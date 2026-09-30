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
 *   · 30 a minute per IP (per instance — a brake, not a wall).
 *   · Signed in? The JWT, if present and valid, attaches user_id. A bad
 *     or missing token is fine — crashes before sign-in matter too.
 *   · URL query strings and fragments are dropped before storing: they
 *     are where tokens and emails turn up.
 *
 * Always 204, including when the table does not exist yet: an error
 * reporter that can itself throw errors at the app is worse than none.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const done = () => ({ statusCode: 204, headers: CORS, body: '' });

const MAX_BODY = 8 * 1024;
const PER_MINUTE = 30;
const KINDS = new Set(['error', 'unhandledrejection', 'boundary', 'chunk', 'network', 'other']);

const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const e = hits.get(ip) || { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n++;
  hits.set(ip, e);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > 60_000) hits.delete(k);
  return e.n <= PER_MINUTE;
}

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

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

/** Best effort: who is this, if they sent a valid session. Never throws. */
async function userIdFrom(event, url) {
  const raw = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = raw.replace(/^Bearer\s+/i, '').trim();
  const apikey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!jwt || !apikey) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${jwt}` } });
    if (!res.ok) return null;
    return (await res.json())?.id || null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return done();
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY) return { statusCode: 413, headers: CORS, body: '' };
  if (!allowed(clientIp(event))) return { statusCode: 429, headers: CORS, body: '' };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return done();

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return done(); }
  if (!b || typeof b !== 'object') return done();

  const row = {
    user_id: await userIdFrom(event, url),
    kind: KINDS.has(b.kind) ? b.kind : 'other',
    message: text(b.message, 1000),
    stack: text(b.stack, 4000),
    url: stripUrl(b.url),
    ua: text(event.headers?.['user-agent'], 300),
    release: text(b.release, 64),
  };
  if (!row.message && !row.stack) return done();

  try {
    const res = await fetch(`${url}/rest/v1/client_errors`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    // 404/400 = table not installed yet; nothing to do but carry on.
    if (!res.ok && res.status !== 404 && res.status !== 400) console.error('client-error: insert', res.status);
  } catch (e) {
    console.error('client-error: insert unreachable', e?.message);
  }
  return done();
};

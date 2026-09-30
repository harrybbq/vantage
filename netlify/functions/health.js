/**
 * Netlify function: health — for an uptime monitor (item 77).
 *
 *   GET /.netlify/functions/health
 *     200 { ok: true,  time, db: 'ok' }
 *     503 { ok: false, time, db: 'unreachable' | 'not configured' }
 *
 * What 200 means, fixed here so the monitor's meaning cannot drift:
 * the function runtime is up AND Supabase's REST endpoint answered a
 * one-row read of `config` (the tiny public key/value table) as the
 * service role within PING_TIMEOUT_MS. ANY HTTP answer from PostgREST
 * short of a 5xx — even a 4xx because that table were renamed —
 * counts as reachable: the question is "is the database up", not "is
 * the schema what we expect". Network error, timeout or 5xx → 503.
 *
 * No auth, on purpose: a monitor holds no session. So it gives away
 * nothing — no versions, no error text, no counts — and it is cheap to
 * call: the DB answer is reused for CACHE_MS, so a flood from many IPs
 * costs Supabase one tiny query per instance per CACHE_MS rather than
 * one per request, and each IP is also rate-limited.
 */
const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
};

const PING_TIMEOUT_MS = 4000;
const CACHE_MS = 10_000;
const PER_MINUTE = 30;

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

let last = { at: 0, db: null };

async function pingDb(url, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/config?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: ctl.signal,
    });
    return res.status < 500 ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }
}

const reply = (statusCode, db) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify({ ok: statusCode === 200, time: new Date().toISOString(), db }),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!allowed(ip)) {
    return { statusCode: 429, headers: { ...HEADERS, 'Retry-After': '60' }, body: JSON.stringify({ error: 'rate limited' }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Unconfigured is down: every data function would be failing too.
  if (!url || !key) return reply(503, 'not configured');

  if (!last.db || Date.now() - last.at > CACHE_MS) {
    last = { at: Date.now(), db: await pingDb(url, key) };
  }
  return reply(last.db === 'ok' ? 200 : 503, last.db);
};

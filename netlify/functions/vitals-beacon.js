/**
 * Netlify function: vitals-beacon — real-user page performance.
 *
 * The client (src/lib/telemetry/webVitals.js) samples 1 page load in 5,
 * measures LCP, INP, CLS, TTFB and FCP with the browser's own
 * PerformanceObserver, and sends ONE navigator.sendBeacon here when the
 * page is hidden. Rows land in public.web_vitals; the owner's Security
 * console reads the 75th percentiles.
 *
 * What is stored, and nothing else: the page PATH (no query, no
 * fragment, ids collapsed), the five numbers, the navigation type and a
 * coarse device class. No user id, no IP, no user agent, no cookie —
 * which is why this needs no session (a beacon cannot carry one) and
 * why the privacy policy can call it anonymous.
 *
 * Abuse limits: 2 KB body cap, 20 a minute per IP (per instance — a
 * brake), every number range-checked (lib/securityShape.shapeVitalsRow).
 * Always 204: a measurement endpoint must never be the reason a page
 * misbehaves, and it tells a prober nothing.
 */
const { shapeVitalsRow } = require('../lib/securityShape');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const done = () => ({ statusCode: 204, headers: CORS, body: '' });

const MAX_BODY = 2 * 1024;
const PER_MINUTE = 20;

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

// A missing table is remembered for ten minutes so a beacon flood
// before the SQL is run costs nothing.
let missingUntil = 0;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return done();
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return { statusCode: 413, headers: CORS, body: '' };
  if (!allowed(clientIp(event))) return { statusCode: 429, headers: CORS, body: '' };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || Date.now() < missingUntil) return done();

  // sendBeacon with a string body arrives as text/plain; parse regardless.
  let b;
  try { b = JSON.parse(raw); } catch { return done(); }
  const row = shapeVitalsRow(b);
  if (!row) return done();

  try {
    const res = await fetch(`${url}/rest/v1/web_vitals`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (res.status === 404 || res.status === 400) missingUntil = Date.now() + 10 * 60_000;
    else if (!res.ok) console.error('vitals-beacon: insert', res.status);
  } catch (e) {
    console.error('vitals-beacon: insert unreachable', e?.message);
  }
  return done();
};

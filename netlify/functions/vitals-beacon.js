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
 * Abuse limits (item 95): 2 KB body cap; per IP 20 a minute and 60 an
 * hour (lib/ipLimit.js, per instance — a brake; one real page load
 * sends at most one beacon, and only 1 in 5 are sampled); every number
 * range-checked and a row with no metric dropped
 * (lib/securityShape.shapeVitalsRow); no User-Agent → dropped (the IP
 * and UA are only looked at here, never stored). Durable cap across
 * instances: once retention_2026_10b.sql is run, a trigger refuses
 * inserts past 3,000 an hour in total, and the 400 backs this instance
 * off for ten minutes like a missing table.
 * Always 204: a measurement endpoint must never be the reason a page
 * misbehaves, and it tells a prober nothing.
 *
 * Retention: rows older than 90 days are deleted by the weekly
 * retention-prune function (item 96).
 */
const sbKeys = require('../lib/sbKeys');
const { shapeVitalsRow } = require('../lib/securityShape');
const { createIpLimiter, clientIp } = require('../lib/ipLimit');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const done = () => ({ statusCode: 204, headers: CORS, body: '' });

const MAX_BODY = 2 * 1024;
const limiter = createIpLimiter([{ ms: 60_000, max: 20 }, { ms: 60 * 60_000, max: 60 }]);

// A missing table (or the durable hourly cap, also a 400) is remembered
// for ten minutes so a beacon flood before the SQL is run costs nothing.
let missingUntil = 0;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return done();
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '' };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return { statusCode: 413, headers: CORS, body: '' };
  if (!limiter.hit(clientIp(event)).allowed) return { statusCode: 429, headers: CORS, body: '' };
  const ua = event.headers?.['user-agent'] || event.headers?.['User-Agent'];
  if (!ua || !String(ua).trim()) return done();

  const url = process.env.SUPABASE_URL;
  const key = sbKeys.serviceKey(process.env);
  if (!url || !key || Date.now() < missingUntil) return done();

  // sendBeacon with a string body arrives as text/plain; parse regardless.
  let b;
  try { b = JSON.parse(raw); } catch { return done(); }
  const row = shapeVitalsRow(b);
  if (!row) return done();

  try {
    const res = await fetch(`${url}/rest/v1/web_vitals`, {
      method: 'POST',
      headers: sbKeys.serviceKeyHeaders(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(row),
    });
    if (res.status === 404 || res.status === 400) missingUntil = Date.now() + 10 * 60_000;
    else if (!res.ok) console.error('vitals-beacon: insert', res.status);
  } catch (e) {
    console.error('vitals-beacon: insert unreachable', e?.message);
  }
  return done();
};

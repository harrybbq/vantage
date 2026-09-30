/**
 * Netlify function: csp-report — receives Content-Security-Policy
 * violation reports.
 *
 * The CSP ships Report-Only (item 21) with the plan "promote to
 * enforcing once it is quiet". Without a report endpoint "quiet" could
 * never be observed (item 60). Browsers send either
 *   application/csp-report   { "csp-report": { ... } }            (report-uri)
 *   application/reports+json [ { type: "csp-violation", body } ]  (report-to)
 * and this accepts both.
 *
 * It logs ONE compact line per violation — directive, blocked origin,
 * page path — and nothing else: no query strings, no full URLs, no
 * script samples, no IPs. The log is the dashboard; there is no table.
 *
 * Always 204. Wiring it up (report-uri / Report-To in netlify.toml or
 * _headers) is a separate change.
 */
const HEADERS = { 'Cache-Control': 'no-store' };
const MAX_BODY = 16 * 1024;
const PER_MINUTE = 60;

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

/** Origin only for http(s); the bare keyword ('inline', 'eval', 'data') otherwise. */
function origin(v) {
  const s = String(v || '').slice(0, 300);
  if (!s) return '-';
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.origin : u.protocol.replace(':', '');
  } catch {
    return s.replace(/[^a-z-]/gi, '').slice(0, 20) || '-';
  }
}
function path(v) {
  try { return new URL(String(v || '')).pathname.slice(0, 120); } catch { return '-'; }
}

function normalise(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    directive: String(r['effective-directive'] || r.effectiveDirective || r['violated-directive'] || r.violatedDirective || '-').split(' ')[0].slice(0, 40),
    blocked: origin(r['blocked-uri'] || r.blockedURL || r.blockedUrl),
    page: path(r['document-uri'] || r.documentURL || r.documentUrl),
    disposition: String(r.disposition || 'report').slice(0, 10),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: '' };
  const raw = event.body || '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return { statusCode: 413, headers: HEADERS, body: '' };
  const h = event.headers || {};
  const ip = h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!allowed(ip)) return { statusCode: 204, headers: HEADERS, body: '' };

  let parsed;
  try {
    parsed = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
  } catch {
    return { statusCode: 204, headers: HEADERS, body: '' };
  }

  const reports = Array.isArray(parsed)
    ? parsed.filter(x => x && (x.type === 'csp-violation' || x.body)).map(x => x.body)   // reports+json
    : [parsed?.['csp-report']];                                                         // csp-report
  for (const r of reports.slice(0, 20)) {
    const n = normalise(r);
    if (n) console.info(`csp ${n.disposition} ${n.directive} blocked=${n.blocked} page=${n.page}`);
  }
  return { statusCode: 204, headers: HEADERS, body: '' };
};

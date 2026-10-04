/**
 * Netlify function: security-agent — the narrow door for scheduled
 * triage agents (the owner's Claude routines) into the Security
 * console's ticket queue. LOW and MEDIUM tickets only.
 *
 * ══ Auth ═════════════════════════════════════════════════════════════
 * Header `X-Agent-Token`, compared in constant time with the env
 * SECURITY_AGENT_TOKEN (generate with `openssl rand -hex 32`; rotate by
 * replacing the env value and redeploying — the old token stops working
 * on the next deploy). The token is NEVER accepted in the query string:
 * a request that carries one there is refused outright, because query
 * strings end up in logs and browser history. Env missing (or shorter
 * than 32 chars) → 503 not_configured. Every other auth failure is the
 * same generic 401. Per-instance rate limits: 60 requests a minute, and
 * 10 failed attempts a minute per client address.
 *
 * ══ What an agent can do ═════════════════════════════════════════════
 *   GET  ?view=queue              open/ack tickets, severity low|medium only:
 *                                 id, kind, severity, status, source, title,
 *                                 headline, detail (personal fields stripped,
 *                                 emails/ids masked — lib/agentShape.js),
 *                                 count, firstSeen, lastSeen, note
 *   GET  ?view=errors&window=1h|24h
 *                                 the top client-error groups (no user ids)
 *   POST { action:'note',    id, note }          append "[agent] <time> note: …"
 *   POST { action:'ack',     id, note? }         status → ack, note appended
 *   POST { action:'resolve', id, note, pr? }     status → resolved, note (+ PR link) appended
 *
 * A high or critical ticket answers 403 to every action. There is no
 * route that bans, suspends, deletes, reads user data or runs SQL — the
 * only write is a PATCH of one security_tickets row's status/note, and
 * that PATCH re-states the severity filter so it cannot touch a
 * high/critical row even if one changed underneath. The owner sees every
 * agent note in the console, prefixed "[agent]". docs/SECURITY_AGENT.md
 * has the guardrails (open PRs, never merge, never deploy).
 */
const { safeEqual } = require('../lib/cronAuth');
const D = require('../lib/securityData');
const { AGENT_SEVERITIES, agentTicket, agentNoteLine, appendNote } = require('../lib/agentShape');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });
const denied = () => reply(401, { error: 'unauthorized' });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 8 * 1024;
const MIN_TOKEN = 32;
const TOKEN_IN_QUERY = /token|secret|key|auth/i;

// Per-instance brakes (a warm lambda's memory — a brake, not a wall).
const buckets = new Map();
function under(key, max, windowMs = 60_000) {
  const now = Date.now();
  const e = buckets.get(key) || { n: 0, t: now };
  if (now - e.t > windowMs) { e.n = 0; e.t = now; }
  e.n++;
  buckets.set(key, e);
  if (buckets.size > 2000) for (const [k, v] of buckets) if (now - v.t > windowMs) buckets.delete(k);
  return e.n <= max;
}
const peek = (key, max, windowMs = 60_000) => {
  const e = buckets.get(key);
  return !e || Date.now() - e.t > windowMs || e.n < max;
};

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function header(event, name) {
  const h = event.headers || {};
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === want) return v;
  return undefined;
}

/** → null when the caller may proceed, or the response to return. */
function authorise(event) {
  const expected = String(process.env.SECURITY_AGENT_TOKEN || '');
  if (expected.length < MIN_TOKEN) return reply(503, { error: 'not_configured' });
  const ip = clientIp(event);
  if (!peek(`fail:${ip}`, 10)) return reply(429, { error: 'too many requests' });
  const q = event.queryStringParameters || {};
  const inQuery = Object.keys(q).some(k => TOKEN_IN_QUERY.test(k));
  const provided = header(event, 'x-agent-token');
  if (inQuery || !provided || !safeEqual(String(provided), expected)) {
    under(`fail:${ip}`, 10);
    console.warn(`security-agent: refused${inQuery ? ' (token in query string)' : ''}`);
    return denied();
  }
  return null;
}

const QUEUE_COLS = 'id,kind,severity,status,source,title,detail,count,created_at,last_seen_at,note';

async function queue(env) {
  const res = await D.rest(env,
    `security_tickets?select=${QUEUE_COLS}&status=in.(open,ack)&severity=in.(${AGENT_SEVERITIES.join(',')})` +
    '&order=last_seen_at.desc.nullslast,created_at.desc&limit=100');
  if (D.missing(res)) return [503, { error: 'not_configured', hint: D.HINTS.sql }];
  if (!res.ok) throw new Error(`queue read ${res.status}`);
  const tickets = (await res.json()).map(agentTicket).filter(Boolean);
  return [200, { ok: true, tickets, generatedAt: new Date().toISOString() }];
}

async function act(env, b) {
  const action = b.action;
  if (!['note', 'ack', 'resolve'].includes(action)) return [400, { error: 'action must be note, ack or resolve' }];
  const id = String(b.id || '');
  if (!UUID.test(id)) return [400, { error: 'ticket id required' }];
  if (b.note != null && typeof b.note !== 'string') return [400, { error: 'note must be a string' }];
  if (typeof b.note === 'string' && b.note.length > 2000) return [400, { error: 'note is over 2,000 characters' }];
  if (action === 'resolve' && String(b.note || '').trim().length < 3) return [400, { error: 'resolve needs a note saying what was done' }];

  const look = await D.rest(env, `security_tickets?id=eq.${id}&select=id,severity,status,note`);
  if (D.missing(look)) return [503, { error: 'not_configured', hint: D.HINTS.sql }];
  if (!look.ok) throw new Error(`ticket read ${look.status}`);
  const row = (await look.json())[0];
  if (!row) return [404, { error: 'no such ticket' }];
  if (!AGENT_SEVERITIES.includes(row.severity)) return [403, { error: 'agents may only act on low and medium tickets' }];

  const line = agentNoteLine(action, b.note, b.pr);
  if (action === 'note' && !line) return [400, { error: 'note required' }];
  const now = new Date().toISOString();
  const patch = { updated_at: now };
  if (line) patch.note = appendNote(row.note, line);
  if (action === 'ack' && row.status === 'open') patch.status = 'ack';
  if (action === 'resolve') { patch.status = 'resolved'; patch.resolved_at = now; patch.resolved_by = null; }

  const res = await D.rest(env, `security_tickets?id=eq.${id}&severity=in.(${AGENT_SEVERITIES.join(',')})&select=id,status`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`ticket update ${res.status}`);
  const rows = await res.json();
  if (!rows.length) return [403, { error: 'agents may only act on low and medium tickets' }];
  console.info(`security-agent: ${action} on a ${row.severity} ticket`);
  return [200, { ok: true, id, status: rows[0].status }];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });
  const no = authorise(event);
  if (no) return no;
  if (!under('agent:all', 60)) return reply(429, { error: 'too many requests' });

  const env = D.supabaseEnv();
  if (!env.supabaseUrl || !env.serviceKey) return reply(503, { error: 'not_configured' });

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      if (q.view === 'queue') { const [c, body] = await queue(env); return reply(c, body); }
      if (q.view === 'errors') {
        const r = await D.readErrorGroups(env, q.window === '1h' ? '1h' : '24h');
        return reply(r.ok ? 200 : 503, r);
      }
      return reply(400, { error: 'view must be queue or errors' });
    }
    if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY) return reply(413, { error: 'too large' });
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) return reply(400, { error: 'invalid body' });
    const [c, body] = await act(env, b);
    return reply(c, body);
  } catch (e) {
    console.error('security-agent:', e?.message);
    return reply(500, { error: 'failed' });
  }
};

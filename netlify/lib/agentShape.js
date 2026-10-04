/**
 * What a triage agent is allowed to see of a ticket, and what it may do.
 * Pure: no fetch, no env. Tested by securityAgent.test.mjs
 * (npm run check:alerts). The endpoint is functions/security-agent.js;
 * the rules for the agents are docs/SECURITY_AGENT.md.
 *
 * The agent sees LOW and MEDIUM tickets only, and never anything that
 * identifies a person: reporter ids, user ids, handles, names, emails,
 * IPs or user agents are dropped by key, and any email address or UUID
 * left inside free text is masked. What remains is the problem itself.
 */
const { headlineFor } = require('./alertText');

const AGENT_SEVERITIES = ['low', 'medium'];
const NOTE_MAX = 2000;
const NOTE_TOTAL_MAX = 8000;

// Keys that name or locate a person. Matched case-insensitively against
// the key with _ and - removed, so user_id, userId and user-id all go.
const PERSONAL_KEYS = new Set([
  'userid', 'user', 'uid', 'reporterid', 'reporter', 'reporterhandle', 'reportedid', 'reported',
  'email', 'mail', 'ip', 'ipaddress', 'ua', 'useragent', 'handle', 'displayname', 'fullname',
  'ownerid', 'resolvedby', 'acceptedby', 'actionedby', 'phone', 'avatar', 'avatarurl',
]);
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const isPersonalKey = k => PERSONAL_KEYS.has(String(k).toLowerCase().replace(/[_-]/g, ''));

/** Mask emails and UUIDs in free text. */
function maskText(s, max = 2000) {
  return String(s).replace(EMAIL, '[email]').replace(UUID, '[id]').slice(0, max);
}

/** A detail object with every personal key dropped and text masked (depth ≤ 3). */
function stripDetail(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return maskText(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth >= 3) return null;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => stripDetail(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) {
      if (isPersonalKey(k)) continue;
      out[String(k).slice(0, 40)] = stripDetail(x, depth + 1);
    }
    return out;
  }
  return null;
}

/**
 * One security_tickets row → what the agent's queue shows. Severity
 * gating is the caller's query, and is re-checked here: anything above
 * medium comes back null.
 */
function agentTicket(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  const severity = String(row.severity || '').toLowerCase();
  if (!AGENT_SEVERITIES.includes(severity)) return null;
  const kind = String(row.kind || '').slice(0, 60);
  const detail = stripDetail(row.detail && typeof row.detail === 'object' ? row.detail : {}) || {};
  const title = maskText(row.title || '', 200);
  return {
    id: String(row.id),
    kind,
    severity,
    status: row.status === 'ack' ? 'ack' : 'open',
    source: ['auto', 'user', 'owner'].includes(row.source) ? row.source : 'auto',
    title,
    // A user ticket's own title is the clearest statement of the problem;
    // the generic server line ("A user reported a bug problem") adds nothing.
    headline: kind.startsWith('user:') ? title : maskText(headlineFor(kind, row.detail, { title }), 300),
    detail,
    count: Number(row.count) || 1,
    firstSeen: row.created_at || null,
    lastSeen: row.last_seen_at || row.created_at || null,
    note: row.note ? maskText(row.note, NOTE_TOTAL_MAX) : null,
  };
}

const PR_URL = /^https:\/\/github\.com\/[\w.-]{1,100}\/[\w.-]{1,100}\/pull\/\d{1,7}$/;

/**
 * The note an agent appends: "[agent] 2026-10-04T12:00:00Z ack: <text> · PR: <url>".
 * → string, or null when there is nothing to say.
 */
function agentNoteLine(action, note, pr, now = new Date()) {
  const text = String(note == null ? '' : note).split('\u0000').join('').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const prOk = typeof pr === 'string' && PR_URL.test(pr.trim()) ? pr.trim() : null;
  if (!text && !prOk && action === 'note') return null;
  const parts = [`[agent] ${now.toISOString().replace(/\.\d{3}Z$/, 'Z')} ${action}`];
  if (text) parts.push(`: ${text}`);
  if (prOk) parts.push(` · PR: ${prOk}`);
  return parts.join('');
}

/** Existing note + the new line, newest last, capped from the front. */
function appendNote(existing, line) {
  const joined = existing ? `${existing}\n${line}` : line;
  return joined.length > NOTE_TOTAL_MAX ? joined.slice(joined.length - NOTE_TOTAL_MAX) : joined;
}

module.exports = {
  AGENT_SEVERITIES, NOTE_MAX, PR_URL, isPersonalKey, maskText, stripDetail, agentTicket, agentNoteLine, appendNote,
};

/**
 * The moderation logic, shared by functions/moderation.js (the original
 * report queue endpoint) and functions/security-console.js (the owner's
 * Security console). One copy, so a fix to how a report is closed or a
 * user suspended lands in both.
 *
 * Every function here answers `[statusCode, body]` or data, never a
 * Netlify response: the caller owns headers and the owner check. None
 * of them checks who is asking — callers MUST have verified the owner
 * server-side first (lib/owner.js).
 *
 * `env` is { supabaseUrl, serviceKey }.
 */
const { invalidateSuspended } = require('./suspended');

const PAGE_SIZE = 25;
const CONTEXT_MESSAGES = 10;
const UUID = /^[0-9a-f-]{36}$/i;
const NOT_INSTALLED = [501, { error: 'moderation schema not installed' }];

function sb(env, path, init = {}) {
  return fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

const missingSchema = res => res.status === 400 || res.status === 404;

/**
 * Open reports, newest first, with both parties' handles and the last
 * few DMs between them. → [200, { ok, page, pageSize, total, items }]
 * or the not-installed 501.
 */
async function listOpenReports(env, page, { oldestFirst = false } = {}) {
  const offset = page * PAGE_SIZE;
  const res = await sb(env,
    `reports?status=eq.open&order=created_at.${oldestFirst ? 'asc' : 'desc'}&limit=${PAGE_SIZE}&offset=${offset}` +
    '&select=id,reporter_id,reported_id,reason,context,created_at,reported_snapshot',
    { headers: { Prefer: 'count=exact' } });
  if (missingSchema(res)) return NOT_INSTALLED;
  if (!res.ok) throw new Error(`reports read ${res.status}`);
  const reports = await res.json();
  const total = parseInt((res.headers.get('content-range') || '').split('/')[1] || '0', 10) || reports.length;

  // Two plain queries rather than PostgREST embeds: reports' FKs point
  // at auth.users, not profiles, so an embed has nothing to follow.
  const ids = [...new Set(reports.flatMap(r => [r.reporter_id, r.reported_id]).filter(Boolean))];
  let byId = new Map();
  let suspendedById = new Map();
  if (ids.length) {
    const pRes = await sb(env, `profiles?id=in.(${ids.join(',')})&select=id,handle,display_name,avatar_url`);
    if (pRes.ok) byId = new Map((await pRes.json()).map(p => [p.id, p]));
    const sRes = await sb(env, `profiles?id=in.(${ids.join(',')})&select=id,suspended_at`);
    if (sRes.ok) suspendedById = new Map((await sRes.json()).map(p => [p.id, p.suspended_at]));
  }
  const who = id => {
    if (!id) return null;   // reported account since deleted (FK set null)
    const p = byId.get(id) || {};
    return {
      id,
      handle: p.handle || null,
      name: p.display_name || null,
      avatarUrl: p.avatar_url || null,
      suspendedAt: suspendedById.get(id) || null,
    };
  };

  // The last few DMs between the pair, both directions, oldest first.
  const items = [];
  for (const r of reports) {
    let messages = [];
    if (r.reporter_id && r.reported_id) {
      const a = r.reporter_id, b = r.reported_id;
      const mRes = await sb(env,
        `messages?or=(and(sender_id.eq.${a},recipient_id.eq.${b}),and(sender_id.eq.${b},recipient_id.eq.${a}))` +
        `&created_at=lte.${encodeURIComponent(r.created_at)}` +
        `&select=sender_id,body,created_at&order=created_at.desc&limit=${CONTEXT_MESSAGES}`);
      if (mRes.ok) {
        messages = (await mRes.json()).reverse().map(m => ({
          from: m.sender_id === b ? 'reported' : 'reporter',
          body: String(m.body || '').slice(0, 2000),
          at: m.created_at,
        }));
      }
    }
    items.push({
      id: r.id,
      createdAt: r.created_at,
      reason: r.reason || null,
      context: r.context || null,
      snapshot: r.reported_snapshot || null,
      reporter: who(r.reporter_id),
      reported: who(r.reported_id),
      messages,
    });
  }
  return [200, { ok: true, page, pageSize: PAGE_SIZE, total, items }];
}

/** → 'ok' | 'missing' (schema) | 'nouser'. Throws on other failures. */
async function setSuspended(env, userId, on) {
  const res = await sb(env, `profiles?id=eq.${userId}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ suspended_at: on ? new Date().toISOString() : null }),
  });
  if (missingSchema(res)) return 'missing';
  if (!res.ok) throw new Error(`suspend ${res.status}`);
  invalidateSuspended();
  return ((await res.json()) || []).length ? 'ok' : 'nouser';
}

/**
 * Close a report, or lift a suspension. Body as moderation.js documents:
 *   { id, action: 'dismiss' | 'action', suspend?, note }
 *   { action: 'unsuspend', userId, note }
 * → [statusCode, body]
 */
async function decideReport(env, moderatorId, body) {
  const note = String(body.note || '').slice(0, 500) || null;

  if (body.action === 'unsuspend') {
    const target = String(body.userId || '');
    if (!UUID.test(target)) return [400, { error: 'userId required' }];
    const out = await setSuspended(env, target, false);
    if (out === 'missing') return NOT_INSTALLED;
    if (out === 'nouser') return [404, { error: 'no such user' }];
    console.info('moderation: unsuspended by owner', note ? '(with note)' : '');
    return [200, { ok: true, suspended: false }];
  }

  const id = String(body.id || '');
  if (!UUID.test(id)) return [400, { error: 'report id required' }];
  if (body.action !== 'dismiss' && body.action !== 'action') {
    return [400, { error: "action must be 'dismiss' or 'action'" }];
  }

  const rRes = await sb(env, `reports?id=eq.${id}&select=id,reported_id,status`);
  if (missingSchema(rRes)) return NOT_INSTALLED;
  if (!rRes.ok) throw new Error(`report read ${rRes.status}`);
  const report = (await rRes.json())[0];
  if (!report) return [404, { error: 'no such report' }];

  // Suspend first: if that fails, the report stays open and visible in
  // the queue rather than being closed with the action not taken.
  let suspended = false;
  if (body.action === 'action' && body.suspend === true) {
    if (!report.reported_id) return [409, { error: 'the reported account no longer exists' }];
    const out = await setSuspended(env, report.reported_id, true);
    if (out === 'missing') return NOT_INSTALLED;
    suspended = out === 'ok';
  }

  const uRes = await sb(env, `reports?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: body.action === 'action' ? 'actioned' : 'dismissed',
      actioned_at: new Date().toISOString(),
      actioned_by: moderatorId,
      note,
    }),
  });
  if (missingSchema(uRes)) return NOT_INSTALLED;
  if (!uRes.ok) throw new Error(`report update ${uRes.status}`);
  return [200, { ok: true, status: body.action === 'action' ? 'actioned' : 'dismissed', suspended, reportedId: report.reported_id || null }];
}

/** Suspended accounts, most recent first. → rows or null (schema missing). */
async function listSuspended(env, limit = 100) {
  const res = await sb(env,
    `profiles?suspended_at=not.is.null&select=id,handle,display_name,suspended_at&order=suspended_at.desc&limit=${limit}`);
  if (missingSchema(res)) return null;
  if (!res.ok) throw new Error(`suspended read ${res.status}`);
  return res.json();
}

module.exports = {
  sb, missingSchema, listOpenReports, setSuspended, decideReport, listSuspended,
  PAGE_SIZE, UUID, NOT_INSTALLED,
};

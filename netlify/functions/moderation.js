/**
 * Netlify function: moderation — the report queue, and acting on it.
 *
 * Apple 1.2 asks for three things from an app with user content: a way
 * to report, a way to block, and someone who reads the reports and can
 * act. The first two shipped; nothing read `reports`. This is the third.
 *
 *   GET  ?page=N          open reports, newest first, 25 a page, each
 *                         with both handles, the reason and context the
 *                         reporter gave, the reported_snapshot taken at
 *                         report time, and the last few DMs between the
 *                         two (the usual evidence for a DM report).
 *   POST { id, action: 'dismiss' | 'action', suspend?, note }
 *                         closes a report. `action` + `suspend: true`
 *                         also sets profiles.suspended_at, which hides
 *                         the user from every public board (see
 *                         lib/suspended.js). Nothing of theirs is deleted.
 *   POST { action: 'unsuspend', userId, note }
 *                         lifts a suspension — a decision has to be
 *                         reversible by the person who made it.
 *
 * OWNER-ONLY, on the verified email from the auth server (lib/owner.js).
 * A non-owner gets 403 'forbidden' — the same as admin-set-rating, so
 * the endpoint's existence is not confirmed to anyone probing for it.
 *
 * Fails soft: until supabase/audit_schema_2026_10.sql has added the
 * status / actioned_* / note / reported_snapshot columns to `reports`
 * and suspended_at to `profiles`, reads and writes that need them get
 * 501 'moderation schema not installed' rather than a 500.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { isOwnerEmail } = require('../lib/owner');
const { invalidateSuspended } = require('../lib/suspended');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  // Reports carry personal data; nothing between here and the owner may keep a copy.
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });
const notInstalled = () => reply(501, { error: 'moderation schema not installed' });

const PAGE_SIZE = 25;
const CONTEXT_MESSAGES = 10;
const UUID = /^[0-9a-f-]{36}$/i;

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

async function listOpen(env, page) {
  const offset = page * PAGE_SIZE;
  const res = await sb(env,
    `reports?status=eq.open&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}` +
    '&select=id,reporter_id,reported_id,reason,context,created_at,reported_snapshot',
    { headers: { Prefer: 'count=exact' } });
  if (missingSchema(res)) return notInstalled();
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
  return reply(200, { ok: true, page, pageSize: PAGE_SIZE, total, items });
}

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

async function decide(env, moderatorId, body) {
  const note = String(body.note || '').slice(0, 500) || null;

  if (body.action === 'unsuspend') {
    const target = String(body.userId || '');
    if (!UUID.test(target)) return reply(400, { error: 'userId required' });
    const out = await setSuspended(env, target, false);
    if (out === 'missing') return notInstalled();
    if (out === 'nouser') return reply(404, { error: 'no such user' });
    console.info('moderation: unsuspended by owner', note ? '(with note)' : '');
    return reply(200, { ok: true, suspended: false });
  }

  const id = String(body.id || '');
  if (!UUID.test(id)) return reply(400, { error: 'report id required' });
  if (body.action !== 'dismiss' && body.action !== 'action') {
    return reply(400, { error: "action must be 'dismiss' or 'action'" });
  }

  const rRes = await sb(env, `reports?id=eq.${id}&select=id,reported_id,status`);
  if (missingSchema(rRes)) return notInstalled();
  if (!rRes.ok) throw new Error(`report read ${rRes.status}`);
  const report = (await rRes.json())[0];
  if (!report) return reply(404, { error: 'no such report' });

  // Suspend first: if that fails, the report stays open and visible in
  // the queue rather than being closed with the action not taken.
  let suspended = false;
  if (body.action === 'action' && body.suspend === true) {
    if (!report.reported_id) return reply(409, { error: 'the reported account no longer exists' });
    const out = await setSuspended(env, report.reported_id, true);
    if (out === 'missing') return notInstalled();
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
  if (missingSchema(uRes)) return notInstalled();
  if (!uRes.ok) throw new Error(`report update ${uRes.status}`);
  return reply(200, { ok: true, status: body.action === 'action' ? 'actioned' : 'dismissed', suspended });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!isOwnerEmail(auth.email)) return reply(403, { error: 'forbidden' });
  if (!underLimit('moderation', auth.userId, 60)) return tooMany(CORS);

  const env = { supabaseUrl: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!env.supabaseUrl || !env.serviceKey) return reply(500, { error: 'not configured' });

  try {
    if (event.httpMethod === 'GET') {
      const page = Math.max(0, Math.min(1000, parseInt(event.queryStringParameters?.page, 10) || 0));
      return await listOpen(env, page);
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
    return await decide(env, auth.userId, body);
  } catch (e) {
    console.error('moderation:', e?.message);
    return reply(500, { error: 'moderation failed' });
  }
};

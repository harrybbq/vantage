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
const crypto = require('crypto');
const { invalidateSuspended } = require('./suspended');
const { serviceKeyHeaders } = require('./sbKeys');
const { URGENT_LABELS, isUrgent, quietToReported } = require('./reportReasons');

const PAGE_SIZE = 25;
const CONTEXT_MESSAGES = 10;
const UUID = /^[0-9a-f-]{36}$/i;
const NOT_INSTALLED = [501, { error: 'moderation schema not installed' }];
// The tables/RPCs supabase/safety_2026_10b.sql adds (notices, the audit
// trail, avatar re-screening). Everything that needs them fails soft.
const SAFETY_NOT_INSTALLED = [501, { error: 'safety schema not installed', hint: 'Run supabase/safety_2026_10b.sql' }];

function sb(env, path, init = {}) {
  return fetch(`${env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: serviceKeyHeaders(env.serviceKey, {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    }),
  });
}

const missingSchema = res => res.status === 400 || res.status === 404;

// ── Notices and the audit trail (safety_2026_10b.sql) ────────────────
// Both are side effects of a decision that has already been made: they
// never throw and never undo the decision. → 'ok' | 'missing' | 'failed'.

/** An in-app notice to one user (src/lib/moderation/notices.js words it). */
async function notify(env, userId, kind, meta = {}, reportId = null) {
  if (!userId || !UUID.test(String(userId))) return 'failed';
  try {
    const res = await sb(env, 'safety_notices', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, kind, meta: meta || {}, report_id: reportId || null }),
    });
    if (missingSchema(res)) return 'missing';
    if (!res.ok) { console.error('moderation: notice', res.status); return 'failed'; }
    return 'ok';
  } catch (e) {
    console.error('moderation: notice', e?.message);
    return 'failed';
  }
}

/** One row in moderation_actions — the owner's audit trail. */
async function logAction(env, row) {
  try {
    const res = await sb(env, 'moderation_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        report_id: row.reportId && UUID.test(row.reportId) ? row.reportId : null,
        target_id: row.targetId || null,
        actor_id: row.actorId || null,
        action: row.action,
        value_hash: row.valueHash || null,
        note: row.note ? String(row.note).slice(0, 500) : null,
      }),
    });
    if (missingSchema(res)) return 'missing';
    if (!res.ok) { console.error('moderation: audit', res.status); return 'failed'; }
    return 'ok';
  } catch (e) {
    console.error('moderation: audit', e?.message);
    return 'failed';
  }
}

/**
 * sha256 hex of a value an owner reset, normalised exactly as the SQL's
 * vb_reset_hash() reads it — that's what lets profiles_reset_guard refuse
 * the same value coming back. Names fold case and runs of whitespace,
 * handles fold case, pictures are compared as written.
 */
function resetHash(kind, value) {
  if (value == null) return null;
  let v = String(value);
  if (kind === 'reset_display_name') v = v.replace(/\s+/g, ' ').trim().toLowerCase();
  else if (kind === 'reset_handle') v = v.toLowerCase();
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex');
}

const RESET_FIELDS = { display_name: 'display_name', handle: 'handle', avatar: 'avatar_url' };
/** The resettable fields asked for, whitelisted and de-duplicated. */
function cleanResetFields(fields) {
  if (!Array.isArray(fields)) return [];
  return [...new Set(fields.filter(f => Object.prototype.hasOwnProperty.call(RESET_FIELDS, f)))];
}

const reporterNoticeKind = action => (action === 'action' ? 'report_actioned' : 'report_dismissed');

/** What the reporter's notice may say: who THEY reported (from the
 *  snapshot they filed), nothing else. */
function reporterMeta(report) {
  const snap = report && report.reported_snapshot && typeof report.reported_snapshot === 'object' ? report.reported_snapshot : {};
  const meta = {};
  if (typeof snap.handle === 'string' && snap.handle.trim()) meta.handle = snap.handle.trim().replace(/^@/, '').slice(0, 64);
  if (typeof snap.display_name === 'string' && snap.display_name.trim()) meta.name = snap.display_name.trim().slice(0, 64);
  return meta;
}

/** Messages copied into reports.reported_snapshot at report time, in the
 *  queue's { from, body, at } shape. Anything malformed is dropped. */
function snapshotMessages(snap) {
  const list = snap && typeof snap === 'object' && Array.isArray(snap.messages) ? snap.messages : [];
  return list
    .filter(m => m && typeof m === 'object' && typeof m.body === 'string')
    .slice(-CONTEXT_MESSAGES)
    .map(m => ({
      from: m.from === 'reported' ? 'reported' : 'reporter',
      body: m.body.slice(0, 2000),
      at: m.at || null,
    }));
}

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
  let reports = await res.json();
  const total = parseInt((res.headers.get('content-range') || '').split('/')[1] || '0', 10) || reports.length;

  // A child's safety, threats and self-harm go first (the proposed Terms
  // promise it). On the first page, pull every open urgent report too —
  // however old — so one can't sit on page 3 behind newer spam.
  if (page === 0) {
    const labels = URGENT_LABELS.map(l => `"${l.replace(/"/g, '')}"`).join(',');
    const uRes = await sb(env,
      `reports?status=eq.open&reason=in.(${encodeURIComponent(labels)})&order=created_at.asc&limit=${PAGE_SIZE}` +
      '&select=id,reporter_id,reported_id,reason,context,created_at,reported_snapshot');
    if (uRes.ok) {
      const urgent = await uRes.json();
      const seen = new Set(urgent.map(r => r.id));
      reports = [...urgent, ...reports.filter(r => !seen.has(r.id))];
    }
  }

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
  // Prefer the copy taken AT REPORT TIME (reports_snapshot_messages in
  // supabase/dm_upgrade_2026_10.sql) — it survives an unsend. Reports
  // filed before that SQL fall back to a live read, as before.
  const items = [];
  for (const r of reports) {
    let messages = snapshotMessages(r.reported_snapshot);
    if (!messages.length && r.reporter_id && r.reported_id) {
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
      urgent: isUrgent(r.reason),
      context: r.context || null,
      snapshot: r.reported_snapshot || null,
      reporter: who(r.reporter_id),
      reported: who(r.reported_id),
      messages,
    });
  }
  return [200, { ok: true, page, pageSize: PAGE_SIZE, total, items }];
}

/**
 * → 'ok' | 'missing' (schema) | 'nouser'. Throws on other failures.
 *
 * On a real change (not suspended → suspended, or back) it also records
 * the action in the audit trail and tells the user in-app — unless
 * `notifyUser` is false (child-safety reports: no tip-off). Repeating a
 * suspension that's already in place sends nothing twice and keeps the
 * original time (it's evidence of when).
 */
async function setSuspended(env, userId, on, { actorId = null, reportId = null, note = null, notifyUser = true } = {}) {
  let was = null;
  const cur = await sb(env, `profiles?id=eq.${userId}&select=suspended_at`);
  if (missingSchema(cur)) return 'missing';
  if (cur.ok) {
    const row = (await cur.json())[0];
    if (!row) return 'nouser';
    was = !!row.suspended_at;
  }
  if (on && was === true) return 'ok';
  const res = await sb(env, `profiles?id=eq.${userId}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ suspended_at: on ? new Date().toISOString() : null }),
  });
  if (missingSchema(res)) return 'missing';
  if (!res.ok) throw new Error(`suspend ${res.status}`);
  invalidateSuspended();
  if (!((await res.json()) || []).length) return 'nouser';
  if (was !== on) {
    await logAction(env, { reportId, targetId: userId, actorId, action: on ? 'suspend' : 'unsuspend', note });
    if (notifyUser) await notify(env, userId, on ? 'account_suspended' : 'account_restored');
  }
  return 'ok';
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
    const out = await setSuspended(env, target, false, { actorId: moderatorId, note });
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

  const rRes = await sb(env, `reports?id=eq.${id}&select=id,reported_id,reporter_id,reason,status,reported_snapshot`);
  if (missingSchema(rRes)) return NOT_INSTALLED;
  if (!rRes.ok) throw new Error(`report read ${rRes.status}`);
  const report = (await rRes.json())[0];
  if (!report) return [404, { error: 'no such report' }];

  // Suspend first: if that fails, the report stays open and visible in
  // the queue rather than being closed with the action not taken.
  let suspended = false;
  // Never tell the reported person about a child-safety report (tip-off
  // risk), and the owner can hold any notice back (`notify: false`).
  const tellReported = body.notify !== false && !quietToReported(report.reason);
  if (body.action === 'action' && body.suspend === true) {
    if (!report.reported_id) return [409, { error: 'the reported account no longer exists' }];
    const out = await setSuspended(env, report.reported_id, true, {
      actorId: moderatorId, reportId: report.id, note, notifyUser: tellReported,
    });
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

  // Tell the reporter how it ended — once: a report that was already
  // closed isn't re-announced if it's closed again.
  let reporterTold = false;
  if (report.reporter_id && report.status === 'open') {
    reporterTold = (await notify(env, report.reporter_id, reporterNoticeKind(body.action), reporterMeta(report), report.id)) === 'ok';
  }
  return [200, {
    ok: true, status: body.action === 'action' ? 'actioned' : 'dismissed', suspended,
    reportedId: report.reported_id || null, reporterTold, reportedTold: suspended && tellReported,
  }];
}

/**
 * Reset a user's display name, handle and/or profile picture (the Terms
 * promise the owner can). Body: { userId, fields: ['display_name' |
 * 'handle' | 'avatar'], reportId?, note?, notify? } → [status, body].
 *
 * Only the PUBLISHED copy in `profiles` is cleared — S.profile in
 * user_data (their own name and photo) is never touched. The removed
 * values are hashed into moderation_actions first, so the database
 * refuses the same value coming back from the app (profiles_reset_guard);
 * a different one goes through. The user is told in-app, never by whom.
 */
async function resetProfile(env, moderatorId, body) {
  const userId = String(body.userId || '');
  if (!UUID.test(userId)) return [400, { error: 'userId required' }];
  const fields = cleanResetFields(body.fields);
  if (!fields.length) return [400, { error: "fields must include 'display_name', 'handle' or 'avatar'" }];
  const note = String(body.note || '').slice(0, 500) || null;
  const reportId = UUID.test(String(body.reportId || '')) ? String(body.reportId) : null;

  const pRes = await sb(env, `profiles?id=eq.${userId}&select=id,display_name,handle,avatar_url`);
  if (!pRes.ok) throw new Error(`profile read ${pRes.status}`);
  const prof = (await pRes.json())[0];
  if (!prof) return [404, { error: 'no such user' }];

  const had = fields.filter(f => prof[RESET_FIELDS[f]] != null && prof[RESET_FIELDS[f]] !== '');
  if (!had.length) return [200, { ok: true, reset: [], message: 'Nothing to reset — those fields are already empty.' }];

  // Audit + sticky hashes BEFORE the reset, so the guard is in place the
  // moment the value is gone.
  let sticky = true;
  for (const f of had) {
    const action = `reset_${f}`;
    const out = await logAction(env, {
      reportId, targetId: userId, actorId: moderatorId, action,
      valueHash: resetHash(action, prof[RESET_FIELDS[f]]), note,
    });
    if (out !== 'ok') sticky = false;
  }

  const patch = Object.fromEntries(had.map(f => [RESET_FIELDS[f], null]));
  const uRes = await sb(env, `profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!uRes.ok) throw new Error(`profile reset ${uRes.status}`);
  console.info(`moderation: reset ${had.join(', ')} by owner${note ? ' (with note)' : ''}`);

  const told = body.notify === false ? false : (await notify(env, userId, 'content_reset', { fields: had })) === 'ok';
  return [200, {
    ok: true, reset: had, told,
    ...(sticky ? {} : { warning: 'Reset done, but the audit trail is not installed (run supabase/safety_2026_10b.sql) — the app may publish the same value again.' }),
  }];
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
  sb, missingSchema, listOpenReports, setSuspended, decideReport, listSuspended, snapshotMessages,
  resetProfile, notify, logAction, resetHash, cleanResetFields, reporterNoticeKind, reporterMeta,
  PAGE_SIZE, UUID, NOT_INSTALLED, SAFETY_NOT_INSTALLED,
};

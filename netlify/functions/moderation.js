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
 *
 * The queue logic itself lives in lib/moderationCore.js, shared with the
 * owner's Security console (functions/security-console.js), so the two
 * can never disagree about how a report is closed.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');
const { isOwnerEmail } = require('../lib/owner');
const { listOpenReports, decideReport } = require('../lib/moderationCore');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
  // Reports carry personal data; nothing between here and the owner may keep a copy.
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

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
      const [code, out] = await listOpenReports(env, page);
      return reply(code, out);
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
    const [code, out] = await decideReport(env, auth.userId, body);
    return reply(code, out);
  } catch (e) {
    console.error('moderation:', e?.message);
    return reply(500, { error: 'moderation failed' });
  }
};

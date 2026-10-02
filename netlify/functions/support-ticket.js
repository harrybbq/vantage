/**
 * Netlify function: support-ticket — Settings → "Report a problem".
 *
 * The support channel the stores require, landing in the same queue as
 * the auto-raised security tickets (public.security_tickets) so the
 * owner reads one list. source 'user', severity 'medium'.
 *
 *   POST { title, body, category? }   (session required)
 *     title     3–120 chars
 *     body      ≤ 2000 chars
 *     category  'bug' | 'account' | 'privacy' | 'abuse' | 'other'
 *   → 200 { ok:true, id }
 *     400 bad input · 401 no session · 429 over the limit
 *     503 not available yet (SQL not run) / could not save
 *
 * Limits: 5 a day per account — a count of that account's tickets since
 * UTC midnight, so it is durable across instances — plus 5 a minute in
 * memory as a brake on bursts.
 *
 * Stored: the user id (so the owner can reply in-app or act on it), the
 * text they typed, the category and the page path they sent. Nothing
 * from their app state.
 */
const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: CORS, body: JSON.stringify(body) });

const DAILY_LIMIT = 5;
const CATEGORIES = new Set(['bug', 'account', 'privacy', 'abuse', 'other']);
const MAX_BODY = 8 * 1024;

// NUL is stripped: Postgres text and jsonb refuse it, which would turn a
// stray character into a failed report.
const clean = (v, n) => String(v == null ? '' : v).split('\u0000').join('').trim().slice(0, n);

function pathOnly(p) {
  const s = clean(p, 300).split(/[?#]/)[0];
  return s.startsWith('/') ? s.slice(0, 120) : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method not allowed' });
  if (Buffer.byteLength(event.body || '', 'utf8') > MAX_BODY) return reply(413, { error: 'That is too long.' });

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('support-ticket', auth.userId, 5)) return tooMany(CORS);

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'invalid json' }); }
  const title = clean(b?.title, 120);
  const text = clean(b?.body ?? b?.detail, 2000);
  if (title.length < 3) return reply(400, { error: 'Add a short title.' });
  const category = CATEGORIES.has(b?.category) ? b.category : 'other';

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return reply(503, { error: 'Could not send right now — try again later.' });
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  try {
    // Durable daily cap: this account's tickets since UTC midnight.
    const since = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
    const cRes = await fetch(
      `${url}/rest/v1/security_tickets?reporter_id=eq.${auth.userId}&created_at=gte.${encodeURIComponent(since)}&select=id`,
      { method: 'HEAD', headers: { ...headers, Prefer: 'count=exact' } });
    if (cRes.status === 404 || cRes.status === 400) {
      return reply(503, { error: 'Problem reports are not switched on yet — try again later.' });
    }
    if (!cRes.ok) throw new Error(`count ${cRes.status}`);
    const used = parseInt((cRes.headers.get('content-range') || '').split('/')[1], 10) || 0;
    if (used >= DAILY_LIMIT) {
      return reply(429, { error: 'You have sent five reports today — we will read them. You can send more tomorrow.' });
    }

    const now = new Date().toISOString();
    const res = await fetch(`${url}/rest/v1/security_tickets?select=id`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        source: 'user',
        kind: `user:${category}`,
        severity: 'medium',
        title,
        detail: { text: text || null, category, page: pathOnly(b?.page) },
        status: 'open',
        reporter_id: auth.userId,
        last_seen_at: now,
      }),
    });
    if (res.status === 404 || res.status === 400) {
      return reply(503, { error: 'Problem reports are not switched on yet — try again later.' });
    }
    if (!res.ok) throw new Error(`insert ${res.status}`);
    const id = (await res.json())[0]?.id || null;
    return reply(200, { ok: true, id });
  } catch (e) {
    console.error('support-ticket:', e?.message);
    return reply(503, { error: 'Could not send right now — try again later.' });
  }
};

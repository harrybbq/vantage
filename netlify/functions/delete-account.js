/**
 * delete-account — actually delete the account, not just its data.
 *
 * App Store guideline 5.1.1(v) requires an app that lets you create an
 * account to let you delete it. The old flow deleted the `user_data`
 * row and signed out, which left auth.users, profiles, friendships,
 * push_tokens and more intact — the account still existed, and under
 * UK GDPR that is an incomplete erasure as well as a review risk.
 *
 * DELETION STRATEGY: delete the auth user and let Postgres cascade.
 * Every user-scoped table declares its FK as
 *   references auth.users(id) on delete cascade
 * so one delete removes user_data, user_data_history, profiles,
 * nutrition_log / _macros / _daily_summary, messages (both directions),
 * friendships, blocks, reports, push_tokens, whoop_tokens,
 * bank_connections, coach_nudges, rating_snapshots, notifications_queue
 * and waitlist.
 *
 * Enumerating those tables here instead would be worse: the list would
 * silently drift every time a table is added, and a missed one is a
 * data-protection problem nobody notices. The cascade is declared next
 * to each table, so it stays correct by construction. The only rule to
 * keep is that new user-scoped tables must carry the same FK.
 *
 * You can only ever delete YOURSELF: the id comes from the verified
 * JWT, never from the request body, so there is no id to tamper with.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (admin delete needs the
 * service role — the anon key cannot remove an auth user).
 */
const { requireUser } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const env = process.env;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    // Fail loudly rather than half-deleting: better the user is told it
    // didn't work than believes their account is gone when it isn't.
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'account deletion is not configured on this site' }),
    };
  }

  // Identity comes from the token, never the body.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  const userId = auth.userId;

  // Deliberate second gate: the client already confirms twice, but this
  // makes an accidental or replayed POST a no-op rather than a wipe.
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* treated as missing */ }
  if (body.confirm !== 'DELETE') {
    return {
      statusCode: 400, headers: CORS,
      body: JSON.stringify({ error: 'confirmation missing' }),
    };
  }

  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Already gone: treat as success so a retry after a dropped
    // response doesn't show the user a scary error.
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: 'could not delete account', detail: detail.slice(0, 200) }),
      };
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return {
      statusCode: 502, headers: CORS,
      body: JSON.stringify({ error: e.message || 'could not delete account' }),
    };
  }
};

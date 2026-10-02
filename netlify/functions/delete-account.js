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
 * ── What the cascade does NOT cover (2026-09-30, items 52/67) ─────────
 * Run BEFORE the auth delete, because they need the user to still exist
 * or would be destroyed by the cascade:
 *   · Groups the user owns are handed to the longest-standing member
 *     (lib/leagues.js handOverGroup — the same heir rule as Leave).
 *     groups.owner_id cascades, so without this an owner deleting their
 *     account deleted the group for every member.
 *   · tracker_streaks rows (live FK is NO ACTION, so they would block
 *     the delete). Best effort; 400/404 = table/column absent.
 * Run AFTER the auth delete succeeds — never before, so a failed auth
 * delete cannot leave a live account with its files gone:
 *   · Storage objects under `<uid>/` in the `cv` and `recipes` buckets
 *     (storage.objects has no FK to auth.users).
 *   · The RevenueCat subscriber, when REVENUECAT_SECRET_API_KEY is set.
 * All of these are best effort and logged; none of them can turn a
 * successful account deletion into a reported failure.
 *
 * WHOOP / Oura: the stored tokens go with the cascade, but the grant is
 * not revoked at the provider. TODO: neither lib/whoop.js nor lib/oura.js
 * documents a revoke endpoint, and guessing one is worse than leaving
 * it — add it here once confirmed from the providers' API docs.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (admin delete needs the
 * service role — the anon key cannot remove an auth user). Optional:
 * REVENUECAT_SECRET_API_KEY.
 */
const { requireUser } = require('../lib/requireUser');
const { handOverGroup } = require('../lib/leagues');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const STORAGE_BUCKETS = ['cv', 'recipes'];

const svc = (serviceKey, extra = {}) => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra });

/** Hand over every group this user owns. Throws if a hand-over fails. */
async function handOverOwnedGroups(userId, url, serviceKey) {
  const res = await fetch(`${url}/rest/v1/groups?owner_id=eq.${userId}&select=id`, { headers: svc(serviceKey) });
  if (res.status === 404 || res.status === 400) return 0;   // groups schema not installed
  if (!res.ok) throw new Error('owned groups read failed');
  const owned = await res.json();
  for (const g of owned) {
    // null heir = nobody else in it; the cascade removes the empty group.
    await handOverGroup(g.id, userId, { supabaseUrl: url, serviceKey });
  }
  return owned.length;
}

/** Every object path under `<uid>/` in a bucket, one level of folders deep. */
async function listUserObjects(url, serviceKey, bucket, prefix, depth = 0) {
  const out = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: svc(serviceKey, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!res.ok) break;
    const items = await res.json().catch(() => []);
    for (const it of items) {
      if (!it?.name) continue;
      const path = `${prefix}${it.name}`;
      if (it.id == null && depth < 2) out.push(...await listUserObjects(url, serviceKey, bucket, `${path}/`, depth + 1));
      else if (it.id != null) out.push(path);
    }
    if (items.length < 1000) break;
  }
  return out;
}

async function removeStorage(userId, url, serviceKey) {
  let removed = 0;
  for (const bucket of STORAGE_BUCKETS) {
    try {
      const paths = await listUserObjects(url, serviceKey, bucket, `${userId}/`);
      for (let i = 0; i < paths.length; i += 100) {
        const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: svc(serviceKey, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }),
        });
        if (res.ok) removed += Math.min(100, paths.length - i);
        else console.error('delete-account: storage remove failed', bucket, res.status);
      }
    } catch (e) {
      console.error('delete-account: storage cleanup failed', bucket, e?.message);
    }
  }
  return removed;
}

async function deleteRevenueCatSubscriber(userId) {
  const key = process.env.REVENUECAT_SECRET_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok && res.status !== 404) console.error('delete-account: RevenueCat delete failed', res.status);
    return res.ok;
  } catch (e) {
    console.error('delete-account: RevenueCat unreachable', e?.message);
    return false;
  }
}

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

  // ── Before: things the cascade would destroy or be blocked by ──
  try {
    await handOverOwnedGroups(userId, url, serviceKey);
  } catch (e) {
    // Stop here: deleting now would take the group from its members.
    console.error('delete-account: group hand-over failed', e?.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'could not delete account — try again' }) };
  }
  try {
    const ts = await fetch(`${url}/rest/v1/tracker_streaks?user_id=eq.${userId}`, {
      method: 'DELETE', headers: svc(serviceKey, { Prefer: 'return=minimal' }),
    });
    if (!ts.ok && ts.status !== 404 && ts.status !== 400) console.error('delete-account: tracker_streaks delete', ts.status);
  } catch { /* best effort */ }

  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: svc(serviceKey, { 'Content-Type': 'application/json' }),
    });

    // Already gone: treat as success so a retry after a dropped
    // response doesn't show the user a scary error.
    if (!res.ok && res.status !== 404) {
      const detail = await res.text().catch(() => '');
      console.error('delete-account: auth delete failed', res.status, detail.slice(0, 300));
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'could not delete account' }) };
    }
  } catch (e) {
    console.error('delete-account: auth delete unreachable', e?.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'could not delete account' }) };
  }

  // ── After: the account is gone; clean up what the cascade cannot ──
  await Promise.all([
    removeStorage(userId, url, serviceKey),
    deleteRevenueCatSubscriber(userId),
  ]).catch(() => null);

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
};

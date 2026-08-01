/**
 * Netlify serverless function: push-dispatch
 *
 * Reads pending rows from the `notifications_queue` table (populated
 * by Postgres triggers on `friendships`, etc.) and sends them via
 * Firebase Cloud Messaging HTTP v1. FCM handles both APNs delivery
 * (when the iOS APNs key is uploaded to the Firebase project) and
 * Android delivery from a single API.
 *
 * Triggered by:
 *   - Netlify Scheduled Function (every 1 minute) — see netlify.toml
 *   - HTTP POST with the dispatch secret (manual / one-off)
 *
 * Required Netlify env vars (all set in dashboard):
 *   SUPABASE_URL                  — same as the client uses
 *   SUPABASE_SERVICE_ROLE_KEY     — service role key (NOT the anon key)
 *   FCM_SERVICE_ACCOUNT_JSON      — JSON string of the FCM service
 *                                   account key. Generate in Firebase
 *                                   Console → Project settings → Service
 *                                   accounts → Generate new private key.
 *                                   Paste the entire JSON file content
 *                                   into the env var as a single string.
 *   FCM_PROJECT_ID                — your Firebase project ID (e.g. "visionboard-prod")
 *   PUSH_DISPATCH_SECRET          — long random string, sent in
 *                                   X-Dispatch-Secret header on manual
 *                                   triggers. Scheduled invocations
 *                                   skip auth (they're internal).
 *
 * Behaviour with missing env vars:
 *   - If SUPABASE_* missing: return 500 with a helpful message.
 *   - If FCM_* missing: skip actual sending, log "no provider
 *     configured", mark each row's last_attempt_at and increment
 *     attempt_count, but leave sent_at NULL. Lets you flip the queue
 *     trigger live before keys are uploaded without piling up
 *     "delivered" rows that never actually fired.
 *
 * Per-token failure handling:
 *   - 404 / UNREGISTERED → token is dead (app uninstalled). Remove
 *     from user's pushTokens array and mark error="unregistered".
 *   - Any other error → leave row pending; attempt_count > 5 will be
 *     filtered out by the partial index in notifications_pending.
 */

const crypto = require('node:crypto');
const { requireScheduler } = require('../lib/cronAuth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Dispatch-Secret',
  'Content-Type': 'application/json',
};

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Treating GET as "scheduled" meant the shared secret only ever
  // guarded POST — the one method an attacker has no reason to pick. A
  // bare GET to this URL skipped auth entirely and flushed the whole
  // notification queue, spending FCM quota and delivering every pending
  // push early. The scheduler is identified by the absence of an HTTP
  // method (or a `next_run` body), which no HTTP client can forge;
  // everything else now needs PUSH_DISPATCH_SECRET.
  const denied = requireScheduler(event, CORS, 'PUSH_DISPATCH_SECRET');
  if (denied) return denied;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured' }),
    };
  }

  const supabase = createSupabaseAdmin(supabaseUrl, serviceKey);

  // Pull a batch of pending rows
  const pending = await supabase.select(
    'notifications_pending',
    { limit: BATCH_SIZE }
  );
  if (pending.error) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: 'queue read failed', detail: pending.error }),
    };
  }
  const rows = pending.data || [];
  if (rows.length === 0) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ processed: 0 }) };
  }

  // Are FCM creds available? If not, mark attempts and return.
  const fcmReady = !!(process.env.FCM_SERVICE_ACCOUNT_JSON && process.env.FCM_PROJECT_ID);

  let accessToken = null;
  if (fcmReady) {
    try {
      accessToken = await getFcmAccessToken();
    } catch (e) {
      console.error('FCM access token error:', e.message);
      // Fall through; we'll log per-row failures rather than 500
    }
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    try {
      // Honor user prefs at dispatch time. The client writes
      // S.notifications into user_data.state; we read it here so the
      // user's latest toggle wins even if the queue was populated
      // before they opted out.
      //
      // Tokens come from the dedicated push_tokens table — NOT from
      // user_data.state.pushTokens (legacy, removed 2026-05-03 after
      // the read-modify-write race wiped a user's data on phone).
      const userState = await supabase.selectOne('user_data', { id: row.user_id }, 'state');
      const prefs = userState?.data?.state?.notifications || {};
      const tokenRows = await supabase.select('push_tokens', {
        match: { user_id: row.user_id },
        select: 'token,platform,last_seen_at',
      });
      const tokens = (tokenRows.data || []).map(t => ({
        token: t.token,
        platform: t.platform,
        registeredAt: t.last_seen_at,
      }));

      const prefKey = KIND_TO_PREF[row.kind];
      if (prefKey && prefs[prefKey] === false) {
        await supabase.update('notifications_queue', { id: row.id }, {
          sent_at: new Date().toISOString(),
          error: 'user_opted_out',
        });
        skipped++;
        continue;
      }

      if (isInQuietHours(prefs)) {
        // Re-schedule for after the window — bump scheduled_at to the
        // window's `end` time tomorrow. Cheap and predictable.
        const next = nextAfterQuietHours(prefs);
        await supabase.update('notifications_queue', { id: row.id }, {
          scheduled_at: next.toISOString(),
        });
        skipped++;
        continue;
      }

      if (tokens.length === 0) {
        await supabase.update('notifications_queue', { id: row.id }, {
          sent_at: new Date().toISOString(),
          error: 'no_token',
        });
        skipped++;
        continue;
      }

      if (!fcmReady || !accessToken) {
        await supabase.update('notifications_queue', { id: row.id }, {
          last_attempt_at: new Date().toISOString(),
          attempt_count: (row.attempt_count || 0) + 1,
          error: 'fcm_not_configured',
        });
        skipped++;
        continue;
      }

      // Send to each registered device for the user. We tolerate per-
      // token failures without failing the whole row — only when ALL
      // tokens fail terminally do we mark error.
      let anyDelivered = false;
      const deadTokens = [];
      for (const tk of tokens) {
        const result = await sendFcm(accessToken, tk.token, {
          title: row.payload?.title || 'VisionBoard',
          body:  row.payload?.body  || '',
          data: {
            kind: row.kind,
            ...stringifyValues(row.payload || {}),
          },
        });
        if (result.ok) {
          anyDelivered = true;
        } else if (result.unregistered) {
          deadTokens.push(tk.token);
        }
      }

      // Prune dead tokens from the dedicated table. Single DELETE per
      // token avoids any read-modify-write of user_data state — the
      // exact pattern that caused the May 3 wipe.
      for (const dead of deadTokens) {
        await supabase.delete('push_tokens', { user_id: row.user_id, token: dead });
      }

      if (anyDelivered) {
        await supabase.update('notifications_queue', { id: row.id }, {
          sent_at: new Date().toISOString(),
        });
        sent++;
      } else {
        await supabase.update('notifications_queue', { id: row.id }, {
          last_attempt_at: new Date().toISOString(),
          attempt_count: (row.attempt_count || 0) + 1,
          error: deadTokens.length === tokens.length ? 'all_tokens_dead' : 'send_failed',
        });
        failed++;
      }
    } catch (e) {
      console.error('Row dispatch error:', row.id, e.message);
      failed++;
    }
  }

  return {
    statusCode: 200, headers: CORS,
    body: JSON.stringify({ processed: rows.length, sent, skipped, failed }),
  };
};

// ── FCM HTTP v1 ────────────────────────────────────────────────────────────

/**
 * Mint a short-lived OAuth2 access token from the service-account JSON.
 * Avoids pulling in google-auth-library (60+ kB) for one call.
 */
async function getFcmAccessToken() {
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const headerB64 = b64urlJson({ alg: 'RS256', typ: 'JWT' });
  const claimB64 = b64urlJson(claim);
  const signingInput = `${headerB64}.${claimB64}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(sa.private_key)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error('FCM token exchange failed: ' + JSON.stringify(json));
  }
  return json.access_token;
}

async function sendFcm(accessToken, deviceToken, { title, body, data }) {
  const projectId = process.env.FCM_PROJECT_ID;
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const message = {
    token: deviceToken,
    notification: { title, body },
    data, // values must be strings
    apns: {
      payload: {
        aps: { sound: 'default', 'content-available': 1 },
      },
    },
    android: {
      priority: 'high',
      notification: { sound: 'default' },
    },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    const status = err?.error?.status;
    // Token is no longer valid — app uninstalled or Firebase moved it.
    if (status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT') {
      return { ok: false, unregistered: true };
    }
    console.warn('FCM send failed:', res.status, JSON.stringify(err));
    return { ok: false };
  } catch (e) {
    console.warn('FCM send error:', e.message);
    return { ok: false };
  }
}

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Preference + quiet hours (mirror of src/lib/push/handlers.js) ──────────
// Duplicated rather than imported because Netlify functions and the
// Vite client live in separate module systems. The mapping is small
// and tested at both ends of the wire.
const KIND_TO_PREF = {
  'vision-unlock':   'visionUnlock',
  'friend-request':  'friendRequest',
  'friend-accepted': 'friendRequest',
  'streak-warning':  'streakWarning',
  'coach-nudge':     'coachNudge',
  'daily-reminder':  'streakWarning', // shares the streak-warning toggle
};

function isInQuietHours(prefs, now = new Date()) {
  const q = prefs?.quietHours;
  if (!q || !q.start || !q.end) return false;
  const [sh, sm] = q.start.split(':').map(Number);
  const [eh, em] = q.end.split(':').map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

function nextAfterQuietHours(prefs, now = new Date()) {
  const q = prefs?.quietHours;
  const [eh, em] = q.end.split(':').map(Number);
  const next = new Date(now);
  next.setHours(eh, em, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v == null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

// ── Tiny Supabase REST client ──────────────────────────────────────────────
// Avoiding @supabase/supabase-js in the Lambda bundle (cold-start cost).
// PostgREST is straightforward for the few calls we need.
function createSupabaseAdmin(url, serviceKey) {
  const base = `${url}/rest/v1`;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  async function select(table, opts = {}) {
    // Two call shapes for backward compat:
    //   select('foo', { limit })                          → simple
    //   select('foo', { match: {...}, select: '...', limit })
    const cols = opts.select || '*';
    const filters = opts.match
      ? '&' + Object.entries(opts.match)
          .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&')
      : '';
    const lim = opts.limit ? `&limit=${opts.limit}` : '';
    const u = `${base}/${table}?select=${cols}${filters}${lim}`;
    const r = await fetch(u, { headers });
    if (!r.ok) return { error: await r.text() };
    return { data: await r.json() };
  }

  async function selectOne(table, match, columns = '*') {
    const filters = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const u = `${base}/${table}?select=${columns}&${filters}&limit=1`;
    const r = await fetch(u, { headers });
    if (!r.ok) return { error: await r.text() };
    const arr = await r.json();
    return { data: arr[0] || null };
  }

  async function update(table, match, patch) {
    const filters = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const u = `${base}/${table}?${filters}`;
    const r = await fetch(u, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    });
    if (!r.ok) return { error: await r.text() };
    return { data: await r.json() };
  }

  async function del(table, match) {
    const filters = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
    const u = `${base}/${table}?${filters}`;
    const r = await fetch(u, { method: 'DELETE', headers });
    if (!r.ok) return { error: await r.text() };
    return { ok: true };
  }

  return { select, selectOne, update, delete: del };
}

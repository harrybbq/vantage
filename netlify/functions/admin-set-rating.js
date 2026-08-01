/**
 * Netlify serverless function: admin-set-rating
 *
 * The one legitimate way to write `prestige` / `ratings*` on a profile
 * by hand. Everything else derives them (recompute-ratings).
 *
 * Why it exists: the leaderboard ranks by `prestige * 100 + ratings_ovr`
 * (get-leaderboard.js), and both columns were granted to
 * `authenticated`. AdminEditModal is owner-only in the UI, but a UI gate
 * is not an access control — any signed-in user could PATCH PostgREST
 * directly:
 *
 *   PATCH /rest/v1/profiles?id=eq.<own uid>
 *   {"prestige":99,"ratings_ovr":99}
 *
 * and sit at the top of the all-time board forever, with no purchase,
 * no activity and nothing to undo it. Moving the write here is what
 * lets supabase/leaderboard_column_lockdown.sql revoke the columns.
 *
 * Guards, in order:
 *   - valid Supabase session (JWT verified against /auth/v1/user)
 *   - the caller's email is in OWNER_EMAIL (comma-separated)
 *   - values clamped server-side; the client's numbers are advisory
 *   - writes ONLY the caller's own row — an owner cannot edit someone
 *     else's rating through this, because no target id is accepted
 *
 * Fails CLOSED: with OWNER_EMAIL unset nobody passes, which is the
 * right default for a function that writes leaderboard inputs.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const PRESTIGE_MAX = 99;

const clamp = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  // ── Who is calling ──
  const raw = event.headers?.authorization || event.headers?.Authorization || '';
  const jwt = raw.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'sign in' }) };

  const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const me = await who.json();
  const userId = me?.id;
  const email = (me?.email || '').toLowerCase();
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  // ── Is the caller an owner ──
  const owners = (process.env.OWNER_EMAIL || process.env.VITE_OWNER_EMAIL || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!owners.length || !owners.includes(email)) {
    // Deliberately identical to an auth failure: confirming that the
    // endpoint exists but you're not an owner tells an attacker they
    // found the admin surface.
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'forbidden' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'invalid json' }) };
  }

  // Clamp here rather than trusting the modal's clamp — the modal is
  // just one client of this endpoint.
  const ratings = {
    brain:   clamp(body.brain,   1, 99),
    finance: clamp(body.finance, 1, 99),
    fitness: clamp(body.fitness, 1, 99),
    social:  clamp(body.social,  1, 99),
    ovr:     clamp(body.ovr,     1, 99),
    computedAt: new Date().toISOString(),
  };
  const prestige = clamp(body.prestige, 0, PRESTIGE_MAX);

  const res = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        prestige,
        ratings,
        ratings_ovr: ratings.ovr,
        ratings_computed_at: ratings.computedAt,
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    console.error('admin-set-rating patch failed:', res.status, detail);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'profile update failed' }) };
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, prestige, ratings }) };
};

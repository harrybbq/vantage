/**
 * Netlify serverless function: recompute-ratings
 *
 * FEATURE 5 Sprint 3 — Level 2 trust boundary for the ranked
 * categories system. Friends read profiles.{ratings, ratings_ovr}
 * — NOT a user's claimed S.ratings — so this function is the
 * single source of truth for what friends see.
 *
 * Rating math lives in netlify/lib/recompute.js (server-side mirror of
 * src/lib/ratings/derive.js — keep them in lockstep; see
 * docs/RANKING_SYSTEM.md). This file is just the auth + rate-limit
 * wrapper that exposes recomputeUser() to the JWT-bearing client.
 */

const { recomputeUser } = require('../lib/recompute');

// ── Rate limiting ─────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimits = new Map();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function checkRateLimit(ip) {
  const now = Date.now();
  const e = rateLimits.get(ip) || { count: 0, t: now };
  if (now - e.t > RATE_LIMIT_WINDOW_MS) { e.count = 0; e.t = now; }
  e.count++;
  rateLimits.set(ip, e);
  return e.count <= RATE_LIMIT_MAX;
}

// ── Handler ───────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'anon';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate limited' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'supabase env missing' }) };
  }

  // ── Auth: verify the user's JWT ──
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'missing token' }) };

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'invalid token' }) };
  const user = await userRes.json();
  const userId = user?.id;
  if (!userId) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no user id' }) };

  try {
    const { ratings, computedAt, prestige } = await recomputeUser(userId, { supabaseUrl, serviceKey });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, ratings, computedAt, prestige }) };
  } catch (e) {
    return {
      statusCode: 500, headers: CORS,
      body: JSON.stringify({ error: e.message || 'recompute failed', detail: e.detail }),
    };
  }
};

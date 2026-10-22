/**
 * Netlify serverless function: ai-coach-daily
 *
 * Generates a daily Morning Brief (3 lines) and, on Sundays, a Weekly
 * Review (~150 words) for a Pro user. Sends a structured snapshot of
 * the user's Vantage state to Claude Haiku and returns the JSON.
 *
 * WHOOP / Oura data is stripped from the snapshot before it is sent
 * unless AI_WEARABLE_DATA_ALLOWED is exactly 'true' — see
 * netlify/lib/coachWearableGuard.js for why and for what counts.
 *
 * The snapshot includes recent_briefs (last few days the model produced)
 * so we can ask Haiku to actively diverge from yesterday's advice. This
 * is the single biggest fix for "the coach said the same thing all week"
 * — without it, similar snapshots produce similar advice.
 *
 * Required Netlify env var:
 *   ANTHROPIC_API_KEY
 * Optional:
 *   AI_WEARABLE_DATA_ALLOWED  'true' lets band-derived values through.
 *                             Unset (the default) strips them.
 *
 * Safe mode (item 105, 2026-10-20): the snapshot is checked for
 * self-harm, eating-disorder, relapse, over-training and under-18
 * signals BEFORE the model runs (netlify/lib/coachSafety.js). Self-harm
 * → a fixed brief with Samaritans/999 and no model call; the others →
 * a reduced snapshot, gentle-mode instructions and a fixed helpline line.
 * Every model brief is then checked against the output policy and
 * replaced if it breaks it. Prompt + pipeline: netlify/lib/coachPrompt.js.
 * Red-team eval: scripts/coach-redteam/.
 *
 * The client is responsible for caching the result for the day (cheap
 * — saved in the user's cloud state). Server-side rate limiting just
 * stops abuse from a single IP.
 */

const rateLimits = new Map();
const RATE_LIMIT = 6;            // a Pro user shouldn't need more than a couple per day
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, windowStart: now };
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

const { pauseGate } = require('../killSwitch');
const sbKeys = require('../sbKeys');
const { requireUser, underLimit, tooMany } = require('../requireUser');
const { withinDailyAiCap, overDailyCap } = require('../aiQuota');
const { isOwnerEmail } = require('../owner');
const { consentGate } = require('../consentGate');
const { prepareBrief, callModel, finaliseBrief } = require('../coachPrompt');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Prompt, snapshot sizing, safe mode and the output policy live in
// lib/coachPrompt.js + lib/coachSafety.js so the red-team eval runs the
// same path without loading this handler.
const RAW_BODY_MAX_BYTES = 256 * 1024;

/** Pro/lifetime from the server-owned profiles.tier — never the client. */
async function isPaid(userId) {
  const url = process.env.SUPABASE_URL;
  const key = sbKeys.serviceKey(process.env);
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=tier`, {
      headers: sbKeys.serviceKeyHeaders(key),
    });
    if (!res.ok) return false;
    const tier = (await res.json())[0]?.tier;
    return tier === 'pro' || tier === 'lifetime';
  } catch {
    return false;
  }
}

function isValidSnapshot(s) {
  return s && typeof s === 'object' &&
    typeof s.name === 'string' &&
    Array.isArray(s.habits) &&
    Array.isArray(s.achievements) &&
    Array.isArray(s.trackers);
}

// ── Handler ───────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  const pausedRes = pauseGate('ai', CORS);
  if (pausedRes) return pausedRes;
  if (event.httpMethod !== 'POST') {

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Costs money / fetches on the user's behalf — one brief per day in practice; 6 absorbs retries.
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('ai-coach', auth.userId, 6)) return tooMany(CORS);
  // AI consent, on the server (item 98): the brief sends health-adjacent
  // data to Anthropic, so it needs the explicit yes the app asks for.
  const noConsent = await consentGate(auth.userId, 'ai', CORS);
  if (noConsent) return noConsent;

  // The coach is a Pro feature. The client hides it from free users,
  // but the endpoint spends money for whoever calls it, so the tier is
  // checked here against the server-owned column. Fails closed.
  if (!isOwnerEmail(auth.email) && !(await isPaid(auth.userId))) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'The AI coach is part of Pro.' }) };
  }

  const ip = event.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'Rate limit reached — try again in a moment' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'AI Coach is not configured on the server' }) };
  }

  if (Buffer.byteLength(event.body || '', 'utf8') > RAW_BODY_MAX_BYTES) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Snapshot too large' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  if (!isValidSnapshot(body.snapshot)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'snapshot is required and must include name, habits, achievements, trackers' }) };
  }
  // Band data out, then the safety pre-checks, then sizing — all in
  // prepareBrief (lib/coachPrompt.js), in that order.
  const prepared = prepareBrief(body.snapshot);
  if (prepared.kind === 'too-large') {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'Snapshot too large' }) };
  }
  // Self-harm signals: a fixed, reviewed brief with helplines. No model
  // call, so no AI allowance is charged for it.
  if (prepared.kind === 'deterministic') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ...prepared.brief, generated_at: new Date().toISOString(), model: 'none' }) };
  }

  // Durable per-day cap, charged only once the request is going ahead.
  if (!(await withinDailyAiCap('coach', auth.userId))) return overDailyCap(CORS);

  try {
    const raw = await callModel(prepared, { apiKey });
    const safe = finaliseBrief(raw, prepared);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(safe) };
  } catch (err) {
    console.error('ai-coach-daily error:', err.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ error: 'Coach is taking a break — please try again shortly' }),
    };
  }
};

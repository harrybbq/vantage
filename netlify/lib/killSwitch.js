/**
 * Kill switch without a code change (STARTUP_REQUIREMENTS item 78).
 *
 * VANTAGE_PAUSE is a comma list of areas to switch off:
 *   ai      ai-food-detect, ai-coach-daily, recipe-from-video, destination-brief
 *   social  get-leaderboard, groups, settle-leagues, prestige-up, avatar-check
 *   sync    whoop-sync, whoop-cron, oura-sync, oura-cron, health-sync,
 *           whoop-callback, oura-callback
 *   push    push-dispatch
 *   all     every area above
 * Case-insensitive, whitespace ignored, unknown values ignored
 * (`VANTAGE_PAUSE=" AI , sync"` pauses ai and sync).
 *
 * NEVER paused, on purpose — they are what you use during an incident,
 * or what a user needs whatever is happening: delete-account, health,
 * security-console / security-sweep / security-agent (the owner's tools
 * — the security agent spends AI but is left OUT of `ai` for that
 * reason), moderation, support-ticket, client-error, csp-report.
 *
 * Netlify applies env var changes to functions only on the next deploy:
 * after setting or clearing VANTAGE_PAUSE, Deploys → Trigger deploy →
 * Deploy site. No code change, but not instant — see
 * docs/INCIDENT_RUNBOOK.md §3.
 *
 * HTTP functions answer pausedResponse(area): 503, Retry-After 600,
 * no-store, `{ error: 'paused', area, message }`. The client turns that
 * into one calm line (src/lib/authFetch.js). Scheduled functions log one
 * line and return early instead.
 */
const AREAS = ['ai', 'social', 'sync', 'push'];
const MESSAGE = 'Paused for maintenance — back soon.';

/** → Set of paused areas from a raw VANTAGE_PAUSE value. */
function parsePause(raw) {
  const out = new Set();
  for (const part of String(raw || '').split(',')) {
    const v = part.trim().toLowerCase();
    if (v === 'all') AREAS.forEach(a => out.add(a));
    else if (AREAS.includes(v)) out.add(v);
  }
  return out;
}

/** True when `area` is switched off by VANTAGE_PAUSE in `env`. */
function paused(area, env = process.env) {
  return parsePause(env && env.VANTAGE_PAUSE).has(area);
}

/** The ready-to-return 503 for a paused HTTP function. */
function pausedResponse(area, headers = {}) {
  return {
    statusCode: 503,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': '600',
    },
    body: JSON.stringify({ error: 'paused', area, message: MESSAGE }),
  };
}

/**
 * For HTTP handlers: the 503 when `area` is paused, else null.
 *   const p = pauseGate('ai', CORS); if (p) return p;
 */
function pauseGate(area, headers = {}, env = process.env) {
  return paused(area, env) ? pausedResponse(area, headers) : null;
}

/**
 * For scheduled handlers: true (and one log line) when paused, so the
 * caller returns early without touching anything.
 */
function pausedCron(area, name, env = process.env) {
  if (!paused(area, env)) return false;
  console.info(`${name}: paused by VANTAGE_PAUSE (${area}) — skipping this run`);
  return true;
}

module.exports = { AREAS, MESSAGE, parsePause, paused, pausedResponse, pauseGate, pausedCron };

/**
 * Netlify function: trading-summary
 *
 * Read-only window onto the sibling app (vantage-trades). Vantage pulls;
 * it never pushes. There is no code path here that can place an order,
 * halt an agent or move capital — by design, not by omission.
 *
 * Why this exists rather than the browser calling the trading app
 * directly: the token is a server-side secret. In the client it would be
 * readable by anyone who opens devtools, and a `VITE_` prefix would bake
 * it into the public bundle. It stays here.
 *
 * Env (set in the Netlify UI, never in the repo):
 *   TRADING_REPORT_URL    — full URL of the trading app's report endpoint
 *   TRADING_REPORT_TOKEN  — the read-only token
 *   OWNER_EMAIL           — comma-separated; already used by admin-set-rating
 *
 * Fails CLOSED on every axis: no session, not an owner, or unconfigured
 * env all refuse rather than guess.
 */

const { requireUser } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  // Brokerage figures are never cacheable — a stale number here reads as
  // a current one, which is worse than no number.
  'Cache-Control': 'no-store',
};

const UPSTREAM_TIMEOUT_MS = 8000;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  // ── Who is asking ──
  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;

  // requireUser gives us the id; we need the email for the owner check,
  // so re-read the verified user rather than trusting anything client-sent.
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const apikey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const jwt = (event.headers?.authorization || event.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '').trim();

  let email = '';
  try {
    const who = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${jwt}` },
    });
    if (who.ok) email = ((await who.json())?.email || '').toLowerCase();
  } catch { /* falls through to the owner check below */ }

  const owners = (process.env.OWNER_EMAIL || process.env.VITE_OWNER_EMAIL || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!owners.length || !email || !owners.includes(email)) {
    // Same shape as any other refusal — don't confirm that a trading
    // endpoint exists to someone who isn't allowed to see it.
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'forbidden' }) };
  }

  // ── Upstream ──
  const reportUrl = process.env.TRADING_REPORT_URL;
  const token = process.env.TRADING_REPORT_TOKEN;
  if (!reportUrl || !token) {
    // Distinct from an upstream failure: nothing is wrong, it just isn't
    // wired up yet. The widget renders a setup hint rather than an alarm.
    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ configured: false }),
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(reportUrl, {
      // Header, never a query string: query strings land in server logs,
      // browser history and Referer headers. Vantage's own health-sync
      // token made that mistake and had to be fixed retroactively.
      headers: { 'X-Vantage-Token': token, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return {
        statusCode: 502, headers: CORS,
        body: JSON.stringify({ error: 'upstream', status: res.status }),
      };
    }
    const payload = await res.json();
    // Returned unchanged. Reshaping here would put a second, silently
    // divergent copy of the money rules in this repo.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ configured: true, report: payload }) };
  } catch (e) {
    // "Could not reach it" must never look like "nothing there" — an
    // empty success would render as a healthy, empty portfolio.
    return {
      statusCode: 504, headers: CORS,
      body: JSON.stringify({ error: e.name === 'AbortError' ? 'timeout' : 'unreachable' }),
    };
  } finally {
    clearTimeout(timer);
  }
};

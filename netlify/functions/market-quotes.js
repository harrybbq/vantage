/**
 * Netlify function: market-quotes
 *
 * Delayed stock quotes for the Market widget. Public market data only —
 * no account, no positions, no orders. Nothing here touches the trading
 * app or a broker.
 *
 * DELAYED, DELIBERATELY. Real-time exchange quotes need a paid data
 * licence in most markets; 15-minute delayed data does not. The payload
 * carries `delayed: true` so the widget can label it, because a ticker
 * that silently shows stale prices as live is the bad version of this
 * feature.
 *
 * Fail-soft, like the food-search sources: with no key configured it
 * answers `{ configured: false }` and the widget shows a setup hint
 * rather than an error. Adding the key needs no code change.
 *
 * Env:
 *   FINNHUB_API_KEY — free tier, delayed quotes
 *
 * Cost control, because this is a per-user widget hitting a metered API:
 *   - module-scope cache shared across invocations on a warm instance
 *   - per-account rate limit
 *   - a hard cap on symbols per request
 */

const { requireUser, underLimit, tooMany } = require('../lib/requireUser');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MAX_SYMBOLS = 20;          // hard ceiling regardless of tier
const CACHE_MS = 60_000;         // quotes are delayed anyway
const cache = new Map();         // symbol -> { at, quote }

const clean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);

async function quoteFor(symbol, key) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.quote;

  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`
  );
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const d = await res.json();

  // Finnhub answers 200 with zeroes for an unknown symbol. A zero price
  // is not a price — surface it as unknown so the widget can say so
  // instead of rendering a confident 0.00.
  const known = typeof d?.c === 'number' && d.c > 0;
  const quote = {
    symbol,
    price: known ? d.c : null,
    changePct: known && typeof d.dp === 'number' ? d.dp : null,
    prevClose: known && typeof d.pc === 'number' ? d.pc : null,
  };
  cache.set(symbol, { at: Date.now(), quote });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return quote;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method not allowed' }) };
  }

  const auth = await requireUser(event, CORS);
  if (auth.error) return auth.error;
  if (!underLimit('market', auth.userId, 30)) return tooMany(CORS);

  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    // Name the variable, never its value. This is the difference
    // between "you haven't set it" and "you set it but scoped it to
    // Builds, so the function can't see it" — indistinguishable from
    // the outside otherwise.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ configured: false, missing: 'FINNHUB_API_KEY' }) };
  }

  const raw = (event.queryStringParameters?.symbols || '').split(',');
  const symbols = [...new Set(raw.map(clean).filter(Boolean))].slice(0, MAX_SYMBOLS);
  if (!symbols.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'no symbols' }) };
  }

  try {
    const quotes = await Promise.all(symbols.map(s =>
      quoteFor(s, key).catch(() => ({ symbol: s, price: null, changePct: null, prevClose: null }))
    ));
    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
      body: JSON.stringify({ configured: true, delayed: true, asOf: new Date().toISOString(), quotes }),
    };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: 'upstream', detail: e.message }) };
  }
};

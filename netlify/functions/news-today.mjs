/**
 * news-today — v2 entry. The handler is unchanged in
 * netlify/lib/handlers/news-today.js; this file exists only so Netlify
 * enforces a per-IP rate limit BEFORE the function runs (STARTUP_
 * REQUIREMENTS item 86). See netlify/lib/v1Adapter.mjs for why the
 * handler is wrapped rather than rewritten.
 *
 * 300 requests / 60 s per IP. General tier: each call is a GNews
 * request. The general number is sized for the busiest client path (food
 * search, 450 ms debounce, capped in-function at 40 a minute per user)
 * with room for several people behind one carrier-NAT or office address
 * — a flood from one address stops here, a busy shared address does not.
 *
 * aggregateBy ['ip', 'domain'] = one counter per client IP per domain
 * (domain-only pooling is Enterprise). Over the limit Netlify answers
 * 429 itself; the function is not invoked. No `path`: a v2 function
 * with a custom path stops answering on /.netlify/functions/news-today,
 * which is the URL every client build (web and native) calls.
 *
 * The config must stay a literal object: Netlify reads it statically
 * from this file, and a non-literal `rateLimit` is dropped silently.
 * check:ratelimit asserts the literal and the values.
 */
import { adapt } from '../lib/v1Adapter.mjs';
import v1 from '../lib/handlers/news-today.js';

export const config = {
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};

export default adapt(v1.handler);

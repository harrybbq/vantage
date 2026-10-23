/**
 * ai-coach-daily — v2 entry. The handler is unchanged in
 * netlify/lib/handlers/ai-coach-daily.js; this file exists only so Netlify
 * enforces a per-IP rate limit BEFORE the function runs (STARTUP_
 * REQUIREMENTS item 86). See netlify/lib/v1Adapter.mjs for why the
 * handler is wrapped rather than rewritten.
 *
 * 20 requests / 60 s per IP. Paid-API tier: every brief is an Anthropic
 * call; the in-function cap is 6 / min per user and the client asks once
 * a day. Twenty a minute is two to three people at the in-function
 * per-user cap sharing one address (mobile carrier NAT, an office, a
 * household on one router), and far more than one person could genuinely
 * want.
 *
 * aggregateBy ['ip', 'domain'] = one counter per client IP per domain
 * (domain-only pooling is Enterprise). Over the limit Netlify answers
 * 429 itself; the function is not invoked. No `path`: a v2 function
 * with a custom path stops answering on /.netlify/functions/ai-coach-daily,
 * which is the URL every client build (web and native) calls.
 *
 * The config must stay a literal object: Netlify reads it statically
 * from this file, and a non-literal `rateLimit` is dropped silently.
 * check:ratelimit asserts the literal and the values.
 */
import { adapt } from '../lib/v1Adapter.mjs';
import v1 from '../lib/handlers/ai-coach-daily.js';

export const config = {
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};

export default adapt(v1.handler);

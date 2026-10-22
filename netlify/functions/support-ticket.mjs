/**
 * support-ticket — v2 entry. The handler is unchanged in
 * netlify/lib/handlers/support-ticket.js; this file exists only so Netlify
 * enforces a per-IP rate limit BEFORE the function runs (STARTUP_
 * REQUIREMENTS item 86). See netlify/lib/v1Adapter.mjs for why the
 * handler is wrapped rather than rewritten.
 *
 * 20 requests / 60 s per IP. Writes a security_tickets row and can
 * notify the owner, so a flood is both DB writes and alert noise. The
 * in-function cap is 5 / min per user and a person files one ticket at a
 * time from Settings → Report a problem; twenty leaves room for a few
 * people on one shared address.
 *
 * aggregateBy ['ip', 'domain'] = one counter per client IP per domain
 * (domain-only pooling is Enterprise). Over the limit Netlify answers
 * 429 itself; the function is not invoked. No `path`: a v2 function
 * with a custom path stops answering on /.netlify/functions/support-ticket,
 * which is the URL every client build (web and native) calls.
 *
 * The config must stay a literal object: Netlify reads it statically
 * from this file, and a non-literal `rateLimit` is dropped silently.
 * check:ratelimit asserts the literal and the values.
 */
import { adapt } from '../lib/v1Adapter.mjs';
import v1 from '../lib/handlers/support-ticket.js';

export const config = {
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};

export default adapt(v1.handler);

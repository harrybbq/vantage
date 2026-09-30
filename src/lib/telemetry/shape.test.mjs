/**
 * The report must say what broke and nothing about who it broke for,
 * and a crash loop must cost a handful of requests, not thousands.
 */
import assert from 'node:assert/strict';
import { stripQueries, maskEmails, shapeReport, signature, makeLimiter } from './shape.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.equal(a, b, m); n++; };

// ── Scrubbing ──
eq(stripQueries('GET https://api.github.com/users/x?token=abc#frag failed'),
  'GET https://api.github.com/users/x failed', 'query + fragment dropped from absolute URLs');
eq(stripQueries('at fn (https://app.test/assets/index-abc.js?v=1:10:5)'),
  'at fn (https://app.test/assets/index-abc.js)', 'query dropped inside a stack frame');
eq(stripQueries('fetch /.netlify/functions/food-search?q=chicken%20breast'),
  'fetch /.netlify/functions/food-search', 'query dropped from relative paths');
eq(maskEmails('User harry@example.com not found'), 'User [email] not found', 'emails masked');

{
  const err = new Error('Failed to fetch https://x.supabase.co/rest/v1/user_data?id=eq.123 for a@b.co');
  const r = shapeReport('save', err, {
    where: { origin: 'https://vantage.app', pathname: '/settings', search: '?code=secret' },
    ua: 'UA', release: 'index-abc.js',
  });
  ok(!r.message.includes('id=eq') && !r.message.includes('a@b.co'), 'message scrubbed');
  eq(r.url, 'https://vantage.app/settings', 'url is origin + path, never the search');
  eq(r.kind, 'save', 'kind kept');
  ok(r.stack.length <= 4000, 'stack capped');
}
{
  const r = shapeReport('unhandledrejection', 'plain string');
  eq(r.message, 'plain string', 'non-Error values are reported as text');
  eq(r.stack, '', 'with no stack');
}
{
  const long = new Error('x'.repeat(5000));
  ok(shapeReport('e', long).message.length === 500, 'message capped at 500');
}

// ── Limiter ──
{
  const allow = makeLimiter({ perMinute: 5 });
  const t = 1_000_000;
  let sent = 0;
  for (let i = 0; i < 1000; i++) if (allow('loop', t + i)) sent++;
  eq(sent, 1, 'the same signature in a loop is sent once');
  sent = 0;
  for (let i = 0; i < 50; i++) if (allow('bug-' + i, t + i)) sent++;
  eq(sent, 4, 'distinct signatures stop at five a minute (one already spent)');
  ok(allow('bug-new', t + 61_000), 'the window rolls after a minute');
  ok(!allow('loop', t + 5 * 60_000), 'a duplicate inside ten minutes is still dropped');
  ok(allow('loop', t + 11 * 60_000), 'and allowed again after');
}
{
  const a = shapeReport('k', Object.assign(new Error('m'), { stack: 'Error: m\n    at one (a.js:1:1)\n    at two' }));
  const b = shapeReport('k', Object.assign(new Error('m'), { stack: 'Error: m\n    at one (a.js:1:1)\n    at three' }));
  eq(signature(a), signature(b), 'signature keys on the first frame');
}

console.log(`telemetry: ${n} checks passed`);

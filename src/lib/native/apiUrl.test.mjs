// node src/lib/native/apiUrl.test.mjs — the native API prefix.
import assert from 'node:assert/strict';
import { resolveApiUrl, DEFAULT_API_BASE } from './apiUrl.js';

const FN = '/.netlify/functions/weather';

// Web: untouched, relative, so previews and localhost keep working.
assert.equal(resolveApiUrl(FN), FN);
assert.equal(resolveApiUrl(FN, { native: false, base: 'https://x.test' }), FN);

// Native: prefixed with the deployed site.
assert.equal(resolveApiUrl(FN, { native: true }), DEFAULT_API_BASE + FN);
assert.equal(resolveApiUrl(FN, { native: true, base: 'https://x.test' }), 'https://x.test' + FN);
assert.equal(resolveApiUrl(FN, { native: true, base: 'https://x.test/' }), 'https://x.test' + FN);
assert.equal(resolveApiUrl('.netlify/functions/a', { native: true, base: 'https://x.test' }),
  'https://x.test/.netlify/functions/a');

// Query strings survive.
assert.equal(resolveApiUrl(FN + '?q=a%20b&x=1', { native: true, base: 'https://x.test' }),
  'https://x.test' + FN + '?q=a%20b&x=1');

// Idempotent: an absolute URL is never prefixed again.
const once = resolveApiUrl(FN, { native: true });
assert.equal(resolveApiUrl(once, { native: true }), once);
assert.equal(resolveApiUrl('https://api.github.com/users/x', { native: true }), 'https://api.github.com/users/x');

// Garbage in, same garbage out — no throw.
assert.equal(resolveApiUrl('', { native: true }), '');
assert.equal(resolveApiUrl(undefined, { native: true }), undefined);

console.log('apiUrl: ok');

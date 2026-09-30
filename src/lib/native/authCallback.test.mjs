// node src/lib/native/authCallback.test.mjs — the native sign-in return URL.
import assert from 'node:assert/strict';
import { parseAuthCallback, AUTH_CALLBACK_URL } from './authCallback.js';

// Not ours → null, so other deep links are left alone.
assert.equal(parseAuthCallback('https://vantagevision.netlify.app/?code=x'), null);
assert.equal(parseAuthCallback('com.vantage.app://other?code=x'), null);
assert.equal(parseAuthCallback('com.vantage.app://auth-callbackX?code=x'), null);
assert.equal(parseAuthCallback(undefined), null);

// PKCE code in the query.
let r = parseAuthCallback(`${AUTH_CALLBACK_URL}?code=abc123`);
assert.equal(r.code, 'abc123');
assert.equal(r.accessToken, null);
assert.equal(r.error, null);

// Trailing slash before the query is still ours.
assert.equal(parseAuthCallback(`${AUTH_CALLBACK_URL}/?code=abc`).code, 'abc');

// Scheme case doesn't matter.
assert.equal(parseAuthCallback('COM.VANTAGE.APP://auth-callback?code=z').code, 'z');

// Implicit tokens in the fragment.
r = parseAuthCallback(`${AUTH_CALLBACK_URL}#access_token=at&refresh_token=rt&expires_in=3600&token_type=bearer`);
assert.equal(r.code, null);
assert.equal(r.accessToken, 'at');
assert.equal(r.refreshToken, 'rt');

// A code inside the fragment is NOT treated as a PKCE code.
assert.equal(parseAuthCallback(`${AUTH_CALLBACK_URL}#code=nope`).code, null);

// Errors, from either half, decoded.
r = parseAuthCallback(`${AUTH_CALLBACK_URL}?error=access_denied&error_description=User%20cancelled`);
assert.equal(r.error, 'User cancelled');
r = parseAuthCallback(`${AUTH_CALLBACK_URL}#error=server_error&error_description=Unable+to+exchange`);
assert.equal(r.error, 'Unable to exchange');
assert.equal(parseAuthCallback(`${AUTH_CALLBACK_URL}?error=access_denied`).error, 'access_denied');

// Bare callback with nothing → all null, not a throw.
r = parseAuthCallback(AUTH_CALLBACK_URL);
assert.deepEqual(r, { code: null, accessToken: null, refreshToken: null, error: null });

console.log('authCallback: ok');

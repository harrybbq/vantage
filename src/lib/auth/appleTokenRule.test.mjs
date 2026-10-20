/**
 * Item 117, client side: which sessions carry an Apple refresh token
 * worth sending to apple-token. Pure; no network, no env.
 */
import assert from 'node:assert/strict';
import { appleTokenToSend, newestIdentityProvider } from './appleTokenRule.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const T = 'r0123456789abcdef.0.abcd.EFGH';
const at = (ms) => new Date(ms).toISOString();
const now = Date.parse('2026-10-20T12:00:00Z');
const sess = (identities, extra = {}) => ({ access_token: 'jwt', provider_refresh_token: T, user: { identities }, ...extra });

eq(newestIdentityProvider({ identities: [] }), null, 'none');
eq(newestIdentityProvider({ identities: [{ provider: 'google', last_sign_in_at: at(now - 5) }, { provider: 'apple', last_sign_in_at: at(now) }] }), 'apple', 'newest');
eq(newestIdentityProvider(undefined), null, 'no user');

eq(appleTokenToSend(sess([{ provider: 'apple', last_sign_in_at: at(now) }])), T, 'Apple sign-in → send');
eq(appleTokenToSend(sess([{ provider: 'apple', last_sign_in_at: at(now - 9) }, { provider: 'google', last_sign_in_at: at(now) }])), null, 'Google was newest → not Apple\'s token');
eq(appleTokenToSend(sess([{ provider: 'apple', last_sign_in_at: at(now) }], { provider_refresh_token: null })), null, 'no provider token (password, refresh, later loads)');
eq(appleTokenToSend(sess([{ provider: 'apple', last_sign_in_at: at(now) }], { access_token: '' })), null, 'no session token to authenticate with');
eq(appleTokenToSend(sess([{ provider: 'apple', last_sign_in_at: at(now) }], { provider_refresh_token: 'short' })), null, 'implausible token');
eq(appleTokenToSend(null), null, 'no session');

console.log(`appleTokenRule: ${n} checks passed`);

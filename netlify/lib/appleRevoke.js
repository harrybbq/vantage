/**
 * Sign in with Apple — token capture and revocation (STARTUP_REQUIREMENTS
 * item 117, store pack gap P8).
 *
 * Apple expects an app that offers Sign in with Apple to revoke the
 * user's Apple tokens when they delete their account:
 *   POST https://appleid.apple.com/auth/revoke
 *     client_id, client_secret (a JWT we sign), token, token_type_hint
 *
 * HOW VANTAGE SIGNS IN WITH APPLE (2026-10-20). There is no native Sign
 * in with Apple plugin: web and native both use Supabase's OAuth flow
 * (web: implicit redirect; native: the system browser + PKCE, see
 * src/lib/native/deepLinks.js). Supabase exchanges Apple's code with the
 * SERVICES ID configured in its Apple provider, and hands the result to
 * the client once, right after sign-in, as `session.provider_refresh_token`.
 * Supabase does not keep it. So:
 *   1. the client posts it to apple-token (src/lib/auth/appleTokenCapture.js),
 *   2. apple-token stores it in public.apple_tokens (service role only;
 *      AES-256-GCM when APPLE_TOKEN_SECRET is set),
 *   3. delete-account reads it BEFORE deleting the auth user (the row
 *      cascades away with the account) and revokes it AFTER the delete
 *      succeeded.
 * The client_id for the revoke must be the client that obtained the
 * token — the Services ID for everything captured through Supabase.
 * A future native SIWA plugin would exchange with the bundle id instead;
 * `client_kind` = 'bundle' is reserved for that.
 *
 * WHICH SIGN-IN WAS IT? provider_refresh_token belongs to whichever
 * provider was just used, and an account can have Google AND Apple
 * linked. app_metadata.provider is the FIRST provider ever used, so it
 * cannot tell. The identity whose last_sign_in_at is newest can: GoTrue
 * stamps it on every sign-in. apple-token stores a token only when the
 * newest identity is Apple and was stamped within CAPTURE_WINDOW_MS —
 * otherwise a later Google sign-in could overwrite the Apple token with
 * a Google one.
 *
 * Everything here fails soft. Missing env, an unreachable Apple, an
 * undecryptable row: logged, never thrown into account deletion.
 *
 * Never log a token, a client secret or a private key.
 */
const crypto = require('node:crypto');

const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const AUDIENCE = 'https://appleid.apple.com';
const CAPTURE_WINDOW_MS = 10 * 60_000;
const TOKEN_MAX = 2048;
const DEFAULT_BUNDLE_ID = 'com.vantage.app';

/* ── Which identity just signed in ─────────────────────────────────── */

/** The provider of the identity with the newest last_sign_in_at, and when. */
function latestIdentity(user) {
  const ids = Array.isArray(user?.identities) ? user.identities : [];
  let best = null;
  for (const i of ids) {
    const t = Date.parse(i?.last_sign_in_at || '');
    if (!Number.isFinite(t)) continue;
    if (!best || t > best.at) best = { provider: String(i.provider || ''), at: t };
  }
  return best;
}

/** May a provider refresh token for this user be stored as Apple's now? */
function appleSignInIsFresh(user, nowMs) {
  const latest = latestIdentity(user);
  return !!latest && latest.provider === 'apple'
    && nowMs - latest.at <= CAPTURE_WINDOW_MS && latest.at - nowMs <= 60_000;
}

/** A plausible token string, or null. Opaque to us; only shape-checked. */
function cleanToken(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length < 16 || t.length > TOKEN_MAX) return null;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(t)) return null;
  return t;
}

/* ── Storage encryption (optional) ─────────────────────────────────── */

function keyFrom(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

/**
 * → { token, enc } for the table. With APPLE_TOKEN_SECRET: AES-256-GCM,
 * enc 'aes-256-gcm-v1', token = base64(iv | tag | ciphertext). Without:
 * stored as is, enc 'none' — the same footing as whoop_tokens (RLS on,
 * no policies, no client grant).
 */
function sealToken(token, secret) {
  if (!secret) return { token, enc: 'none' };
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return { token: Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'), enc: 'aes-256-gcm-v1' };
}

/** The stored row back to the token, or null (wrong/missing secret, junk). */
function openToken(row, secret) {
  if (!row || typeof row.token !== 'string') return null;
  if (row.enc === 'none' || !row.enc) return row.token;
  if (row.enc !== 'aes-256-gcm-v1' || !secret) return null;
  try {
    const buf = Buffer.from(row.token, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ── Client secret ─────────────────────────────────────────────────── */

/** PEM from env: real newlines, escaped "\n", or the bare base64 body. */
function normalisePem(raw) {
  let s = String(raw || '').trim().replace(/\\n/g, '\n');
  if (!s) return '';
  if (!s.includes('BEGIN')) {
    const body = s.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') || '';
    s = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  }
  return s;
}

/**
 * Apple's configuration from env, or { missing: [...] } naming what is
 * not set (names only). clientKind 'services' (default) or 'bundle'.
 */
function appleConfig(env = {}, clientKind = 'services') {
  const clientId = clientKind === 'bundle'
    ? (env.APPLE_BUNDLE_ID || DEFAULT_BUNDLE_ID)
    : env.APPLE_SERVICES_ID;
  const cfg = {
    teamId: String(env.APPLE_TEAM_ID || '').trim(),
    keyId: String(env.APPLE_KEY_ID || '').trim(),
    privateKey: normalisePem(env.APPLE_PRIVATE_KEY),
    clientId: String(clientId || '').trim(),
  };
  const missing = [];
  if (!cfg.teamId) missing.push('APPLE_TEAM_ID');
  if (!cfg.keyId) missing.push('APPLE_KEY_ID');
  if (!cfg.privateKey) missing.push('APPLE_PRIVATE_KEY');
  if (!cfg.clientId) missing.push(clientKind === 'bundle' ? 'APPLE_BUNDLE_ID' : 'APPLE_SERVICES_ID');
  return missing.length ? { missing } : cfg;
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * The client_secret JWT: ES256 over P-256, header {alg, kid}, claims
 * {iss: team id, iat, exp, aud: appleid.apple.com, sub: client id}.
 * Apple allows up to six months; this one lives five minutes, since a
 * fresh one is minted per revoke. JWS wants the raw r||s signature
 * (ieee-p1363), not Node's default DER.
 */
function buildClientSecret({ teamId, keyId, privateKey, clientId }, nowSec = Math.floor(Date.now() / 1000), ttlSec = 300) {
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = { iss: teamId, iat: nowSec, exp: nowSec + ttlSec, aud: AUDIENCE, sub: clientId };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

/* ── Revoke ────────────────────────────────────────────────────────── */

/**
 * Revoke one token. → { ok, status?, reason? }. Never throws.
 *   row   — the apple_tokens row ({ token, enc, client_kind })
 *   env   — process.env (or a test object)
 */
async function revokeStoredToken(row, env = {}, fetchImpl = globalThis.fetch) {
  try {
    const token = openToken(row, env.APPLE_TOKEN_SECRET);
    if (!token) return { ok: false, reason: 'token_unreadable' };
    const cfg = appleConfig(env, row.client_kind === 'bundle' ? 'bundle' : 'services');
    if (cfg.missing) return { ok: false, reason: 'not_configured', missing: cfg.missing };
    let secret;
    try { secret = buildClientSecret(cfg); } catch { return { ok: false, reason: 'bad_private_key' }; }
    const res = await fetchImpl(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: secret,
        token,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, reason: 'apple_refused' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

module.exports = {
  REVOKE_URL,
  CAPTURE_WINDOW_MS,
  latestIdentity,
  appleSignInIsFresh,
  cleanToken,
  sealToken,
  openToken,
  normalisePem,
  appleConfig,
  buildClientSecret,
  revokeStoredToken,
};

/**
 * Supabase API keys — the ONE place functions read them (item 85).
 *
 * Supabase is retiring the legacy JWT keys (`anon`, `service_role`) by
 * the end of 2026. Their replacements:
 *   sb_publishable_…  replaces anon          (public, RLS-gated)
 *   sb_secret_…       replaces service_role  (bypasses RLS)
 * The new keys are opaque strings, NOT JWTs. Supabase's docs: send them
 * on the `apikey` header only — if the same key is also sent as
 * `Authorization: Bearer`, the platform tries to parse it as a JWT and
 * answers `Invalid JWT`. The gateway fills in the Authorization header
 * from `apikey` itself on /rest/v1, /auth/v1 and /storage/v1, and that
 * already works with the legacy keys today. So every service call here
 * sends `apikey` and nothing else.
 *
 * Secret keys are also refused (401) when the request's User-Agent
 * looks like a browser. Node's fetch sends its own UA; never forward
 * the client's User-Agent on a service call.
 *
 * Switching: set SUPABASE_SECRET_KEY (and SUPABASE_PUBLISHABLE_KEY) in
 * Netlify and redeploy — the new key wins whenever it is set. Rolling
 * back is deleting it again: the legacy key is the fallback.
 *
 * User-JWT calls (pattern b) — choice made for every call site:
 *   userHeaders() sends the PUBLIC key as `apikey` and the user's own
 *   JWT as `Authorization`. Every such call in netlify/ is a session
 *   check against /auth/v1/user, which verifies the Bearer JWT and
 *   answers the same whichever project key is on `apikey` — so moving
 *   the apikey from the service key to the public key changes nothing
 *   today, and avoids the one combination nobody has documented
 *   (an sb_secret_ apikey next to a user JWT). Where no public key is
 *   configured for functions, it falls back to the service key, exactly
 *   as requireUser always did. There are no RLS-scoped data reads made
 *   as the user from functions; if one is added, userHeaders keeps the
 *   user's role because the Bearer JWT decides the role, not the apikey.
 *
 * Never log the return value of anything in this file.
 */

/** The service-role credential: new secret key preferred, legacy fallback. */
function serviceKey(env = process.env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/** The public (RLS-gated) credential: publishable preferred, anon fallback. */
function publicKey(env = process.env) {
  return env.SUPABASE_PUBLISHABLE_KEY
    || env.VITE_SUPABASE_PUBLISHABLE_KEY
    || env.SUPABASE_ANON_KEY
    || env.VITE_SUPABASE_ANON_KEY
    || '';
}

/** Headers for a call that already holds a resolved service key (libs
 *  that are handed `serviceKey` by their caller). apikey only. */
function serviceKeyHeaders(key, extra = {}) {
  const h = { ...extra, apikey: key };
  // Belt and braces: a caller's `extra` must never smuggle the key back
  // onto Authorization (that is the exact request the new keys reject).
  if (h.Authorization === `Bearer ${key}`) delete h.Authorization;
  return h;
}

/** Headers for a service-role call: apikey only, no Authorization. */
function serviceHeaders(env = process.env, extra = {}) {
  return serviceKeyHeaders(serviceKey(env), extra);
}

/** The apikey used next to a user's JWT (see the note at the top). */
function userApiKey(env = process.env) {
  return publicKey(env) || serviceKey(env);
}

/** Headers for a call made AS the user: public apikey + the user's JWT. */
function userHeaders(env = process.env, jwt, extra = {}) {
  return { ...extra, apikey: userApiKey(env), Authorization: `Bearer ${jwt}` };
}

module.exports = { serviceKey, publicKey, serviceKeyHeaders, serviceHeaders, userApiKey, userHeaders };

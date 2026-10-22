/**
 * The update-required gate and the build census (STATE_SIZE_PLAN.md,
 * Phase 0; STARTUP_REQUIREMENTS items 25–26).
 *
 * Every build carries a stamp, `__BUILD__` (the build time in ms, defined
 * in vite.config.js), so builds order themselves. The owner can require a
 * minimum build per platform in `public.app_config` under `min_build`
 * ({ web, native }; supabase/state_size_phase0_2026_10.sql). A build older
 * than that stops BEFORE the app loads (Board never mounts, so nothing is
 * read or written) and asks for a reload or a store update. The state
 * migration needs this: a gate binds only builds that already contain it,
 * so it ships before anything moves.
 *
 * Pure (no React, no Supabase, no window) so every branch is pinned by
 * buildGate.test.mjs (npm run check:buildgate). The reads live in
 * buildGateClient.js.
 *
 * Fail-open rules (a broken gate must never lock anyone out):
 *   · a missing row, a failed or slow read, or a malformed value → 'ok';
 *   · a minimum that is not a whole number ≥ 0 → ignored;
 *   · a minimum from the future (later than now + a margin) → ignored.
 *     Build stamps are build times, so no real build can be newer than
 *     the clock; a value like that is a typo, and honouring it would stop
 *     every build including the newest;
 *   · a build without a stamp (tests, a dev server) → 'ok'.
 * Once the app has mounted in a page load it stays mounted (latch), so
 * raising the minimum never unmounts anyone mid-session.
 */

/** A minimum more than this far ahead of the clock is a mistake. */
export const FUTURE_MARGIN_MS = 10 * 60 * 1000;

export const PLATFORMS = Object.freeze(['web', 'native']);

/** This build's stamp, or 0 when there is none (node tests, an unstamped build). */
export function currentBuild() {
  const b = typeof __BUILD__ !== 'undefined' ? Number(__BUILD__) : 0;
  return Number.isSafeInteger(b) && b > 0 ? b : 0;
}

/**
 * The minimum to enforce for `platform`, from the `min_build` value
 * ({ web, native }), or 0 when there is nothing valid to enforce.
 */
export function minBuildFor(value, platform, now = Date.now()) {
  if (!value || typeof value !== 'object' || !PLATFORMS.includes(platform)) return 0;
  const n = Number(value[platform]);
  if (!Number.isSafeInteger(n) || n <= 0) return 0;
  if (n > now + FUTURE_MARGIN_MS) return 0;
  return n;
}

/**
 * What App renders, from one read of `min_build`.
 *   read     — undefined while in flight; { ok: true, value } (value null
 *              when there is no row) or { ok: false } once it settled
 *   build    — this build's stamp (currentBuild())
 *   platform — 'web' | 'native'
 * Returns 'pending' (hold the loader), 'ok' (carry on) or 'update'.
 */
export function decideBuildGate({ read, build, platform, now = Date.now() } = {}) {
  if (read === undefined) return 'pending';
  if (!read || read.ok !== true) return 'ok';
  if (!Number.isSafeInteger(build) || build <= 0) return 'ok';
  const min = minBuildFor(read.value, platform, now);
  return min > 0 && build < min ? 'update' : 'ok';
}

/**
 * Once Board has mounted in this page load, a later answer never takes
 * it away (an unmount mid-session could drop an unsaved edit). The next
 * load applies the new minimum.
 *   mounted — true once the app has mounted in this page load
 */
export function latchGate(decision, mounted) {
  return mounted ? 'ok' : decision;
}

/** True only when the main app (Board, and with it the state load/save) may mount. */
export function mayMountApp(decision) {
  return decision === 'ok';
}

/**
 * The census write is made at most once per user, platform and build on
 * a device: `noted` is what was last recorded (the stored marker).
 */
export function censusMarker(userId, platform, build) {
  return userId && PLATFORMS.includes(platform) && build > 0 ? `${userId}|${platform}|${build}` : null;
}

export function shouldNoteBuild(noted, userId, platform, build) {
  const marker = censusMarker(userId, platform, build);
  return !!marker && noted !== marker;
}

/**
 * The decisions usePublishProfile makes, with no React or network in
 * them (items 84 and 92, store pack P9). Pure; tested by
 * publishPlan.test.mjs.
 */
import { checkPublicText } from '../moderation/nameFilter.js';

/** Presence heartbeat while the app is visible (item 92: was 60 s). */
export const PRESENCE_INTERVAL_MS = 5 * 60_000;
/** Coming back to the app re-pings only if the last ping is this old —
 *  tab-hopping must not turn into a write per switch. */
export const PRESENCE_REPING_MS = 2 * 60_000;

/**
 * The streak friends see. The habit NAME is user text shown to other
 * people (e.g. a quit-drinking streak), so it gets the same public-text
 * filter as names and handles; a refused name publishes the day count
 * with no name rather than nothing.
 */
export function streakForFriends(streak) {
  if (!streak || !(streak.days > 0)) return { days: 0, name: null };
  const name = typeof streak.name === 'string' ? streak.name.trim().slice(0, 60) : '';
  return { days: streak.days, name: name && checkPublicText(name).ok ? name : null };
}

/**
 * What to do about the avatar on this publish.
 *   → { action: 'clear' }    publish no picture
 *   → { action: 'keep' }     leave the server copy alone
 *   → { action: 'send' }     resize and send for screening
 *
 * photoSrc     the user's photo (null when shareAvatar is off / no photo)
 * hash         SHA-256 of photoSrc, or null (no SubtleCrypto)
 * screen       S.avatarScreen — { hash, ok } from an earlier verdict
 * retry        { hash, until } — a recent undecided screening
 * serverAvatar what profiles.avatar_url holds now (undefined: unknown)
 */
export function planAvatar({ photoSrc, hash, screen, retry, serverAvatar, now = Date.now() }) {
  if (!photoSrc || !hash) return serverAvatar === null ? { action: 'keep' } : { action: 'clear' };
  if (screen?.hash === hash) {
    if (screen.ok === false) return serverAvatar === null ? { action: 'keep' } : { action: 'clear' };
    // Approved, and a picture is up — it is this photo, published from
    // here or from another device (the resized bytes differ per device,
    // so comparing them would re-screen on every device switch).
    if (screen.ok === true && serverAvatar) return { action: 'keep' };
  }
  if (retry?.hash === hash && now < retry.until) return { action: 'keep' };
  return { action: 'send' };
}

/**
 * The direct (non-public-text) profile patch: presence cleared once when
 * sharing is off. → {} when nothing needs writing. Presence pings are
 * the heartbeat's job.
 *
 * It used to carry `level` too, with presence piggy-backed on it. Level
 * was retired (2026-10), so profiles.level is no longer written: the
 * column stays (no destructive SQL) and keeps whatever it last held,
 * which nothing reads any more.
 */
export function planDirectPatch({ presenceOff, sentPresence }) {
  const out = {};
  if (presenceOff && sentPresence !== 'off') out.last_active_at = null;
  return out;
}

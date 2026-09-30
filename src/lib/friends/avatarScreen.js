import { authFetch } from '../authFetch';

/**
 * Screening for the avatar other people see (functions/avatar-check.js).
 *
 * The photo itself stays in S.profile.photo and is never touched here;
 * this only decides whether its small published copy may go out to
 * profiles.avatar_url. Verdicts are remembered in S.avatarScreen
 * ({ hash, ok, at }) keyed by a hash of the SOURCE photo — stable across
 * devices, where the canvas-resized copy is not — so the same photo is
 * screened once, not on every publish.
 */

/** SHA-256 of the photo data URL, hex. Null where SubtleCrypto is
 *  unavailable (an insecure context) — the caller then publishes no
 *  avatar, which is the safe direction. */
export async function photoHash(dataUrl) {
  try {
    const bytes = new TextEncoder().encode(dataUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * Ask the server about one resized avatar.
 * → true (approved) | false (rejected) | null (no verdict: not
 *   deployed, no key, over the daily cap, offline — ask again later).
 */
export async function requestAvatarScreen(avatarDataUrl) {
  try {
    const res = await authFetch('/.netlify/functions/avatar-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: avatarDataUrl }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.ok === true) return true;
    if (body?.ok === false && !body.pending) return false;
    return null;
  } catch {
    return null;
  }
}

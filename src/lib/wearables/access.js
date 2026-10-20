/**
 * WHOOP / Oura connect while the providers review Vantage — the pure
 * half (item 127, owner decision D7; 2026-10-20). No React, no network,
 * no import.meta, so `node src/lib/wearables/access.test.mjs` runs it.
 *
 *   connectResultMessage   the words for a connect that came back
 *                          `?whoop=<result>`, replacing the bare
 *                          "WHOOP connect failed (denied)";
 *   showWearablePanel      D7: which panels a build may show;
 *   cleanHandle, accessErrorMessage
 *                          the owner panel (Settings → Tools → Wearable
 *                          access), mirroring lib/webAccess.js.
 */

const NAMES = { whoop: 'WHOOP', oura: 'Oura' };
export const providerName = p => NAMES[p] || 'Wearable';

/**
 * One calm sentence for the result of a connect round trip.
 * `paused` is not handled here — the panels show PAUSED_MESSAGE.
 */
export function connectResultMessage(provider, result) {
  const name = providerName(provider);
  switch (result) {
    case 'denied':
      // The provider sends `error=access_denied` both when the person
      // presses Cancel and when it refuses the link — and an app under
      // review is capped at 10 linked accounts.
      return `${name} didn’t link. If you pressed Cancel, nothing changed. If ${name} showed an error instead, it is most likely its limit on accounts while ${name} reviews Vantage — your data and everything else work as normal.`;
    case 'expired':
    case 'badstate':
      return `That ${name} link expired or was already used — press Connect again.`;
    case 'nocode':
    case 'tokenfail':
    case 'storefail':
    case 'error':
      return `${name} didn’t finish linking — try again in a few minutes.`;
    case 'notconfigured':
      return `${name} is not set up on this site yet.`;
    default:
      return `${name} connect failed (${String(result || 'unknown').slice(0, 40)}).`;
  }
}

/**
 * D7: may this build show a provider's panel?
 *   connectAvailable — false in native builds while WHOOP/Oura are held
 *                      back (lib/native/wearableGate.js)
 *   connected        — the account is already linked: the panel stays so
 *                      the person can sync and, above all, Disconnect
 *                      (withdrawing consent must always be possible).
 */
export function showWearablePanel({ connectAvailable, connected }) {
  return !!connectAvailable || !!connected;
}

/** "@Name_1" → "Name_1", or null when it can't be a handle. */
export function cleanHandle(raw) {
  let v = typeof raw === 'string' ? raw.trim() : '';
  if (v.startsWith('@')) v = v.slice(1);
  return /^[a-zA-Z0-9_]{3,20}$/.test(v) ? v : null;
}

export function cleanNote(raw) {
  const v = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  return v || null;
}

/** One sentence for a failed owner RPC. Never the raw error. */
export function accessErrorMessage(error) {
  const code = error && (error.code || error.status);
  const msg = String((error && error.message) || '');
  if (code === 'PGRST202' || code === '42883' || code === '42P01' || /could not find the function|does not exist/i.test(msg)) {
    return 'Wearable access isn’t set up yet — run supabase/wearable_access_2026_10.sql in the Supabase SQL editor.';
  }
  if (code === '42501' || /not allowed|permission denied/i.test(msg)) return 'Only the app owner can change wearable access.';
  if (code === 'P0002' || /no such handle/i.test(msg)) return 'No account has that handle.';
  if (code === '54000' || /list is full/i.test(msg)) return 'The list is full — WHOOP and Oura allow 10 accounts (you plus 9) until they approve Vantage. Remove someone first.';
  if (code === '22023' || /invalid handle/i.test(msg)) return 'That doesn’t look like a handle (3–20 letters, numbers or _).';
  if (/invalid mode/i.test(msg)) return 'Unknown mode.';
  return 'Couldn’t reach the server. Check your connection and try again.';
}

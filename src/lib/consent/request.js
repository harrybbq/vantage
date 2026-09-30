/**
 * Ask for consent from anywhere, without threading state.
 *
 *   if (!(await requestConsent('ai'))) return;   // before any AI call
 *
 * The places that need to ask — the camera scanner, the video-recipe
 * reader, the wearable panels — don't hold `S` or `update`, and giving
 * them a context provider would mean wrapping the whole of Board's
 * return. Instead ConsentHost (components/consent), mounted once in
 * Board, registers itself here and mirrors S.consent into `current`.
 *
 * Resolves true straight away, with no UI, when consent is already on
 * record. Resolves FALSE when no host is mounted — consent is never
 * granted silently, so a tree without the host simply can't make the
 * call rather than making it without asking.
 */
import { isGranted } from './consent';

let host = null;
let current = {};

/** ConsentHost only. Returns the unregister function. */
export function registerConsentHost(fn) {
  host = fn;
  return () => { if (host === fn) host = null; };
}

/** ConsentHost only — keeps the synchronous check in step with state. */
export function syncConsent(consent) {
  current = consent || {};
}

export function hasConsent(kind) {
  return isGranted(current, kind);
}

export async function requestConsent(kind) {
  if (isGranted(current, kind)) return true;
  if (!host) return false;
  try {
    return !!(await host(kind));
  } catch {
    return false;
  }
}

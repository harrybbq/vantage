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
import { settleGrant } from './ledger';

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
  let granted = false;
  try {
    granted = !!(await host(kind));
  } catch {
    return false;
  }
  // A fresh yes: record it (consent_events) and save it before the
  // caller's request goes out — the server checks consent too (items
  // 98/99). Bounded and never throws (ledger.js).
  if (granted) await settleGrant(kind);
  return granted;
}

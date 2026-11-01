/**
 * Ask App to open the paywall from somewhere that has no handle on its
 * modal state (a Settings card, say). App listens and routes it through
 * handleOpenModal, so it is the same sheet every other upsell opens.
 * `key` picks the copy (PaywallModal / paywallCopy); unknown keys read
 * as the generic sheet.
 */
export const OPEN_PAYWALL_EVENT = 'vantage:open-paywall';

export function requestPaywall(key = 'generic') {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_PAYWALL_EVENT, { detail: { key: String(key || 'generic') } }));
    return true;
  } catch { return false; }
}

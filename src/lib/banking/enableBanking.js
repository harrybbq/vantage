/**
 * Open Banking client wrapper — FOUNDATION / SCAFFOLD.
 *
 * Status: SCAFFOLDED, not yet live. This lays the base so we can wire
 * real bank-account data later without reshaping the app. It is
 * deliberately inert and fail-soft: with no backend configured, every
 * call resolves to a "not configured / not connected" result and the
 * app behaves exactly as it does today. Nothing here replaces the manual
 * Subscriptions & Bills or Savings features — Open Banking will
 * *augment* them (auto-suggest recurring payments, refresh balances),
 * never remove the manual path.
 *
 * Provider plan: Enable Banking (https://enablebanking.com) — the
 * self-serve, key-less-to-start replacement for the wound-down
 * GoCardless/Nordigen free tier. Its "Restricted Production" mode lets
 * the owner whitelist their own accounts for real data before any paid
 * scale. All OAuth/token exchange must happen server-side in a Netlify
 * function (`netlify/functions/banking-*`) — credentials never touch the
 * client, mirroring how WHOOP tokens are handled.
 *
 * Data model (additive, no migration needed for the client):
 *   S.banking = {
 *     status: 'disconnected' | 'connected',
 *     connectedAt?: number,
 *     institution?: string,
 *     // accounts/balances are fetched fresh, never persisted in bulk
 *   }
 *
 * When we go live, only the function bodies + `beginConnect` redirect
 * need real implementations; the call sites stay the same.
 */

const NOT_CONFIGURED = { configured: false, connected: false };

/** Ask the backend whether Open Banking is configured + connected.
 *  Fail-soft: any error → not configured, so the UI shows "coming soon"
 *  rather than an error. */
export async function bankingStatus() {
  try {
    const res = await fetch('/.netlify/functions/banking-status');
    if (!res.ok) return NOT_CONFIGURED;
    const j = await res.json().catch(() => NOT_CONFIGURED);
    return {
      configured: !!j.configured,
      connected: !!j.connected,
      institution: j.institution || null,
    };
  } catch {
    return NOT_CONFIGURED;
  }
}

/** Kick off the bank-connect consent flow. Until the backend is
 *  configured this returns { ok: false, reason: 'not_configured' } and
 *  the caller shows the coming-soon state. Later this will redirect to
 *  the provider's hosted consent screen (server-issued URL). */
export async function beginConnect() {
  try {
    const res = await fetch('/.netlify/functions/banking-connect', { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (j && j.authUrl) { window.location.href = j.authUrl; return { ok: true }; }
    return { ok: false, reason: j.reason || 'not_configured' };
  } catch {
    return { ok: false, reason: 'not_configured' };
  }
}

/** Placeholder — will return the caller's linked accounts once live.
 *  Empty array today so any UI mapping over it renders nothing. */
export async function listAccounts() {
  return [];
}

/** Placeholder — will return recurring-payment candidates detected from
 *  transactions, for one-tap add into the Subscriptions widget. Empty
 *  today. This is the augment-not-replace hook. */
export async function detectSubscriptions() {
  return [];
}

/**
 * Subscription panel (Settings → Tools tab).
 *
 * Shows:
 *   - Current tier + plan label
 *   - Restore purchases (native only — re-syncs entitlements from
 *     App Store / Play Store after reinstall, device switch, restore
 *     from backup)
 *   - Manage subscription (deep-links to platform-native subscription
 *     management UI — required by Apple's review guidelines)
 *   - Web users see a contextual hint that purchases happen on mobile
 *
 * Status: SCAFFOLDED. The Restore / Manage flows are wired through
 * `src/lib/billing/revenuecat.js` which dynamic-imports the RC plugin.
 * If the plugin isn't installed yet (current state), Restore returns
 * 'unavailable' and we tell the user the native build is required.
 */
import { useState } from 'react';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { restorePurchases, openManageSubscription, presentCustomerCenter } from '../lib/billing/revenuecat';
import SettingsGroup from './settings/SettingsGroup';

const PLAN_LABEL = {
  monthly:  'Pro — Monthly',
  annual:   'Pro — Yearly',
  lifetime: 'Lifetime',
};
const TIER_LABEL = { free: 'Free', pro: 'Pro', lifetime: 'Lifetime' };

export default function SubscriptionPanel() {
  const { tier, hasPro, proPlan, isMonthly, proIsLive, loading } = useSubscriptionContext();
  // Prefer the precise plan label when we know it; fall back to the
  // generic tier name so a freshly-purchased user (RC sync still in
  // flight) never sees a blank.
  const planLabel = (proPlan && PLAN_LABEL[proPlan]) || TIER_LABEL[tier] || 'Free';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgKind, setMsgKind] = useState('info'); // 'info' | 'ok' | 'err'

  function flash(kind, text) {
    setMsgKind(kind);
    setMsg(text);
    setTimeout(() => setMsg(null), 4500);
  }

  async function handleRestore() {
    setBusy(true);
    const r = await restorePurchases();
    setBusy(false);
    if (r.ok) {
      const upgraded = Object.values(r.entitlements || {}).some(e => e?.isActive);
      flash(upgraded ? 'ok' : 'info',
        upgraded
          ? 'Purchases restored. Your Pro entitlement is active.'
          : 'No prior purchases were found on this account.');
    } else if (r.reason === 'unavailable') {
      flash('info', "Restore needs the iOS or Android build — it's a no-op on the web.");
    } else if (r.reason === 'cancelled') {
      // Silent
    } else {
      flash('err', "Couldn't restore purchases. Check your network and try again.");
    }
  }

  async function handleManage() {
    const ok = await openManageSubscription();
    if (!ok) flash('info', 'Open the App Store or Play Store and find Vantage under Subscriptions.');
  }

  // Customer Center is RevenueCat's prebuilt sheet — view active sub,
  // change plan, cancel, request refunds, see purchase history. Apple's
  // review guidelines treat this as the canonical "manage subscription"
  // surface, so we surface it as the primary action when on native.
  async function handleCustomerCenter() {
    const ok = await presentCustomerCenter();
    if (!ok) flash('info', "Customer Center isn't available on the web. Try this from the iOS or Android app.");
  }

  if (loading) return null;

  return (
    <SettingsGroup
      title="Subscription"
      desc="Manage your plan, restore prior purchases, and open the platform's subscription settings."
    >

      {/* Current plan */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px',
        borderRadius: '10px',
        border: hasPro ? '2px solid var(--em)' : '1px solid var(--border)',
        background: hasPro ? 'rgba(var(--em-rgb),0.08)' : 'var(--card, rgba(255,255,255,0.04))',
        marginBottom: '14px',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Current plan
          </div>
          <div style={{ fontFamily: 'var(--sans)', fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>
            {planLabel}
          </div>
        </div>
        {!hasPro && proIsLive && (
          <span style={{
            padding: '5px 10px', borderRadius: '6px',
            background: 'var(--em)', color: 'var(--em-on, #fff)',
            fontFamily: 'var(--mono)', fontSize: '10px',
            letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 700,
          }}>£3.99 / mo</span>
        )}
      </div>

      {/* Annual upgrade banner — shown only to monthly subscribers.
          Pitch: switch to yearly and lock in the discount. The actual
          purchase still happens in the platform's manage-subscription
          surface (Apple/Google handle plan changes), so we deep-link
          into that rather than running a custom upgrade flow. */}
      {isMonthly && (
        <div style={{
          padding: '14px',
          borderRadius: '10px',
          border: '1px solid var(--em)',
          background: 'rgba(var(--em-rgb), 0.06)',
          marginBottom: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: '10px',
              letterSpacing: '1.4px', textTransform: 'uppercase',
              color: 'var(--em)', marginBottom: '4px',
            }}>Save £18.88 / year</div>
            <div style={{
              fontFamily: 'var(--sans)', fontSize: '13px',
              color: 'var(--text)', lineHeight: 1.5,
            }}>
              Switch to <strong>Yearly</strong> and pay £29 instead of £47.88
              over a year. Same Pro features, ~39% off.
            </div>
          </div>
          <button
            onClick={handleCustomerCenter}
            style={{
              padding: '9px 14px', borderRadius: '8px',
              background: 'var(--em)', border: '1px solid var(--em)',
              color: 'var(--em-on, #fff)',
              fontFamily: 'var(--mono)', fontSize: '11px',
              letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >Switch to yearly</button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {hasPro && (
          <button
            onClick={handleCustomerCenter}
            style={{
              padding: '9px 14px', borderRadius: '8px',
              background: 'var(--em)',
              border: '1px solid var(--em)',
              color: 'var(--em-on, #fff)',
              fontFamily: 'var(--mono)', fontSize: '11px',
              letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Manage subscription
          </button>
        )}
        <button
          onClick={handleRestore}
          disabled={busy}
          style={{
            padding: '9px 14px', borderRadius: '8px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontFamily: 'var(--mono)', fontSize: '11px',
            letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Restoring…' : 'Restore purchases'}
        </button>
        {hasPro && (
          <button
            onClick={handleManage}
            title="Open the platform's subscription page directly (fallback if Customer Center isn't available)"
            style={{
              padding: '9px 14px', borderRadius: '8px',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--mono)', fontSize: '11px',
              letterSpacing: '1px', textTransform: 'uppercase', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Open store page
          </button>
        )}
      </div>

      {msg && (
        <div style={{
          marginTop: '14px',
          padding: '10px 12px', borderRadius: '8px',
          background: msgKind === 'err' ? 'rgba(220, 60, 60, 0.08)'
                    : msgKind === 'ok'  ? 'rgba(var(--em-rgb), 0.10)'
                    : 'var(--card, rgba(255,255,255,0.04))',
          border: '1px solid ' + (msgKind === 'err' ? 'rgba(220, 60, 60, 0.25)' : 'var(--border)'),
          fontFamily: 'var(--mono)', fontSize: '11px',
          color: 'var(--text)',
          lineHeight: '1.6',
        }}>{msg}</div>
      )}
    </SettingsGroup>
  );
}

/**
 * Console paywall: opens on the cap that was hit, shows what Pro changes
 * as a free-vs-Pro table built from FREE_CAPS, then the plan choice.
 *
 * Same props as classic PaywallModal ({ openId, onClose, onManage,
 * onShowToast, onOpenLegal }) and the same store behaviour, line for line:
 *   - offerings are loaded on every open (a user who connects to RC
 *     mid-session gets plans on the next view)
 *   - Lifetime is never sold here (grant only), whatever the dashboard says
 *   - every price, saving and renewal term comes from the store product
 *     (lib/billing/renewalWording.js); when no product loads, no price is
 *     shown at all and the sheet says where Pro is bought
 *   - Terms, Privacy and Restore purchases are always on the sheet, and
 *     every fine-print line classic carries is carried here
 *
 * Differences, all presentation: one sheet (bottom < 1024 px, drawer
 * above), a plan is chosen and then confirmed (classic bought on tap),
 * no invented "example nudge", no // labels or em-dashes. Unknown cap
 * ids (bare `paywall:`, `paywall:friends`) read as the generic entry;
 * classic renders nothing for them.
 */
import { useEffect, useMemo, useState } from 'react';
import { FREE_CAPS } from '../../../hooks/useTierLimits';
import { useSubscriptionContext } from '../../../context/SubscriptionContext';
import { getOfferings, purchasePackage, restorePurchases, isAvailable as rcIsAvailable } from '../../../lib/billing/revenuecat';
import { platform as storePlatform } from '../../../lib/billing/manageSubscription';
import { renewalLine, storeName, yearlySaving, perMonthLine, introLine } from '../../../lib/billing/renewalWording';
import { isNativeApp } from '../../../lib/native/platform';
import { Sheet, Button } from '../ui';
import { resolveCapKey, isPaywallId, compareRows, headline } from './paywallCopy';

const PACKAGE_ORDER = ['$rc_annual', '$rc_monthly', '$rc_lifetime'];
const UNSELLABLE = new Set(['$rc_lifetime']);
const PACKAGE_LABEL = { $rc_annual: 'Yearly', $rc_monthly: 'Monthly', $rc_lifetime: 'Lifetime' };
const weight = p => { const i = PACKAGE_ORDER.indexOf(p.identifier); return i === -1 ? 99 : i; };

export default function ConsolePaywall({ openId, onClose, onManage, onShowToast, onOpenLegal, count = null }) {
  const open = isPaywallId(openId);
  return open ? <PaywallSheet openId={openId} onClose={onClose} onManage={onManage} onShowToast={onShowToast} onOpenLegal={onOpenLegal} count={count} /> : null;
}

function PaywallSheet({ openId, onClose, onManage, onShowToast, onOpenLegal, count }) {
  const { proIsLive, hasPro } = useSubscriptionContext();
  const capKey = resolveCapKey(openId, FREE_CAPS);
  const head = headline(capKey, FREE_CAPS, { hasPro, count });
  const rows = useMemo(() => compareRows(FREE_CAPS, capKey), [capKey]);

  const [offerings, setOfferings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(null);
  const [purchasing, setPurchasing] = useState(null);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);

  // Loaded per open (this component mounts on open), as classic does.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await rcIsAvailable())) { if (!cancelled) { setOfferings(null); setLoading(false); } return; }
        const o = await getOfferings();
        if (!cancelled) { setOfferings(o); setLoading(false); }
      } catch {
        if (!cancelled) { setOfferings(null); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const packages = (offerings?.availablePackages || []).filter(p => !UNSELLABLE.has(p.identifier));
  const sorted = [...packages].sort((a, b) => weight(a) - weight(b));
  const storefront = proIsLive && sorted.length > 0 && !hasPro;
  const monthly = packages.find(p => p.identifier === '$rc_monthly') || null;
  const annual = packages.find(p => p.identifier === '$rc_annual') || null;
  const saving = yearlySaving(monthly, annual);
  const plat = storePlatform();
  const chosen = sorted.find(p => p.identifier === picked) || sorted[0] || null;

  async function buy(pkg) {
    if (!pkg) return;
    setPurchasing(pkg.identifier);
    setError(null);
    const result = await purchasePackage(pkg);
    setPurchasing(null);
    if (result.ok) {
      onShowToast?.('Welcome to Pro. Your plan is active.', true);
      onClose?.();
    } else if (result.reason === 'cancelled') {
      // Backed out of the store sheet: nothing to say.
    } else {
      setError(result.reason === 'unavailable'
        ? (isNativeApp()
          ? "The store isn't available right now. Please try again in a moment."
          : "Purchases need the iOS or Android app. They don't work on the web.")
        : "Couldn't complete the purchase. Try again, or restore from Settings → Subscription if you've bought before.");
    }
  }

  // Same outcomes and wording as Settings → Subscription.
  async function restore() {
    setRestoring(true);
    setRestoreMsg(null);
    const r = await restorePurchases();
    setRestoring(false);
    if (r.ok) {
      const upgraded = Object.values(r.entitlements || {}).some(e => e?.isActive);
      setRestoreMsg(upgraded ? 'Purchases restored. Your Pro entitlement is active.' : 'No prior purchases were found on this account.');
      if (upgraded) onShowToast?.('Pro restored.', true);
    } else if (r.reason === 'unavailable') {
      setRestoreMsg("Restore needs the iOS or Android app. Purchases can't be made or restored on the web.");
    } else if (r.reason !== 'cancelled') {
      setRestoreMsg("Couldn't restore purchases. Check your network and try again.");
    }
  }

  const legal = (key, label) => (
    <a href={`/${key}`} className="cx-sweep-pw-link" onClick={e => { if (onOpenLegal) { e.preventDefault(); onOpenLegal(key); } }}>{label}</a>
  );

  const fine = storefront
    ? `Payment is charged to your ${plat === 'android' ? 'Google Play' : plat === 'ios' ? 'Apple ID' : 'store'} account at confirmation. `
      + `Subscriptions auto-renew at the price shown until cancelled; cancel at least 24 hours before the period ends in ${storeName(plat)} subscription settings.`
    : proIsLive && !hasPro
      ? 'Pro is bought in the iOS and Android apps. The price and renewal terms are shown there before you pay, and a subscription can be cancelled any time in the store.'
      : hasPro ? 'Your data stays yours.' : 'Pro isn’t on sale yet. Everything free stays free.';

  const footer = (
    <div className="cx-sweep-pw-foot">
      {hasPro ? (
        <div className="cx-sweep-pw-actions">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onManage}>Manage in Settings</Button>
        </div>
      ) : storefront ? (
        <Button variant="primary" block onClick={() => buy(chosen)} disabled={!!purchasing || !chosen} data-testid="cx-paywall-buy">
          {purchasing ? 'Opening the store…' : `Continue with ${(PACKAGE_LABEL[chosen?.identifier] || chosen?.product?.title || 'this plan').toLowerCase()}`}
        </Button>
      ) : (
        <Button variant="primary" block onClick={onClose} disabled={loading}>{loading ? 'Loading…' : 'Got it'}</Button>
      )}
      <div className="cx-sweep-pw-legal">
        {!hasPro && (
          <button type="button" className="cx-sweep-pw-link" onClick={restore} disabled={restoring}>
            {restoring ? 'Restoring…' : 'Restore purchases'}
          </button>
        )}
        {legal('terms', 'Terms of Service')}
        {legal('privacy', 'Privacy Policy')}
      </div>
      <p className="cx-sweep-pw-fine">{fine}</p>
    </div>
  );

  return (
    <Sheet
      title={head.title}
      onClose={onClose}
      footer={footer}
      width={520}
      testId="cx-paywall"
      className="cx-sweep-paywall"
      closeLabel="Close"
    >
      <div className="cx-sweep-pw">
        <div className="cx-sweep-pw-tagrow">
          <span className="cx-sweep-pro"><span aria-hidden="true">◆</span> Pro</span>
          <span className="cx-t13 cx-mid" data-testid="cx-paywall-cap">{head.tag}</span>
        </div>
        <p className="cx-t15 cx-mid">{head.sub}</p>

        {!hasPro && (
          <table className="cx-sweep-pw-table">
            <caption className="cx-sr">Free compared with Pro</caption>
            <thead>
              <tr><th scope="col"><span className="cx-sr">Feature</span></th><th scope="col">Free</th><th scope="col">Pro</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className={r.hit ? 'is-hit' : ''}>
                  <th scope="row">{r.label}</th>
                  <td className={/^[\d–]/.test(r.free) ? 'cx-num' : ''}>{r.free}</td>
                  <td>{r.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {storefront && (
          <div className="cx-sweep-plans" role="radiogroup" aria-label="Plan">
            {sorted.map(pkg => {
              const on = chosen?.identifier === pkg.identifier;
              const isAnnual = pkg.identifier === '$rc_annual';
              const perMonth = isAnnual ? perMonthLine(pkg) : null;
              const offer = introLine(pkg);
              const renew = renewalLine(pkg, plat);
              return (
                <button
                  key={pkg.identifier}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`cx-sweep-plan${on ? ' is-on' : ''}`}
                  onClick={() => setPicked(pkg.identifier)}
                  disabled={!!purchasing}
                >
                  <span className="cx-sweep-plan-dot" aria-hidden="true" />
                  <span className="cx-sweep-plan-main">
                    <span className="cx-sweep-plan-name">
                      {PACKAGE_LABEL[pkg.identifier] || pkg.product?.title || 'Plan'}
                      {isAnnual && saving && <span className="cx-sweep-plan-save">Save <span className="cx-num">{saving.pct}%</span></span>}
                    </span>
                    <span className="cx-sweep-plan-sub">{perMonth ? `${perMonth}, billed yearly` : pkg.identifier === '$rc_monthly' ? 'Billed monthly. Cancel any time.' : (pkg.product?.description || '')}</span>
                    {offer && <span className="cx-sweep-plan-sub">{offer}</span>}
                    {renew && <span className="cx-sweep-plan-renew">{renew}</span>}
                  </span>
                  <span className="cx-sweep-plan-price cx-num">{pkg.product?.priceString || ''}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="cx-sweep-pw-msg cx-danger" role="alert">{error}</p>}
        {restoreMsg && <p className="cx-sweep-pw-msg" role="status">{restoreMsg}</p>}
      </div>
    </Sheet>
  );
}

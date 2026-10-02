/**
 * Paywall modal — shown when a free user crosses a cap (or taps an
 * upgrade affordance from anywhere). Three modes:
 *
 *   1. RC offerings load successfully on a native build →
 *      render three package cards (Lifetime / Yearly / Monthly) and
 *      run the platform purchase sheet on tap. This is the "real"
 *      mode that drives revenue.
 *
 *   2. RC unavailable (web, no plugin, no API key set, offerings
 *      empty) → fall back to the legacy waitlist CTA. The web build
 *      can't actually sell you a sub anyway — App Store / Play Store
 *      are the only payment surfaces — so pointing to a waitlist
 *      keeps the surface honest.
 *
 *   3. Pro isn't live yet (config.pro_live === false) → also fall
 *      back to the waitlist path, regardless of platform.
 *
 * The cap context (FREE_CAPS[capKey]) is preserved so the headline
 * still reads "You've reached your free limit of N habits".
 *
 * Store rules (App Store 3.1.2, Play's subscription policy) that shape
 * the bottom of the sheet: every price and renewal term is read from the
 * store product (lib/billing/renewalWording.js) — nothing is quoted when
 * no product is loaded — and the sheet always carries Terms, Privacy and
 * Restore purchases.
 */
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { FREE_CAPS } from '../hooks/useTierLimits';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { getOfferings, purchasePackage, restorePurchases, isAvailable as rcIsAvailable } from '../lib/billing/revenuecat';
import { platform as storePlatform } from '../lib/billing/manageSubscription';
import { priceLine, renewalLine, storeName } from '../lib/billing/renewalWording';
import Overlay from './ui/Overlay';
import { isNativeApp } from '../lib/native/platform';

// Display order for package cards. RC's `availablePackages` array
// arrives in dashboard order which is unreliable; sort by our own
// preference so Lifetime is always last (one-time, biggest commitment),
// Yearly first (best value, headline), Monthly between.
const PACKAGE_ORDER = ['$rc_annual', '$rc_monthly', '$rc_lifetime'];

// Lifetime is NOT sold. It exists only as a grant (founder / early
// supporter), applied server-side straight to profiles.tier. If a
// lifetime SKU is ever left enabled in the RevenueCat dashboard it
// would otherwise show up here and be buyable, so it's filtered out of
// the paywall explicitly rather than relying on dashboard config.
//
// The ENTITLEMENT mapping in lib/billing/revenuecat.js is deliberately
// left intact: anyone already holding lifetime keeps resolving to the
// lifetime tier.
const UNSELLABLE = new Set(['$rc_lifetime']);
const PACKAGE_META = {
  $rc_lifetime: { label: 'Lifetime',  sub: 'One payment. Yours forever.', accent: 'gold' },
  $rc_annual:   { label: 'Yearly',    sub: 'Best value — save vs monthly.', accent: 'em', badge: 'Best value' },
  $rc_monthly:  { label: 'Monthly',   sub: 'Billed monthly. Cancel anytime.', accent: 'mid' },
};

function packageWeight(p) {
  const idx = PACKAGE_ORDER.indexOf(p.identifier);
  return idx === -1 ? 99 : idx;
}

export default function PaywallModal({ openId, onClose, onUpgrade, onShowToast, onOpenLegal }) {
  const { proIsLive, hasPro } = useSubscriptionContext();
  const isOpen = typeof openId === 'string' && openId.startsWith('paywall:');
  const capKey = isOpen ? openId.split(':')[1] : null;
  const cap = capKey ? FREE_CAPS[capKey] : null;

  const [offerings, setOfferings] = useState(null);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [purchasingId, setPurchasingId] = useState(null);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);

  // Load offerings when the modal opens. We do it on every open
  // (not on mount) so a user who connects to RC mid-session gets
  // packages on their next paywall view without a refresh.
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setPurchasingId(null);
      setRestoreMsg(null);
      return;
    }
    let cancelled = false;
    setOfferingsLoading(true);
    (async () => {
      try {
        if (!(await rcIsAvailable())) {
          if (!cancelled) { setOfferings(null); setOfferingsLoading(false); }
          return;
        }
        const o = await getOfferings();
        if (!cancelled) { setOfferings(o); setOfferingsLoading(false); }
      } catch {
        if (!cancelled) { setOfferings(null); setOfferingsLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  async function handlePurchase(pkg) {
    setPurchasingId(pkg.identifier);
    setError(null);
    const result = await purchasePackage(pkg);
    setPurchasingId(null);
    if (result.ok) {
      onShowToast?.('✦ Welcome to Pro — your tier is active.', true);
      onClose?.();
    } else if (result.reason === 'cancelled') {
      // Silent — user backed out of the platform sheet
    } else {
      setError(
        result.reason === 'unavailable'
          // Inside the app "use the app" is nonsense — there it means
          // the store couldn't be reached or isn't configured yet.
          ? (isNativeApp()
            ? "The store isn't available right now. Please try again in a moment."
            : "Purchases need the iOS or Android build to fire — they don't work on the web.")
          : "Couldn't complete the purchase. Try again, or restore from Settings → Subscription if you've bought before."
      );
    }
  }

  // Same outcomes and wording as Settings → Subscription, so the two
  // restore buttons never disagree about what happened.
  async function handleRestore() {
    setRestoring(true);
    setRestoreMsg(null);
    const r = await restorePurchases();
    setRestoring(false);
    if (r.ok) {
      const upgraded = Object.values(r.entitlements || {}).some(e => e?.isActive);
      setRestoreMsg(upgraded
        ? 'Purchases restored. Your Pro entitlement is active.'
        : 'No prior purchases were found on this account.');
      if (upgraded) onShowToast?.('✦ Pro restored.', true);
    } else if (r.reason === 'unavailable') {
      setRestoreMsg("Restore needs the iOS or Android app — purchases can't be made or restored on the web.");
    } else if (r.reason !== 'cancelled') {
      setRestoreMsg("Couldn't restore purchases. Check your network and try again.");
    }
  }

  // In-app routes first, so the legal page opens over the app instead
  // of reloading it; the href is what a new tab or a no-JS reader gets.
  function legalLink(key, label) {
    return (
      <a
        href={`/${key}`}
        className="paywall-legal-link"
        onClick={e => { if (onOpenLegal) { e.preventDefault(); onOpenLegal(key); } }}
      >{label}</a>
    );
  }

  // Decide what to render in the actions area
  const packages = (offerings?.availablePackages || []).filter(p => !UNSELLABLE.has(p.identifier));
  const hasPackages = packages.length > 0;
  const useStorefront = isOpen && proIsLive && hasPackages && !hasPro;
  const sortedPackages = hasPackages ? [...packages].sort((a, b) => packageWeight(a) - packageWeight(b)) : [];
  const plat = storePlatform();

  return (
    <Overlay>
    <AnimatePresence>
      {isOpen && cap && (
        <motion.div
          className="modal-overlay open"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{ display: 'flex' }}
        >
          <motion.div
            className="modal paywall-modal"
            initial={{ opacity: 0, scale: 0.92, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            onClick={e => e.stopPropagation()}
          >
            <div className="paywall-hero">
              <div className="paywall-hero-icon"><Icon name="sparkles" size={26} /></div>
              <div className="paywall-hero-eyebrow">Vantage Pro</div>
              <h3 className="paywall-hero-title">
                {hasPro
                  ? "You're already on Pro"
                  : cap.feature
                    ? `${cap.label} — a Pro bonus.`
                    : "Your coach watches your patterns and nudges you when it sees a slip."}
              </h3>
              <p className="paywall-hero-sub">
                {hasPro
                  ? 'Manage your subscription below.'
                  : cap.feature
                    ? cap.sub
                    : `You've reached your free limit of ${cap.limit} ${cap.label}. ` +
                      'Unlock proactive nudges, the AI daily brief, and remove every cap.'}
              </p>
            </div>

            {/* Context summary — only when a specific cap triggered this
                (i.e. not the generic upgrade entry). Names the trigger
                in plain words + leads with what they get immediately,
                so the modal reads as "here's what unlocking does for
                you right now" rather than a generic feature list. */}
            {!hasPro && !cap.feature && (
              <div className="paywall-trigger-card">
                <div className="paywall-trigger-eyebrow">// CAP REACHED</div>
                <div className="paywall-trigger-line">
                  <span className="paywall-trigger-count">{cap.limit}/{cap.limit}</span>
                  <span className="paywall-trigger-label">{cap.label}</span>
                </div>
                <div className="paywall-trigger-unlock">
                  Pro removes this cap immediately + adds 4 perks below.
                </div>
              </div>
            )}

            {/* Illustration of the kind of nudge the coach sends. It is
                NOT drawn from the reader's data — it used to be headed "A
                nudge your coach would send" above a "+2 more insights this
                week" teaser, which read as a real finding about them. A
                sales sheet that invents facts about the buyer is the
                thing review (and consumer law) objects to, so it says
                Example and the teaser is gone. */}
            {!hasPro && (
              <div className="paywall-preview">
                <div className="paywall-preview-eyebrow">Example nudge — not from your data</div>
                <p className="paywall-preview-body">
                  "Wednesday is your weakest day for Gym Session — three weeks running.
                  Want to schedule a 15-min walk instead?"
                </p>
              </div>
            )}

            <div className="paywall-features">
              <PaywallFeature icon={<Icon name="zap" size={15} />} title="Proactive nudges" sub="Coach spots patterns in your week and nudges before you slip." />
              <PaywallFeature icon={<Icon name="sparkles" size={15} />} title="Daily brief + weekly review" sub="3-line focus / watch / micro action every morning. Sundays: a deep look back." />
              <PaywallFeature icon={<Icon name="infinity" size={15} />} title="Unlimited everything" sub="Habits, achievements, widgets, holidays — no caps." />
              <PaywallFeature icon={<Icon name="palette" size={15} />} title="Accent colours + full history" sub="Every accent, a colour of your own, your entire year of data." />
            </div>

            {/* Storefront — three package cards. Replaces the single
                CTA when RC offerings are available. */}
            {useStorefront ? (
              <div className="paywall-storefront">
                {sortedPackages.map(pkg => {
                  const meta = PACKAGE_META[pkg.identifier] || { label: pkg.product?.title || 'Plan', sub: pkg.product?.description || '' };
                  const busy = purchasingId === pkg.identifier;
                  return (
                    <button
                      key={pkg.identifier}
                      className={`paywall-pkg paywall-pkg-${meta.accent}`}
                      onClick={() => handlePurchase(pkg)}
                      disabled={!!purchasingId}
                    >
                      {meta.badge && <span className="paywall-pkg-badge">{meta.badge}</span>}
                      <div className="paywall-pkg-label">{meta.label}</div>
                      <div className="paywall-pkg-price">
                        {priceLine(pkg) || ''}
                      </div>
                      <div className="paywall-pkg-sub">{meta.sub}</div>
                      {renewalLine(pkg, plat) && (
                        <div className="paywall-pkg-renew">{renewalLine(pkg, plat)}</div>
                      )}
                      {busy && <div className="paywall-pkg-busy">Opening…</div>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="paywall-actions">
                <button className="btn btn-ghost" onClick={onClose}>Maybe later</button>
                <button
                  className="btn btn-primary paywall-cta"
                  onClick={onUpgrade}
                  disabled={offeringsLoading}
                >
                  {hasPro
                    ? 'Manage in Settings'
                    : offeringsLoading
                      ? 'Loading…'
                      : proIsLive
                        // No product loaded (web, or the store didn't
                        // answer) → no price. The only price quoted is
                        // the one the store is about to charge.
                        ? 'Upgrade to Pro'
                        : 'Join the waitlist'}
                </button>
              </div>
            )}

            {error && (
              <div className="paywall-error" role="alert">{error}</div>
            )}

            {restoreMsg && (
              <div className="paywall-restore-msg" role="status">{restoreMsg}</div>
            )}

            <p className="paywall-fineprint">
              {useStorefront
                ? `Payment is charged to your ${plat === 'android' ? 'Google Play' : plat === 'ios' ? 'Apple ID' : 'store'} account at confirmation. `
                  + `Subscriptions auto-renew at the price shown until cancelled; cancel at least 24 hours before the period ends in ${storeName(plat)} subscription settings.`
                : proIsLive && !hasPro
                  ? 'Pro is bought in the iOS and Android apps. The price and renewal terms are shown there before you pay, and a subscription can be cancelled any time in the store.'
                  : 'Your data stays yours.'}
            </p>

            <div className="paywall-legal">
              {legalLink('terms', 'Terms of Service')}
              <span aria-hidden="true">·</span>
              {legalLink('privacy', 'Privacy Policy')}
              {!hasPro && (
                <>
                  <span aria-hidden="true">·</span>
                  <button type="button" className="paywall-legal-link" onClick={handleRestore} disabled={restoring}>
                    {restoring ? 'Restoring…' : 'Restore purchases'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}

function PaywallFeature({ icon, title, sub }) {
  return (
    <div className="paywall-feature">
      <div className="paywall-feature-icon">{icon}</div>
      <div className="paywall-feature-body">
        <div className="paywall-feature-title">{title}</div>
        <div className="paywall-feature-sub">{sub}</div>
      </div>
    </div>
  );
}

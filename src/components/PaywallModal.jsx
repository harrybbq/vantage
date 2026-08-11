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
 */
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { motion, AnimatePresence } from 'framer-motion';
import { FREE_CAPS } from '../hooks/useTierLimits';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { getOfferings, purchasePackage, isAvailable as rcIsAvailable } from '../lib/billing/revenuecat';
import Overlay from './ui/Overlay';

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

export default function PaywallModal({ openId, onClose, onUpgrade, onShowToast }) {
  const { proIsLive, hasPro } = useSubscriptionContext();
  const isOpen = typeof openId === 'string' && openId.startsWith('paywall:');
  const capKey = isOpen ? openId.split(':')[1] : null;
  const cap = capKey ? FREE_CAPS[capKey] : null;

  const [offerings, setOfferings] = useState(null);
  const [offeringsLoading, setOfferingsLoading] = useState(false);
  const [purchasingId, setPurchasingId] = useState(null);
  const [error, setError] = useState(null);

  // Load offerings when the modal opens. We do it on every open
  // (not on mount) so a user who connects to RC mid-session gets
  // packages on their next paywall view without a refresh.
  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setPurchasingId(null);
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
          ? "Purchases need the iOS or Android build to fire — they don't work on the web."
          : "Couldn't complete the purchase. Try again, or restore from Settings → Subscription if you've bought before."
      );
    }
  }

  // Decide what to render in the actions area
  const packages = (offerings?.availablePackages || []).filter(p => !UNSELLABLE.has(p.identifier));
  const hasPackages = packages.length > 0;
  const useStorefront = isOpen && proIsLive && hasPackages && !hasPro;
  const sortedPackages = hasPackages ? [...packages].sort((a, b) => packageWeight(a) - packageWeight(b)) : [];

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

            {/* Inline preview — what your coach noticed.
                Shown only to non-Pro users; gives them a real example
                pulled from their own data when possible. */}
            {!hasPro && (
              <div className="paywall-preview">
                <div className="paywall-preview-eyebrow">A nudge your coach would send</div>
                <p className="paywall-preview-body">
                  "Wednesday is your weakest day for Gym Session — three weeks running.
                  Want to schedule a 15-min walk instead?"
                </p>
                <div className="paywall-preview-blur">
                  <span>+ 2 more pattern insights this week</span>
                </div>
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
                        {pkg.product?.priceString || ''}
                      </div>
                      <div className="paywall-pkg-sub">{meta.sub}</div>
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
                        ? 'Upgrade — £3.99/mo'
                        : 'Join the waitlist'}
                </button>
              </div>
            )}

            {error && (
              <div className="paywall-error" role="alert">{error}</div>
            )}

            <p className="paywall-fineprint">
              Cancel anytime. UK GDPR compliant. Your data stays yours.
              {useStorefront && ' Subscriptions auto-renew until cancelled in your platform settings.'}
            </p>
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

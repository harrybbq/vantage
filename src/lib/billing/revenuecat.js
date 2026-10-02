/**
 * RevenueCat client wrapper.
 *
 * The Capacitor plugins (`@revenuecat/purchases-capacitor`, `-ui`,
 * `@capacitor/browser`) are imported with LITERAL specifiers so Vite
 * bundles them as lazy chunks. They used to load through a variable
 * plus a vite-ignore comment — a bare specifier only a bundler can
 * resolve, so inside the native WebView the import always failed,
 * `isAvailable()` was always false and Upgrade fell through to the
 * waitlist. Nobody could buy anything.
 *
 * The web build never initialises the plugin: every path checks
 * `Capacitor.isNativePlatform()` first, and the lazy chunks are only
 * fetched after that passes. Still needed for purchases to work:
 *   - `VITE_REVENUECAT_API_KEY_IOS` / `..._ANDROID` env vars
 *   - iOS / Android offerings in the RC dashboard
 *   - `npx cap sync` so the native halves are linked
 *
 * Until then `isAvailable()` returns false and every other call no-ops
 * gracefully — falling back to the existing `profiles.tier` source of
 * truth in useSubscription.
 *
 * Why RevenueCat (vs direct StoreKit / Google Play Billing):
 *   - One API across iOS + Android. Two separate implementations would
 *     double the code and the bug surface.
 *   - Free up to $10k MTR. By the time we exceed that we're profitable
 *     enough to swap to direct.
 *   - Webhook → server gives us a tamper-proof entitlement source we
 *     can sync into `profiles.tier` from the existing dispatch function
 *     pattern.
 */

let _purchases = null;
let _initPromise = null;
let _initialized = false;
let _initFailed = false;

async function getPurchases() {
  if (_purchases) return _purchases;
  try {
    // Never off-platform: there's no store on the web to talk to.
    // Checked here as well as in initRevenueCat so no caller can load
    // the plugin in a browser. A failure is cached so we don't retry
    // on every call.
    const cap = await import('@capacitor/core');
    if (!cap.Capacitor.isNativePlatform()) { _initFailed = true; return null; }
    const mod = await import('@revenuecat/purchases-capacitor');
    _purchases = mod.Purchases || mod.default || mod;
    return _purchases;
  } catch {
    _initFailed = true;
    return null;
  }
}

/**
 * One-time SDK init. Safe to call multiple times — guarded by promise.
 * Resolves to true on success, false otherwise.
 */
export async function initRevenueCat({ userId } = {}) {
  if (_initialized) return true;
  if (_initFailed) return false;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const cap = await import('@capacitor/core');
      if (!cap.Capacitor.isNativePlatform()) {
        _initFailed = true;
        return false;
      }
      const Purchases = await getPurchases();
      if (!Purchases) return false;

      const platform = cap.Capacitor.getPlatform();
      const apiKey = platform === 'ios'
        ? import.meta.env.VITE_REVENUECAT_API_KEY_IOS
        : import.meta.env.VITE_REVENUECAT_API_KEY_ANDROID;
      if (!apiKey) {
        console.warn('RevenueCat API key not set for platform:', platform);
        _initFailed = true;
        return false;
      }

      await Purchases.configure({ apiKey, appUserID: userId || null });
      _initialized = true;
      return true;
    } catch (e) {
      console.warn('RevenueCat init failed:', e?.message);
      _initFailed = true;
      return false;
    }
  })();
  return _initPromise;
}

/** Returns true if the SDK is loaded, configured, and on a native platform. */
export async function isAvailable() {
  if (_initialized) return true;
  if (_initFailed) return false;
  return initRevenueCat();
}

/**
 * Fetch current offerings (monthly + annual packages from the
 * RevenueCat dashboard). Returns null if SDK not available.
 *
 * Caller renders these as the paywall options. The wire shape mirrors
 * RC's own (id, title, description, priceString, period).
 */
export async function getOfferings() {
  if (!(await isAvailable())) return null;
  try {
    const Purchases = await getPurchases();
    const o = await Purchases.getOfferings();
    return o?.current || null;
  } catch (e) {
    console.warn('getOfferings failed:', e?.message);
    return null;
  }
}

/**
 * Trigger the platform purchase sheet for the given package. Resolves
 * to { ok: true, entitlements } on success, { ok: false, reason } on
 * cancel / failure.
 */
export async function purchasePackage(pkg) {
  if (!(await isAvailable())) return { ok: false, reason: 'unavailable' };
  try {
    const Purchases = await getPurchases();
    const result = await Purchases.purchasePackage({ aPackage: pkg });
    const entitlements = result?.customerInfo?.entitlements?.active || {};
    return { ok: true, entitlements };
  } catch (e) {
    if (e?.userCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: e?.message || 'error' };
  }
}

/**
 * Re-syncs entitlements from the App Store / Play Store. Critical for
 * users who reinstall, switch devices, or restore from backup.
 */
export async function restorePurchases() {
  if (!(await isAvailable())) return { ok: false, reason: 'unavailable' };
  try {
    const Purchases = await getPurchases();
    const customerInfo = await Purchases.restorePurchases();
    const entitlements = customerInfo?.entitlements?.active || {};
    return { ok: true, entitlements };
  } catch (e) {
    return { ok: false, reason: e?.message || 'error' };
  }
}

/**
 * Read the current customer info without triggering a purchase. Used
 * on app start to seed `tier` from the platform's source of truth
 * (in case the user upgraded on another device and we haven't synced).
 */
export async function getCustomerInfo() {
  if (!(await isAvailable())) return null;
  try {
    const Purchases = await getPurchases();
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

/**
 * Maps RevenueCat entitlement keys → our internal tier shape.
 *
 * Configure in the RC dashboard → Entitlements:
 *   - 'pro'           → grants 'pro' tier (monthly OR yearly)
 *   - 'pro_lifetime'  → grants 'lifetime' tier (one-time lifetime SKU)
 *
 * Fallback to 'VisionBoard Pro' (with space) and 'lifetime' is included
 * because RC entitlement IDs are user-named and we've seen the dashboard
 * configured with the display string. Cleanest long-term: rename in the
 * dashboard to lowercase identifiers and the fallback can be removed.
 *
 * Returns 'free' / 'pro' / 'lifetime'.
 */
export function deriveTierFromEntitlements(entitlements) {
  if (!entitlements) return 'free';
  if (entitlements.pro_lifetime?.isActive) return 'lifetime';
  if (entitlements.lifetime?.isActive) return 'lifetime';
  if (entitlements.pro?.isActive) return 'pro';
  // Display-string entitlement IDs seen in the RC dashboard. Both the
  // legacy 'VisionBoard Pro' and the rebranded 'Vantage Pro' are
  // accepted so a dashboard rename doesn't break Pro detection.
  if (entitlements['VisionBoard Pro']?.isActive) return 'pro';
  if (entitlements['Vantage Pro']?.isActive) return 'pro';
  return 'free';
}

/**
 * Within the `pro` tier, distinguish monthly vs annual based on which
 * SKU is currently granting the entitlement. Returns:
 *   'annual'    → user is on the yearly plan
 *   'monthly'   → user is on the monthly plan
 *   'lifetime'  → one-time lifetime purchase (separate entitlement)
 *   null        → free user, or pro plan can't be determined
 *
 * The mapping reads the entitlement's `productIdentifier` and matches
 * against our App Store Connect product IDs (yearly / monthly /
 * lifetime — the same names visible in the RC dashboard offering).
 *
 * Used by the subscription panel to label the plan accurately and by
 * the migration banner to show "Switch to annual and save" only to
 * users currently on monthly.
 */
export function derivePlanFromEntitlements(entitlements) {
  if (!entitlements) return null;
  const lifetime = entitlements.pro_lifetime || entitlements.lifetime;
  if (lifetime?.isActive) return 'lifetime';
  const pro = entitlements.pro || entitlements['VisionBoard Pro'] || entitlements['Vantage Pro'];
  if (!pro?.isActive) return null;
  const product = (pro.productIdentifier || '').toLowerCase();
  if (product.includes('year') || product.includes('annual')) return 'annual';
  if (product.includes('month'))                              return 'monthly';
  return null; // unknown SKU pattern — surface no plan label
}

/**
 * Sync the RC SDK's user identity with our Supabase user. Call on
 * sign-in (and call `logoutRevenueCat` on sign-out) so purchases on
 * a shared device get attributed to the right account.
 *
 * Returns the post-login CustomerInfo so callers can re-derive tier
 * immediately rather than waiting for the next getCustomerInfo poll.
 */
export async function loginRevenueCat(userId) {
  if (!userId) return null;
  if (!(await isAvailable())) return null;
  try {
    const Purchases = await getPurchases();
    const result = await Purchases.logIn({ appUserID: userId });
    return result?.customerInfo || null;
  } catch (e) {
    console.warn('loginRevenueCat failed:', e?.message);
    return null;
  }
}

export async function logoutRevenueCat() {
  if (!(await isAvailable())) return;
  try {
    const Purchases = await getPurchases();
    await Purchases.logOut();
  } catch (e) {
    console.warn('logoutRevenueCat failed:', e?.message);
  }
}

/**
 * Present RevenueCat's prebuilt Customer Center sheet — the surface
 * that lets users view their active subscription, manage billing,
 * cancel, request refunds, see purchase history. Apple's review
 * guidelines treat this as the canonical "manage subscription"
 * affordance, so we surface it from Settings → Subscription.
 *
 * Falls back to `openManageSubscription` (App Store / Play Store
 * deep-link) if the UI plugin fails to load or present.
 */
export async function presentCustomerCenter() {
  try {
    const cap = await import('@capacitor/core');
    if (!cap.Capacitor.isNativePlatform()) return false;
    const mod = await import('@revenuecat/purchases-capacitor-ui').catch(() => null);
    if (!mod) {
      // Plugin not installed — fall back to the platform store page
      return openManageSubscription();
    }
    const RevenueCatUI = mod.RevenueCatUI || mod.default || mod;
    await RevenueCatUI.presentCustomerCenter();
    return true;
  } catch (e) {
    console.warn('presentCustomerCenter failed, falling back:', e?.message);
    return openManageSubscription();
  }
}

/**
 * Open the platform-native subscription management surface. iOS opens
 * the App Store subscriptions page, Android opens the Play Store
 * subscriptions page. Used as the fallback when Customer Center isn't
 * available (web, or UI plugin not installed).
 */
export async function openManageSubscription() {
  try {
    const cap = await import('@capacitor/core');
    if (!cap.Capacitor.isNativePlatform()) return false;
    const platform = cap.Capacitor.getPlatform();
    const url = platform === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
    const { Browser } = await import('@capacitor/browser').catch(() => ({ Browser: null }));
    if (Browser) {
      await Browser.open({ url });
      return true;
    }
    window.open(url, '_blank');
    return true;
  } catch (e) {
    console.warn('openManageSubscription failed:', e?.message);
    return false;
  }
}

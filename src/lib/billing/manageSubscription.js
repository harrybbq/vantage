/**
 * Where a user goes to change or cancel a subscription.
 *
 * Not something the app can do itself: an active subscription is owned
 * by whichever store took the money, and only that store can change or
 * cancel it. RevenueCat reports the state; it doesn't manage the
 * billing relationship on the user's behalf.
 *
 * So this returns the right destination for the platform rather than
 * pretending there's an in-app path.
 */

/** Rough platform sniff — good enough to pick a store link. */
function platform() {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as a Mac, so the touch check catches it.
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  if (iOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'web';
}

/**
 * Store subscription-management URL. On the web there's no store
 * relationship, so we send them to Apple's page — subscriptions can
 * only have been bought in the app, and Apple's is the one that opens
 * sensibly in a desktop browser.
 */
export function storeSubscriptionsUrl() {
  switch (platform()) {
    case 'android': return 'https://play.google.com/store/account/subscriptions';
    case 'ios':
    default:        return 'https://apps.apple.com/account/subscriptions';
  }
}

export { platform };

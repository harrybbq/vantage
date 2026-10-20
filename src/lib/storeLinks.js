/**
 * Where to get the store apps. PLACEHOLDERS until the listings exist:
 * null renders "Coming soon to the App Store / Google Play" instead of a
 * link that goes nowhere. Fill both in when the apps are live (they are
 * shown on the web gate page and the invite landing — item 131).
 *
 *   APP_STORE_URL  e.g. https://apps.apple.com/app/id0000000000
 *   PLAY_STORE_URL e.g. https://play.google.com/store/apps/details?id=com.vantage.app
 */
export const APP_STORE_URL = null;
export const PLAY_STORE_URL = null;

/** Only an https link counts as filled in. */
export function storeHref(url) {
  return typeof url === 'string' && /^https:\/\/\S+$/.test(url) ? url : null;
}

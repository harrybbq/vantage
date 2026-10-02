/**
 * What the paywall says about price and renewal, built from the store
 * product rather than typed into the component.
 *
 * Apple (3.1.2) and Google both want the auto-renewing terms next to the
 * buy button: the price, the period it buys, that it renews until
 * cancelled, and where to cancel. A price written into JSX drifts the
 * first time the store price changes, a currency differs, or a promo
 * runs — the store product is the only thing that knows what the person
 * will actually be charged, so it is the only thing quoted.
 *
 * Pure on purpose (no SDK import) so renewalWording.test.mjs can pin it.
 */

// Package identifiers the app already trusts (PaywallModal sorts on
// them). The ISO-8601 period and RC's packageType are fallbacks for a
// custom package that doesn't use the standard identifiers.
const BY_IDENTIFIER = { $rc_monthly: 'month', $rc_annual: 'year', $rc_weekly: 'week', $rc_lifetime: 'lifetime' };
const BY_TYPE = { MONTHLY: 'month', ANNUAL: 'year', WEEKLY: 'week', LIFETIME: 'lifetime' };
const BY_ISO = { P1W: 'week', P7D: 'week', P1M: 'month', P1Y: 'year', P12M: 'year' };

/** 'week' | 'month' | 'year' | 'lifetime' | null */
export function packagePeriod(pkg) {
  if (!pkg) return null;
  return BY_IDENTIFIER[pkg.identifier]
    || BY_TYPE[pkg.packageType]
    || BY_ISO[pkg.product?.subscriptionPeriod]
    || null;
}

const ADVERB = { week: 'weekly', month: 'monthly', year: 'yearly' };

/** The store a subscription is cancelled in, by platform. */
export function storeName(platform) {
  if (platform === 'ios') return 'the App Store';
  if (platform === 'android') return 'Google Play';
  return 'the App Store or Google Play';
}

/**
 * The price line for a package card: "£3.99 / month". Null when the
 * product carries no price string — the caller then shows no price at
 * all rather than a remembered one.
 */
export function priceLine(pkg) {
  const price = pkg?.product?.priceString;
  if (!price) return null;
  const period = packagePeriod(pkg);
  if (!period || period === 'lifetime') return price;
  return `${price} / ${period}`;
}

/**
 * The renewal sentence for one package, e.g.
 *   "£3.99 per month, auto-renews monthly until cancelled. Cancel at
 *    least 24 hours before renewal in the App Store."
 * Null when there is no product price to quote.
 */
export function renewalLine(pkg, platform) {
  const price = pkg?.product?.priceString;
  if (!price) return null;
  const period = packagePeriod(pkg);
  if (period === 'lifetime') return `${price}, one payment. Does not renew.`;
  const per = period ? ` per ${period}` : '';
  const how = period ? ` ${ADVERB[period]}` : '';
  return `${price}${per}, auto-renews${how} until cancelled. `
    + `Cancel at least 24 hours before renewal in ${storeName(platform)} subscription settings.`;
}

/**
 * What switching monthly → yearly saves over a year, from the two
 * products' numeric prices. Null unless both prices are real numbers in
 * the same currency and the yearly plan is actually cheaper — a saving
 * is only claimed when it can be computed.
 */
export function yearlySaving(monthlyPkg, annualPkg) {
  const m = monthlyPkg?.product, a = annualPkg?.product;
  if (!m || !a) return null;
  if (typeof m.price !== 'number' || typeof a.price !== 'number') return null;
  if (m.currencyCode && a.currencyCode && m.currencyCode !== a.currencyCode) return null;
  const yearAtMonthly = m.price * 12;
  const amount = Math.round((yearAtMonthly - a.price) * 100) / 100;
  if (!(amount > 0)) return null;
  return {
    amount,
    pct: Math.round((amount / yearAtMonthly) * 100),
    yearAtMonthly: Math.round(yearAtMonthly * 100) / 100,
    annual: a.price,
    currency: a.currencyCode || m.currencyCode || null,
  };
}

/** Format an amount in a currency, falling back to a bare number. */
export function money(amount, currency) {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
    } catch { /* unknown code — fall through */ }
  }
  return amount.toFixed(2);
}

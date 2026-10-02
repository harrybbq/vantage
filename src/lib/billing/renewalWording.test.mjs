/**
 * The paywall's price and renewal wording. What matters here is that a
 * price only ever comes from the product, and a missing product yields
 * no price at all rather than a remembered one.
 */
import assert from 'node:assert/strict';
import {
  packagePeriod, priceLine, renewalLine, yearlySaving, storeName, money,
} from './renewalWording.js';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const monthly = { identifier: '$rc_monthly', product: { priceString: '£4.49', price: 4.49, currencyCode: 'GBP' } };
const annual  = { identifier: '$rc_annual',  product: { priceString: '£34.99', price: 34.99, currencyCode: 'GBP' } };

// ── Period ──
{
  eq(packagePeriod(monthly), 'month', 'standard identifier');
  eq(packagePeriod(annual), 'year', 'standard identifier');
  eq(packagePeriod({ identifier: 'custom', packageType: 'ANNUAL' }), 'year', 'packageType fallback');
  eq(packagePeriod({ identifier: 'custom', product: { subscriptionPeriod: 'P1M' } }), 'month', 'ISO fallback');
  eq(packagePeriod({ identifier: 'custom' }), null, 'unknown stays unknown');
  eq(packagePeriod(null), null, 'no package');
}

// ── Price comes from the product, or not at all ──
{
  eq(priceLine(monthly), '£4.49 / month', 'monthly price line');
  eq(priceLine(annual), '£34.99 / year', 'yearly price line');
  eq(priceLine({ identifier: '$rc_monthly', product: {} }), null, 'no priceString → no price');
  eq(priceLine({ identifier: 'custom', product: { priceString: '$9' } }), '$9', 'unknown period → price alone');
}

// ── Renewal sentence ──
{
  const line = renewalLine(monthly, 'ios');
  ok(line.startsWith('£4.49 per month, auto-renews monthly until cancelled.'), 'names price, period, renewal');
  ok(line.includes('24 hours before renewal'), 'says when to cancel by');
  ok(line.includes('the App Store'), 'names the store on iOS');
  ok(renewalLine(annual, 'android').includes('Google Play'), 'names the store on Android');
  ok(renewalLine(annual, 'web').includes('App Store or Google Play'), 'both when unknown');
  eq(renewalLine({ identifier: '$rc_annual', product: {} }), null, 'no product price → no sentence');
  ok(/does not renew/i.test(renewalLine({ identifier: '$rc_lifetime', product: { priceString: '£60' } })), 'lifetime is not a renewal');
  ok(!/\d/.test(storeName('ios')), 'store names carry no numbers');
}

// ── Saving claimed only when it can be computed ──
{
  const s = yearlySaving(monthly, annual);
  eq(s.amount, 18.89, '12 × 4.49 − 34.99');
  eq(s.pct, 35, 'rounded percentage');
  eq(s.currency, 'GBP', 'currency carried');
  eq(yearlySaving(monthly, { identifier: '$rc_annual', product: { priceString: '£60', price: 60 } }), null, 'dearer yearly → no claim');
  eq(yearlySaving(monthly, { identifier: '$rc_annual', product: { priceString: '£30' } }), null, 'no numeric price → no claim');
  eq(yearlySaving(monthly, { identifier: '$rc_annual', product: { price: 30, currencyCode: 'USD' } }), null, 'mixed currency → no claim');
  eq(yearlySaving(null, annual), null, 'missing package');
  eq(money(18.89, 'GBP'), '£18.89', 'formats GBP');
  eq(money(3, null), '3.00', 'bare fallback');
}

console.log(`renewalWording: ${n} checks passed`);

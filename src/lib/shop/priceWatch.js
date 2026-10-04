/**
 * Price-drop watching for wishlist items — the network half.
 *
 * The rules about what gets written (merge onto the latest list by id,
 * never write `price`, a failed check isn't a check) live in the pure
 * sweep.js, which is tested. This file only asks the function and keeps
 * a per-device note of URLs that just failed.
 *
 * Re-exports the pure helpers so existing imports keep working.
 */
import { authFetch } from '../authFetch';
import { itemsDueCheck, planSweepResults, CHECK_INTERVAL_MS } from './sweep.js';
import { parsePrice } from './price.js';

export { itemsDueCheck, planSweepResults, applySweepUpdates, applyCheck, applyPriceEdit, priceMovement } from './sweep.js';

/**
 * Numeric value of a free-text price, or null. Kept for old callers;
 * it is parsePrice() underneath, so "1.299,99 €" is 1299.99, not 1.3.
 */
export function priceToNumber(str) {
  return parsePrice(str).value;
}

// Failed URLs, per device: url → ms. A dead link would otherwise sit at
// the front of the oldest-first queue forever (it never gets a
// priceCheckedAt now that failures don't count), taking a slot from a
// live one on every open. Browser storage is right for this: it is a
// retry hint, losing it costs one extra request, and it never needs to
// reach another device or the server.
const FAIL_KEY = 'vantage.shopPriceFails';

function readFails(now) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(FAIL_KEY) || '{}');
    const out = {};
    for (const [url, at] of Object.entries(raw || {})) {
      if (typeof at === 'number' && now - at <= CHECK_INTERVAL_MS) out[url] = at;
    }
    return out;
  } catch { return {}; }
}

function writeFails(fails) {
  try { window.localStorage.setItem(FAIL_KEY, JSON.stringify(fails)); } catch { /* private mode etc. */ }
}

/**
 * Run one sweep over `items` (a snapshot is fine — nothing from it is
 * written back). Resolves to { updates: Map<id, update> } holding ONLY
 * the items whose price was actually read; apply them to the latest
 * list with applySweepUpdates. Never throws; offline → empty map.
 */
export async function sweepPrices(items) {
  const now = Date.now();
  const fails = readFails(now);
  const due = itemsDueCheck(items, now, fails);
  const empty = { updates: new Map() };
  if (!due.length) return empty;
  try {
    const res = await authFetch('/.netlify/functions/shop-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [...new Set(due.map(i => i.url))] }),
    });
    if (!res.ok) return empty;
    const body = await res.json().catch(() => ({}));
    const { updates, failedUrls } = planSweepResults(due, body.results, new Date().toISOString());
    // Successes clear an old failure; failures start (or restart) one.
    const next = { ...fails };
    for (const u of updates.values()) delete next[u.url];
    for (const url of failedUrls) next[url] = now;
    writeFails(next);
    return { updates };
  } catch {
    // Offline or the function is down — not the links' fault, so no
    // failures recorded and nothing written.
    return empty;
  }
}

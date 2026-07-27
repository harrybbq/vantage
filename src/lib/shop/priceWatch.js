/**
 * Price-drop watching for wishlist items.
 *
 * Items keep a small `priceHistory` of points where the price actually
 * MOVED — not one row per check. A wishlist item is watched for months,
 * so recording every poll would grow state without adding information,
 * and state size is already the app's tightest constraint.
 *
 * Everything here is additive: it only ever adds `priceHistory`,
 * `priceCheckedAt` and `price` to an item that has a URL. Items with no
 * URL, and every other field, are returned untouched.
 */
import { authFetch } from '../authFetch';

const CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~daily, but tolerant
const MAX_PER_SWEEP = 8;                        // matches the function's cap
const MAX_HISTORY = 12;                         // ~a year of real moves

/** Numeric value of a formatted price string ("£1,299.00" → 1299). */
export function priceToNumber(str) {
  if (str == null) return null;
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;
  const m = String(str).replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Items due a re-check: has a URL, not bought, and not checked lately. */
export function itemsDueCheck(items, now = Date.now()) {
  return (items || [])
    .filter(i => i && i.url && /^https?:\/\//i.test(i.url) && !i.bought)
    .filter(i => {
      const last = i.priceCheckedAt ? Date.parse(i.priceCheckedAt) : 0;
      return !last || (now - last) > CHECK_INTERVAL_MS;
    })
    // Oldest check first, so the queue drains fairly across sessions.
    .sort((a, b) => (Date.parse(a.priceCheckedAt || 0) || 0) - (Date.parse(b.priceCheckedAt || 0) || 0))
    .slice(0, MAX_PER_SWEEP);
}

/**
 * Merge fetched prices into items. Returns a NEW array, and returns the
 * original array untouched when nothing changed so callers can skip a
 * pointless state write.
 */
export function applyPriceResults(items, results, nowIso = new Date().toISOString()) {
  const byUrl = new Map();
  for (const r of results || []) if (r && r.url) byUrl.set(r.url, r);
  if (!byUrl.size) return items;

  let changed = false;
  const next = (items || []).map(item => {
    const r = item?.url ? byUrl.get(item.url) : null;
    if (!r) return item;

    // A failed check still counts as "checked", or a dead URL would be
    // retried on every single page open forever.
    if (!r.ok || r.priceNum == null) {
      changed = true;
      return { ...item, priceCheckedAt: nowIso };
    }

    const history = Array.isArray(item.priceHistory) ? item.priceHistory : [];
    const lastPoint = history[history.length - 1];
    const known = lastPoint ? lastPoint.p : priceToNumber(item.price);

    // Seed history from the price the item was saved with, so the first
    // observed drop still has something to be a drop FROM.
    let nextHistory = history;
    if (!history.length && known != null) {
      nextHistory = [{ at: item.addedAt || nowIso, p: known }];
    }

    const moved = known == null || Math.abs(r.priceNum - known) >= 0.01;
    if (moved) {
      nextHistory = [...nextHistory, { at: nowIso, p: r.priceNum }].slice(-MAX_HISTORY);
    }

    changed = true;
    return {
      ...item,
      price: r.price || item.price,
      priceCheckedAt: nowIso,
      ...(nextHistory !== history ? { priceHistory: nextHistory } : {}),
    };
  });

  return changed ? next : items;
}

/**
 * What the card should say about price movement, or null when there's
 * nothing interesting. `pct` is negative for a drop.
 */
export function priceMovement(item) {
  const history = Array.isArray(item?.priceHistory) ? item.priceHistory : [];
  if (history.length < 2) return null;
  const first = history[0]?.p;
  const now = history[history.length - 1]?.p;
  if (first == null || now == null || first <= 0) return null;
  const delta = now - first;
  if (Math.abs(delta) < 0.01) return null;

  // Peak matters more than the starting point for "how good is this
  // deal" — a price that rose then fell back is not a saving.
  const peak = Math.max(...history.map(h => h.p).filter(p => p != null));
  return {
    direction: delta < 0 ? 'down' : 'up',
    delta,
    pct: (delta / first) * 100,
    from: first,
    to: now,
    peak,
    offPeak: peak > 0 ? ((now - peak) / peak) * 100 : 0,
    at: history[history.length - 1].at,
  };
}

/** Run one sweep. Returns the updated items array (or the original). */
export async function sweepPrices(items) {
  const due = itemsDueCheck(items);
  if (!due.length) return items;
  try {
    const res = await authFetch('/.netlify/functions/shop-price-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: due.map(i => i.url) }),
    });
    if (!res.ok) return items;
    const body = await res.json().catch(() => ({}));
    return applyPriceResults(items, body.results);
  } catch {
    // Offline or the function is down — leave everything alone.
    return items;
  }
}

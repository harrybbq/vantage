/**
 * Price-drop watching for wishlist items — the pure half.
 *
 * The network call lives in priceWatch.js; everything that decides what
 * gets written lives here, so it can be tested without a browser.
 *
 * Three rules, each one a bug that shipped before:
 *
 *  1. Results land on the LATEST list, by id, and only on the items the
 *     sweep actually checked. The sweep used to snapshot every item when
 *     the page opened, wait 3–25 s for the shops, then write the
 *     snapshot's `price` and history back over every item — reverting
 *     anything edited in the meantime, checked or not. Nothing from the
 *     start-of-sweep snapshot is written now: `planSweepResults` returns
 *     only what each shop said, and `applySweepUpdates` computes the new
 *     fields from the item as it is at merge time.
 *
 *  2. The sweep never writes `price`. That field is the person's own
 *     text ("From £20", "£47 in the sale") and it used to be replaced by
 *     whatever was scraped. The checked price goes in `livePrice`
 *     ({ p, at, c? } — a new, additive key) and in `priceHistory`.
 *
 *  3. A failed check is not a check. `priceCheckedAt` only moves on a
 *     price actually read. Failures are returned so the caller can back
 *     off that URL for a while (priceWatch keeps that per device), which
 *     stops a dead link being retried on every open without pretending
 *     it was checked.
 *
 * History keeps points where the price MOVED, not one per poll, capped
 * at 12. A point the person typed in the edit modal carries
 * `src: 'edit'`, and movement is measured from the latest such point —
 * so retyping the price restarts the comparison instead of measuring
 * against a number they've since corrected.
 */
import { parsePrice, isSuspectMove } from './price.js';

export const CHECK_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~daily, but tolerant
export const MAX_PER_SWEEP = 8;                        // matches the function's cap
export const MAX_HISTORY = 12;                         // ~a year of real moves

const isLinked = i => i && typeof i.url === 'string' && /^https?:\/\//i.test(i.url);

/**
 * Items due a re-check: linked, not bought, not checked lately, and not
 * a URL that failed within the interval (`failedAt`: url → ms).
 */
export function itemsDueCheck(items, now = Date.now(), failedAt = {}) {
  return (items || [])
    .filter(i => isLinked(i) && !i.bought)
    .filter(i => {
      const last = i.priceCheckedAt ? Date.parse(i.priceCheckedAt) : 0;
      if (last && (now - last) <= CHECK_INTERVAL_MS) return false;
      const failed = failedAt && failedAt[i.url];
      return !(failed && (now - failed) <= CHECK_INTERVAL_MS);
    })
    // Oldest check first, so the queue drains fairly across sessions.
    .sort((a, b) => (Date.parse(a.priceCheckedAt || 0) || 0) - (Date.parse(b.priceCheckedAt || 0) || 0))
    .slice(0, MAX_PER_SWEEP);
}

/** What a shop's answer is worth, or null when it couldn't be read. */
function readResult(r) {
  if (!r || !r.ok) return null;
  const parsed = parsePrice(r.price);
  if (parsed.value != null && parsed.kind !== 'free') {
    return { value: parsed.value, currency: parsed.currency || 'GBP' };
  }
  const n = typeof r.priceNum === 'number' && Number.isFinite(r.priceNum) && r.priceNum > 0 ? r.priceNum : null;
  return n == null ? null : { value: Math.round(n * 100) / 100, currency: 'GBP' };
}

/**
 * Turn the function's answer into per-item updates.
 *
 * `checked` is the list the request was built from. Returns
 *   updates:    Map<id, { url, value, currency, at }> — successful reads only
 *   failedUrls: urls that failed or had no readable price
 * Nothing in `updates` is copied from the items themselves.
 */
export function planSweepResults(checked, results, at = new Date().toISOString()) {
  const byUrl = new Map();
  for (const r of results || []) if (r && typeof r.url === 'string') byUrl.set(r.url, r);
  const updates = new Map();
  const failed = new Set();
  for (const item of checked || []) {
    if (!isLinked(item) || item.bought) continue;
    if (!byUrl.has(item.url)) continue;
    const read = readResult(byUrl.get(item.url));
    if (!read) { failed.add(item.url); continue; }
    updates.set(item.id, { url: item.url, value: read.value, currency: read.currency, at });
  }
  return { updates, failedUrls: [...failed] };
}

const toIso = v => {
  if (v == null) return null;
  const d = new Date(typeof v === 'number' ? v : Date.parse(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Apply one successful check to an item AS IT IS NOW. Returns the item
 * unchanged if its link has changed since the check was sent (the
 * answer was about a different page).
 *
 * Accepts either a planned update ({ url, value, currency, at }) or a
 * raw function result ({ url, ok, price, priceNum }) plus `at`.
 */
export function applyCheck(item, check, atArg) {
  if (!item || !check || item.url !== check.url) return item;
  let value, currency, at;
  if ('value' in check) {
    ({ value, currency, at } = check);
  } else {
    const read = readResult(check);
    if (!read) return item;
    ({ value, currency } = read);
    at = atArg;
  }
  at = at || atArg || new Date().toISOString();
  currency = currency || 'GBP';

  const livePrice = { p: value, at, ...(currency !== 'GBP' ? { c: currency } : {}) };
  const history = Array.isArray(item.priceHistory) ? item.priceHistory : [];
  const typed = parsePrice(item.price);
  const typedCur = typed.currency || 'GBP';
  const lastPoint = history[history.length - 1];

  // History is in one currency. A euro read for an item typed in pounds
  // is still shown as livePrice, but it can't be a "move".
  let nextHistory = history;
  if (typedCur === currency) {
    const known = lastPoint && typeof lastPoint.p === 'number'
      ? lastPoint.p
      : (typed.kind !== 'free' ? typed.value : null);
    // Seed from the price the item was saved with, so the first observed
    // drop has something to be a drop FROM.
    if (!history.length && known != null) {
      nextHistory = [{ at: toIso(item.addedAt) || at, p: known }];
    }
    const moved = known == null || Math.abs(value - known) >= 0.01;
    if (moved) nextHistory = [...nextHistory, { at, p: value }].slice(-MAX_HISTORY);
  }

  return {
    ...item,
    livePrice,
    priceCheckedAt: at,
    ...(nextHistory !== history ? { priceHistory: nextHistory } : {}),
  };
}

/**
 * Merge planned updates onto the latest list. Items not in `updates`
 * come back as the same object; returns the same ARRAY when nothing
 * applied, so callers can skip the state write.
 */
export function applySweepUpdates(latest, updates) {
  if (!updates || !updates.size || !Array.isArray(latest)) return latest;
  let changed = false;
  const next = latest.map(item => {
    const u = item && updates.get(item.id);
    if (!u) return item;
    const out = applyCheck(item, u);
    if (out !== item) changed = true;
    return out;
  });
  return changed ? next : latest;
}

/**
 * Apply an edit-modal patch to an item. When the typed price changes to
 * a readable value, a fresh history point is added (marked `src:'edit'`)
 * so movement restarts from what the person just wrote. Old points stay,
 * capped at 12. Items with no history get none invented — the next check
 * seeds it from the text, as before. Every other patch field is applied
 * as given.
 */
export function applyPriceEdit(item, patch, at = new Date().toISOString()) {
  const next = { ...item, ...patch };
  if (!patch || !('price' in patch) || patch.price === item.price) return next;
  const history = Array.isArray(item.priceHistory) ? item.priceHistory : [];
  if (!history.length) return next;
  const typed = parsePrice(patch.price);
  if (typed.value == null || typed.kind === 'free') return next;
  next.priceHistory = [...history, { at, p: typed.value, src: 'edit' }].slice(-MAX_HISTORY);
  return next;
}

/**
 * What the card should say about price movement, or null when there's
 * nothing believable to say. `pct` is negative for a drop.
 *
 * Measured from the latest typed (`src:'edit'`) point, or the first
 * point. Reads more than 90% down or 300% up from that baseline are
 * treated as misreads and skipped — the "▲ 453%" badge was one.
 */
export function priceMovement(item) {
  const all = Array.isArray(item?.priceHistory) ? item.priceHistory : [];
  let start = 0;
  for (let i = all.length - 1; i >= 0; i--) if (all[i] && all[i].src === 'edit') { start = i; break; }
  const history = all.slice(start).filter(h => h && typeof h.p === 'number' && Number.isFinite(h.p));
  if (history.length < 2) return null;
  const first = history[0].p;
  if (!(first > 0)) return null;
  const good = history.filter((h, i) => i === 0 || !isSuspectMove(first, h.p));
  if (good.length < 2) return null;
  const last = good[good.length - 1];
  const delta = last.p - first;
  if (Math.abs(delta) < 0.01) return null;

  // Peak matters more than the starting point for "how good is this
  // deal" — a price that rose then fell back is not a saving.
  const peak = Math.max(...good.map(h => h.p));
  return {
    direction: delta < 0 ? 'down' : 'up',
    delta,
    pct: (delta / first) * 100,
    from: first,
    to: last.p,
    peak,
    offPeak: peak > 0 ? ((last.p - peak) / peak) * 100 : 0,
    at: last.at,
  };
}

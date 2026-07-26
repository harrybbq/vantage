/**
 * Sorting, searching and totalling for the wishlist.
 *
 * Pure functions over the items array — no state shape changes. Sort and
 * search are VIEW state (component-local), deliberately not persisted to
 * `S`: they're a way of looking at the list for a minute, not a setting,
 * and every key added to state is paid for on every load and save.
 */
import { priceToNumber } from './priceWatch';

export const SORTS = [
  { key: 'added',    label: 'Recently added' },
  { key: 'priceHi',  label: 'Price: high → low' },
  { key: 'priceLo',  label: 'Price: low → high' },
  { key: 'priority', label: 'Priority' },
  { key: 'coins',    label: 'Coin cost' },
  { key: 'name',     label: 'Name (A–Z)' },
  { key: 'drops',    label: 'Biggest price drop' },
];

const PRIORITY_RANK = { high: 0, med: 1, low: 2 };

/** Drop percentage (negative = cheaper than it started), else 0. */
function dropPct(item) {
  const h = Array.isArray(item.priceHistory) ? item.priceHistory : [];
  if (h.length < 2) return 0;
  const first = h[0]?.p, now = h[h.length - 1]?.p;
  if (!first || now == null || first <= 0) return 0;
  return ((now - first) / first) * 100;
}

/**
 * Sort a COPY of items. `order` is the original array so 'added' can use
 * insertion order — items carry no timestamp, and inferring one from the
 * id would break for any item created before ids were time-based.
 */
export function sortItems(items, sortKey, order = items) {
  const index = new Map(order.map((it, i) => [it.id, i]));
  const list = [...items];
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');

  switch (sortKey) {
    case 'priceHi':
      return list.sort((a, b) => (priceToNumber(b.price) ?? -Infinity) - (priceToNumber(a.price) ?? -Infinity) || byName(a, b));
    case 'priceLo':
      return list.sort((a, b) => (priceToNumber(a.price) ?? Infinity) - (priceToNumber(b.price) ?? Infinity) || byName(a, b));
    case 'priority':
      return list.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byName(a, b));
    case 'coins':
      return list.sort((a, b) => (Number(b.coinCost) || 0) - (Number(a.coinCost) || 0) || byName(a, b));
    case 'name':
      return list.sort(byName);
    case 'drops':
      // Most-negative first; anything without movement sinks to the end.
      return list.sort((a, b) => dropPct(a) - dropPct(b) || byName(a, b));
    case 'added':
    default:
      // Newest first — the array is append-ordered.
      return list.sort((a, b) => (index.get(b.id) ?? 0) - (index.get(a.id) ?? 0));
  }
}

/** Case-insensitive match across the fields a person would search by. */
export function searchItems(items, term) {
  const q = (term || '').trim().toLowerCase();
  if (!q) return items;
  // All words must appear somewhere, so "sony head" finds the headphones.
  const words = q.split(/\s+/);
  return items.filter(it => {
    const hay = [it.name, it.notes, it.price, it.url].filter(Boolean).join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/**
 * Summed price of a set of items, plus how many had an unreadable price.
 * The price field is free text, so "unknown" is a real outcome and the
 * UI says so rather than quietly under-reporting the total.
 */
export function totalFor(items) {
  let sum = 0, counted = 0, unknown = 0;
  for (const it of items || []) {
    const n = priceToNumber(it.price);
    if (n == null) { unknown++; continue; }
    sum += n;
    counted++;
  }
  return { sum, counted, unknown };
}

/** "£1,299" / "£1,299.50" — whole pounds unless the pennies matter. */
export function fmtMoney(n, prefix = '£') {
  if (n == null) return '';
  const hasPence = Math.abs(n % 1) > 0.001;
  return prefix + n.toLocaleString('en-GB', {
    minimumFractionDigits: hasPence ? 2 : 0,
    maximumFractionDigits: hasPence ? 2 : 0,
  });
}

/**
 * The one price reader for the wishlist.
 *
 * `shopItems[].price` is FREE TEXT — whatever the person typed or the
 * autofill found — and it stays that way: nothing here rewrites it. This
 * module only reads it, so every total, sort and badge on the page agrees
 * on what "£1,299.99" or "2 for £10" is worth.
 *
 * It replaced three parsers that disagreed. The header stripped every
 * non-digit ("£20–£30" read as 2030), the totals took the first number
 * with commas removed ("1.299,99 €" read as £1.30), and none knew about
 * "Was £50 now £30" or that $ and € are not pounds. On one test list the
 * header said £20,641 and the list said £12,854.20.
 *
 * Pure. No React, no DOM, no state writes.
 */

const SYMBOL = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
const CODE = { GBP: 'GBP', USD: 'USD', EUR: 'EUR', GBR: 'GBP', UKP: 'GBP' };

// A number with optional thousands groups ("1,299", "1.299", "1 299")
// and an optional 1–2 digit decimal part. Group separators include the
// no-break and narrow no-break spaces shops use in "1 299,99 €".
const NUM = /\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)/g;

const EMPTY = Object.freeze({ value: null, currency: null, kind: 'unknown', raw: '' });

/** "1,299.99" / "1.299,99" / "1 299" / "12,99" → number. */
function toNumber(tok) {
  let s = tok.replace(/[\u00a0\u202f ]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal point.
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    s = s.split(grp).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // Comma only: ",dd" or ",d" at the end is a decimal ("12,99"),
    // anything else is grouping ("1,299", "12,345,678").
    const tail = s.length - lastComma - 1;
    s = (tail <= 2 && s.split(',').length === 2) ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot >= 0) {
    // Dot only: "1.299" / "12.345.678" are grouping (no price is
    // £1.299), "12.5" / "12.50" are decimals.
    const parts = s.split('.');
    const grouped = parts.length > 2 || parts[1].length === 3;
    s = grouped ? parts.join('') : s;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Currency written next to a number at [start, end) of `str`, or null. */
function currencyAround(str, start, end) {
  const before = str.slice(Math.max(0, start - 5), start);
  const after = str.slice(end, end + 5);
  let m = before.match(/([£$€])\s*$/) || before.match(/\b(GBP|USD|EUR)\s*$/i);
  if (m) return SYMBOL[m[1]] || CODE[m[1].toUpperCase()] || null;
  m = after.match(/^\s*([£$€])/) || after.match(/^\s*(GBP|USD|EUR)\b/i);
  if (m) return SYMBOL[m[1]] || CODE[m[1].toUpperCase()] || null;
  // "99p" — pence, always pounds.
  if (/^p\b/i.test(after)) return 'GBX';
  return null;
}

function tokens(str) {
  const out = [];
  NUM.lastIndex = 0;
  let m;
  while ((m = NUM.exec(str))) {
    // Skip digits glued to letters ("X200", "4K", "2nd") — model names,
    // not prices. A currency symbol or space is the honest boundary.
    const prev = str[m.index - 1];
    const next = str[m.index + m[0].length];
    if (prev && /[A-Za-z]/.test(prev) && !/(GBP|USD|EUR)$/i.test(str.slice(0, m.index))) continue;
    if (next && /[A-Za-z]/.test(next) && !/^p\b/i.test(str.slice(m.index + m[0].length))) continue;
    const value = toNumber(m[0]);
    if (value == null) continue;
    let currency = currencyAround(str, m.index, m.index + m[0].length);
    let v = value;
    if (currency === 'GBX') { v = Math.round(value) / 100; currency = 'GBP'; }
    out.push({ value: v, currency, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const round2 = n => Math.round(n * 100) / 100;

/**
 * Read a free-text price.
 *
 *   '£1,299.99'        → 1299.99 GBP exact
 *   '1.299,99 €'       → 1299.99 EUR exact
 *   '£20–£30', 'from £20' → 20 GBP from
 *   'Was £50 now £30'  → 30 GBP exact
 *   '2 for £10'        → 10 GBP multi
 *   'Free'             → 0 free
 *   '', null, 'TBC'    → null unknown
 *
 * `raw` is the input as given (trimmed), never altered further.
 */
export function parsePrice(input) {
  if (input == null) return EMPTY;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0
      ? { value: round2(input), currency: null, kind: 'exact', raw: String(input) }
      : { ...EMPTY, raw: String(input) };
  }
  const raw = String(input).trim();
  if (!raw) return EMPTY;

  let text = raw;
  // "Was £50 now £30" / "RRP £50, now £30": what it costs NOW.
  const nowAt = text.search(/\bnow\b/i);
  if (nowAt >= 0) {
    const after = text.slice(nowAt);
    if (tokens(after).length) text = after;
  }

  let toks = tokens(text);
  const anyCurrency = toks.find(t => t.currency)?.currency
    || (raw.match(/[£$€]/) ? SYMBOL[raw.match(/[£$€]/)[0]] : null)
    || (raw.match(/\b(GBP|USD|EUR)\b/i) ? CODE[raw.match(/\b(GBP|USD|EUR)\b/i)[1].toUpperCase()] : null);

  if (!toks.length) {
    if (/\bfree\b/i.test(raw)) return { value: 0, currency: anyCurrency, kind: 'free', raw };
    return { ...EMPTY, raw };
  }

  // "2 for £10" / "3 for 2" — the amount after "for" is the price.
  const multi = text.match(/(\d+)\s*(?:x\s*)?for\s*/i);
  if (multi) {
    const after = toks.find(t => t.start >= multi.index + multi[0].length);
    if (after) return { value: round2(after.value), currency: after.currency || anyCurrency, kind: 'multi', raw };
  }

  // Ranges: "£20–£30", "£20 - 30", "£20 to £30" → the lowest, flagged.
  // Checked before the currency filter below so "£20 - 30" (symbol on
  // one end only) still reads as a range.
  const hasCurrency = toks.some(t => t.currency);
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i], b = toks[i + 1];
    if (hasCurrency && !a.currency && !b.currency) continue;
    const between = text.slice(a.end, b.start);
    if (/^\s*[£$€]?\s*(?:-|–|—|to)\s*[£$€]?\s*$/i.test(between)) {
      const lo = a.value <= b.value ? a : b;
      return { value: round2(lo.value), currency: a.currency || b.currency || anyCurrency, kind: 'from', raw };
    }
  }

  // Prefer numbers that carry a currency: "Model 3 — £45" is £45.
  if (hasCurrency) toks = toks.filter(t => t.currency);

  // "£30 (was £50)" / "Was £50, £30": skip the amount right after "was".
  if (toks.length >= 2) {
    const wasRe = /\bwas\b\s*:?\s*/gi;
    let w;
    const was = new Set();
    while ((w = wasRe.exec(text))) {
      const t = toks.find(x => x.start >= w.index + w[0].length - 1);
      if (t) was.add(t);
    }
    const rest = toks.filter(t => !was.has(t));
    if (rest.length) toks = rest;
  }

  const first = toks[0];
  const kind = /\b(from|starting at|starts at)\b/i.test(text) ? 'from' : 'exact';
  return { value: round2(first.value), currency: first.currency || anyCurrency, kind, raw };
}

// Movement beyond these bounds is a misread ("£33 a month" pay-later
// text, a bundle price), not a real price change. Shared with
// priceMovement so the card and the sweep agree on what to believe.
export const BAD_DROP = 0.9;   // a fall of more than 90%
export const BAD_RISE = 3;     // a rise of more than 300%

/** True when going from `base` to `next` is too big a jump to believe. */
export function isSuspectMove(base, next) {
  if (!(base > 0) || next == null || !Number.isFinite(next)) return false;
  const r = (next - base) / base;
  return r < -BAD_DROP || r > BAD_RISE;
}

/**
 * Everything the page needs to know about one item's price.
 *
 * `value`/`currency`/`kind`/`raw` come from the user's own text.
 * `now` is the last price the sweep checked (`item.livePrice`, written
 * since the sweep stopped overwriting `price`), or null when there isn't
 * one — and null too when it is a believable misread against the
 * typed price, so the card never says "Now £3" beside "£300".
 */
export function itemPrice(item) {
  const typed = parsePrice(item?.price);
  const lp = item?.livePrice;
  let now = null;
  if (lp && typeof lp.p === 'number' && Number.isFinite(lp.p)) {
    const cur = lp.c || 'GBP';
    const sameCur = !typed.currency || typed.currency === cur;
    const suspect = sameCur && typed.value > 0 && isSuspectMove(typed.value, lp.p);
    if (!suspect) now = { value: lp.p, at: lp.at || null, currency: cur };
  }
  return { ...typed, now };
}

/**
 * The number to total and sort by: the typed price, or — when the text
 * has no readable price at all — the checked one. That second case is
 * an item added from a link with the price box left empty; the old
 * sweep filled `price` in for those, and it no longer writes `price`.
 */
export function effectivePrice(item) {
  const p = itemPrice(item);
  if (p.value != null) return { value: p.value, currency: p.currency };
  if (p.now) return { value: p.now.value, currency: p.now.currency };
  return { value: null, currency: null };
}

/**
 * Totals for a set of items.
 *
 *   sum            pounds only (text with no symbol counts as pounds)
 *   count          items considered
 *   priced         items that went into `sum`
 *   unpriced       items with no readable price
 *   otherCurrency  items priced in $ or € — counted, never added to £
 *
 * count === priced + unpriced + otherCurrency.
 */
export function totalsFor(items) {
  let sum = 0, count = 0, priced = 0, unpriced = 0, otherCurrency = 0;
  for (const it of items || []) {
    if (!it) continue;
    count++;
    const { value, currency } = effectivePrice(it);
    if (value == null) { unpriced++; continue; }
    if (currency && currency !== 'GBP') { otherCurrency++; continue; }
    sum += value;
    priced++;
  }
  return { sum: round2(sum), count, priced, unpriced, otherCurrency };
}

/**
 * '£12,854.20', '£1,299', '-£5.50'. Pennies show when they matter;
 * `{ pence: 'always' }` or `{ pence: 'never' }` forces either way.
 * Returns '' for a missing or non-finite number.
 */
export function fmtGBP(n, { pence = 'auto' } = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  const abs = Math.abs(v);
  const show = pence === 'always' || (pence === 'auto' && Math.abs(round2(abs) % 1) > 0.001);
  const body = (pence === 'never' ? Math.round(abs) : abs).toLocaleString('en-GB', {
    minimumFractionDigits: show ? 2 : 0,
    maximumFractionDigits: show ? 2 : 0,
  });
  return (v < 0 ? '-£' : '£') + body;
}

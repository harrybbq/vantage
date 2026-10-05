/**
 * Money for Books — integer pence everywhere, never floats in storage.
 *
 *   toPence(input)  → integer | null
 *       '£1,234.56' → 123456   '1234.56' → 123456   '-12' → -1200
 *       12.5 → 1250            '(12.00)' → -1200 (accounting negative)
 *       '12.00 DR' → -1200     '12.00 CR' → 1200    '−£3' → -300
 *       junk / empty / non-finite → null
 *     Strings are parsed digit-by-digit (no float maths), rounding half away
 *     from zero at the third decimal. A comma is a thousands separator
 *     (UK/US style); '1.234,56' continental notation is NOT guessed — it
 *     returns null rather than a wrong number.
 *   fmtGBP(pence)   → '£1,234.56'; negative → '−£12.00' (U+2212 minus);
 *                     not a number → '—'
 *   fmtMoney(pence, currency) → '$12.00' / '€3.50' / '12.00 SEK'
 *   fromPence(pence) → '1234.56' (plain, for CSV and inputs)
 *
 * Pure. Tested by books.test.mjs (npm run check:books).
 */

const SYMBOLS = /[£$€¥]|GBP|USD|EUR|JPY|AUD|CAD|CHF|SEK|NOK|DKK/gi;
const MAX_ABS_PENCE = 1e13;   // £100bn — anything bigger is a parsing accident

export function toPence(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // String() of a JS number is its shortest round-trip form (12.5, 0.1),
    // so parsing that string avoids 0.1 * 100 = 10.000000000000002.
    const s = String(input);
    if (/e/i.test(s)) {
      const v = Math.round(input * 100);
      return Number.isSafeInteger(v) && Math.abs(v) <= MAX_ABS_PENCE ? v : null;
    }
    return parseDecimal(s);
  }
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;

  let negative = false;
  // Accounting brackets: (12.00)
  const br = s.match(/^\((.*)\)$/);
  if (br) { negative = true; s = br[1].trim(); }
  // Bank suffixes: 12.00 DR / 12.00 CR
  const drcr = s.match(/^(.*?)\s*(DR|CR)\.?$/i);
  if (drcr) { if (drcr[2].toUpperCase() === 'DR') negative = !negative; s = drcr[1].trim(); }

  s = s.replace(SYMBOLS, '').replace(/[\s\u00a0\u202f]/g, '');
  // Any minus sign: ASCII hyphen, U+2212, en dash; leading or trailing.
  const minus = /^[-\u2212\u2013]|[-\u2212\u2013]$/;
  if (minus.test(s)) {
    negative = !negative;
    s = s.replace(minus, '');
    if (minus.test(s)) return null;   // '--12'
  }
  if (s.startsWith('+')) s = s.slice(1);
  // Thousands separators must be well-formed: 1,234,567.89
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  const v = parseDecimal(s);
  if (v == null) return null;
  return negative ? (v === 0 ? 0 : -v) : v;
}

/** '1234.567' → 123457 (half away from zero). Signless input only, plus a leading '-' from numbers. */
function parseDecimal(s) {
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const m = s.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1] || '0';
  const frac = (m[2] || '');
  const two = (frac + '00').slice(0, 2);
  let v = Number(whole) * 100 + Number(two);
  if (frac.length > 2 && Number(frac[2]) >= 5) v += 1;
  if (!Number.isSafeInteger(v) || v > MAX_ABS_PENCE) return null;
  return neg ? (v === 0 ? 0 : -v) : v;
}

const groupThousands = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Plain decimal string for CSV/inputs: 123456 → '1234.56', -5 → '-0.05'. */
export function fromPence(pence) {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '';
  const p = Math.round(pence);
  const abs = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function fmtGBP(pence) {
  return fmtMoney(pence, 'GBP');
}

const PREFIX = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' };

export function fmtMoney(pence, currency = 'GBP') {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '—';
  const p = Math.round(pence);
  const abs = Math.abs(p);
  const body = `${groupThousands(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}`;
  const cur = String(currency || 'GBP').toUpperCase();
  const sign = p < 0 ? '\u2212' : '';
  return PREFIX[cur] ? `${sign}${PREFIX[cur]}${body}` : `${sign}${body} ${cur}`;
}

/** Whole pounds for tiles: 124000 → '£1,240'. */
export function fmtGBPShort(pence) {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '—';
  const pounds = Math.round(pence / 100);
  return `${pounds < 0 ? '\u2212' : ''}£${groupThousands(String(Math.abs(pounds)))}`;
}

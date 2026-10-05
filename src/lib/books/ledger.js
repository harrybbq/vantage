/**
 * Ledger entries — the one shape every Books screen, importer and the
 * server agree on.
 *
 *   normaliseEntry(e) → entry   trims, defaults and derives; returns ONLY
 *                               the known fields (a projection, never a spread)
 *   validateEntry(e)  → { ok, errors:{ field: message } }
 *                               validates normaliseEntry(e)
 *   isIsoDate(s)      → boolean real calendar date 'YYYY-MM-DD'
 *
 * Entry fields (= books_entries columns, supabase/books_2026_10.sql):
 *   id?           uuid (only when editing / round-tripping an export)
 *   occurred_on   'YYYY-MM-DD'
 *   kind          'income' | 'expense' | 'transfer'
 *   category      an id from CATEGORIES[kind]
 *   amount_pence  integer > 0, in `currency` (the direction is the kind)
 *   currency      ISO 4217, default 'GBP'
 *   fx_rate       GBP per 1 unit of currency; null for GBP
 *   gbp_pence     the GBP value reports use (= amount_pence for GBP)
 *   vat_pence     null or 0..amount_pence (same currency as amount)
 *   counterparty, description, note   free text (≤ 120 / 300 / 1000)
 *   source        'manual' | 'bank_csv' | 'apple' | 'google' | 'recurring'
 *                 ('revenuecat' exists in the schema but is refused here:
 *                 RevenueCat figures are information only, never booked —
 *                 income comes from store reports / bank)
 *   source_ref    stable id within the source; required for every source
 *                 but 'manual'; [A-Za-z0-9:._-]{1,200}
 *
 * Convenience inputs normaliseEntry accepts: `amount` (a money string,
 * via toPence) when amount_pence is absent; `vat` likewise.
 *
 * The server validates with a CommonJS copy (netlify/lib/booksCore.js);
 * books.test.mjs runs both over the same cases and asserts they agree.
 *
 * Pure. Tested by books.test.mjs (npm run check:books).
 */
import { toPence } from './money.js';
import { isCategory } from './categories.js';

export const KINDS = ['income', 'expense', 'transfer'];
export const SOURCES = ['manual', 'bank_csv', 'apple', 'google', 'revenuecat', 'recurring'];
export const BOOKABLE_SOURCES = SOURCES.filter(s => s !== 'revenuecat');
export const MAX_PENCE = 1e13;
export const LIMITS = { counterparty: 120, description: 300, note: 1000, source_ref: 200 };
const REF_RE = /^[A-Za-z0-9:._-]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function toIsoDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
  return m ? m[1] : s || null;
}

const text = (v, max) => {
  if (v == null) return null;
  // Drop control characters except tab/newline (no-control-regex forbids the literal class).
  const s = Array.from(String(v)).filter(ch => {
    const c = ch.charCodeAt(0);
    return c >= 32 || c === 9 || c === 10 || c === 13;
  }).join('').trim();
  return s ? s.slice(0, max) : null;
};

const intOrNull = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : NaN;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
};

const numOrNull = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : NaN;
};

export function normaliseEntry(e = {}) {
  const src = e && typeof e === 'object' ? e : {};
  const currency = (text(src.currency, 10) || 'GBP').toUpperCase();
  let amount = intOrNull(src.amount_pence);
  if (amount == null && src.amount != null) amount = toPence(src.amount) ?? NaN;
  let vat = intOrNull(src.vat_pence);
  if (vat == null && src.vat != null && src.vat !== '') vat = toPence(src.vat) ?? NaN;

  let fx = currency === 'GBP' ? null : numOrNull(src.fx_rate);
  let gbp = intOrNull(src.gbp_pence);
  if (currency === 'GBP') gbp = amount;
  else if (gbp == null && typeof fx === 'number' && fx > 0 && Number.isFinite(amount)) gbp = Math.round(amount * fx);

  const out = {
    occurred_on: toIsoDate(src.occurred_on),
    kind: text(src.kind, 20)?.toLowerCase() || null,
    category: text(src.category, 40)?.toLowerCase() || null,
    amount_pence: amount,
    currency,
    fx_rate: fx,
    gbp_pence: gbp,
    vat_pence: vat,
    counterparty: text(src.counterparty, LIMITS.counterparty),
    description: text(src.description, LIMITS.description),
    source: text(src.source, 20)?.toLowerCase() || 'manual',
    source_ref: text(src.source_ref, 400),
    note: text(src.note, LIMITS.note),
  };
  if (typeof src.id === 'string' && UUID_RE.test(src.id)) out.id = src.id.toLowerCase();
  return out;
}

export function validateEntry(input) {
  const e = normaliseEntry(input);
  const errors = {};
  if (!isIsoDate(e.occurred_on)) errors.occurred_on = 'Enter a date (YYYY-MM-DD).';
  else {
    const y = Number(e.occurred_on.slice(0, 4));
    if (y < 2000 || y > 2100) errors.occurred_on = 'Date must be between 2000 and 2100.';
  }
  if (!KINDS.includes(e.kind)) errors.kind = 'Choose income, expense or transfer.';
  else if (!isCategory(e.kind, e.category)) errors.category = 'Choose a category.';

  if (!Number.isSafeInteger(e.amount_pence)) errors.amount_pence = 'Enter an amount.';
  else if (e.amount_pence <= 0) errors.amount_pence = 'Amount must be more than zero.';
  else if (e.amount_pence > MAX_PENCE) errors.amount_pence = 'Amount is too large.';

  if (!/^[A-Z]{3}$/.test(e.currency)) errors.currency = 'Currency must be a 3-letter code.';
  else if (e.currency !== 'GBP') {
    if (e.fx_rate != null && !(typeof e.fx_rate === 'number' && e.fx_rate > 0 && e.fx_rate < 10000)) {
      errors.fx_rate = 'Exchange rate must be a positive number.';
    }
    if (!Number.isSafeInteger(e.gbp_pence) || e.gbp_pence < 0) {
      errors.gbp_pence = 'Enter the GBP value (or an exchange rate).';
    } else if (e.gbp_pence > MAX_PENCE) errors.gbp_pence = 'GBP value is too large.';
  }

  if (e.vat_pence != null) {
    if (!Number.isSafeInteger(e.vat_pence) || e.vat_pence < 0) errors.vat_pence = 'VAT must be zero or more.';
    else if (Number.isSafeInteger(e.amount_pence) && e.vat_pence > e.amount_pence) errors.vat_pence = 'VAT cannot exceed the amount.';
  }

  if (!SOURCES.includes(e.source)) errors.source = 'Unknown source.';
  else if (e.source === 'revenuecat') errors.source = 'RevenueCat figures are information only and are never booked.';

  if (e.source_ref != null && !REF_RE.test(e.source_ref)) errors.source_ref = 'Reference has unsupported characters.';
  else if (e.source_ref == null && e.source !== 'manual' && SOURCES.includes(e.source)) errors.source_ref = 'Imported entries need a reference.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** The fields an edit may change (identity — id, source, source_ref — is fixed). */
export const EDITABLE = ['occurred_on', 'kind', 'category', 'amount_pence', 'currency', 'fx_rate', 'gbp_pence', 'vat_pence', 'counterparty', 'description', 'note'];

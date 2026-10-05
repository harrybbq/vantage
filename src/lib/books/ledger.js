// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's ledger.js.
import { toPence } from './money.js';
import { isCategory } from './categories.js';

export const KINDS = ['income', 'expense', 'transfer'];
export const SOURCES = ['manual', 'bank_csv', 'apple', 'google', 'revenuecat', 'recurring'];
export const BOOKABLE_SOURCES = SOURCES.filter(s => s !== 'revenuecat');
export const MAX_PENCE = 1e13;
export const LIMITS = { counterparty: 120, description: 300, note: 1000, source_ref: 200 };
export const EDITABLE = ['occurred_on', 'kind', 'category', 'amount_pence', 'currency', 'fx_rate', 'gbp_pence', 'vat_pence', 'counterparty', 'description', 'note'];

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const txt = (v, max) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
const int = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

export function normaliseEntry(e = {}) {
  const src = e && typeof e === 'object' ? e : {};
  const currency = (txt(src.currency, 10) || 'GBP').toUpperCase();
  let amount = int(src.amount_pence);
  if (amount == null && src.amount != null) amount = toPence(src.amount) ?? NaN;
  const fx = currency === 'GBP' ? null : (src.fx_rate == null || src.fx_rate === '' ? null : Number(src.fx_rate));
  let gbp = int(src.gbp_pence);
  if (currency === 'GBP') gbp = amount;
  else if (gbp == null && fx > 0 && Number.isFinite(amount)) gbp = Math.round(amount * fx);
  const out = {
    occurred_on: txt(src.occurred_on, 10), kind: txt(src.kind, 20)?.toLowerCase() || null,
    category: txt(src.category, 40)?.toLowerCase() || null, amount_pence: amount, currency, fx_rate: fx,
    gbp_pence: gbp, vat_pence: int(src.vat_pence), counterparty: txt(src.counterparty, LIMITS.counterparty),
    description: txt(src.description, LIMITS.description), source: txt(src.source, 20)?.toLowerCase() || 'manual',
    source_ref: txt(src.source_ref, 400), note: txt(src.note, LIMITS.note),
  };
  if (typeof src.id === 'string' && /^[0-9a-f-]{36}$/i.test(src.id)) out.id = src.id.toLowerCase();
  return out;
}

export function validateEntry(input) {
  const e = normaliseEntry(input);
  const errors = {};
  if (!isIsoDate(e.occurred_on)) errors.occurred_on = 'Enter a date (YYYY-MM-DD).';
  if (!KINDS.includes(e.kind)) errors.kind = 'Choose income, expense or transfer.';
  else if (!isCategory(e.kind, e.category)) errors.category = 'Choose a category.';
  if (!Number.isSafeInteger(e.amount_pence)) errors.amount_pence = 'Enter an amount.';
  else if (e.amount_pence <= 0) errors.amount_pence = 'Amount must be more than zero.';
  if (!/^[A-Z]{3}$/.test(e.currency)) errors.currency = 'Currency must be a 3-letter code.';
  else if (e.currency !== 'GBP' && !Number.isSafeInteger(e.gbp_pence)) errors.gbp_pence = 'Enter the GBP value (or an exchange rate).';
  if (!SOURCES.includes(e.source) || e.source === 'revenuecat') errors.source = 'Unknown source.';
  else if (e.source !== 'manual' && !e.source_ref) errors.source_ref = 'Imported entries need a reference.';
  return { ok: Object.keys(errors).length === 0, errors };
}

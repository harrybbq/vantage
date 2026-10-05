// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's recurring.js.
import { isIsoDate, MAX_PENCE } from './ledger.js';
import { isCategory } from './categories.js';
import { toPence } from './money.js';

export const CADENCES = ['monthly', 'yearly'];
export const MAX_POSTINGS = 120;
const pad = n => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addCadence(date, cadence, anchorDay) {
  if (!isIsoDate(date)) return null;
  let [y, m, d] = date.split('-').map(Number);
  const anchor = Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d;
  if (cadence === 'yearly') y += 1;
  else if (cadence === 'monthly') { m += 1; if (m > 12) { m = 1; y += 1; } }
  else return null;
  return `${y}-${pad(m)}-${pad(Math.min(anchor, daysIn(y, m)))}`;
}

const int = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
export function normaliseRecurring(r = {}) {
  const s = r && typeof r === 'object' ? r : {};
  const currency = String(s.currency || 'GBP').trim().toUpperCase();
  let amount = int(s.amount_pence);
  if (amount == null && s.amount != null) amount = toPence(s.amount) ?? NaN;
  const next = s.next_due ? String(s.next_due).slice(0, 10) : null;
  let anchor = int(s.anchor_day);
  if (anchor == null && isIsoDate(next)) anchor = Number(next.slice(8, 10));
  const out = {
    name: s.name ? String(s.name).trim().slice(0, 120) || null : null, kind: String(s.kind || 'expense').toLowerCase(),
    category: s.category ? String(s.category).toLowerCase() : null, amount_pence: amount, currency,
    gbp_pence: currency === 'GBP' ? null : int(s.gbp_pence), cadence: s.cadence ? String(s.cadence).toLowerCase() : null,
    next_due: next, anchor_day: anchor, active: s.active === undefined ? true : s.active === true,
    note: s.note ? String(s.note).trim().slice(0, 1000) || null : null,
  };
  if (typeof s.id === 'string' && /^[0-9a-f-]{36}$/i.test(s.id)) out.id = s.id.toLowerCase();
  return out;
}

export function validateRecurring(input) {
  const r = normaliseRecurring(input);
  const errors = {};
  if (!r.name) errors.name = 'Give the bill a name.';
  if (r.kind !== 'income' && r.kind !== 'expense') errors.kind = 'A bill is income or an expense.';
  else if (!isCategory(r.kind, r.category)) errors.category = 'Choose a category.';
  if (!Number.isSafeInteger(r.amount_pence) || r.amount_pence <= 0) errors.amount_pence = 'Amount must be more than zero.';
  else if (r.amount_pence > MAX_PENCE) errors.amount_pence = 'Amount is too large.';
  if (r.currency !== 'GBP' && (!Number.isSafeInteger(r.gbp_pence) || r.gbp_pence <= 0)) errors.gbp_pence = 'Enter the GBP value to post.';
  if (!CADENCES.includes(r.cadence)) errors.cadence = 'Monthly or yearly.';
  if (!isIsoDate(r.next_due)) errors.next_due = 'Enter the next due date (YYYY-MM-DD).';
  return { ok: Object.keys(errors).length === 0, errors };
}

export function postingsFor(bill, upTo) {
  const r = normaliseRecurring(bill);
  if (!r.active || !r.id || !isIsoDate(r.next_due) || !isIsoDate(upTo)) return { entries: [], nextDue: r.next_due };
  const entries = [];
  let due = r.next_due;
  while (due && due <= upTo && entries.length < MAX_POSTINGS) {
    entries.push({
      occurred_on: due, kind: r.kind, category: r.category, amount_pence: r.amount_pence, currency: r.currency, fx_rate: null,
      gbp_pence: r.currency === 'GBP' ? r.amount_pence : r.gbp_pence, vat_pence: null, counterparty: null,
      description: r.name, source: 'recurring', source_ref: `recurring:${r.id}:${due}`, note: null,
    });
    due = addCadence(due, r.cadence, r.anchor_day);
  }
  return { entries, nextDue: due };
}

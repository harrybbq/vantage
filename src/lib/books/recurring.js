/**
 * Recurring bills — monthly or yearly, posted into the ledger on demand.
 *
 *   normaliseRecurring(r) → bill        projection of the known fields
 *   validateRecurring(r)  → { ok, errors }
 *   addCadence(date, cadence, anchorDay?) → next 'YYYY-MM-DD'
 *       A bill anchored on the 31st falls on the last day of shorter
 *       months and returns to the 31st after (anchorDay keeps it from
 *       drifting to the 28th forever). Yearly 29 Feb → 28 Feb in common
 *       years, back to 29 Feb in leap years.
 *   postingsFor(bill, upTo) → { entries, nextDue }
 *       every due date ≤ upTo as a ledger entry (source 'recurring',
 *       source_ref 'recurring:<id>:<date>' — so posting twice inserts
 *       nothing new: the ref is the de-dup key), plus the bill's new
 *       next_due. Inactive bills post nothing. Capped at 120 postings.
 *
 * Bill fields (= books_recurring columns): id, name, kind ('income' |
 * 'expense'), category, amount_pence, currency, gbp_pence (needed when
 * currency ≠ GBP), cadence ('monthly' | 'yearly'), next_due, anchor_day,
 * active, note.
 *
 * Mirrored server-side in netlify/lib/booksCore.js (parity-tested).
 * Pure. Tested by books.test.mjs (npm run check:books).
 */
import { isIsoDate, MAX_PENCE } from './ledger.js';
import { isCategory } from './categories.js';
import { toPence } from './money.js';

export const CADENCES = ['monthly', 'yearly'];
export const MAX_POSTINGS = 120;

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based
const pad = n => String(n).padStart(2, '0');

export function addCadence(date, cadence, anchorDay) {
  if (!isIsoDate(date)) return null;
  let [y, m, d] = date.split('-').map(Number);
  const anchor = Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d;
  if (cadence === 'yearly') y += 1;
  else if (cadence === 'monthly') { m += 1; if (m > 12) { m = 1; y += 1; } }
  else return null;
  return `${y}-${pad(m)}-${pad(Math.min(anchor, daysIn(y, m)))}`;
}

const str = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const int = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : NaN;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return NaN;
};

export function normaliseRecurring(r = {}) {
  const src = r && typeof r === 'object' ? r : {};
  const currency = (str(src.currency, 10) || 'GBP').toUpperCase();
  let amount = int(src.amount_pence);
  if (amount == null && src.amount != null) amount = toPence(src.amount) ?? NaN;
  const nextDue = str(src.next_due, 10);
  let anchor = int(src.anchor_day);
  if (anchor == null && isIsoDate(nextDue)) anchor = Number(nextDue.slice(8, 10));
  const out = {
    name: str(src.name, 120),
    kind: (str(src.kind, 20) || 'expense').toLowerCase(),
    category: str(src.category, 40)?.toLowerCase() || null,
    amount_pence: amount,
    currency,
    gbp_pence: currency === 'GBP' ? null : int(src.gbp_pence),
    cadence: (str(src.cadence, 10) || '').toLowerCase() || null,
    next_due: nextDue,
    anchor_day: anchor,
    active: src.active === undefined ? true : src.active === true,
    note: str(src.note, 1000),
  };
  if (typeof src.id === 'string' && /^[0-9a-f-]{36}$/i.test(src.id)) out.id = src.id.toLowerCase();
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
  if (!/^[A-Z]{3}$/.test(r.currency)) errors.currency = 'Currency must be a 3-letter code.';
  else if (r.currency !== 'GBP' && (!Number.isSafeInteger(r.gbp_pence) || r.gbp_pence <= 0)) {
    errors.gbp_pence = 'Enter the GBP value to post.';
  }
  if (!CADENCES.includes(r.cadence)) errors.cadence = 'Monthly or yearly.';
  if (!isIsoDate(r.next_due)) errors.next_due = 'Enter the next due date (YYYY-MM-DD).';
  if (r.anchor_day != null && !(Number.isInteger(r.anchor_day) && r.anchor_day >= 1 && r.anchor_day <= 31)) {
    errors.anchor_day = 'Day of month must be 1\u201331.';
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function postingsFor(bill, upTo) {
  const r = normaliseRecurring(bill);
  if (!r.active || !r.id || !isIsoDate(r.next_due) || !isIsoDate(upTo) || !CADENCES.includes(r.cadence)) {
    return { entries: [], nextDue: r.next_due };
  }
  const entries = [];
  let due = r.next_due;
  while (due && due <= upTo && entries.length < MAX_POSTINGS) {
    entries.push({
      occurred_on: due,
      kind: r.kind,
      category: r.category,
      amount_pence: r.amount_pence,
      currency: r.currency,
      fx_rate: null,
      gbp_pence: r.currency === 'GBP' ? r.amount_pence : r.gbp_pence,
      vat_pence: null,
      counterparty: null,
      description: r.name,
      source: 'recurring',
      source_ref: `recurring:${r.id}:${due}`,
      note: null,
    });
    due = addCadence(due, r.cadence, r.anchor_day);
  }
  return { entries, nextDue: due };
}

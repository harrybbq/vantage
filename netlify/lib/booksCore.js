/**
 * Books — the server's copy of the pure rules (CommonJS).
 *
 * netlify/functions/books.js validates every write with the SAME rules the
 * client uses, but cannot import the ES modules in src/lib/books/. This is
 * the mirror, kept line-for-line close to:
 *   money.js       toPence, fromPence
 *   categories.js  category ids (CATEGORY_IDS)
 *   ledger.js      normaliseEntry, validateEntry, isIsoDate
 *   recurring.js   normaliseRecurring, validateRecurring, addCadence, postingsFor
 *   importers.js   NATIVE_HEADERS, toCsv, nativeCsv (the export)
 * src/lib/books/books.test.mjs (npm run check:books) runs both copies over
 * the same cases — including a generated batch — and fails on any
 * difference, so they cannot drift apart silently.
 *
 * Server-only here: planImport (preview/commit de-dup), validatePrefs,
 * shapeRevenueCatOverview.
 *
 * Pure: no fetch, no env.
 */

// ── money.js ─────────────────────────────────────────────────────────

const SYMBOLS = /[£$€¥]|GBP|USD|EUR|JPY|AUD|CAD|CHF|SEK|NOK|DKK/gi;
const MAX_ABS_PENCE = 1e13;

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

function toPence(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
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
  const br = s.match(/^\((.*)\)$/);
  if (br) { negative = true; s = br[1].trim(); }
  const drcr = s.match(/^(.*?)\s*(DR|CR)\.?$/i);
  if (drcr) { if (drcr[2].toUpperCase() === 'DR') negative = !negative; s = drcr[1].trim(); }
  s = s.replace(SYMBOLS, '').replace(/[\s\u00a0\u202f]/g, '');
  const minus = /^[-\u2212\u2013]|[-\u2212\u2013]$/;
  if (minus.test(s)) {
    negative = !negative;
    s = s.replace(minus, '');
    if (minus.test(s)) return null;
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  const v = parseDecimal(s);
  if (v == null) return null;
  return negative ? (v === 0 ? 0 : -v) : v;
}

function fromPence(pence) {
  if (typeof pence !== 'number' || !Number.isFinite(pence)) return '';
  const p = Math.round(pence);
  const abs = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ── categories.js ────────────────────────────────────────────────────

const CATEGORY_IDS = {
  income: ['app-store', 'google-play', 'web', 'other-income'],
  expense: ['hosting', 'software', 'store-fees', 'refunds', 'professional', 'bank', 'equipment', 'marketing', 'travel', 'office', 'subscriptions', 'other'],
  transfer: ['store-payout', 'between-accounts', 'other-transfer'],
};
const isCategory = (kind, id) => !!(CATEGORY_IDS[kind] && CATEGORY_IDS[kind].includes(id));

// ── ledger.js ────────────────────────────────────────────────────────

const KINDS = ['income', 'expense', 'transfer'];
const SOURCES = ['manual', 'bank_csv', 'apple', 'google', 'revenuecat', 'recurring'];
const BOOKABLE_SOURCES = SOURCES.filter(s => s !== 'revenuecat');
const MAX_PENCE = 1e13;
const LIMITS = { counterparty: 120, description: 300, note: 1000, source_ref: 200 };
const REF_RE = /^[A-Za-z0-9:._-]{1,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = ['occurred_on', 'kind', 'category', 'amount_pence', 'currency', 'fx_rate', 'gbp_pence', 'vat_pence', 'counterparty', 'description', 'note'];

function isIsoDate(s) {
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

function normaliseEntry(e = {}) {
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

function validateEntry(input) {
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

// ── recurring.js ─────────────────────────────────────────────────────

const CADENCES = ['monthly', 'yearly'];
const MAX_POSTINGS = 120;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = n => String(n).padStart(2, '0');

function addCadence(date, cadence, anchorDay) {
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

function normaliseRecurring(r = {}) {
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

function validateRecurring(input) {
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

function postingsFor(bill, upTo) {
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

// ── importers.js (export side) ───────────────────────────────────────

const NATIVE_HEADERS = ['Date', 'Kind', 'Category', 'Amount', 'Currency', 'FX rate', 'GBP amount', 'VAT', 'Counterparty', 'Description', 'Source', 'Source ref', 'Note', 'ID'];

const guard = s => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);

function cell(v) {
  const s = guard(v == null ? '' : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function nativeRow(e) {
  return [
    e.occurred_on, e.kind, e.category, fromPence(e.amount_pence), e.currency || 'GBP',
    e.fx_rate == null ? '' : String(e.fx_rate), fromPence(e.gbp_pence),
    e.vat_pence == null ? '' : fromPence(e.vat_pence),
    e.counterparty || '', e.description || '', e.source || 'manual', e.source_ref || '', e.note || '', e.id || '',
  ];
}

function nativeCsv(entries) {
  return toCsv([NATIVE_HEADERS, ...(Array.isArray(entries) ? entries : []).map(nativeRow)]);
}

// ── Server only ──────────────────────────────────────────────────────

/** Which import formats may carry which entry sources. */
const IMPORT_SOURCES = {
  'bank-generic': ['bank_csv'],
  'apple-financial': ['apple'],
  'google-earnings': ['google'],
  'books-native': BOOKABLE_SOURCES,
};
const IMPORT_FORMATS = Object.keys(IMPORT_SOURCES);
const MAX_IMPORT_ROWS = 2000;

/**
 * Split an import batch into what would be added, what is already there,
 * and what is invalid. No I/O: `existing` is { refs:Set<'source|ref'>,
 * ids:Set<uuid> } read by the caller for the batch's refs and ids.
 *   → { add:[entry…], duplicates:[{ row, source_ref, reason }], invalid:[{ row, reason, errors? }] }
 * `row` is the client's row number when it sent one, else the 1-based
 * index in the batch. Duplicates WITHIN the batch count as duplicates too.
 */
function planImport(format, rows, existing = {}) {
  const add = []; const duplicates = []; const invalid = [];
  const allowed = IMPORT_SOURCES[format];
  if (!allowed) return { add, duplicates, invalid: [{ row: 0, reason: 'unknown import format' }] };
  const refs = existing.refs instanceof Set ? existing.refs : new Set();
  const ids = existing.ids instanceof Set ? existing.ids : new Set();
  const seenRefs = new Set(); const seenIds = new Set();
  (Array.isArray(rows) ? rows : []).slice(0, MAX_IMPORT_ROWS).forEach((raw, i) => {
    const row = raw && Number.isInteger(raw.row) && raw.row > 0 ? raw.row : i + 1;
    const e = normaliseEntry(raw);
    const v = validateEntry(e);
    if (!v.ok) { invalid.push({ row, reason: Object.values(v.errors)[0], errors: v.errors }); return; }
    if (!allowed.includes(e.source)) { invalid.push({ row, reason: `A ${format} import cannot carry source "${e.source}".` }); return; }
    if (!e.source_ref) { invalid.push({ row, reason: 'Imported entries need a reference.' }); return; }
    const key = `${e.source}|${e.source_ref}`;
    if (refs.has(key) || (e.id && ids.has(e.id))) { duplicates.push({ row, source_ref: e.source_ref, reason: 'Already in the books' }); return; }
    if (seenRefs.has(key) || (e.id && seenIds.has(e.id))) { duplicates.push({ row, source_ref: e.source_ref, reason: 'Repeated in this file' }); return; }
    seenRefs.add(key);
    if (e.id) seenIds.add(e.id);
    add.push({ ...e, row });
  });
  return { add, duplicates, invalid };
}

/** books_config keys and their validators. Only 'prefs' today. */
const VIEWS = ['month', 'last-month', 'year', 'last-year', 'ytd'];
function validatePrefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'prefs must be an object' };
  const out = {};
  if (value.defaultCurrency != null) {
    const c = String(value.defaultCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return { ok: false, error: 'defaultCurrency must be a 3-letter code' };
    out.defaultCurrency = c;
  }
  if (value.defaultView != null) {
    if (!VIEWS.includes(value.defaultView)) return { ok: false, error: `defaultView must be one of ${VIEWS.join(', ')}` };
    out.defaultView = value.defaultView;
  }
  if (value.fx != null) {
    if (typeof value.fx !== 'object' || Array.isArray(value.fx)) return { ok: false, error: 'fx must be an object' };
    const fx = {};
    for (const [k, v] of Object.entries(value.fx).slice(0, 30)) {
      const n = Number(v);
      if (!/^[A-Z]{3}$/.test(k) || !(n > 0 && n < 10000)) return { ok: false, error: `fx.${k} must be a positive rate` };
      fx[k] = n;
    }
    out.fx = fx;
  }
  return { ok: true, value: out };
}
const CONFIG_KEYS = { prefs: validatePrefs };

/**
 * RevenueCat GET /v2/projects/{id}/metrics/overview → { mrr,
 * activeSubscriptions, activeTrials, revenue28d, currency }.
 *
 * The response shape is UNVERIFIED (RevenueCat's docs were not reachable
 * from the build container; third-party write-ups disagree): it is read
 * tolerantly from any of
 *   { metrics:[{ id, value, unit? }] }   (RevenueCat-style list)
 *   { items:[{ id, value }] }
 *   { mrr, active_subscriptions, active_trials, revenue_last_28_days }
 * with ids 'mrr', 'active_subscriptions', 'active_trials', 'revenue'
 * (or 'revenue_last_28_days'). Money values are in major units of the
 * requested currency, returned here as numbers (not pence) — this is a
 * live INFORMATION tile only, never booked.
 */
function shapeRevenueCatOverview(body, currency = 'GBP') {
  if (!body || typeof body !== 'object') return null;
  const list = Array.isArray(body.metrics) ? body.metrics : Array.isArray(body.items) ? body.items : null;
  const byId = {};
  if (list) for (const m of list) if (m && typeof m.id === 'string') byId[m.id] = m.value;
  const pick = (...keys) => {
    for (const k of keys) {
      const v = list ? byId[k] : body[k];
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const out = {
    mrr: pick('mrr'),
    activeSubscriptions: pick('active_subscriptions', 'activeSubscriptions'),
    activeTrials: pick('active_trials', 'activeTrials'),
    revenue28d: pick('revenue', 'revenue_last_28_days', 'revenue28d'),
    currency,
  };
  return out.mrr == null && out.activeSubscriptions == null && out.activeTrials == null && out.revenue28d == null ? null : out;
}

module.exports = {
  toPence, fromPence,
  CATEGORY_IDS, isCategory,
  KINDS, SOURCES, BOOKABLE_SOURCES, MAX_PENCE, LIMITS, EDITABLE,
  isIsoDate, normaliseEntry, validateEntry,
  CADENCES, MAX_POSTINGS, addCadence, normaliseRecurring, validateRecurring, postingsFor,
  NATIVE_HEADERS, toCsv, nativeRow, nativeCsv,
  IMPORT_SOURCES, IMPORT_FORMATS, MAX_IMPORT_ROWS, planImport,
  CONFIG_KEYS, validatePrefs, shapeRevenueCatOverview,
};

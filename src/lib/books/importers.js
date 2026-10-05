/**
 * Tolerant CSV import for Books, and Books' own CSV export format.
 *
 *   parseCsv(text, { delimiter? }) → string[][]
 *       RFC 4180: quoted fields, "" escapes, commas/newlines inside quotes,
 *       CRLF / LF / CR line ends, a UTF-8 BOM. The delimiter is sniffed
 *       from the first lines (comma, semicolon or tab) unless given.
 *       Blank lines are dropped.
 *   detectFormat(headers) → 'bank-generic' | 'apple-financial' |
 *                           'google-earnings' | 'books-native' | null
 *   findHeaderRow(rows) → index of the first row detectFormat recognises
 *       (reports can carry preamble lines), else the first non-empty row
 *   toEntries(format, rows, { mapping, fx, account, dateOrder }) →
 *       { entries, invalid:[{ row, reason }], skipped, format, headers }
 *       rows: parseCsv output (header row found automatically) or objects
 *       keyed by header. `row` numbers are 1-based lines of the file.
 *       Each entry is a ledger entry (ledger.js) plus UI-only fields that
 *       the server ignores: `row`, `confidence` ('high'|'medium'|'low'),
 *       `needs_fx` (true when a non-GBP amount has no rate yet — the UI
 *       must fill gbp_pence or fx_rate, e.g. with applyFx, before commit).
 *     · mapping — the manual path for files that are not recognised:
 *       { date, description, amount } or { date, description, moneyIn,
 *       moneyOut }, optional currency; values are header names. With a
 *       mapping, the file is read as bank-generic whatever was detected.
 *     · fx — { USD: 0.79, EUR: 0.85 }: GBP per 1 unit of that currency.
 *     · account — optional label folded into bank refs, so two accounts
 *       with identical lines on the same day don't collide.
 *     · dateOrder — 'dmy' (default; UK banks) or 'mdy'. Apple files are
 *       always read month-first.
 *   applyFx(entries, fx) → entries with gbp_pence / fx_rate filled where
 *       a rate is now known
 *   source_ref — stable across re-imports of the same lines: a hash of the
 *       line's identifying fields plus its running index among IDENTICAL
 *       lines in the same file (two £4.99 coffees on one day stay two).
 *       Overlapping exports therefore de-duplicate against each other.
 *   NATIVE_HEADERS, toCsv(rows), nativeCsv(entries) — Books' export (the
 *       accountant's CSV, also re-importable as 'books-native'). Cells that
 *       a spreadsheet would run as a formula (= + - @ at the start of text)
 *       are prefixed with ' and the importer strips it again.
 *
 * ── Formats (UNVERIFIED against real files — from public documentation and
 *    common exports; keep the manual mapping path for anything else) ──
 *   bank-generic: Date + Description + (Amount | Money in/Money out |
 *     Paid in/Paid out | Credit/Debit). Dates dd/mm/yyyy, dd-mm-yy,
 *     dd.mm.yyyy, '05 Oct 2026', ISO (with or without a time). Amounts like
 *     '-12.50', '£1,234.00', '(12.00)', '12.00 DR'.
 *   apple-financial: App Store Connect "Financial Report" (tab-separated;
 *     columns include Start Date, End Date, Vendor Identifier, Quantity,
 *     Partner Share, Extended Partner Share, Partner Share Currency, Sales or
 *     Return, Apple Identifier, Title, Country Of Sale, Customer Price;
 *     dates MM/DD/YYYY; trailer rows Total_Rows / Total_Amount /
 *     Total_Units). One income 'app-store' entry per row (returns →
 *     expense 'refunds'), dated at the period END, in the Partner Share
 *     Currency.
 *   google-earnings: Play Console "Earnings" report (columns include
 *     Description (the order id), Transaction Date ('Oct 1, 2026'),
 *     Transaction Time, Transaction Type (Charge, Google fee, Charge
 *     refund, Google fee refund, Tax…), Product Title, Product id, Amount
 *     (Merchant Currency), Merchant Currency). Charges → income
 *     'google-play'; Google fees → expense 'store-fees'; charge refunds →
 *     expense 'refunds'.
 *   books-native: NATIVE_HEADERS — this file's own export; round-trips.
 *
 * Pure. Tested by books.test.mjs (npm run check:books).
 */
import { toPence, fromPence } from './money.js';
import { categorise, isCategory } from './categories.js';
import { isIsoDate, BOOKABLE_SOURCES } from './ledger.js';

// ── CSV parsing ──────────────────────────────────────────────────────

function sniffDelimiter(text) {
  const sample = text.slice(0, 4000).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 5);
  const score = d => sample.reduce((n, line) => {
    let inQ = false; let c = 0;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch === d) c++;
    }
    return n + c;
  }, 0);
  const tab = score('\t');
  const semi = score(';');
  const comma = score(',');
  if (tab > 0 && tab >= comma && tab >= semi) return '\t';
  if (semi > comma) return ';';
  return ',';
}

export function parseCsv(text, { delimiter } = {}) {
  if (typeof text !== 'string') return [];
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!s) return [];
  const d = delimiter || sniffDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;
  const n = s.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (row.some(c => c.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < n) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === '') { field = ''; inQ = true; i++; continue; }
    if (ch === d) { endField(); i++; continue; }
    if (ch === '\r') { endRow(); i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// ── Headers ──────────────────────────────────────────────────────────

const norm = h => String(h || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' ');
// For bank aliases only: drop a currency marker — 'Paid in (£)', 'Amount (GBP)'.
const bankNorm = h => norm(h).replace(/\s*\((£|gbp)\)$/, '').replace(/\s*£$/, '').trim();

const BANK = {
  date: ['date', 'transaction date', 'posting date', 'posted date', 'value date', 'completed date', 'booking date', 'date of transaction'],
  description: ['description', 'transaction description', 'details', 'transaction details', 'narrative', 'memo', 'payee', 'name', 'merchant', 'counterparty', 'counter party', 'reference'],
  amount: ['amount', 'value', 'transaction amount', 'amount gbp', 'net amount'],
  pairs: [['money in', 'money out'], ['paid in', 'paid out'], ['credit', 'debit'], ['credit amount', 'debit amount'], ['in', 'out'], ['credits', 'debits']],
  currency: ['currency', 'local currency', 'ccy'],
};

const indexOf = (headers, names, f = bankNorm) => {
  const hs = headers.map(f);
  for (const name of names) {
    const i = hs.indexOf(name);
    if (i !== -1) return i;
  }
  return -1;
};

export const NATIVE_HEADERS = ['Date', 'Kind', 'Category', 'Amount', 'Currency', 'FX rate', 'GBP amount', 'VAT', 'Counterparty', 'Description', 'Source', 'Source ref', 'Note', 'ID'];

function bankColumns(headers) {
  const date = indexOf(headers, BANK.date);
  const description = indexOf(headers, BANK.description);
  const amount = indexOf(headers, BANK.amount);
  let moneyIn = -1; let moneyOut = -1;
  for (const [a, b] of BANK.pairs) {
    const ia = indexOf(headers, [a]); const ib = indexOf(headers, [b]);
    if (ia !== -1 && ib !== -1) { moneyIn = ia; moneyOut = ib; break; }
  }
  return { date, description, amount, moneyIn, moneyOut, currency: indexOf(headers, BANK.currency) };
}

export function detectFormat(headers) {
  if (!Array.isArray(headers) || !headers.length) return null;
  const hs = headers.map(norm);
  const has = h => hs.includes(h);
  if (has('kind') && has('gbp amount') && has('source ref') && has('date')) return 'books-native';
  if (has('vendor identifier') && has('partner share currency') && (has('extended partner share') || has('partner share'))) return 'apple-financial';
  if (has('transaction type') && has('amount (merchant currency)') && has('transaction date')) return 'google-earnings';
  const c = bankColumns(headers);
  if (c.date !== -1 && c.description !== -1 && (c.amount !== -1 || (c.moneyIn !== -1 && c.moneyOut !== -1))) return 'bank-generic';
  return null;
}

export function findHeaderRow(rows) {
  if (!Array.isArray(rows)) return -1;
  const lim = Math.min(rows.length, 30);
  for (let i = 0; i < lim; i++) if (Array.isArray(rows[i]) && detectFormat(rows[i])) return i;
  return rows.findIndex(r => Array.isArray(r) && r.some(c => String(c).trim()));
}

// ── Dates ────────────────────────────────────────────────────────────

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const year4 = y => (y < 100 ? 2000 + y : y);
const iso = (y, m, d) => {
  const s = `${year4(y)}-${pad(m)}-${pad(d)}`;
  return isIsoDate(s) ? s : null;
};

/** Tolerant date → 'YYYY-MM-DD' | null. `order` decides 01/02/2026. */
export function parseDate(input, order = 'dmy') {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T][\d:.]+)?$/);
  if (m) return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{2}|\d{4})$/);
  if (m) {
    const mo = MON[m[2].toLowerCase()] || MON[m[2].slice(0, 4).toLowerCase()] || MON[m[2].slice(0, 3).toLowerCase()];
    return mo ? iso(+m[3], mo, +m[1]) : null;
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MON[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MON[m[1].slice(0, 3).toLowerCase()], +m[2]);
  return null;
}

// ── Stable refs ──────────────────────────────────────────────────────

/** cyrb53 — a fast, well-mixed 53-bit string hash (public domain). */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed; let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** 106 bits as 28 hex chars: two seeds, so a collision needs both to collide. */
export function stableHash(str) {
  const s = String(str);
  return cyrb53(s, 1).toString(16).padStart(14, '0') + cyrb53(s, 2).toString(16).padStart(14, '0');
}

/** Running index among identical keys, in file order. */
function refMaker(prefix) {
  const seen = new Map();
  return key => {
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    return `${prefix}:${stableHash(`${key}|${n}`)}`;
  };
}

const canon = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

// ── Shared helpers ───────────────────────────────────────────────────

function withFx(entry, fx) {
  if (entry.currency === 'GBP') return { ...entry, fx_rate: null, gbp_pence: entry.amount_pence, needs_fx: false };
  const rate = fx && Number(fx[entry.currency]);
  if (Number.isFinite(rate) && rate > 0) {
    return { ...entry, fx_rate: rate, gbp_pence: Math.round(entry.amount_pence * rate), needs_fx: false };
  }
  if (Number.isSafeInteger(entry.gbp_pence)) return { ...entry, needs_fx: false };
  return { ...entry, fx_rate: null, gbp_pence: null, needs_fx: true };
}

export function applyFx(entries, fx) {
  return (Array.isArray(entries) ? entries : []).map(e => (e && e.needs_fx ? withFx(e, fx) : e));
}

const cur = v => {
  const c = String(v || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
};

function asTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return { headers: [], body: [], offset: 0 };
  if (!Array.isArray(rows[0])) {
    const headers = Object.keys(rows[0] || {});
    return { headers, body: rows.map(r => headers.map(h => (r && r[h] != null ? String(r[h]) : ''))), offset: 1 };
  }
  const h = Math.max(0, findHeaderRow(rows));
  return { headers: rows[h].map(String), body: rows.slice(h + 1), offset: h + 1 };
}

// ── Importers ────────────────────────────────────────────────────────

function bankEntries(headers, body, offset, opts) {
  const map = opts.mapping || null;
  const cols = map
    ? {
      date: headers.indexOf(map.date),
      description: headers.indexOf(map.description),
      amount: map.amount ? headers.indexOf(map.amount) : -1,
      moneyIn: map.moneyIn ? headers.indexOf(map.moneyIn) : -1,
      moneyOut: map.moneyOut ? headers.indexOf(map.moneyOut) : -1,
      currency: map.currency ? headers.indexOf(map.currency) : -1,
    }
    : bankColumns(headers);
  const entries = []; const invalid = []; let skipped = 0;
  if (cols.date === -1 || cols.description === -1 || (cols.amount === -1 && (cols.moneyIn === -1 || cols.moneyOut === -1))) {
    return { entries, invalid: [{ row: offset, reason: 'Could not find the date, description and amount columns — map them by hand.' }], skipped };
  }
  const ref = refMaker('bank');
  const account = canon(opts.account || '');
  body.forEach((r, i) => {
    const row = offset + i + 1;
    const date = parseDate(r[cols.date], opts.dateOrder === 'mdy' ? 'mdy' : 'dmy');
    const description = String(r[cols.description] || '').trim();
    let amount;
    if (cols.amount !== -1) amount = toPence(r[cols.amount]);
    else {
      const a = toPence(r[cols.moneyIn]); const b = toPence(r[cols.moneyOut]);
      amount = (a == null && b == null) ? null : Math.abs(a || 0) - Math.abs(b || 0);
    }
    if (!date) { invalid.push({ row, reason: `Unreadable date "${String(r[cols.date] || '').slice(0, 30)}"` }); return; }
    if (amount == null) { invalid.push({ row, reason: 'No amount' }); return; }
    if (amount === 0) { skipped++; return; }
    const currency = (cols.currency !== -1 && cur(r[cols.currency])) || cur(opts.currency) || 'GBP';
    const c = categorise({ description, amountPence: amount, direction: amount < 0 ? 'out' : 'in' });
    const e = {
      occurred_on: date,
      kind: c.kind,
      category: c.category,
      amount_pence: Math.abs(amount),
      currency,
      vat_pence: null,
      counterparty: null,
      description: description.slice(0, 300) || null,
      source: 'bank_csv',
      source_ref: ref(`${account}|${date}|${canon(description)}|${amount}|${currency}`),
      note: null,
      row,
      confidence: c.confidence,
    };
    entries.push(withFx(e, opts.fx));
  });
  return { entries, invalid, skipped };
}

function appleEntries(headers, body, offset, opts) {
  const col = name => headers.map(norm).indexOf(name);
  const C = {
    start: col('start date'), end: col('end date'), vendor: col('vendor identifier'), qty: col('quantity'),
    share: col('partner share'), ext: col('extended partner share'), currency: col('partner share currency'),
    sr: col('sales or return'), appleId: col('apple identifier'), title: col('title'), country: col('country of sale'),
    type: col('product type identifier'), price: col('customer price'),
  };
  const entries = []; const invalid = []; let skipped = 0;
  const ref = refMaker('apple');
  const get = (r, k) => (C[k] === -1 ? '' : String(r[C[k]] ?? '').trim());
  body.forEach((r, i) => {
    const row = offset + i + 1;
    const vendor = get(r, 'vendor');
    const first = String(r[0] ?? '').trim();
    if (!vendor || /^total_/i.test(first)) { skipped++; return; }   // trailer / blank
    const end = parseDate(get(r, 'end'), 'mdy') || parseDate(get(r, 'start'), 'mdy');
    if (!end) { invalid.push({ row, reason: 'No readable End Date' }); return; }
    const qty = Number(get(r, 'qty')) || 0;
    let amount = toPence(get(r, 'ext'));
    if (amount == null) {
      const share = toPence(get(r, 'share'));
      amount = share == null ? null : share * qty;
    }
    if (amount == null) { invalid.push({ row, reason: 'No Extended Partner Share' }); return; }
    if (amount === 0) { skipped++; return; }
    const currency = cur(get(r, 'currency'));
    if (!currency) { invalid.push({ row, reason: 'No Partner Share Currency' }); return; }
    const refund = amount < 0 || /^r$/i.test(get(r, 'sr'));
    const name = get(r, 'title') || vendor;
    const country = get(r, 'country');
    const e = {
      occurred_on: end,
      kind: refund ? 'expense' : 'income',
      category: refund ? 'refunds' : 'app-store',
      amount_pence: Math.abs(amount),
      currency,
      vat_pence: null,
      counterparty: 'Apple',
      description: `App Store · ${name}${country ? ` · ${country}` : ''} · ${Math.abs(qty)} ${Math.abs(qty) === 1 ? 'unit' : 'units'}${refund ? ' (returns)' : ''}`.slice(0, 300),
      source: 'apple',
      source_ref: ref([get(r, 'start'), get(r, 'end'), vendor, get(r, 'appleId'), country, currency, get(r, 'share'), qty, amount, get(r, 'sr'), get(r, 'type'), get(r, 'price')].join('|')),
      note: null,
      row,
      confidence: 'high',
    };
    entries.push(withFx(e, opts.fx));
  });
  return { entries, invalid, skipped };
}

function googleEntries(headers, body, offset, opts) {
  const col = name => headers.map(norm).indexOf(name);
  const C = {
    order: col('description'), date: col('transaction date'), time: col('transaction time'), type: col('transaction type'),
    title: col('product title'), product: col('product id'), amount: col('amount (merchant currency)'), currency: col('merchant currency'),
    country: col('buyer country'),
  };
  const entries = []; const invalid = []; let skipped = 0;
  const ref = refMaker('google');
  const get = (r, k) => (C[k] === -1 ? '' : String(r[C[k]] ?? '').trim());
  body.forEach((r, i) => {
    const row = offset + i + 1;
    const date = parseDate(get(r, 'date'), 'mdy');
    if (!date) { invalid.push({ row, reason: `Unreadable Transaction Date "${get(r, 'date').slice(0, 30)}"` }); return; }
    const amount = toPence(get(r, 'amount'));
    if (amount == null) { invalid.push({ row, reason: 'No Amount (Merchant Currency)' }); return; }
    if (amount === 0) { skipped++; return; }
    const currency = cur(get(r, 'currency'));
    if (!currency) { invalid.push({ row, reason: 'No Merchant Currency' }); return; }
    const type = get(r, 'type');
    const t = type.toLowerCase();
    let kind; let category; let confidence = 'high';
    if (/fee/.test(t) && amount < 0) { kind = 'expense'; category = 'store-fees'; }
    else if (/refund/.test(t) && amount < 0) { kind = 'expense'; category = 'refunds'; }
    else if (amount > 0) { kind = 'income'; category = 'google-play'; if (!/charge|fee refund/.test(t)) confidence = 'medium'; }
    else { kind = 'expense'; category = /tax/.test(t) ? 'other' : 'store-fees'; confidence = 'low'; }
    const name = get(r, 'title') || get(r, 'product') || 'Google Play';
    const e = {
      occurred_on: date,
      kind,
      category,
      amount_pence: Math.abs(amount),
      currency,
      vat_pence: null,
      counterparty: 'Google',
      description: `Google Play · ${type || 'Transaction'} · ${name}`.slice(0, 300),
      source: 'google',
      source_ref: ref([get(r, 'order'), get(r, 'date'), get(r, 'time'), type, amount, currency, get(r, 'product'), get(r, 'country')].join('|')),
      note: null,
      row,
      confidence,
    };
    entries.push(withFx(e, opts.fx));
  });
  return { entries, invalid, skipped };
}

const unguard = s => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nativeEntries(headers, body, offset, opts) {
  const hs = headers.map(norm);
  const C = Object.fromEntries(NATIVE_HEADERS.map(h => [h, hs.indexOf(norm(h))]));
  const get = (r, h) => (C[h] === -1 ? '' : unguard(String(r[C[h]] ?? '').trim()));
  const entries = []; const invalid = [];
  const ref = refMaker('native');
  body.forEach((r, i) => {
    const row = offset + i + 1;
    const date = parseDate(get(r, 'Date'), 'dmy');
    const kind = get(r, 'Kind').toLowerCase();
    const category = get(r, 'Category').toLowerCase();
    const amount = toPence(get(r, 'Amount'));
    if (!date) { invalid.push({ row, reason: 'Unreadable Date' }); return; }
    if (!isCategory(kind, category)) { invalid.push({ row, reason: `Unknown kind/category "${kind}/${category}"` }); return; }
    if (amount == null || amount <= 0) { invalid.push({ row, reason: 'Amount must be more than zero' }); return; }
    const currency = cur(get(r, 'Currency')) || 'GBP';
    const fxRate = get(r, 'FX rate') ? Number(get(r, 'FX rate')) : null;
    const gbp = toPence(get(r, 'GBP amount'));
    const id = UUID_RE.test(get(r, 'ID')) ? get(r, 'ID').toLowerCase() : null;
    let source = get(r, 'Source').toLowerCase();
    if (!BOOKABLE_SOURCES.includes(source)) source = 'manual';
    let sourceRef = get(r, 'Source ref') || null;
    if (!sourceRef) {
      sourceRef = id ? `native:${id}` : ref(`${date}|${kind}|${category}|${amount}|${currency}|${canon(get(r, 'Description'))}`);
    }
    const vat = get(r, 'VAT') ? toPence(get(r, 'VAT')) : null;
    const e = {
      ...(id ? { id } : {}),
      occurred_on: date,
      kind,
      category,
      amount_pence: amount,
      currency,
      fx_rate: currency === 'GBP' ? null : (Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null),
      gbp_pence: currency === 'GBP' ? amount : gbp,
      vat_pence: vat,
      counterparty: get(r, 'Counterparty') || null,
      description: get(r, 'Description') || null,
      source,
      source_ref: sourceRef,
      note: get(r, 'Note') || null,
      row,
      confidence: 'high',
    };
    entries.push(withFx(e, opts.fx));
  });
  return { entries, invalid, skipped: 0 };
}

export function toEntries(format, rows, opts = {}) {
  const { headers, body, offset } = asTable(rows);
  const o = opts && typeof opts === 'object' ? opts : {};
  const fmt = o.mapping ? 'bank-generic' : (format || detectFormat(headers));
  const run = {
    'bank-generic': bankEntries,
    'apple-financial': appleEntries,
    'google-earnings': googleEntries,
    'books-native': nativeEntries,
  }[fmt];
  if (!run) {
    return { entries: [], invalid: [{ row: offset || 1, reason: 'Format not recognised — map the columns by hand.' }], skipped: 0, format: null, headers };
  }
  return { ...run(headers, body, offset, o), format: fmt, headers };
}

// ── Export (books-native) ────────────────────────────────────────────

const guard = s => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);

function cell(v) {
  const s = guard(v == null ? '' : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function nativeRow(e) {
  return [
    e.occurred_on, e.kind, e.category, fromPence(e.amount_pence), e.currency || 'GBP',
    e.fx_rate == null ? '' : String(e.fx_rate), fromPence(e.gbp_pence),
    e.vat_pence == null ? '' : fromPence(e.vat_pence),
    e.counterparty || '', e.description || '', e.source || 'manual', e.source_ref || '', e.note || '', e.id || '',
  ];
}

export function nativeCsv(entries) {
  return toCsv([NATIVE_HEADERS, ...(Array.isArray(entries) ? entries : []).map(nativeRow)]);
}

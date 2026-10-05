// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's importers.js (simplified bodies): parseCsv, NATIVE_HEADERS, detectFormat,
// findHeaderRow, parseDate, stableHash, applyFx, toEntries, toCsv, nativeRow, nativeCsv.
import { toPence, fromPence } from './money.js';
import { categorise, isCategory } from './categories.js';
import { isIsoDate } from './ledger.js';

export function parseCsv(text, { delimiter } = {}) {
  if (typeof text !== 'string') return [];
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = s.split(/\r\n|\n|\r/, 1)[0] || '';
  const n = ch => first.split(ch).length - 1;
  const d = delimiter || (n('\t') > 0 && n('\t') >= n(',') ? '\t' : n(';') > n(',') ? ';' : ',');
  const rows = []; let row = [], f = '', q = false;
  const endRow = () => { row.push(f); f = ''; if (row.some(c => c.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f.trim() === '') { f = ''; q = true; } else if (c === d) { row.push(f); f = ''; } else if (c === '\r') { endRow(); if (s[i + 1] === '\n') i++; } else if (c === '\n') endRow(); else f += c;
  }
  if (f !== '' || row.length) endRow();
  return rows;
}

export const NATIVE_HEADERS = ['Date', 'Kind', 'Category', 'Amount', 'Currency', 'FX rate', 'GBP amount', 'VAT', 'Counterparty', 'Description', 'Source', 'Source ref', 'Note', 'ID'];
const norm = h => String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
const PAIRS = [['money in', 'money out'], ['paid in', 'paid out'], ['credit', 'debit']];

export function detectFormat(headers) {
  if (!Array.isArray(headers) || !headers.length) return null;
  const hs = headers.map(norm), has = h => hs.includes(h);
  if (has('kind') && has('gbp amount') && has('source ref') && has('date')) return 'books-native';
  if (has('vendor identifier') && has('partner share currency')) return 'apple-financial';
  if (has('transaction type') && has('amount (merchant currency)') && has('transaction date')) return 'google-earnings';
  if (has('date') && has('description') && (has('amount') || PAIRS.some(([a, b]) => has(a) && has(b)))) return 'bank-generic';
  return null;
}

export function findHeaderRow(rows) {
  if (!Array.isArray(rows)) return -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) if (detectFormat(rows[i])) return i;
  return rows.findIndex(r => Array.isArray(r) && r.some(c => String(c).trim()));
}

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => { const s = `${y < 100 ? 2000 + y : y}-${pad(m)}-${pad(d)}`; return isIsoDate(s) ? s : null; };
export function parseDate(input, order = 'dmy') {
  const s = String(input || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/); if (m) return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/); if (m && MON[m[1].toLowerCase()]) return iso(+m[3], MON[m[1].toLowerCase()], +m[2]);
  return null;
}

export function stableHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).padStart(16, '0');
}

function withFx(e, fx) {
  if (e.currency === 'GBP') return { ...e, fx_rate: null, gbp_pence: e.amount_pence, needs_fx: false };
  const r = fx && Number(fx[e.currency]);
  if (r > 0) return { ...e, fx_rate: r, gbp_pence: Math.round(e.amount_pence * r), needs_fx: false };
  if (Number.isSafeInteger(e.gbp_pence)) return { ...e, needs_fx: false };
  return { ...e, fx_rate: null, gbp_pence: null, needs_fx: true };
}
export const applyFx = (entries, fx) => (Array.isArray(entries) ? entries : []).map(e => (e && e.needs_fx ? withFx(e, fx) : e));

export function toEntries(format, rows, opts = {}) {
  const h = Math.max(0, findHeaderRow(rows || []));
  const headers = (rows && rows[h] ? rows[h] : []).map(String);
  const body = (rows || []).slice(h + 1);
  const fmt = opts.mapping ? 'bank-generic' : (format || detectFormat(headers));
  const col = name => headers.map(norm).indexOf(name);
  const entries = [], invalid = []; let skipped = 0;
  const seen = new Map();
  const ref = (p, k) => { const n = seen.get(k) || 0; seen.set(k, n + 1); return `${p}:${stableHash(`${k}|${n}`)}`; };
  if (!fmt) return { entries, invalid: [{ row: h + 1, reason: 'Format not recognised — map the columns by hand.' }], skipped, format: null, headers };
  body.forEach((r, i) => {
    const row = h + i + 2;
    const g = c => (c === -1 ? '' : String(r[c] ?? '').trim());
    let e;
    if (fmt === 'bank-generic') {
      const m = opts.mapping;
      const ix = m ? { d: headers.indexOf(m.date), s: headers.indexOf(m.description), a: m.amount ? headers.indexOf(m.amount) : -1, i: m.moneyIn ? headers.indexOf(m.moneyIn) : -1, o: m.moneyOut ? headers.indexOf(m.moneyOut) : -1 }
        : { d: col('date'), s: col('description'), a: col('amount'), ...(PAIRS.map(([a, b]) => ({ i: col(a), o: col(b) })).find(p => p.i !== -1) || { i: -1, o: -1 }) };
      const date = parseDate(g(ix.d), opts.dateOrder);
      const desc = g(ix.s);
      let amt;
      if (ix.a !== -1) amt = toPence(g(ix.a));
      else { const a = toPence(g(ix.i)), b = toPence(g(ix.o)); amt = a == null && b == null ? null : Math.abs(a || 0) - Math.abs(b || 0); }
      if (!date) { invalid.push({ row, reason: `Unreadable date "${g(ix.d).slice(0, 30)}"` }); return; }
      if (amt == null) { invalid.push({ row, reason: 'No amount' }); return; }
      if (amt === 0) { skipped++; return; }
      const c = categorise({ description: desc, amountPence: amt });
      e = { occurred_on: date, kind: c.kind, category: c.category, amount_pence: Math.abs(amt), currency: 'GBP', description: desc || null, counterparty: null, source: 'bank_csv', source_ref: ref('bank', `${date}|${desc.toUpperCase()}|${amt}`), confidence: c.confidence };
    } else if (fmt === 'apple-financial') {
      const vendor = g(col('vendor identifier'));
      if (!vendor || /^total_/i.test(String(r[0] || ''))) { skipped++; return; }
      const date = parseDate(g(col('end date')), 'mdy');
      const amt = toPence(g(col('extended partner share')));
      const cur = g(col('partner share currency')).toUpperCase();
      if (!date) { invalid.push({ row, reason: 'No readable End Date' }); return; }
      if (amt == null || !cur) { invalid.push({ row, reason: 'No Extended Partner Share' }); return; }
      const refund = amt < 0;
      e = { occurred_on: date, kind: refund ? 'expense' : 'income', category: refund ? 'refunds' : 'app-store', amount_pence: Math.abs(amt), currency: cur, counterparty: 'Apple', description: `App Store · ${g(col('title')) || vendor} · ${g(col('country of sale'))}`, source: 'apple', source_ref: ref('apple', r.join('|')), confidence: 'high' };
    } else if (fmt === 'google-earnings') {
      const date = parseDate(g(col('transaction date')), 'mdy');
      const amt = toPence(g(col('amount (merchant currency)')));
      const type = g(col('transaction type'));
      if (!date) { invalid.push({ row, reason: 'Unreadable Transaction Date' }); return; }
      if (amt == null) { invalid.push({ row, reason: 'No Amount (Merchant Currency)' }); return; }
      const fee = /fee/i.test(type) && amt < 0;
      e = { occurred_on: date, kind: amt > 0 ? 'income' : 'expense', category: amt > 0 ? 'google-play' : fee ? 'store-fees' : 'refunds', amount_pence: Math.abs(amt), currency: g(col('merchant currency')).toUpperCase() || 'GBP', counterparty: 'Google', description: `Google Play · ${type} · ${g(col('product title'))}`, source: 'google', source_ref: ref('google', r.join('|')), confidence: 'high' };
    } else {
      const date = parseDate(g(col('date')));
      const kind = g(col('kind')).toLowerCase(), category = g(col('category')).toLowerCase();
      const amt = toPence(g(col('amount')));
      if (!date || !isCategory(kind, category) || !(amt > 0)) { invalid.push({ row, reason: 'Unreadable row' }); return; }
      e = { occurred_on: date, kind, category, amount_pence: amt, currency: g(col('currency')) || 'GBP', gbp_pence: toPence(g(col('gbp amount'))), description: g(col('description')) || null, source: g(col('source')) || 'manual', source_ref: g(col('source ref')) || ref('native', r.join('|')), confidence: 'high' };
    }
    entries.push(withFx({ vat_pence: null, note: null, ...e, row }, opts.fx));
  });
  return { entries, invalid, skipped, format: fmt, headers };
}

const cell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = rows => rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
export const nativeRow = e => [e.occurred_on, e.kind, e.category, fromPence(e.amount_pence), e.currency || 'GBP', e.fx_rate ?? '', fromPence(e.gbp_pence), e.vat_pence == null ? '' : fromPence(e.vat_pence), e.counterparty || '', e.description || '', e.source || 'manual', e.source_ref || '', e.note || '', e.id || ''];
export const nativeCsv = entries => toCsv([NATIVE_HEADERS, ...(entries || []).map(nativeRow)]);

/**
 * Reports over ledger entries — calendar periods only.
 *
 *   summarise(entries, { from, to }) → {
 *     incomePence, expensePence, profitPence,          // profit = income − expense
 *     byCategory: { income:{ [id]: pence }, expense:{ [id]: pence } },
 *     byMonth: [{ month:'YYYY-MM', income, expense, profit }],
 *     transferPence, count
 *   }
 *     · from/to inclusive 'YYYY-MM-DD', both optional
 *     · gbp_pence is the value used (every entry carries it)
 *     · transfers are EXCLUDED from income/expense/profit and byMonth
 *       (they are own money moving, or store payouts already booked as
 *       income from the store report); transferPence is shown separately
 *     · soft-deleted rows (deleted_at set) are ignored
 *     · byMonth is zero-filled across the range (or across the entries'
 *       own span when no range is given), capped at 120 months
 *
 *   calendarPeriod(kind, today) → { from, to, label }
 *     kind: 'month' | 'last-month' | 'year' | 'last-year' | 'ytd'
 *     today: 'YYYY-MM-DD' (callers pass the local date)
 *   customPeriod(from, to) → { from, to, label } | null
 *
 * Pure. Tested by books.test.mjs (npm run check:books).
 */
import { isIsoDate } from './ledger.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const value = e => (Number.isSafeInteger(e.gbp_pence) ? e.gbp_pence : 0);

function monthRange(fromMonth, toMonth, cap = 120) {
  const out = [];
  let [y, m] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < cap) {
    out.push(`${y}-${pad(m)}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function summarise(entries, { from, to } = {}) {
  const lo = isIsoDate(from) ? from : null;
  const hi = isIsoDate(to) ? to : null;
  const byCategory = { income: {}, expense: {} };
  const months = new Map();
  let incomePence = 0;
  let expensePence = 0;
  let transferPence = 0;
  let count = 0;
  let minDate = null;
  let maxDate = null;

  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.deleted_at || !isIsoDate(e.occurred_on)) continue;
    if ((lo && e.occurred_on < lo) || (hi && e.occurred_on > hi)) continue;
    const v = value(e);
    count += 1;
    if (e.kind === 'transfer') { transferPence += v; continue; }
    if (e.kind !== 'income' && e.kind !== 'expense') continue;
    const month = e.occurred_on.slice(0, 7);
    const row = months.get(month) || { month, income: 0, expense: 0, profit: 0 };
    if (e.kind === 'income') { incomePence += v; row.income += v; }
    else { expensePence += v; row.expense += v; }
    row.profit = row.income - row.expense;
    months.set(month, row);
    const cat = e.category || 'uncategorised';
    byCategory[e.kind][cat] = (byCategory[e.kind][cat] || 0) + v;
    if (!minDate || e.occurred_on < minDate) minDate = e.occurred_on;
    if (!maxDate || e.occurred_on > maxDate) maxDate = e.occurred_on;
  }

  const start = (lo || minDate || '').slice(0, 7);
  const end = (hi || maxDate || '').slice(0, 7);
  const byMonth = start && end && start <= end
    ? monthRange(start, end).map(mo => months.get(mo) || { month: mo, income: 0, expense: 0, profit: 0 })
    : [];

  return {
    incomePence,
    expensePence,
    profitPence: incomePence - expensePence,
    byCategory,
    byMonth,
    transferPence,
    count,
  };
}

export function calendarPeriod(kind, today) {
  if (!isIsoDate(today)) return null;
  const [y, m] = today.split('-').map(Number);
  switch (kind) {
    case 'month':
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, label: `${MONTHS[m - 1]} ${y}` };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`, label: `${MONTHS[pm - 1]} ${py}` };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    case 'last-year':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
    case 'ytd':
      return { from: `${y}-01-01`, to: today, label: `${y} to date` };
    default:
      return null;
  }
}

const shortDate = s => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;

export function customPeriod(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  return { from, to, label: `${shortDate(from)} \u2013 ${shortDate(to)}` };
}

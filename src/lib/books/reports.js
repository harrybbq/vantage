// STUB — replaced by the backend agent's version at merge
// Same exports as the backend's reports.js: summarise, calendarPeriod, customPeriod.
import { isIsoDate } from './ledger.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function summarise(entries, { from, to } = {}) {
  const lo = isIsoDate(from) ? from : null, hi = isIsoDate(to) ? to : null;
  const byCategory = { income: {}, expense: {} }, months = new Map();
  let incomePence = 0, expensePence = 0, transferPence = 0, count = 0, min = null, max = null;
  for (const e of entries || []) {
    if (!e || e.deleted_at || !isIsoDate(e.occurred_on)) continue;
    if ((lo && e.occurred_on < lo) || (hi && e.occurred_on > hi)) continue;
    const v = Number.isSafeInteger(e.gbp_pence) ? e.gbp_pence : 0;
    count++;
    if (e.kind === 'transfer') { transferPence += v; continue; }
    if (e.kind !== 'income' && e.kind !== 'expense') continue;
    const m = e.occurred_on.slice(0, 7);
    const row = months.get(m) || { month: m, income: 0, expense: 0, profit: 0 };
    if (e.kind === 'income') { incomePence += v; row.income += v; } else { expensePence += v; row.expense += v; }
    row.profit = row.income - row.expense;
    months.set(m, row);
    byCategory[e.kind][e.category || 'uncategorised'] = (byCategory[e.kind][e.category || 'uncategorised'] || 0) + v;
    if (!min || e.occurred_on < min) min = e.occurred_on;
    if (!max || e.occurred_on > max) max = e.occurred_on;
  }
  const start = (lo || min || '').slice(0, 7), end = (hi || max || '').slice(0, 7);
  const byMonth = [];
  if (start && end && start <= end) {
    let [y, m] = start.split('-').map(Number);
    for (let k = 0; k < 120; k++) {
      const id = `${y}-${pad(m)}`;
      if (id > end) break;
      byMonth.push(months.get(id) || { month: id, income: 0, expense: 0, profit: 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return { incomePence, expensePence, profitPence: incomePence - expensePence, byCategory, byMonth, transferPence, count };
}

export function calendarPeriod(kind, today) {
  if (!isIsoDate(today)) return null;
  const [y, m] = today.split('-').map(Number);
  switch (kind) {
    case 'month': return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, label: `${MONTHS[m - 1]} ${y}` };
    case 'last-month': {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`, label: `${MONTHS[pm - 1]} ${py}` };
    }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    case 'last-year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: String(y - 1) };
    case 'ytd': return { from: `${y}-01-01`, to: today, label: `${y} to date` };
    default: return null;
  }
}

const short = s => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
export function customPeriod(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  return { from, to, label: `${short(from)} – ${short(to)}` };
}

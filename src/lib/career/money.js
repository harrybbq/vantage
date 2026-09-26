/**
 * House-purchase arithmetic for the Career plan's money panel.
 *
 * Every number the panel shows is derived here from `career.money` (owner
 * content, fetched at runtime — never bundled). This file holds the method
 * and public tax facts only; the figures themselves live in Supabase.
 *
 *   cash needed = price − LTV × min(price, valuation) + LBTT + legal + buffer
 *
 * `min(price, valuation)` is the whole story of a Scottish overbid: the
 * lender lends against the Home Report valuation, so every pound bid above
 * it comes out of savings.
 *
 * Months are 'YYYY-MM' strings throughout — they sort, compare and read
 * without a Date and without a timezone.
 *
 * Pure. No React, no network, no clock.
 */

/* ── Months ─────────────────────────────────────────────────────────── */

const MONTH_RE = /^(\d{4})-(\d{2})$/;
export const isMonth = m => typeof m === 'string' && MONTH_RE.test(m) && +m.slice(5) >= 1 && +m.slice(5) <= 12;

export function addMonths(m, n) {
  const [y, mo] = m.split('-').map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Whole months from a to b (b − a). */
export function monthDiff(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

/** Every month from a to b inclusive. */
export function monthsFrom(a, b) {
  const out = [];
  for (let m = a; monthDiff(m, b) >= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2027-03' → 'Mar 27'. */
export const monthLabel = m => (isMonth(m) ? `${MON[+m.slice(5) - 1]} ${m.slice(2, 4)}` : String(m || ''));

export const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/* ── LBTT ───────────────────────────────────────────────────────────── */

/**
 * Scottish Land and Buildings Transaction Tax, residential. Public rates
 * (Revenue Scotland); overridable from `career.money.lbtt` if they change.
 * First-time buyer relief raises the nil band to `ftbNilBand`.
 */
export const LBTT_DEFAULT = {
  bands: [
    { upTo: 145000, rate: 0 },
    { upTo: 250000, rate: 0.02 },
    { upTo: 325000, rate: 0.05 },
    { upTo: 750000, rate: 0.10 },
    { upTo: null, rate: 0.12 },
  ],
  ftbNilBand: 175000,
};

export function lbtt(price, { firstTimeBuyer = true, bands = LBTT_DEFAULT.bands, ftbNilBand = LBTT_DEFAULT.ftbNilBand } = {}) {
  if (!(price > 0)) return 0;
  let tax = 0, lo = 0;
  for (const b of bands) {
    const hi = b.upTo == null ? Infinity : b.upTo;
    // Relief: nothing is charged below the first-time-buyer threshold.
    const from = firstTimeBuyer ? Math.max(lo, Math.min(ftbNilBand, hi)) : lo;
    if (price > from) tax += (Math.min(price, hi) - from) * b.rate;
    lo = hi;
    if (price <= hi) break;
  }
  return Math.round(tax);
}

/* ── Cash needed ────────────────────────────────────────────────────── */

export function cashNeeded(sc, money = {}) {
  const ltv = sc.ltv ?? money.ltvDefault ?? 0.9;
  const lend = ltv * Math.min(sc.price, sc.valuation ?? sc.price);
  const deposit = sc.price - lend;
  const tax = lbtt(sc.price, { ...(money.lbtt || {}), firstTimeBuyer: money.firstTimeBuyer !== false });
  const legal = money.legal ?? 2000;
  const buffer = money.buffer ?? 3000;
  return {
    deposit: Math.round(deposit), lbtt: tax, legal, buffer,
    total: Math.round(deposit + tax + legal + buffer),
  };
}

/* ── Projection ─────────────────────────────────────────────────────── */

/**
 * Month-end balances from the month after `start.month` to `to`.
 *   money.start      { month, balance }         balance at the END of month
 *   money.transfers  [{ from, to?, monthly }]   to omitted = open-ended
 *   money.oneOffs    [{ month, amount, label, bonus? }]
 * `bonus: false` leaves out every one-off marked `bonus`.
 * → [{ month, balance, inflow }], the start month first.
 */
export function project(money, { to, bonus = true } = {}) {
  const start = money && money.start;
  if (!start || !isMonth(start.month)) return [];
  const end = to || money.until || addMonths(start.month, 15);
  const out = [{ month: start.month, balance: Math.round(start.balance || 0), inflow: 0 }];
  let bal = start.balance || 0;
  for (let m = addMonths(start.month, 1); monthDiff(m, end) >= 0; m = addMonths(m, 1)) {
    let inflow = 0;
    for (const t of money.transfers || []) {
      if (monthDiff(t.from, m) >= 0 && (!t.to || monthDiff(m, t.to) >= 0)) inflow += Number(t.monthly) || 0;
    }
    for (const o of money.oneOffs || []) {
      if (o.month === m && (bonus || !o.bonus)) inflow += Number(o.amount) || 0;
    }
    bal += inflow;
    out.push({ month: m, balance: Math.round(bal), inflow: Math.round(inflow) });
  }
  return out;
}

/** The first month whose month-end balance covers `amount`, or null. */
export function firstMonthAtLeast(series, amount) {
  const hit = series.find(p => p.balance >= amount);
  return hit ? hit.month : null;
}

/**
 * When a scenario becomes affordable, with and without the bonus, and
 * the keys month that follows (`keysLagMonths` later — offer, missives,
 * settlement). `afterContract` flags keys landing after the contract
 * end month, which is when the mortgage application gets harder.
 */
export function readiness(money, sc, { to } = {}) {
  const need = cashNeeded(sc, money);
  const horizon = to || money.until || '2028-12';
  const withB = project(money, { to: horizon, bonus: true });
  const noB = project(money, { to: horizon, bonus: false });
  const lag = money.keysLagMonths ?? 2;
  const ready = firstMonthAtLeast(noB, need.total);
  const readyBonus = firstMonthAtLeast(withB, need.total);
  const keys = ready ? addMonths(ready, lag) : null;
  const keysBonus = readyBonus ? addMonths(readyBonus, lag) : null;
  const end = money.contractEnd;
  return {
    need, ready, readyBonus, keys, keysBonus,
    afterContract: !!(end && keys && monthDiff(end, keys) > 0),
  };
}

/**
 * Post-purchase monthly budget. The listed lines are summed as a low–high
 * range; what is LEFT is an input, not derived, because take-home minus
 * these lines is not the whole picture (food, car, phone… are not listed)
 * and inventing those lines would be worse than stating the answer. The
 * bonus version adds a third of the net bonus, which pays every third
 * payslip.
 */
export function budgetSummary(money) {
  const b = (money && money.budget) || {};
  const lines = b.lines || [];
  const low = lines.reduce((s, l) => s + (Number(l.low ?? l.high) || 0), 0);
  const high = lines.reduce((s, l) => s + (Number(l.high ?? l.low) || 0), 0);
  const left = Number.isFinite(Number(b.left)) ? Number(b.left) : null;
  const perMonthBonus = b.bonusNet ? Math.round(Number(b.bonusNet) / 3) : 0;
  return { low, high, left, leftWithBonus: left != null && perMonthBonus ? left + perMonthBonus : null, perMonthBonus };
}

/**
 * The savings maths, with no React in it.
 *
 * Everything the pots, the projection chart and the accounts panel show
 * is derived here, so the two surfaces that render it — the desktop
 * board and the mobile sub-tabs — cannot disagree about a number, and
 * so the arithmetic can be checked without a browser.
 *
 * The state shapes are the ones already in `S`; nothing here invents a
 * new key:
 *   S.savings         [{id,name,icon,image,target,current,targetDate,
 *                       achievementId,contributions:[{id,amount,note,ts}],createdAt}]
 *   S.projection      {items,groups,horizon,startBalance}
 *   S.projection.items[{id,kind,label,amount,freq,goalId,accountId,
 *                       groupId,from,until,payDay}]
 *   S.savingsAccounts [{id,name,balance,apy}]
 */

/** A row's amount expressed per month, whatever cadence it is entered at. */
export function toMonthly(amount, freq) {
  const v = parseFloat(amount) || 0;
  if (freq === 'year') return v / 12;
  if (freq === 'week') return v * 52 / 12;
  return v;
}

export const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Is a row live in month `m` from now? Rows can carry a from/until
 * window ("Nursery fees until Sep 2027"), and a projection that ignored
 * it would quietly promise money that stops arriving.
 */
export function activeAt(item, m, now = new Date()) {
  if (!item.from && !item.until) return true;
  const at = new Date(now.getFullYear(), now.getMonth() + m, 1);
  if (item.from) {
    const [y, mo] = item.from.split('-').map(Number);
    if (y && mo && at < new Date(y, mo - 1, 1)) return false;
  }
  if (item.until) {
    const [y, mo] = item.until.split('-').map(Number);
    if (y && mo && at > new Date(y, mo - 1, 1)) return false;
  }
  return true;
}

/**
 * A row's signed effect on CASH in month m.
 *
 * Income that is routed into a pot or an account is deliberately worth
 * zero here: it never lands in the current account, it lands in the
 * thing it is routed to. Counting it in both places was the obvious
 * bug to write and would have inflated every projection.
 */
export function signedMonthly(item, m, now) {
  if (!activeAt(item, m, now)) return 0;
  if (item.kind === 'income' && (item.goalId || item.accountId)) return 0;
  return (item.kind === 'income' ? 1 : -1) * toMonthly(item.amount, item.freq);
}

/** Monthly total routed into one pot, from every row that feeds it. */
export function routedFor(items, goalId, m = 0, now) {
  if (!goalId) return 0;
  return (items || [])
    .filter(it => it.goalId === goalId && activeAt(it, m, now))
    .reduce((s, it) => s + toMonthly(it.amount, it.freq), 0);
}

/** Monthly total routed into one account. */
export function routedToAccount(items, accountId, m = 0, now) {
  if (!accountId) return 0;
  return (items || [])
    .filter(it => it.accountId === accountId && activeAt(it, m, now))
    .reduce((s, it) => s + toMonthly(it.amount, it.freq), 0);
}

/** Whole months (fractional by day) between two dates. */
export function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12
       + (b.getMonth() - a.getMonth())
       + (b.getDate() - a.getDate()) / 30;
}

function asDate(iso) {
  if (!iso) return null;
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Everything one pot knows about itself.
 *
 * `pace` is where the pot SHOULD be — how far through the run from the
 * day it was created to its target date today is — which is what makes
 * "behind" mean something. Without a target date there is no pace to be
 * behind of, so such a pot is never called behind; it is simply open.
 */
export function derivePot(goal, items, now = new Date()) {
  const target = Number(goal.target) || 0;
  const current = Number(goal.current) || 0;
  const pct = target > 0 ? clamp01(current / target) : 0;
  const done = target > 0 && current >= target;
  const left = Math.max(0, target - current);

  const targetDate = asDate(goal.targetDate);
  const started = asDate(goal.createdAt) || (targetDate ? new Date(targetDate.getFullYear() - 1, targetDate.getMonth(), 1) : null);

  let pace = null;
  let monthsLeft = null;
  let needed = null;
  if (targetDate && started) {
    const span = Math.max(1, monthsBetween(started, targetDate));
    pace = clamp01(Math.max(0, monthsBetween(started, now)) / span);
    monthsLeft = Math.max(0, monthsBetween(now, targetDate));
    needed = monthsLeft > 0 ? left / monthsLeft : left;
  }

  const routed = routedFor(items, goal.id, 0, now);
  const etaMonths = routed > 0 && left > 0 ? Math.ceil(left / routed) : null;

  const state = done ? 'funded'
    : pace == null ? 'open'
    : pct + 0.02 >= pace ? 'ontrack'
    : 'behind';

  return { pct, done, pace, left, monthsLeft, needed, routed, etaMonths, state, targetDate, started, target, current };
}

/**
 * The last 12 calendar months of contributions to a pot, oldest first.
 * Buckets by the contribution's own timestamp rather than assuming a
 * regular standing order, so a lumpy year looks lumpy.
 */
export function last12Months(goal, now = new Date()) {
  const out = new Array(12).fill(0);
  const base = now.getFullYear() * 12 + now.getMonth();
  for (const c of (goal.contributions || [])) {
    const d = asDate(c.ts);
    if (!d) continue;
    const idx = 11 - (base - (d.getFullYear() * 12 + d.getMonth()));
    if (idx >= 0 && idx < 12) out[idx] += Number(c.amount) || 0;
  }
  return out;
}

/** Projected CASH at month m: what is left over, accumulated. */
export function cashSeries(startBalance, items, horizon, now = new Date()) {
  let bal = parseFloat(startBalance) || 0;
  const out = [bal];
  for (let m = 1; m <= horizon; m++) {
    bal += (items || []).reduce((s, it) => s + signedMonthly(it, m, now), 0);
    out.push(bal);
  }
  return out;
}

/**
 * Projected SAVINGS at month m: every account compounding at its own
 * rate, plus whatever is routed into it that month.
 */
export function savingsSeries(accounts, items, horizon, now = new Date()) {
  const list = accounts || [];
  const bal = list.map(a => parseFloat(a.balance) || 0);
  const rate = list.map(a => (parseFloat(a.apy) || 0) / 1200);
  const out = [bal.reduce((s, v) => s + v, 0)];
  for (let m = 1; m <= horizon; m++) {
    for (let i = 0; i < bal.length; i++) {
      bal[i] = bal[i] * (1 + rate[i]) + routedToAccount(items, list[i].id, m, now);
    }
    out.push(bal.reduce((s, v) => s + v, 0));
  }
  return out;
}

/** The headline numbers above the pots. */
export function potTotals(goals, items, now = new Date()) {
  const list = goals || [];
  const derived = list.map(g => ({ goal: g, d: derivePot(g, items, now) }));
  const saved = list.reduce((s, g) => s + (Number(g.current) || 0), 0);
  const target = list.reduce((s, g) => s + (Number(g.target) || 0), 0);
  const routed = derived.reduce((s, x) => s + x.d.routed, 0);
  const behind = derived.filter(x => x.d.state === 'behind').length;
  const doneCount = derived.filter(x => x.d.done).length;
  const next = derived
    .filter(x => !x.d.done && x.d.etaMonths != null)
    .sort((a, b) => a.d.etaMonths - b.d.etaMonths)[0] || null;
  return {
    derived, saved, target, routed, behind, doneCount,
    pct: target > 0 ? clamp01(saved / target) : 0,
    count: list.length,
    next: next ? { goal: next.goal, months: next.d.etaMonths } : null,
  };
}

/** Income, spend and net per month, for the flow header and segments. */
export function flowTotals(items, now = new Date()) {
  const list = items || [];
  const income = list.filter(i => i.kind === 'income' && activeAt(i, 0, now))
    .reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const spend = list.filter(i => i.kind === 'expense' && activeAt(i, 0, now))
    .reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  const routed = list.filter(i => i.goalId && activeAt(i, 0, now))
    .reduce((s, i) => s + toMonthly(i.amount, i.freq), 0);
  return { income, spend, net: income - spend, routed, rate: income > 0 ? routed / income : 0 };
}

/** Blended rate across accounts, weighted by balance. */
export function blendedApy(accounts) {
  const list = accounts || [];
  const total = list.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  if (total <= 0) return 0;
  return list.reduce((s, a) => s + (parseFloat(a.balance) || 0) * (parseFloat(a.apy) || 0), 0) / total;
}

// ── Formatting ───────────────────────────────────────────────────────

export function money(n, opts = {}) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  const dp = opts.pence && abs < 1000 ? 2 : 0;
  return sign + '£' + abs.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Short form for axis labels, where £26,400 is three characters too many. */
export function moneyK(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 10000) return sign + '£' + Math.round(abs / 1000) + 'k';
  if (abs >= 1000) return sign + '£' + (Math.round(abs / 100) / 10) + 'k';
  return money(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "now", "Mar", "Jan ’28" — the year only where it changes. */
export function monthLabel(m, now = new Date()) {
  if (m === 0) return 'now';
  const t = now.getMonth() + m;
  const y = now.getFullYear() + Math.floor(t / 12);
  const mo = ((t % 12) + 12) % 12;
  return MONTHS[mo] + (mo === 0 ? ' ’' + String(y).slice(2) : '');
}

/** A pot's colour: its own if set, else a stable one from its position. */
export const POT_PALETTE = ['#2fbf83', '#5b8cff', '#d0498f', '#12a5a5', '#d99114', '#7a4fd0', '#e05252', '#4dc485'];
export function potColor(goal, index) {
  return goal?.color || POT_PALETTE[((index % POT_PALETTE.length) + POT_PALETTE.length) % POT_PALETTE.length];
}

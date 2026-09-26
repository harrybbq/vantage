/**
 * Month-end savings snapshots — the "actual" line.
 *
 * Accounts store a balance and when it was set; there was no record of
 * what they held last month, so nothing could be compared with a plan.
 * This keeps one number per month:
 *
 *   S.savingsHistory = { 'YYYY-MM': { total, at } }
 *
 * ── When it is written ──
 * Only when a balance is deliberately changed — editing an account, the
 * monthly plan post, completing a pot. Each of those passes its NEXT
 * state through `withSnapshot`, which stamps the current month's total.
 * The last change in a month wins, which makes it the month-end figure
 * the moment the month closes. Nothing is ever written on load (a new
 * build must not rewrite state as it opens), and it is a new key, so it
 * is additive — nothing existing changes shape.
 *
 * The current month is also shown LIVE (today's balances, interest
 * included) without being written, so the line always reaches today.
 *
 * Pure. No React, no network.
 */
import { accountsTotal } from './interest.js';

export const ymOf = (d = new Date()) => {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

const pick = (accounts, ids) => (ids && ids.length ? (accounts || []).filter(a => ids.includes(a.id)) : accounts || []);

/**
 * The state after a balance change, with a month's snapshot stamped —
 * this month by default; the plan post passes the month it closes.
 */
export function withSnapshot(next, now = Date.now(), forMonth = null) {
  if (!next || !Array.isArray(next.savingsAccounts)) return next;
  const total = Math.round(accountsTotal(next.savingsAccounts, now) * 100) / 100;
  const month = forMonth || ymOf(new Date(now));
  const prev = next.savingsHistory || {};
  if (prev[month] && prev[month].total === total) return next;
  return { ...next, savingsHistory: { ...prev, [month]: { total, at: now } } };
}

/**
 * Actual balances for a chart: stored snapshots from `from` to before the
 * current month, then today's live total. `accountIds` narrows it to the
 * accounts a plan counts (e.g. just the house fund); empty = all.
 * Snapshots of a subset can't be recovered from a stored total, so when
 * a subset is asked for, only the live point is exact — earlier months
 * are the stored totals and are flagged `approx`.
 * → [{ month, balance, live?, approx? }]
 */
export function actualSeries(S, { from, accountIds = [], now = Date.now() } = {}) {
  const hist = (S && S.savingsHistory) || {};
  const nowMonth = ymOf(new Date(now));
  const subset = accountIds && accountIds.length > 0;
  const out = Object.keys(hist)
    .filter(m => (!from || m >= from) && m < nowMonth && Number.isFinite(hist[m] && hist[m].total))
    .sort()
    .map(m => ({ month: m, balance: Math.round(hist[m].total), ...(subset ? { approx: true } : null) }));
  const accounts = pick(S && S.savingsAccounts, accountIds);
  if (accounts.length && (!from || nowMonth >= from)) {
    out.push({ month: nowMonth, balance: Math.round(accountsTotal(accounts, now)), live: true });
  }
  return out;
}

/** Actual minus plan for each month both have: + ahead, − behind. */
export function versusPlan(actual, planned) {
  const byMonth = Object.fromEntries((planned || []).map(p => [p.month, p.balance]));
  return (actual || [])
    .filter(a => byMonth[a.month] != null)
    .map(a => ({ month: a.month, actual: a.balance, planned: byMonth[a.month], diff: a.balance - byMonth[a.month], live: !!a.live }));
}

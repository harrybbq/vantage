/**
 * Interest on the savings accounts — the balance as it stands TODAY.
 *
 * An account was a balance and a rate, and the balance sat at whatever
 * was typed in until it was typed again: a 4.1% saver entered in March
 * still showed the March figure in September. The projection compounded
 * forward from it, but "now" never moved.
 *
 * ── The model ────────────────────────────────────────────────────────
 * The stored `balance` is what the account held at `balanceAt`. Today's
 * balance is that, grown at the APY for the whole days since:
 *
 *     balance × (1 + APY) ^ (days / 365)
 *
 * which is what an APY (or a UK AER) means — the effective rate over a
 * year, however often the bank actually credits it. Daily rather than
 * stepping on a monthly credit date because we do not know anyone's
 * credit date, and because it makes settling lossless (below).
 *
 * ── Derived, never written on load ───────────────────────────────────
 * Nothing here runs a write. An account entered before this existed has
 * no `balanceAt`; it accrues from INTEREST_EPOCH (the release) rather
 * than being stamped on open — a new build must never rewrite state as
 * it loads.
 *
 * ── Settling ─────────────────────────────────────────────────────────
 * Anything that CHANGES a balance (typing a new one, the monthly plan
 * post paying in, completing a pot drawing it down) goes through
 * `settleAccount`: fold the interest earned so far into the balance,
 * apply the change, restamp. Without that, a deposit made today would
 * earn interest backdated to March, and a withdrawal would lose the
 * interest the money had already earned.
 */

const DAY = 86400000;

/** Accrual start for balances that predate this feature (25 Sep 2026). */
export const INTEREST_EPOCH = new Date(2026, 8, 25).getTime();

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** The monthly rate equivalent to an APY — for month-stepped projections. */
export function monthlyRate(apy) {
  const r = num(apy) / 100;
  return r > -1 ? Math.pow(1 + r, 1 / 12) - 1 : 0;
}

/**
 * One account today.
 * @returns { balance, base, earned, days, since }
 */
export function accountBalance(a, now = Date.now()) {
  const base = num(a && a.balance);
  const apy = num(a && a.apy);
  const since = Number(a && a.balanceAt) || INTEREST_EPOCH;
  const days = Math.max(0, Math.floor((now - since) / DAY));
  if (base <= 0 || apy <= 0 || days === 0) return { balance: base, base, earned: 0, days, since };
  const balance = base * Math.pow(1 + apy / 100, days / 365);
  return { balance, base, earned: balance - base, days, since };
}

/** Today's balance, as a number — the one most callers want. */
export const balanceNow = (a, now = Date.now()) => accountBalance(a, now).balance;

/** Sum of today's balances. */
export const accountsTotal = (accounts, now = Date.now()) =>
  (accounts || []).reduce((s, a) => s + balanceNow(a, now), 0);

/**
 * The account after a change of `delta` (negative to draw down), with
 * interest-to-date folded in and the clock restarted. Never below zero;
 * rounded to the penny, because it is money and it is stored.
 */
export function settleAccount(a, delta = 0, now = Date.now()) {
  const today = balanceNow(a, now);
  const next = Math.max(0, Math.round((today + (Number(delta) || 0)) * 100) / 100);
  return { ...a, balance: next, balanceAt: now };
}

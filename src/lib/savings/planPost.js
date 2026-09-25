/**
 * The month that has just finished, posted from the plan.
 *
 * ── Why ──────────────────────────────────────────────────────────────
 * The cash flow already states what moves every month: £250 into the
 * house deposit, £100 into the ISA, on a standing order that does not
 * need supervising. And then the user was asked to type both of them
 * into the pot ledger by hand, every month, forever — or, far more
 * likely, not to, and to watch their pots read as behind when they were
 * not.
 *
 * Vantage has no bank connection and no purchase history, so it cannot
 * KNOW the money moved. What it can do is stop asking for data it has
 * already been given: propose the month from the plan and take one tap
 * for the whole thing. Derivation where sensing is not available.
 *
 * ── The line this does not cross ─────────────────────────────────────
 * It never posts on its own. Every entry it writes is money the user
 * confirmed, on rows they can edit or drop first, and the confirmation
 * is per month rather than standing — an app that silently grew your
 * savings would be worse than useless, because the number would be
 * wrong in the direction you wanted to believe.
 *
 * ── Never twice ──────────────────────────────────────────────────────
 * Three guards, because posting the same month twice is inventing money:
 *   1. `S.planLedger.months[month]` records every month decided, posted
 *      or skipped, and a decided month is never proposed again.
 *   2. Contribution ids are deterministic (`plan-2026-08-<itemId>`), and
 *      addContribution refuses an id already on the pot's ledger.
 *   3. `S.planLedger.from` is set the first time a plan is seen, and
 *      nothing before that month is ever proposed — connecting the
 *      feature does not back-post a year the user may already have
 *      entered by hand.
 *
 * New state key, additive:
 *   S.planLedger { from: 'YYYY-MM', months: { 'YYYY-MM': {...} } }
 *
 * Pure. No React, no network.
 */
import { settleAccount } from './interest.js';
import { toMonthly, activeAt } from './derive.js';
import { addContribution } from './contribute.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function monthLabel(key) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return key || '';
  return `${MONTHS[m - 1]} ${y}`;
}

/** Months from `now` to `key` — negative for a month already gone. */
export function monthOffset(key, now) {
  const [y, m] = String(key || '').split('-').map(Number);
  if (!y || !m) return 0;
  return (y * 12 + (m - 1)) - (now.getFullYear() * 12 + now.getMonth());
}

/** The month before this one. */
export function prevMonth(key) {
  const [y, m] = String(key).split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return monthKey(d);
}

const ledgerOf = S => (S && S.planLedger) || {};
const decided = (S, month) => !!(ledgerOf(S).months || {})[month];

/** Rows that send money somewhere other than the current account. */
export function routedRows(S) {
  const items = (S && S.projection && S.projection.items) || [];
  const accounts = (S && S.savingsAccounts) || [];
  const byId = new Map(accounts.map(a => [a.id, a]));
  return items.filter(it => {
    if (it.goalId) return true;
    const acc = it.accountId ? byId.get(it.accountId) : null;
    return !!acc;
  });
}

/**
 * Start the clock, the first time there is a plan to post from.
 *
 * Returns `prev` unchanged once armed, or while there is nothing
 * routed — so this can run on every open without touching state.
 */
export function armPlanLedger(prev, now = new Date()) {
  const ledger = ledgerOf(prev);
  if (ledger.from) return prev;
  if (!routedRows(prev).length) return prev;
  return { ...prev, planLedger: { ...ledger, from: monthKey(now), months: ledger.months || {} } };
}

/**
 * The one month waiting for a decision, or null.
 *
 * Only ever the month that has just finished. Offering a backlog would
 * mean asking someone to remember what moved in June, and a wrong
 * answer there is money on a pot that never arrived.
 */
export function duePlanMonth(S, now = new Date()) {
  const ledger = ledgerOf(S);
  if (!ledger.from) return null;
  const month = prevMonth(monthKey(now));
  if (month < ledger.from) return null;
  if (decided(S, month)) return null;
  if (!routedRows(S).length) return null;
  return month;
}

/**
 * What the plan says moved in `month`.
 *
 * A row naming both a pot and one of that pot's own accounts is ONE
 * movement, not two — the same dedupe routedFor makes, for the same
 * reason: counting it twice would double every figure it touched.
 */
export function proposePlanPosts(S, month, now = new Date()) {
  if (!month) return [];
  const accounts = (S && S.savingsAccounts) || [];
  const goals = (S && S.savings) || [];
  const byAccount = new Map(accounts.map(a => [a.id, a]));
  const byGoal = new Map(goals.map(g => [g.id, g]));
  const m = monthOffset(month, now);

  const out = [];
  for (const it of routedRows(S)) {
    if (!activeAt(it, m, now)) continue;
    const amount = Math.round(toMonthly(it.amount, it.freq) * 100) / 100;
    if (!(amount > 0)) continue;
    const account = it.accountId ? byAccount.get(it.accountId) : null;
    const goalId = it.goalId || (account && account.goalId) || null;
    // A completed pot takes no more contributions; money routed through
    // an account still lands in the account.
    const hit = goalId ? byGoal.get(goalId) : null;
    const goal = hit && !hit.completedAt ? hit : null;
    if (!goal && !account) continue;        // routed at something deleted or finished
    out.push({
      itemId: it.id,
      label: it.label || 'Untitled',
      amount,
      goalId: goal ? goal.id : null,
      goalName: goal ? goal.name : null,
      accountId: account ? account.id : null,
      accountName: account ? account.name : null,
    });
  }
  return out;
}

/** Noon on the last day of the month, so a post buckets into the month
 *  it belongs to wherever it is read from. */
function stampFor(month) {
  const [y, m] = String(month).split('-').map(Number);
  return new Date(y, m, 0, 12, 0, 0).toISOString();
}

export const contributionId = (month, itemId) => `plan-${month}-${itemId}`;

/**
 * Post the confirmed rows.
 *
 * `rows` is what the user agreed to, which may be fewer rows and
 * different amounts than were proposed — the proposal is the plan, the
 * post is what happened, and those are allowed to differ.
 *
 * Returns `prev` unchanged if the month has already been decided.
 */
export function applyPlanPosts(prev, month, rows, now = Date.now()) {
  if (!month || decided(prev, month)) return prev;

  const ts = stampFor(month);
  const note = `Plan · ${monthLabel(month)}`;
  let next = prev;
  let total = 0;
  const posted = [];

  for (const row of (rows || [])) {
    const amount = Math.round(Number(row.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let touched = false;

    if (row.goalId) {
      const before = next;
      next = addContribution(next, row.goalId, {
        id: contributionId(month, row.itemId),
        amount, note, ts, auto: 'plan',
      });
      touched = next !== before;
    }

    // The account is where the money physically sits; the pot is what
    // it is for. A row that names an account moves both, and a row that
    // names only a pot moves only the pot — which is exactly how the
    // two were modelled when accounts were linked to pots.
    if (row.accountId) {
      const accounts = next.savingsAccounts || [];
      const idx = accounts.findIndex(a => a.id === row.accountId);
      if (idx >= 0) {
        const nextAccounts = accounts.slice();
        // Interest earned so far is folded in before the deposit, and the
        // clock restarts — so the new money earns from today, not from
        // whenever the balance was last typed (see savings/interest).
        nextAccounts[idx] = settleAccount(accounts[idx], amount, now);
        next = { ...next, savingsAccounts: nextAccounts };
        touched = true;
      }
    }

    if (touched) { total += amount; posted.push(row.itemId); }
  }

  const ledger = ledgerOf(next);
  return {
    ...next,
    planLedger: {
      ...ledger,
      from: ledger.from || month,
      months: { ...(ledger.months || {}), [month]: { ts: Date.now(), total, itemIds: posted } },
    },
  };
}

/** Decide the month by deciding nothing moved. Recorded, so it is not
 *  asked again — a question you already answered is not a reminder. */
export function skipPlanMonth(prev, month) {
  if (!month || decided(prev, month)) return prev;
  const ledger = ledgerOf(prev);
  return {
    ...prev,
    planLedger: {
      ...ledger,
      from: ledger.from || month,
      months: { ...(ledger.months || {}), [month]: { ts: Date.now(), skipped: true, total: 0, itemIds: [] } },
    },
  };
}

/** Months already decided, most recent first — the "what has this done"
 *  answer for a user who wants to check its work. */
export function postedMonths(S) {
  const months = ledgerOf(S).months || {};
  return Object.keys(months).sort().reverse().map(k => ({ month: k, ...months[k] }));
}

/**
 * The wallet's recent rows.
 *
 * `coinHistory` is written from a dozen places — achievements, habits,
 * trackers, the shop, savings, league payouts — and each one prepends.
 * Mostly that leaves it newest-first, but "mostly" is not a guarantee
 * worth building a list on, and some accounts carry entries written
 * before the `ts` field existed at all. So this sorts rather than
 * trusting arrival order, and sinks the undated rather than hoisting
 * them: an entry we cannot place in time is the last thing that should
 * be claiming the top of a six-row list.
 *
 * Formatting lives here too, because "when did that happen" is the part
 * of a ledger row people actually read and it is all edge cases —
 * today's entries want a clock, yesterday's want a word, and last
 * March's wants a year or it reads as this March.
 *
 * Pure. No React, no DOM.
 */

const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Milliseconds, or null when the entry predates `ts` or carries junk. */
function stamp(entry) {
  const ts = Number(entry.ts);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : ts;
}

/**
 * "09:12" today, "Yest" yesterday, "3 Sep" this year, "3 Sep 25" before
 * that, "—" when there is no usable timestamp.
 */
export function whenLabel(ts, now = new Date()) {
  if (ts == null) return '—';
  const d = new Date(ts);
  if (dayKey(d) === dayKey(now)) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  // Built by stepping the Date rather than subtracting 86.4e6 ms: the
  // clocks change twice a year and on those two days a fixed day of
  // milliseconds lands an hour into the wrong one.
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return 'Yest';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-GB', sameYear
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: '2-digit' });
}

/** "+10" / "−75" — a true minus sign, which sits on the digits' midline. */
export function amountLabel(amount) {
  const n = Number(amount) || 0;
  return (n < 0 ? '−' : '+') + Math.abs(n).toLocaleString('en-GB');
}

/**
 * What kind of movement this was, in a word.
 *
 * `type` is authoritative where it exists; the sign is the fallback,
 * because an entry that says nothing about itself but takes coins away
 * is a spend whatever it forgot to record.
 */
export function kindLabel(entry) {
  if (entry.type === 'spend') return 'Spent';
  if (entry.type === 'refund') return 'Refund';
  if (entry.type === 'earn') return 'Earned';
  return Number(entry.amount) < 0 ? 'Spent' : 'Earned';
}

/**
 * The most recent `limit` movements, newest first, ready to render.
 *
 * Each row: `{ key, kind, label, when, amount, amountLabel, up }`.
 */
export function ledgerRows(coinHistory, now = new Date(), limit = 6) {
  const rows = [];
  (coinHistory || []).forEach((entry, i) => {
    if (!entry) return;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount)) return;
    const ts = stamp(entry);
    rows.push({
      key: `${i}`,
      i,
      ts,
      kind: kindLabel(entry),
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : 'Adjustment',
      when: whenLabel(ts, now),
      amount,
      amountLabel: amountLabel(amount),
      up: amount >= 0,
    });
  });

  rows.sort((a, b) => {
    if (a.ts == null && b.ts == null) return a.i - b.i;   // both undated: as given
    if (a.ts == null) return 1;                            // undated sinks
    if (b.ts == null) return -1;
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.i - b.i;                                      // same instant: as given
  });

  return rows.slice(0, Math.max(0, limit));
}

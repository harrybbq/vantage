/**
 * What today did to your coin balance.
 *
 * The wallet in the top bar shows a total, which is a fact about your
 * whole history and therefore says nothing about today. The number
 * beside it is today's NET — everything earned minus everything given
 * back — so the chip answers "am I up" as well as "how many".
 *
 * `coinHistory` is append-only and already carries the sign: an award
 * records a positive amount and a reversal a negative one, so the net is
 * just a sum. Nothing here reads `type`, deliberately — a new kind of
 * entry (a shop purchase, say) starts counting the day it is written,
 * without this needing to know it exists.
 *
 * Pure. No React, no DOM.
 */

/** Local calendar day, not UTC: "today" is the user's today. */
const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Net coins for the calendar day containing `now`.
 *
 * Entries with no usable timestamp are skipped rather than counted as
 * today's: the history predates the `ts` field in some accounts, and a
 * silent misattribution of hundreds of coins to today would be worse
 * than showing nothing.
 */
export function coinsToday(coinHistory, now = new Date()) {
  const today = dayKey(now);
  let net = 0;
  for (const entry of (coinHistory || [])) {
    if (!entry) continue;
    const ts = Number(entry.ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime()) || dayKey(d) !== today) continue;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount)) continue;
    net += amount;
  }
  return net;
}

/** "+30", "−12", or null when the day is flat and there is nothing to say. */
export function coinsTodayLabel(coinHistory, now = new Date()) {
  const net = coinsToday(coinHistory, now);
  if (net === 0) return null;
  // A true minus sign, not a hyphen: it sits on the digits' midline and
  // matches the width of the plus beside it in a tabular font.
  return (net > 0 ? '+' : '−') + Math.abs(net).toLocaleString('en-GB');
}

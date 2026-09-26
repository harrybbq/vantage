/**
 * The Career plan's master timeline: which column each item sits in, what
 * its status is, and where plans collide.
 *
 * Items are months, not dates: 'YYYY-MM', optionally with an `end` month
 * for a span. Two special starts:
 *   'post-completion'  — placed in the column after the keys month of the
 *                        chosen house scenario, so it moves when the
 *                        scenario does rather than being guessed at.
 *   anything past the range end lands in the 'after' column.
 *
 * Pure. No React, no network.
 */
import { addMonths, isMonth, monthDiff, monthsFrom, readiness } from './money.js';

export const STATUSES = ['planned', 'in_progress', 'done', 'at_risk'];
export const STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', done: 'Done', at_risk: 'At risk' };

/** Columns: every month in range, then 'after'. */
export function columns(range) {
  if (!range || !isMonth(range.from) || !isMonth(range.to)) return [];
  return [...monthsFrom(range.from, range.to), 'after'];
}

/**
 * [startCol, endCol] indexes for an item, or null if it cannot be placed.
 * `postMonth` is where 'post-completion' items begin (keys month + 1).
 */
export function span(item, cols, postMonth) {
  const months = cols.filter(c => c !== 'after');
  const last = months[months.length - 1];
  const afterIdx = cols.indexOf('after');
  const idx = m => {
    if (!isMonth(m)) return -1;
    if (monthDiff(months[0], m) < 0) return 0;
    if (monthDiff(m, last) < 0) return afterIdx;
    return cols.indexOf(m);
  };
  let from = item.start, to = item.end || item.start;
  if (from === 'post-completion') {
    if (!isMonth(postMonth)) return null;
    from = postMonth;
    to = item.end && isMonth(item.end) ? item.end : postMonth;
  }
  const a = idx(from), b = idx(to);
  if (a < 0) return null;
  return [a, Math.max(a, b < 0 ? a : b)];
}

export const statusOf = (item, statusMap) =>
  (statusMap && statusMap[item.id] && STATUSES.includes(statusMap[item.id].status))
    ? statusMap[item.id].status
    : (STATUSES.includes(item.status) ? item.status : 'planned');

/** Months an item covers (post-completion resolved), for collision checks. */
export function monthsOfItem(item, postMonth) {
  let from = item.start, to = item.end || item.start;
  if (from === 'post-completion') { from = postMonth; to = isMonth(item.end) ? item.end : postMonth; }
  if (!isMonth(from) || !isMonth(to) || monthDiff(from, to) < 0) return isMonth(from) ? [from] : [];
  return monthsFrom(from, to);
}

/** Months a cert's exam may fall in: `target` 'YYYY-MM', or target..targetEnd. */
export function examMonths(cert) {
  if (!isMonth(cert.target)) return [];
  if (isMonth(cert.targetEnd) && monthDiff(cert.target, cert.targetEnd) >= 0) return monthsFrom(cert.target, cert.targetEnd);
  return [cert.target];
}

/**
 * Exams that share a month with a house milestone. The rule is strict —
 * any exam in a house month warns; Jan–Jun 27 is where both pile up.
 * Only dated HOUSE items count (not post-completion renovation).
 * → [{ certId, cert, month, house: [titles] }]
 */
export function examCollisions(certs, items, { houseStream = 'HOUSE' } = {}) {
  const houseByMonth = {};
  for (const it of items || []) {
    if (it.stream !== houseStream || it.start === 'post-completion') continue;
    for (const m of monthsOfItem(it)) (houseByMonth[m] ||= []).push(it.title);
  }
  const out = [];
  for (const c of certs || []) {
    if (c.completed || c.status === 'passed' || c.status === 'done') continue;
    for (const m of examMonths(c)) {
      if (houseByMonth[m]) out.push({ certId: c.id, cert: c.name, month: m, house: houseByMonth[m] });
    }
  }
  return out;
}

/** Items that move when cash arrives later: every `cashDependent` item shifted by `delta` months. */
export function shifted(items, delta) {
  if (!delta) return [];
  return (items || [])
    .filter(it => it.cashDependent && isMonth(it.start))
    .map(it => ({ ...it, from: it.start, start: addMonths(it.start, delta), end: isMonth(it.end) ? addMonths(it.end, delta) : it.end }));
}

/**
 * Where cash-dependent items land if the bonus never comes. An item that
 * names its `scenario` moves by that scenario's own difference (ready
 * without bonus − ready with bonus) — which is zero for anything the bonus
 * could not have paid for yet. An item with no scenario uses `fallback`.
 * → [{ id, title, from, to, delta }] for items that actually move.
 */
export function bonusShift(items, money, fallback = 1) {
  const cache = {};
  const deltaFor = id => {
    if (id in cache) return cache[id];
    const sc = ((money && money.scenarios) || []).find(x => x.id === id);
    const r = sc ? readiness(money, sc) : null;
    return (cache[id] = r && r.ready && r.readyBonus ? monthDiff(r.readyBonus, r.ready) : null);
  };
  const out = [];
  for (const it of items || []) {
    if (!it.cashDependent || !isMonth(it.start)) continue;
    const d = it.scenario ? deltaFor(it.scenario) : fallback;
    if (!d) continue;
    out.push({ id: it.id, title: it.title, from: it.start, to: addMonths(it.start, d), end: isMonth(it.end) ? addMonths(it.end, d) : null, delta: d });
  }
  return out;
}

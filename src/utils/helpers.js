import { trackerDone } from '../lib/trackers/done.js';

export function adjustColour(hex, amt) {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function timeAgo(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * ISO-8601 week key, 'YYYY-Www', for a 'YYYY-MM-DD' day (or a Date).
 *
 * It keys persisted state — the weekly-coin awards are stored as
 * `awarded_<tracker>_<weekKey>` — so for every mid-year day it returns
 * exactly what the previous version did. The fixes are at the edges:
 *   · the year is the ISO week-YEAR, decided by the week's Thursday.
 *     1 Jan 2027 (a Friday) is 2026-W53, not "2027-W00"; 29 Dec 2025 (a
 *     Monday) is 2026-W01, not a second "2025-W53". The old keys split
 *     one real week in two across New Year, so its weekly goal could be
 *     awarded twice and its logs never added up.
 *   · the string is read as a LOCAL calendar day, by its parts. `new
 *     Date('2026-09-28')` is UTC midnight, which west of Greenwich is
 *     still Sunday — Mondays landed in the previous week.
 *   · the arithmetic is on UTC day numbers, so a DST change between
 *     January and the date can't knock a Monday back an hour into the
 *     week before.
 */
export function getWeekKey(dateStr) {
  let y, m, d;
  const parts = typeof dateStr === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (parts) {
    y = +parts[1]; m = +parts[2] - 1; d = +parts[3];
  } else {
    const dt = dateStr instanceof Date ? dateStr : new Date(dateStr);
    y = dt.getFullYear(); m = dt.getMonth(); d = dt.getDate();
  }
  const day = new Date(Date.UTC(y, m, d));
  const dow = (day.getUTCDay() + 6) % 7;             // Mon=0 … Sun=6
  day.setUTCDate(day.getUTCDate() - dow + 3);        // this week's Thursday
  const isoYear = day.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Thu = new Date(jan4);
  week1Thu.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((day - week1Thu) / 604800000);
  return isoYear + '-W' + String(week).padStart(2, '0');
}

/** The most coins a tracker's weekly goal can pay. Forms cap what they
 *  store; every award reads through this too, so a value written before
 *  the cap (or edited into state by hand) can't pay more. */
export const WEEKLY_COINS_MAX = 50;
export function trackerWeeklyCoins(t) {
  const n = Math.floor(Number(t && t.weeklyCoins));
  return Number.isFinite(n) ? Math.max(0, Math.min(WEEKLY_COINS_MAX, n)) : 0;
}

/** Days this week the tracker was logged — or, given the tracker,
 *  days it was DONE (a number tracker's daily target met). */
export function countWeekLogs(logs, trackerId, dateStr, tracker) {
  const targetWeek = getWeekKey(dateStr);
  return Object.entries(logs).filter(([key, dayLog]) => {
    if (getWeekKey(key) !== targetWeek) return false;
    return tracker ? trackerDone(tracker, dayLog[trackerId]) : !!dayLog[trackerId];
  }).length;
}

export function getTodayStr() {
  const today = new Date();
  return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
}

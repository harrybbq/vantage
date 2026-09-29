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

export function getWeekKey(dateStr) {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d - startOfWeek1;
  const week = Math.floor(diff / 604800000) + 1;
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
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

// STUB — replaced by the data agent's version at merge
/** Compact relative time: "now" | "2 m" | "1 h" | "3 d". */
export function ago(ms, now = Date.now()) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

/** "Fri 2 Oct, 14:26" */
export function exactTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t}`;
}

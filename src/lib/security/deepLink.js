/**
 * Deep links into the Security console — what a phone alert opens.
 *
 *   /?upgrade=security&ticket=<uuid>   → Upgrade → Security → Tickets, that ticket open
 *   /?upgrade=security&sec=database    → that sub-tab
 *   /?sec=tickets&ticket=<uuid>        → the same, short form
 *
 * The server builds the first form (netlify/lib/alertNotify.js
 * ticketLink). Upgrade is owner-gated in the UI; a deep link opened by
 * anyone else lands on "This page isn't available" and the console's
 * function answers them 401 regardless.
 *
 * Pure: explain.test.mjs pins it (npm run check:alerts).
 */
export const SECURITY_TABS = ['overview', 'database', 'netlify', 'moderation', 'tickets'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAMS = ['upgrade', 'sec', 'ticket'];

/** location.search → { tab, focus } | null */
export function parseSecurityLink(search) {
  let q;
  try { q = new URLSearchParams(typeof search === 'string' ? search : ''); } catch { return null; }
  const upgrade = q.get('upgrade');
  const sec = q.get('sec');
  const ticket = q.get('ticket');
  if (upgrade != null && upgrade !== 'security') return null;
  if (upgrade == null && sec == null) return null;
  const id = ticket && UUID.test(ticket) ? ticket.toLowerCase() : null;
  if (id) return { tab: 'tickets', focus: `ticket:${id}` };
  return { tab: SECURITY_TABS.includes(sec) ? sec : 'overview', focus: null };
}

/** The same URL without the deep-link parameters (so a reload doesn't re-open it). */
export function stripSecurityParams(href) {
  try {
    const u = new URL(href);
    for (const p of PARAMS) u.searchParams.delete(p);
    const qs = u.searchParams.toString();
    return `${u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
  } catch {
    return null;
  }
}

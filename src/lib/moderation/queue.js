/**
 * The owner's report queue — reading what /.netlify/functions/moderation
 * answers, without trusting it to be there yet.
 *
 * The function and the columns it reads (reports.status, .note,
 * .reported_snapshot, profiles.suspended_at) arrive with the audit SQL
 * and a deploy that may land in either order. Until then the endpoint
 * can answer 501 ("not installed"), 404 (no such function), or — under
 * `vite` alone — the SPA's index.html. All three mean the same thing to
 * the person looking at the panel, so they collapse into one state.
 *
 * Pure: moderation/queue.test.mjs pins it.
 */

/**
 * @returns {{ state: 'ok'|'not-installed'|'forbidden'|'error', reports: object[], error?: string }}
 */
export function readQueueResponse(status, raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (/^\s*<(?:!doctype|html)/i.test(text)) return { state: 'not-installed', reports: [] };
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (status === 501 || status === 404) return { state: 'not-installed', reports: [] };
  if (status === 401 || status === 403) return { state: 'forbidden', reports: [], error: body?.error || 'Not allowed.' };
  if (status < 200 || status >= 300) {
    return { state: 'error', reports: [], error: body?.error || `The queue didn't load (HTTP ${status}).` };
  }
  const list = Array.isArray(body) ? body : (body?.reports || body?.queue || []);
  return { state: 'ok', reports: list.map(normaliseReport).filter(Boolean) };
}

/** One report row, whatever the exact field names turn out to be. */
export function normaliseReport(r) {
  if (!r || r.id == null) return null;
  const snap = (r.reported_snapshot && typeof r.reported_snapshot === 'object') ? r.reported_snapshot : {};
  const who = r.reported || r.reported_profile || {};
  const reportedId = r.reported_id ?? r.reportedId ?? null;
  return {
    id: r.id,
    at: r.created_at || r.createdAt || null,
    reason: r.reason || null,
    context: r.context || null,
    status: r.status || 'open',
    note: r.note || null,
    reportedId,
    // Live profile first — it's what everyone sees now — then the copy
    // the reporter saw, which is all that's left once an account is gone.
    name: who.display_name || snap.display_name || null,
    handle: who.handle || snap.handle || null,
    avatar: who.avatar_url || null,
    suspended: !!(who.suspended_at || r.reported_suspended_at),
    where: snap.where || r.where || null,
    reporter: r.reporter?.handle || r.reporter_handle || null,
    deleted: reportedId == null,
  };
}

/** How many OPEN reports name each reported account — repeat targets. */
export function openCounts(reports) {
  const n = new Map();
  for (const r of reports || []) {
    if (r.status !== 'open' || !r.reportedId) continue;
    n.set(r.reportedId, (n.get(r.reportedId) || 0) + 1);
  }
  return n;
}

/** Open first, then newest first. */
export function sortQueue(reports) {
  return [...(reports || [])].sort((a, b) => {
    const ao = a.status === 'open' ? 0 : 1, bo = b.status === 'open' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return String(b.at || '').localeCompare(String(a.at || ''));
  });
}

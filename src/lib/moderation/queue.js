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
  // moderation.js answers `items` (a page of 25, with `total`); earlier
  // drafts and the security console's panel use `reports`. Read them all.
  const list = Array.isArray(body) ? body : (body?.items || body?.reports || body?.queue || []);
  const out = { state: 'ok', reports: (Array.isArray(list) ? list : []).map(normaliseReport).filter(Boolean) };
  if (body && Number.isFinite(body.total)) out.total = body.total;
  return out;
}

/**
 * One report row, whatever the exact field names turn out to be — the
 * function's camelCase shape ({ createdAt, snapshot, reported: { id,
 * name, handle, suspendedAt }, reporter: { handle }, messages }) and the
 * raw table's snake_case both read the same.
 */
export function normaliseReport(r) {
  if (!r || r.id == null) return null;
  const rawSnap = r.reported_snapshot ?? r.snapshot;
  const snap = (rawSnap && typeof rawSnap === 'object') ? rawSnap : {};
  const who = (r.reported && typeof r.reported === 'object' ? r.reported : null) || r.reported_profile || {};
  const reportedId = r.reported_id ?? r.reportedId ?? who.id ?? null;
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
    name: who.display_name || who.name || snap.display_name || null,
    handle: who.handle || snap.handle || null,
    avatar: who.avatar_url || who.avatarUrl || null,
    suspended: !!(who.suspended_at || who.suspendedAt || r.reported_suspended_at),
    banned: !!(who.banned_at || who.bannedAt || who.banned),
    where: snap.where || r.where || null,
    reporter: r.reporter?.handle || r.reporter_handle || null,
    messages: Array.isArray(r.messages)
      ? r.messages.filter(m => m && typeof m === 'object').map(m => ({
        from: m.from === 'reported' ? 'reported' : 'reporter',
        body: String(m.body || ''),
        at: m.at || m.created_at || null,
      }))
      : [],
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

/**
 * Open first, then newest first — or, with `oldestFirst` (the Security
 * console's "stale reports" link), longest-waiting first.
 */
export function sortQueue(reports, { oldestFirst = false } = {}) {
  return [...(reports || [])].sort((a, b) => {
    const ao = a.status === 'open' ? 0 : 1, bo = b.status === 'open' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const byTime = String(b.at || '').localeCompare(String(a.at || ''));
    return oldestFirst ? -byTime : byTime;
  });
}

/** An open report older than `hours` — waiting too long for a decision. */
export function isStale(r, hours = 24, now = Date.now()) {
  if (!r || r.status !== 'open' || !r.at) return false;
  const t = Date.parse(r.at);
  return Number.isFinite(t) && now - t > hours * 3600_000;
}

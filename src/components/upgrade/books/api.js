/**
 * Books' one endpoint: /.netlify/functions/books.
 *
 * Owner-only ON THE SERVER (verified JWT email vs the owner, the same
 * generic 401 for anyone else). Upgrade's useIsOwner gate is a UI gate
 * and nothing more. Every answer goes through readPanel, so a function
 * that isn't deployed reads as "not installed" and one whose SQL hasn't
 * been run reads as not_configured — never as an error or a healthy £0.
 */
import { authFetch } from '../../../lib/authFetch';
import { readPanel } from '../../../lib/security/status';

export const BOOKS = '/.netlify/functions/books';
export const BOOKS_SQL = 'supabase/books_2026_10.sql';

/** GET ?view=… → { state, data?, hint?, error? }. Never throws. */
export async function fetchBooks(view, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const q = new URLSearchParams({ view, ...clean });
  try {
    const res = await authFetch(`${BOOKS}?${q}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    return readPanel(res.status, await res.text());
  } catch {
    return { state: 'error', error: "Couldn't reach the server." };
  }
}

/** POST { action, … } → { ok:true, data } | { ok:false, state, error }. Never throws. */
export async function booksAction(action, body = {}) {
  try {
    const res = await authFetch(BOOKS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const text = await res.text();
    const out = readPanel(res.status, text);
    if (out.state === 'ok') return { ok: true, data: out.data };
    // A refused write says which fields (the server validates with the same rules as the forms).
    if (res.status === 400) {
      let reply = null;
      try { reply = JSON.parse(text); } catch { /* not json */ }
      const errors = reply && reply.errors && typeof reply.errors === 'object' ? reply.errors : null;
      const first = errors ? Object.values(errors)[0] : null;
      return { ok: false, state: 'invalid', errors, error: first || (reply && reply.error) || 'The server refused that.' };
    }
    if (out.state === 'not-installed') return { ok: false, state: out.state, error: 'The books function isn’t deployed yet.' };
    if (out.state === 'not_configured') return { ok: false, state: out.state, error: `Run ${BOOKS_SQL} first.` };
    if (out.state === 'unavailable') return { ok: false, state: out.state, error: out.hint || 'That isn’t available right now.' };
    return { ok: false, state: out.state, error: out.error || 'Could not save that.' };
  } catch {
    return { ok: false, state: 'error', error: "Couldn't reach the server." };
  }
}

/**
 * The accountant's CSV for a date range (Books' native format, so it
 * re-imports), downloaded as a file.
 * → { ok } | { ok:false, error }
 */
export async function downloadExport({ from, to }) {
  try {
    const q = new URLSearchParams({ view: 'export', from, to });
    const res = await authFetch(`${BOOKS}?${q}`, { headers: { Accept: 'text/csv' }, cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/text\/csv/i.test(type)) {
      const out = readPanel(res.status, await res.text());
      if (out.state === 'not-installed') return { ok: false, error: 'The books function isn’t deployed yet.' };
      if (out.state === 'not_configured') return { ok: false, error: `Run ${BOOKS_SQL} first.` };
      return { ok: false, error: out.error || out.hint || 'The export didn’t come back as a CSV.' };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `books-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

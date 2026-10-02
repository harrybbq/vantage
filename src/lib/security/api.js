/**
 * The Security console's one endpoint: /.netlify/functions/security-console.
 *
 * Owner-only ON THE SERVER (verified JWT email vs OWNER_EMAIL, the same
 * 401 for a non-owner as for a bad token). Upgrade's useIsOwner gate is
 * a UI gate and nothing more. Every answer goes through readPanel, so a
 * function that isn't deployed yet reads as "not installed".
 */
import { authFetch } from '../authFetch';
import { readPanel } from './status';

export const CONSOLE = '/.netlify/functions/security-console';

/** GET ?panel=… → readPanel's { state, data?, hint?, error? }. Never throws. */
export async function fetchPanel(panel, params = {}) {
  const q = new URLSearchParams({ panel, ...params });
  try {
    const res = await authFetch(`${CONSOLE}?${q}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    return readPanel(res.status, await res.text());
  } catch {
    return { state: 'error', error: "Couldn't reach the server." };
  }
}

/**
 * POST { action, … } → { ok:true, data } | { ok:false, state, error }.
 * Never throws; the caller shows `error` inline.
 */
export async function postAction(body) {
  try {
    const res = await authFetch(CONSOLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = readPanel(res.status, await res.text());
    if (out.state === 'ok') return { ok: true, data: out.data };
    if (out.state === 'not-installed') return { ok: false, state: out.state, error: 'The security console function isn’t deployed yet.' };
    if (out.state === 'not_configured' || out.state === 'unavailable') {
      return { ok: false, state: out.state, error: out.hint || 'That isn’t available yet.' };
    }
    return { ok: false, state: out.state, error: out.error || 'Could not record that.' };
  } catch {
    return { ok: false, state: 'error', error: "Couldn't reach the server." };
  }
}

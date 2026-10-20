/**
 * The server kill switch, seen from the client (STARTUP_REQUIREMENTS
 * item 78; netlify/lib/killSwitch.js).
 *
 * A paused function answers 503 `{ error: 'paused', area, message }`.
 * Nearly every caller shows `body.error` when a call fails, so left
 * alone the user would read the bare word "paused". calmPaused() swaps
 * that one response for the same 503 whose `error` IS the calm line —
 * every caller then says "Paused for maintenance — back soon." without
 * being touched. Any other response passes through untouched (and
 * unread: only a 503 is ever cloned and parsed).
 *
 * Pure — no Supabase import — so the check script can run it in node.
 */
export const PAUSED_MESSAGE = 'Paused for maintenance — back soon.';

export async function calmPaused(res) {
  if (!res || res.status !== 503) return res;
  let body = null;
  try { body = await res.clone().json(); } catch { return res; }
  if (!body || body.error !== 'paused') return res;
  const headers = new Headers(res.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(
    JSON.stringify({ error: PAUSED_MESSAGE, message: PAUSED_MESSAGE, paused: true, area: body.area || null }),
    { status: 503, statusText: 'Paused', headers },
  );
}

/** True when an already-parsed body is a calmed paused answer. */
export const isPausedBody = body => !!(body && body.paused === true);

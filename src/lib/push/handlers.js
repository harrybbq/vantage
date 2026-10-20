/**
 * Push notification handler scaffolding.
 *
 * The plumbing in useCapacitor.js already does APNs/FCM registration,
 * subscribes to token events, and routes incoming + tapped messages
 * to two callbacks. This module is what those callbacks delegate to —
 * separating "react to a push" from "register for pushes" so the
 * feature stays testable without a native runtime.
 *
 * Status: SCAFFOLDED. Will not fire end-to-end until:
 *   1. APNs key uploaded to RevenueCat / your push provider
 *   2. FCM service-account JSON uploaded
 *   3. Server-side function created that calls the push provider when
 *      a vision unlocks / a friend request arrives / etc.
 *
 * Until then this just stores the token (so the server has something
 * to target) and logs incoming messages so we can verify the wiring.
 */

import { supabase } from '../supabase';

/**
 * Persist the device push token to a place the server can read it.
 *
 * Tokens live in their own `push_tokens` table — NOT in user_data.
 * History (2026-05-03): the original implementation read user_data
 * state, mutated it, and wrote it back. That race-condition
 * read-modify-write wiped a real user's data on phone. The dedicated
 * table is the architectural fix — no read-modify-write of state,
 * no possibility of clobbering anything else on the user_data row.
 *
 * Apply `supabase/push_tokens_schema.sql` once before this is useful.
 * The migration is idempotent and includes a one-time copy of any
 * legacy tokens out of user_data.state.pushTokens. Until applied,
 * this function silently no-ops (the upsert fails on missing table,
 * we swallow it).
 */
export async function registerPushToken(userId, token, platform = 'unknown') {
  if (!userId || !token) return;
  try {
    // Single-statement upsert to a dedicated table. No read of state,
    // no possibility of overwriting user data. Conflict on (user_id,
    // token) just bumps last_seen_at — the natural cap on devices is
    // managed server-side via a periodic prune (or a count check
    // here later if we need stricter device caps).
    await supabase
      .from('push_tokens')
      .upsert({
        user_id: userId,
        token,
        platform,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'user_id,token' });
  } catch {
    // Silent fail — push token storage failing shouldn't crash the app
  }
}

/**
 * Map push `data.kind` (kebab-case wire format) → preference key in
 * S.notifications (camelCase). Anything not in this map is treated as
 * an "always-allowed" system push and bypasses the prefs check.
 */
const KIND_TO_PREF = {
  'vision-unlock':   'visionUnlock',
  'friend-request':  'friendRequest',
  'friend-accepted': 'friendRequest',
  'streak-warning':  'streakWarning',
  'coach-nudge':     'coachNudge',
  'daily-reminder':  'streakWarning', // shares the streak-warning toggle (as push-dispatch.js)
};

/**
 * Returns true if `now` falls inside the user's quiet-hours window.
 * Window can wrap midnight (e.g. 22:00 → 07:00). Both blank disables.
 *
 * Tapped pushes always pass through — quiet hours suppress proactive
 * surfacing, not the user's own intent to follow up on something.
 */
function isInQuietHours(prefs, now = new Date()) {
  const q = prefs?.quietHours;
  if (!q || !q.start || !q.end) return false;
  const [sh, sm] = q.start.split(':').map(Number);
  const [eh, em] = q.end.split(':').map(Number);
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  // Wrap-midnight case: e.g. 22:00 → 07:00 means [22:00, 24:00) ∪ [00:00, 07:00)
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

/**
 * Decide whether this incoming push should be surfaced to the user
 * given their notification preferences. Returns true to allow.
 *
 *   - Per-category opt-out (S.notifications[prefKey] === false) suppresses.
 *   - Quiet hours suppress proactive (non-tapped) pushes only.
 *   - Pushes with no recognized kind always pass (they're system-level).
 *   - Tapped pushes always pass — the user explicitly engaged.
 */
function shouldSurfacePush(msg, prefs) {
  if (!prefs) return true;
  if (msg?.tapped) return true;
  const kind = msg?.data?.kind;
  const prefKey = KIND_TO_PREF[kind];
  if (prefKey && prefs[prefKey] === false) return false;
  if (isInQuietHours(prefs)) return false;
  return true;
}

/**
 * Route an incoming push message to the right in-app side-effect.
 *
 * Supported payloads (declared in the `data` field of the push):
 *   - kind: 'vision-unlock'    → toast + (eventually) confetti
 *   - kind: 'friend-request'   → toast + navigate to Friends rail
 *   - kind: 'streak-warning'   → toast with the (generic) title
 *   - kind: 'coach-nudge'      → toast with the (generic) title; the
 *                                nudge itself is read in the app
 *
 * `msg` shape (from useCapacitor):
 *   { title, body, data: { kind, ... }, foreground?, tapped? }
 *
 * `actions` is the dependency-injection bag — caller passes in
 * navigate / showToast / prefs so this module doesn't import the world.
 *   - prefs: S.notifications snapshot for category + quiet-hours gating
 */
export function handleIncomingPush(msg, actions = {}) {
  const { navigate, showToast, prefs } = actions;
  const data = msg?.data || {};
  const kind = data.kind;

  // Honor the user's preferences before doing anything observable.
  if (!shouldSurfacePush(msg, prefs)) return;

  // Default: just toast the title + body if it's foreground
  if (!kind) {
    if (msg?.foreground && showToast && msg.title) {
      showToast(msg.title, true);
    }
    return;
  }

  switch (kind) {
    case 'vision-unlock':
      if (showToast) showToast(`✦ ${msg.title || 'Honour earned'}`, true);
      break;
    case 'friend-request':
    case 'friend-accepted':
      if (showToast) showToast(`◌ ${msg.title || 'New friend request'}`, true);
      // If tapped, navigate to where the rail lives (hub for now;
      // dedicated friends route later).
      if (msg?.tapped && navigate) navigate('hub');
      break;
    // Lock-screen safe (item 104): the server sends fixed, generic text
    // (netlify/lib/lockScreenSafe.js), so the toast shows the title —
    // the body is only ever "Open Vantage to …". Detail lives in the app.
    case 'streak-warning':
    case 'daily-reminder':
      if (showToast) showToast(`⏰ ${msg.title || 'A quick check-in'}`);
      if (msg?.tapped && navigate) navigate('track');
      break;
    case 'coach-nudge':
      if (showToast) showToast(`✦ ${msg.title || 'Your coach has a note for you'}`, true);
      if (msg?.tapped && navigate) navigate('hub');
      break;
    default:
      if (msg?.foreground && showToast && msg.title) {
        showToast(msg.title, true);
      }
  }
}

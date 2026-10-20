/**
 * Lock-screen-safe push text (item 104, DPIA G8 / R13).
 *
 * A push shows on a locked phone — to whoever is holding it, sitting next
 * to it, or looking at a car's screen. So no push Vantage sends may carry
 * anything sensitive in its title or body: no weight, calories or other
 * health numbers, no habit names (a habit called "No gambling" or "Sober"
 * says a lot), no direct-message text, no report details, no friend
 * names. Every push gets a fixed, generic title and body for its kind;
 * the detail lives in the app, behind the user's own login.
 *
 *   lockScreenSafe(kind, payload) → { title, body, data }
 *
 *   title / body  fixed text per kind (below); an unknown kind gets the
 *                 most generic text there is. Nothing from `payload` is
 *                 ever copied into either.
 *   data          { kind } plus the reference ids that kind needs to
 *                 open the right screen (e.g. `requester_id`), and only
 *                 if they look like ids. All strings (FCM requires it).
 *                 Names, handles, bodies and anything else are dropped:
 *                 `data` is not drawn on the lock screen, but it does
 *                 pass through the OS and any notification extension,
 *                 so it carries no more than the app needs.
 *
 * There is no "show previews" setting today, so this is safe by default
 * for everyone. If one is ever added, it belongs here — and the OS-level
 * preview setting still applies on top.
 *
 * Where pushes come from: rows in `notifications_queue` (written by DB
 * triggers — supabase/notifications_schema.sql — and, later, the coach
 * nudge job), sent by netlify/functions/push-dispatch.js, which runs
 * every row through this before anything reaches FCM. Kinds with no
 * writer yet (DMs, safety notices) are covered now so the first writer
 * cannot get it wrong.
 *
 * Pure. CommonJS for the functions bundle.
 */

const KINDS = {
  'friend-request':  { title: 'New friend request',            body: 'Open Vantage to see who it is.',       ids: ['requester_id'] },
  'friend-accepted': { title: 'Friend request accepted',       body: 'Open Vantage to see your friends.',    ids: ['friend_id'] },
  'coach-nudge':     { title: 'Your coach has a note for you', body: 'Open Vantage to read it.',             ids: ['nudge_id'] },
  'streak-warning':  { title: 'A quick check-in',              body: 'Open Vantage when you have a moment.', ids: [] },
  'daily-reminder':  { title: 'Your daily check-in',           body: 'Open Vantage when you have a moment.', ids: [] },
  'vision-unlock':   { title: 'You earned an honour',          body: 'Open Vantage to see it.',              ids: ['vision_id'] },
  'direct-message':  { title: 'New message from a friend',     body: 'Open Vantage to read it.',             ids: ['thread_id', 'message_id'] },
  'group-message':   { title: 'New message in a group',        body: 'Open Vantage to read it.',             ids: ['group_id', 'message_id'] },
  'safety-notice':   { title: 'You have a notice from Vantage', body: 'Open Vantage to read it.',            ids: ['notice_id'] },
};
const DEFAULT = { title: 'Vantage', body: 'You have a new notification.', ids: [] };

/** A uuid or a short opaque id — never free text. */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

function lockScreenSafe(kind, payload) {
  const k = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, kind) ? kind : null;
  const spec = k ? KINDS[k] : DEFAULT;
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const data = { kind: k || 'notification' };
  for (const key of spec.ids) {
    const v = p[key];
    if ((typeof v === 'string' || typeof v === 'number') && ID_SHAPE.test(String(v))) data[key] = String(v);
  }
  return { title: spec.title, body: spec.body, data };
}

module.exports = { lockScreenSafe, LOCK_SCREEN_KINDS: KINDS, LOCK_SCREEN_DEFAULT: DEFAULT };

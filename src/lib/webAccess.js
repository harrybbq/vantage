/**
 * The web gate — who gets the full app in a web browser (item 131).
 *
 * Owner decision 2026-10-20: at public launch Vantage is used through the
 * iPhone/Android apps. In a browser the full app is for an owner-kept
 * allow-list (the owner + friends); everyone else signed in on the web
 * gets "Vantage is on iPhone and Android". It is a SWITCH, held in
 * `public.config` under `web_access` (supabase/web_access_2026_10b.sql),
 * and it ships OPEN — flipping it needs no deploy.
 *
 * Pure (no React, no Supabase, no window) so every branch is pinned by
 * webAccess.test.mjs (npm run check:webaccess). The reads live in
 * webAccessClient.js; App.jsx renders what decideWebAccess() returns.
 *
 * Fail-open rules, in order of precedence:
 *   · The native app is never gated (the store app IS the product).
 *   · Public pages (/privacy, /terms, /support, /delete-account) are open
 *     to everyone, whatever the mode — store review and Google's web
 *     deletion requirement depend on them.
 *   · A missing config row, an unknown value or a failed read → 'open',
 *     so a read error can never lock anyone out while the switch is off…
 *   · …except that once this tab has SEEN 'allowlist', a transient read
 *     error keeps 'allowlist' (otherwise a blip would reopen the web).
 */

export const WEB_ACCESS_MODES = Object.freeze(['open', 'allowlist']);

/** 'allowlist' for exactly that value (any case/whitespace); everything else is 'open'. */
export function normalizeMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'allowlist' ? 'allowlist' : 'open';
}

/**
 * The mode to act on, from one config read.
 *   read      — { ok: true, value: string|null } (null = no row), or { ok: false } for an error/timeout
 *   lastKnown — the mode this tab last resolved from a SUCCESSFUL read, or undefined
 */
export function resolveMode(read, lastKnown) {
  if (read && read.ok === true) return normalizeMode(read.value);
  return lastKnown === 'allowlist' ? 'allowlist' : 'open';
}

/**
 * Whether this signed-in user may use the full web app, from one
 * web_access_allowed() call.
 *   read      — { ok: true, value: boolean } or { ok: false }
 *   lastKnown — this user's last successful answer in this tab, or undefined
 * Returns true / false, or null when it is unknown (error and nothing known).
 */
export function resolveAllowed(read, lastKnown) {
  if (read && read.ok === true) return read.value === true;
  return typeof lastKnown === 'boolean' ? lastKnown : null;
}

/**
 * What App renders.
 *
 *   native       — running in the Capacitor shell
 *   publicRoute  — the URL is a public page (resolvePublicPage) — or an
 *                  invite landing being PREVIEWED, which App handles itself
 *   mode         — 'open' | 'allowlist' | undefined (not resolved yet)
 *   signedIn     — boolean
 *   owner        — true when is_app_owner() said so (only ever promotes)
 *   allowed      — true | false | null (check failed, nothing known) | undefined (in flight)
 *
 * Returns one of:
 *   'public'       — render the public page; nothing else is decided
 *   'full'         — today's behaviour: sign-in screen, or the app
 *   'pending'      — signed in, waiting on the mode or the check: hold the loader
 *   'invite-only'  — signed out, mode allowlist: sign-in screen + the one-line note
 *   'gate'         — signed in, not allowed: the app-store page; the app never mounts
 *   'unverified'   — signed in, the check failed with nothing known: the
 *                    app-store page with a "check again" button
 */
export function decideWebAccess({ native, publicRoute, mode, signedIn, owner, allowed } = {}) {
  if (native) return 'full';
  if (publicRoute) return 'public';
  if (!signedIn) return mode === 'allowlist' ? 'invite-only' : 'full';
  if (mode === undefined) return 'pending';
  if (mode !== 'allowlist') return 'full';
  if (owner === true || allowed === true) return 'full';
  if (allowed === false) return 'gate';
  if (allowed === null) return 'unverified';
  return 'pending';
}

/**
 * Once the app has mounted for a user in this page load, a later change
 * (the owner flipping the switch, a re-check, the mode arriving late)
 * must never unmount it: unmounting Board mid-session could drop an
 * unsaved edit. The gate is decided at boot; the next load applies a
 * new mode.
 *   latchedUser — the user id the app last mounted for, or null
 */
export function latchDecision(decision, { signedIn, userId, latchedUser } = {}) {
  if (!signedIn || !userId || latchedUser !== userId) return decision;
  return decision === 'pending' || decision === 'gate' || decision === 'unverified' ? 'full' : decision;
}

/** True only when the main app (Board, and with it the state load/save) may mount. */
export function mayMountBoard(decision, signedIn) {
  return decision === 'full' && !!signedIn;
}

/** True when the store-app page replaces the app for this signed-in visitor. */
export function isGated(decision) {
  return decision === 'gate' || decision === 'unverified';
}

/**
 * The invite landing's call to action: "Open in the Vantage app" + store
 * links instead of signing in on the web. Signed out in allowlist mode
 * counts — they cannot use the web app either unless they are listed,
 * and a listed friend can still sign in from the normal screen.
 */
export function inviteAppOnly(decision) {
  return decision === 'invite-only' || isGated(decision);
}

// ── Owner panel input ─────────────────────────────────────────────────

/** Lower-cased, trimmed email, or null when it does not look like one (the server checks again). */
export function cleanEmail(raw) {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v.length < 3 || v.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** Note as stored: trimmed, ≤200 chars, empty → null. */
export function cleanNote(raw) {
  const v = typeof raw === 'string' ? raw.trim().slice(0, 200) : '';
  return v || null;
}

/**
 * One calm sentence for a failed owner RPC. Never the raw error: the SQL
 * not being run yet is the expected case until launch prep.
 */
export function ownerErrorMessage(error) {
  const code = error && (error.code || error.status);
  const msg = String((error && error.message) || '');
  if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg)) {
    return 'Web access isn’t set up yet — run supabase/web_access_2026_10b.sql in the Supabase SQL editor.';
  }
  if (code === '42501' || /not allowed|permission denied/i.test(msg)) {
    return 'Only the app owner can change web access.';
  }
  if (code === '22023' || /invalid email/i.test(msg)) return 'That doesn’t look like an email address.';
  if (/invalid mode/i.test(msg)) return 'Unknown mode.';
  return 'Couldn’t reach the server. Check your connection and try again.';
}

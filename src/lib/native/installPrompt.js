/**
 * When may the "Add to Home Screen" prompt appear?
 *
 * History (2026-10-17): the prompt showed on every section, on the
 * first visit, three seconds in, bottom centre over the content, and a
 * dismissal only lasted until the tab closed (sessionStorage). Asking a
 * stranger to install something before they have used it is the
 * request most likely to be refused, and asking again every visit
 * turns a refusal into an annoyance.
 *
 * The rules now:
 *   · Never inside the native app (it IS the installed thing) and never
 *     when the page is already running standalone.
 *   · Only after the person has done something worth coming back for:
 *     a second visit in this browser, or real data in their state.
 *   · At most ONCE per browser. Shown is remembered the moment it
 *     appears, dismissed is remembered too, both in localStorage.
 *
 * Storage can throw (private mode, blocked site data) — every access
 * is wrapped, and a throw reads as "not allowed to show", so the worst
 * case is a prompt that never appears rather than one that nags.
 *
 * Pure apart from the storage helpers, which take the Storage objects
 * as arguments so the test can hand in fakes.
 */

export const INSTALL_KEYS = {
  dismissed: 'vb4_install_dismissed',
  shown: 'vb4_install_shown',
  sessions: 'vb4_install_sessions',
  sessionCounted: 'vb4_install_session_counted', // sessionStorage
};

/** Visits needed before the prompt may show without other evidence. */
export const MIN_SESSIONS = 2;

function read(store, key) {
  try { return store ? store.getItem(key) : null; } catch { return null; }
}
function write(store, key, value) {
  try { if (store) store.setItem(key, value); return true; } catch { return false; }
}

/**
 * Count this browser session once (React StrictMode runs effects twice;
 * a reload in the same tab is the same session). Returns the running
 * total, or 0 when storage is unavailable.
 */
export function countSession(local, session) {
  const prev = parseInt(read(local, INSTALL_KEYS.sessions), 10) || 0;
  if (read(session, INSTALL_KEYS.sessionCounted)) return prev;
  const next = prev + 1;
  if (!write(local, INSTALL_KEYS.sessions, String(next))) return 0;
  write(session, INSTALL_KEYS.sessionCounted, '1');
  return next;
}

/** Has this browser already seen or dismissed the prompt? Storage
 *  failure counts as yes — never nag a browser we cannot remember. */
export function alreadyHandled(local) {
  try {
    if (!local) return true;
    return !!(local.getItem(INSTALL_KEYS.dismissed) || local.getItem(INSTALL_KEYS.shown));
  } catch {
    return true;
  }
}

export function markShown(local, now = Date.now()) {
  return write(local, INSTALL_KEYS.shown, String(now));
}

export function markDismissed(local, now = Date.now()) {
  return write(local, INSTALL_KEYS.dismissed, String(now));
}

/* Evidence that comes from setting up rather than using the app: the
 * name and tagline typed at sign-up, the onboarding self-checks. Real
 * use is everything else meaningfulEvidence() reports — a logged day,
 * a weigh-in, a savings pot, a synced band. */
const SETUP_ONLY = new Set(['profile.name', 'profile.tagline',
  'brainScore', 'financeScore', 'fitnessScore', 'socialScore']);

/** Has the person logged something? Takes meaningfulEvidence(S). */
export function hasLoggedSomething(evidence) {
  return Array.isArray(evidence) && evidence.some(k => !SETUP_ONLY.has(k));
}

/**
 * The decision itself.
 * @param {object} f
 * @param {boolean} f.native      running inside the Capacitor shell
 * @param {boolean} f.standalone  display-mode: standalone / navigator.standalone
 * @param {boolean} f.handled     shown or dismissed before in this browser
 * @param {number}  f.sessions    visits counted in this browser
 * @param {boolean} f.engaged     the person's state holds real data
 */
export function mayShowInstallPrompt({ native, standalone, handled, sessions, engaged }) {
  if (native || standalone || handled) return false;
  return !!engaged || (sessions || 0) >= MIN_SESSIONS;
}

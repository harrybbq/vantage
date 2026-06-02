import { useState, useCallback, useEffect, useRef } from 'react';
import { DEFAULT_STATE } from '../data/initialState';
import { supabase } from '../lib/supabase';

// Keys that are only relevant to the current session — never persisted
const TRANSIENT_KEYS = [
  'calYear', 'calMonth', 'ghCache', 'multiSelectedDays',
  'multiSelectMode', 'connectingFrom', 'selectedLogDate', 'shopFilter',
];

function addTransient(state) {
  return {
    ...state,
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    ghCache: {},
    multiSelectedDays: [],
    multiSelectMode: false,
  };
}

function stripForSave(state) {
  const s = { ...state };
  TRANSIENT_KEYS.forEach(k => delete s[k]);
  // Photo stored in separate column
  s.profile = { ...s.profile, photo: null };
  return s;
}

// ── Cloud helpers ──────────────────────────────────────────────────────────
//
// History note (2026-05-01): the previous version of `loadFromCloud`
// returned a single null in three different cases:
//   1. row genuinely doesn't exist (PGRST116)
//   2. any other Supabase error (network blip, RLS hiccup, etc.)
//   3. row exists but `state` column is empty/missing
//
// init() then unconditionally called `saveToCloud(userId, DEFAULT_STATE)`
// on null. Result: a transient blip at login wiped a user's real data
// to defaults, with no warning, irreversibly.
//
// The contract is now a discriminated result: `{ kind, ... }`. Only
// `no_row` is safe to recover from with a default save. Anything else
// surfaces as a load error to the UI; we never auto-overwrite ambiguous
// state.
//
// History note (2026-05-03): the discriminated-result fix landed but a
// second incident still wiped a dev preview to defaults. Cause was
// never definitively identified — most plausible is `maybeSingle()`
// returning {data: null, error: null} for a userId that DID have a row
// (RLS edge case, query cancellation race, etc). Added a localStorage
// breadcrumb (`vb4_seen_user:{userId}`) recorded on every successful
// `loaded` outcome. If we ever subsequently see `no_row` for the same
// userId, we refuse to save defaults and surface a `seen_before_no_row`
// error instead. The user can retry, sign out, or explicitly start
// fresh — no silent overwrite is possible.

const SEEN_USER_PREFIX = 'vb4_seen_user:';

function markUserSeen(userId) {
  try { localStorage.setItem(SEEN_USER_PREFIX + userId, String(Date.now())); } catch {}
}

function hasSeenUser(userId) {
  try { return !!localStorage.getItem(SEEN_USER_PREFIX + userId); } catch { return false; }
}

/**
 * Wipe the breadcrumb for the given user. Only call this after a
 * user-confirmed `startFresh()` — that's the one path where we WANT
 * the next load to be allowed to seed defaults again.
 */
function clearUserSeen(userId) {
  try { localStorage.removeItem(SEEN_USER_PREFIX + userId); } catch {}
}

async function loadFromCloud(userId) {
  // maybeSingle() returns data:null + error:null when zero rows exist,
  // which lets us cleanly distinguish "no row" from "request failed".
  const { data, error } = await supabase
    .from('user_data')
    .select('state, photo')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // Anything from the network or RLS is unsafe to recover from
    // automatically. Throw — init() catches and parks the app in an
    // error state rather than overwriting with defaults.
    const e = new Error(error.message || 'Could not load your data.');
    e.cause = error;
    throw e;
  }

  if (!data) {
    // True "no row" — first-time login for this user. Caller will
    // create one with defaults (or migrated localStorage).
    return { kind: 'no_row' };
  }

  // Row exists. If `state` is null/missing/empty we treat it as
  // suspicious rather than auto-saving over it. This is the exact
  // shape that wiped the May 2026 row, and we will not let it
  // happen silently again.
  const stateOk =
    data.state &&
    typeof data.state === 'object' &&
    Object.keys(data.state).length > 0;

  if (!stateOk) {
    return { kind: 'empty_state', photo: data.photo };
  }

  // Shape sanity check (added 2026-05-03 after the push-handler wipe).
  // A real saved state always has a `profile` key — it's set on
  // first save and only ever updated, never deleted. A state object
  // that's missing it is almost certainly the result of a partial
  // write from somewhere (legacy push handler, future bug). Treat as
  // empty_state so we surface the rescue UI rather than load it as
  // "real" and then auto-save over the actual data later.
  const looksReal = 'profile' in data.state;
  if (!looksReal) {
    console.warn(
      '[useVisionBoardState] State row exists but is missing required shape markers — treating as empty_state to avoid clobber.',
      { keys: Object.keys(data.state) }
    );
    return { kind: 'empty_state', photo: data.photo };
  }

  const state = addTransient({ ...DEFAULT_STATE, ...data.state });
  if (data.photo) state.profile = { ...state.profile, photo: data.photo };
  return { kind: 'loaded', state };
}

async function saveToCloud(userId, state) {
  const stateToSave = stripForSave(state);
  const photo = state.profile?.photo || null;

  // History note (2026-06): saves used to be fire-and-forget — the
  // upsert error was never inspected, so a failed write looked
  // identical to a successful one. We now surface failures so the
  // caller can keep the last-known-good data and retry rather than
  // assume the cloud is in sync.
  const { error } = await supabase.from('user_data').upsert({
    id: userId,
    state: stateToSave,
    photo,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    const e = new Error(error.message || 'Could not save your data.');
    e.cause = error;
    throw e;
  }
}

// ── Anti-wipe content signals ───────────────────────────────────────────────
//
// DEFAULT_STATE is NOT empty — it ships with 4 seed achievements + 3
// seed trackers. So a wiped state doesn't look empty; it looks like
// factory defaults. These two predicates let the save path tell the
// difference between "user genuinely has data" and "state has been
// reset to the out-of-box seed", so we can refuse the one transition
// that is never a legitimate single edit: real data → factory default.

/** True if the state carries any evidence of real user activity. */
function hasMeaningfulData(state) {
  if (!state || typeof state !== 'object') return false;
  return (
    Object.keys(state.logs || {}).length > 0 ||
    (state.savings || []).length > 0 ||
    Object.keys(state.visions || {}).length > 0 ||
    (state.coins || 0) > 0 ||
    !!(state.profile && state.profile.name) ||
    !!(state.profile && state.profile.tagline) ||
    (state.habits || []).length > 0 ||
    (state.links || []).length > 0 ||
    (state.shopItems || []).length > 0 ||
    (state.achievements || []).some(a => a.completed) ||
    (state.achievements || []).length > 4 ||
    (state.trackers || []).length > 3 ||
    !!state.brainScore || !!state.financeScore ||
    !!state.fitnessScore || !!state.socialScore
  );
}

/** True if the state is indistinguishable from the out-of-box seed:
 *  no logs / savings / visions / coins, no profile identity, only the
 *  seed achievements (none completed) and seed trackers. This is the
 *  exact shape a wipe-to-defaults produces. */
function looksLikeFactoryDefault(state) {
  if (!state || typeof state !== 'object') return false;
  return (
    Object.keys(state.logs || {}).length === 0 &&
    (state.savings || []).length === 0 &&
    Object.keys(state.visions || {}).length === 0 &&
    (state.coins || 0) === 0 &&
    !(state.profile && state.profile.name) &&
    !(state.profile && state.profile.tagline) &&
    (state.habits || []).length === 0 &&
    (state.achievements || []).length <= 4 &&
    !(state.achievements || []).some(a => a.completed) &&
    (state.trackers || []).length <= 3
  );
}

// ── Local last-known-good backup ─────────────────────────────────────────────
//
// Belt-and-braces: on every successful load and every successful save
// we mirror the state into localStorage. If the cloud ever does get
// into a bad state, the user can restore from here in one tap. We
// strip the heavy photo blobs (profile + savings images) so a large
// board can't blow the ~5 MB localStorage quota — data is recovered,
// photos are re-addable.

const BACKUP_PREFIX = 'vb4_backup:';

function slimForBackup(state) {
  const s = stripForSave(state); // drops transient keys + profile.photo
  if (Array.isArray(s.savings)) {
    s.savings = s.savings.map(g => (g && g.image ? { ...g, image: null } : g));
  }
  return s;
}

function writeBackup(userId, state) {
  if (!userId) return;
  try {
    localStorage.setItem(
      BACKUP_PREFIX + userId,
      JSON.stringify({ ts: Date.now(), state: slimForBackup(state) })
    );
  } catch {
    // Quota or serialization failure — non-fatal; backup is optional.
  }
}

export function readBackup(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(BACKUP_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.state && hasMeaningfulData(parsed.state)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function hasBackup(userId) {
  return !!readBackup(userId);
}

// ── localStorage fallback (migration source) ──────────────────────────────

function readLocalStorage() {
  try {
    const raw = localStorage.getItem('vb4_state');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = addTransient({ ...DEFAULT_STATE, ...parsed });
    const photo = localStorage.getItem('vb4_photo');
    if (photo) state.profile = { ...state.profile, photo };
    return state;
  } catch {
    return null;
  }
}

export function hasLocalStorageData() {
  return !!localStorage.getItem('vb4_state');
}

export function clearLocalStorageData() {
  localStorage.removeItem('vb4_state');
  localStorage.removeItem('vb4_photo');
}

// ── Main hook ─────────────────────────────────────────────────────────────

export function useVisionBoardState(userId) {
  const [S, setS] = useState(addTransient({ ...DEFAULT_STATE }));
  const [loading, setLoading] = useState(true);
  const [justMigrated, setJustMigrated] = useState(false);
  // loadError is null on success, otherwise an object the UI can use
  // to render an error screen. Specifically:
  //   { kind: 'load_failed', message }    — network / RLS / unknown
  //   { kind: 'empty_state', message }    — row exists but empty
  // Both states block any auto-save, so the user can hit "Try again"
  // (re-init) without risk.
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const saveTimer = useRef(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // ── Anti-wipe refs ──
  // loadingRef: true until the initial cloud load resolves. Blocks the
  //   debounced writer from persisting the in-memory default state
  //   before real data has arrived (closes the load-race window).
  // lastGoodMeaningfulRef: true once we've confirmed this user has real
  //   data. While true, the save path refuses any write that would
  //   reduce the state to factory defaults.
  // allowEmptyRef: briefly flipped on during a user-confirmed reset
  //   (startFresh) so the legitimate wipe IS allowed through the guard.
  const loadingRef = useRef(true);
  const lastGoodMeaningfulRef = useRef(false);
  const allowEmptyRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function init() {
      setLoading(true);
      loadingRef.current = true;
      setLoadError(null);

      let result;
      try {
        result = await loadFromCloud(userId);
      } catch (e) {
        if (cancelled) return;
        setLoadError({
          kind: 'load_failed',
          message: e?.message || 'Could not reach the server. Check your connection and try again.',
        });
        loadingRef.current = false;
        setLoading(false);
        return;
      }

      if (cancelled) return;

      if (result.kind === 'loaded') {
        // Mark that we've successfully loaded data for this userId on
        // this device. Future `no_row` for the same userId is then
        // suspicious and refuses to seed defaults. See the history
        // note above the helpers for context.
        markUserSeen(userId);
        // Record whether this user has real data — gates the save-path
        // anti-clobber guard. Mirror to the local backup so a future
        // cloud problem is recoverable.
        if (hasMeaningfulData(result.state)) {
          lastGoodMeaningfulRef.current = true;
          writeBackup(userId, result.state);
        }
        setS(result.state);
        loadingRef.current = false;
        setLoading(false);
        return;
      }

      if (result.kind === 'no_row') {
        // ── First-line defense ─────────────────────────────────────
        // If we've previously loaded data for this userId on this
        // device, `no_row` is anomalous — almost certainly a
        // false-negative from the server (RLS edge case, query
        // cancellation race, transient empty response). Refuse to
        // overwrite, surface an error, leave it to the user.
        if (hasSeenUser(userId)) {
          console.warn('[useVisionBoardState] Refusing to save defaults: userId previously had data', { userId });
          if (!cancelled) {
            setLoadError({
              kind: 'seen_before_no_row',
              message:
                "Your account is signed in but the server returned no saved data — " +
                "and we know this account had data before on this device. " +
                "We refused to overwrite the cloud with defaults. " +
                "Try Try Again. If it persists, check your network and reach out before signing out.",
            });
            loadingRef.current = false;
            setLoading(false);
          }
          return;
        }

        // ── Genuine first-time user on this device ────────────────
        // Safe to create a row with defaults (or migrated localStorage).
        const local = readLocalStorage();
        const initial = local ?? addTransient({ ...DEFAULT_STATE });
        try {
          await saveToCloud(userId, initial);
        } catch (e) {
          if (cancelled) return;
          setLoadError({
            kind: 'load_failed',
            message: e?.message || 'Could not create your initial data on the server.',
          });
          loadingRef.current = false;
          setLoading(false);
          return;
        }
        if (cancelled) return;
        // Mark seen now that we've created the row, so even THIS user
        // can't be wiped if maybeSingle returns no_row again later.
        markUserSeen(userId);
        if (hasMeaningfulData(initial)) {
          lastGoodMeaningfulRef.current = true;
          writeBackup(userId, initial);
        }
        if (local) setJustMigrated(true);
        setS(initial);
        loadingRef.current = false;
        setLoading(false);
        return;
      }

      // result.kind === 'empty_state' — row exists but state column
      // is empty/missing. Could be (a) corrupted save, (b) a recovery
      // operation in progress, (c) a user who explicitly cleared
      // their data. We refuse to overwrite. The UI prompts the user
      // to retry or escalate; "Start fresh" requires explicit consent.
      if (!cancelled) {
        setLoadError({
          kind: 'empty_state',
          message:
            'Your account exists but no saved data was found. ' +
            'This is unusual — refreshing may help. If the problem persists, ' +
            'please don\'t edit anything and reach out for help.',
        });
        loadingRef.current = false;
        setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  // reloadKey lets the user retry without unmounting the whole app.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reloadKey]);

  const update = useCallback((updater) => {
    setS(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };

      // Once this user is known to have real data, remember it so the
      // save guard below can refuse a regression to factory defaults.
      if (hasMeaningfulData(next)) lastGoodMeaningfulRef.current = true;

      // Debounce cloud saves — 1.5 s after last change.
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const uid = userIdRef.current;
        if (!uid) return;

        // Skip if parked on a load error — saving now could overwrite
        // the very data we're trying not to clobber.
        if (loadError) return;

        // Skip while the initial load is still in flight — the
        // in-memory state is the default seed until real data arrives,
        // and persisting it would be a wipe. (Closes the load race.)
        if (loadingRef.current) return;

        // ── Anti-wipe guard ───────────────────────────────────────
        // Never let an in-memory anomaly overwrite real cloud data
        // with the factory-default seed. This is the one transition
        // that is never a legitimate single edit. The user's real
        // data stays in the cloud; a refresh restores the UI. The
        // only way past this is an explicit, user-confirmed reset
        // (startFresh), which flips allowEmptyRef.
        if (
          lastGoodMeaningfulRef.current &&
          !allowEmptyRef.current &&
          looksLikeFactoryDefault(next)
        ) {
          console.error(
            '[useVisionBoardState] BLOCKED save: refusing to overwrite real data with factory defaults. ' +
            'Cloud data preserved; reload to restore.'
          );
          return;
        }

        saveToCloud(uid, next)
          .then(() => {
            // Successful write is a new known-good snapshot.
            if (hasMeaningfulData(next)) writeBackup(uid, next);
          })
          .catch(err => {
            console.error('[useVisionBoardState] Save failed — keeping last-known-good:', err?.message || err);
          });
      }, 1500);

      return next;
    });
  }, [loadError]);

  function dismissMigrationBanner() {
    setJustMigrated(false);
  }

  function retryLoad() {
    setReloadKey(k => k + 1);
  }

  /**
   * Explicit user-confirmed reset. Only call this from a UI that has
   * shown the user the consequences (e.g. "Start fresh — this will
   * permanently overwrite any saved data"). Used to recover from the
   * `empty_state` or `seen_before_no_row` error paths when the user
   * has decided to start over.
   *
   * Clears the breadcrumb first so the new `loaded` write registers
   * cleanly, and the next anomalous `no_row` is treated as a genuine
   * first-time event for the (now reset) account.
   */
  async function startFresh() {
    if (!userIdRef.current) return;
    const fresh = addTransient({ ...DEFAULT_STATE });
    try {
      // Authorise the one write that the anti-wipe guard would
      // otherwise block: a deliberate reset to factory defaults.
      allowEmptyRef.current = true;
      clearUserSeen(userIdRef.current);
      await saveToCloud(userIdRef.current, fresh);
      markUserSeen(userIdRef.current);
      lastGoodMeaningfulRef.current = false;
      setS(fresh);
      setLoadError(null);
    } catch (e) {
      setLoadError({
        kind: 'load_failed',
        message: e?.message || 'Could not save fresh state.',
      });
    } finally {
      // Re-arm the guard immediately — only the single reset write is
      // exempt; ordinary edits after a fresh start are protected again.
      allowEmptyRef.current = false;
    }
  }

  /**
   * Restore the last-known-good snapshot saved in localStorage. Used
   * from the error UI when the cloud row is bad but a local backup
   * exists. Photos (profile + savings images) aren't in the backup, so
   * they'll need re-adding, but all data is recovered.
   */
  async function restoreFromBackup() {
    const uid = userIdRef.current;
    if (!uid) return false;
    const backup = readBackup(uid);
    if (!backup || !backup.state) return false;
    const restored = addTransient({ ...DEFAULT_STATE, ...backup.state });
    try {
      clearUserSeen(uid);
      await saveToCloud(uid, restored);
      markUserSeen(uid);
      lastGoodMeaningfulRef.current = hasMeaningfulData(restored);
      setS(restored);
      setLoadError(null);
      return true;
    } catch (e) {
      setLoadError({
        kind: 'load_failed',
        message: e?.message || 'Could not restore your backup.',
      });
      return false;
    }
  }

  return {
    S, update, loading, justMigrated, dismissMigrationBanner,
    loadError, retryLoad, startFresh,
    restoreFromBackup,
    hasBackup: () => hasBackup(userIdRef.current),
  };
}

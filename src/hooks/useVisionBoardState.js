import { useState, useCallback, useEffect, useRef } from 'react';
import { DEFAULT_STATE } from '../data/initialState';
import { supabase } from '../lib/supabase';
import { mergeState, sameValue } from '../lib/state/merge';

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
    // updated_at comes back so the client knows WHICH version it is
    // editing. Without it every save was an unconditional overwrite and
    // a second device's work vanished with no error anywhere.
    .select('state, photo, updated_at')
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
  // `raw` is the stored state without the defaults folded in — the exact
  // thing the next write is compared against, so a merge base is what
  // was actually saved rather than what the app filled in around it.
  return { kind: 'loaded', state, updatedAt: data.updated_at || null, raw: data.state };
}

async function saveToCloud(userId, state, { allowEmpty = false, fromBackup = false, baseUpdatedAt = null } = {}) {
  // A state descended from the local backup is missing the photo and
  // the backgrounds. Writing one replaces the real thing with the gap.
  // Only the explicit user-confirmed restore may do it knowingly.
  if (state?.__slim && !fromBackup) {
    const e = new Error('Refused to save a state derived from the slim local backup (it has no photo or backgrounds).');
    e.code = 'SLIM_GUARD';
    console.error('[useVisionBoardState] ' + e.message);
    throw e;
  }

  const stateToSave = stripForSave(state);
  delete stateToSave.__slim;   // never let the marker reach the database
  const photo = state.profile?.photo || null;

  // ── Definitive anti-wipe guard (read-before-write) ──────────────────
  // If we're about to persist a factory-default-looking state, re-read
  // the cloud row first and REFUSE if it still holds real data. This is
  // the backstop that doesn't depend on any in-memory flag — it catches
  // every wipe vector (load races, the backgrounds migration, focus
  // refresh, etc.) by checking the actual server state at write time.
  // Only `startFresh` (user-confirmed reset) passes allowEmpty.
  if (!allowEmpty && looksLikeFactoryDefault(stateToSave)) {
    const { data: existing, error: readErr } = await supabase
      .from('user_data').select('state').eq('id', userId).maybeSingle();
    if (!readErr && existing?.state && hasMeaningfulData(existing.state)) {
      const e = new Error('Refused to overwrite real cloud data with defaults (wipe guard).');
      e.code = 'WIPE_GUARD';
      console.error('[useVisionBoardState] ' + e.message);
      throw e;
    }
  }

  // History note (2026-06): saves used to be fire-and-forget — the
  // upsert error was never inspected, so a failed write looked
  // identical to a successful one. We now surface failures so the
  // caller can keep the last-known-good data and retry rather than
  // assume the cloud is in sync.
  // Nothing in the app ever clears a photo — it is only ever set. So a
  // falsy value here means "we don't have it loaded", never "the user
  // removed it", and writing the null is always destructive. Omitting
  // the column leaves the stored value alone (upsert only SETs the keys
  // it is given). If a delete-photo feature is ever added it must pass
  // an explicit flag rather than relying on a falsy value.
  const row = {
    id: userId,
    state: stateToSave,
    updated_at: new Date().toISOString(),
  };
  if (photo) row.photo = photo;

  // ── Compare-and-set ────────────────────────────────────────────────
  // `baseUpdatedAt` is the version this client last saw. When it is
  // known we UPDATE only if the row still carries it, so a client
  // holding a stale copy cannot overwrite a newer one — it gets a
  // conflict back and the caller merges instead. Unconditional upsert
  // is kept only for the first write, where there is no version to
  // compare against and nothing yet to lose.
  if (baseUpdatedAt) {
    const { data, error } = await supabase
      .from('user_data')
      .update(row)
      .eq('id', userId)
      .eq('updated_at', baseUpdatedAt)
      .select('updated_at');
    if (error) {
      const e = new Error(error.message || 'Could not save your data.');
      e.cause = error;
      throw e;
    }
    if (!data || data.length === 0) {
      // Nothing matched: either the row moved on under us, or it is
      // gone. Either way this write must not be forced through.
      const e = new Error('Someone else saved first — merging.');
      e.code = 'CONFLICT';
      throw e;
    }
    return data[0].updated_at || row.updated_at;
  }

  const { data, error } = await supabase.from('user_data').upsert(row).select('updated_at');
  if (error) {
    const e = new Error(error.message || 'Could not save your data.');
    e.cause = error;
    throw e;
  }
  return (data && data[0] && data[0].updated_at) || row.updated_at;
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
  // Drop heavy background images from the local backup so a board with
  // several can't blow the ~5 MB localStorage quota (data is recovered;
  // backgrounds are re-addable, same trade-off as photos).
  if (s.backgrounds) s.backgrounds = {};
  // Brand the copy. This state is missing the photo and every
  // background by design, so it is safe to RENDER and never safe to
  // PERSIST. The marker travels through object spreads, so anything
  // derived from it stays branded and gets refused by saveToCloud.
  s.__slim = true;
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

/* ── The snapshot that outlives the page ────────────────────────────────
 *
 * The debounced save assumes the runtime lives another 1.5s. Close the
 * tab or swipe the app away sooner and the edit only ever existed in
 * memory. The pagehide flush starts a request, but a plain fetch is
 * abandoned when the page is discarded, and the state is far too large
 * for a keepalive body (64 KB) to carry.
 *
 * So on hide the pending state goes to localStorage SYNCHRONOUSLY —
 * which does survive — together with the version it was based on. The
 * next load merges it against whatever the cloud holds by then and
 * writes the result. The edit lands late rather than never.
 *
 * Full state, not the slim backup: this one becomes the basis of a
 * write, and the slim copy has no photo and no backgrounds.
 */
const PENDING_PREFIX = 'vb4_pending:';

function writePending(userId, state, baseUpdatedAt) {
  if (!userId || !state) return;
  try {
    localStorage.setItem(
      PENDING_PREFIX + userId,
      JSON.stringify({ ts: Date.now(), baseUpdatedAt: baseUpdatedAt || null, state: stripForSave(state) }),
    );
  } catch {
    // Quota or serialisation failure. No worse off than before this
    // existed, and never a reason to break the hide handler.
  }
}

function readPending(userId) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Same shape check the loader uses — a pending snapshot missing
    // `profile` is the partial-write shape and must never be replayed.
    if (parsed?.state && typeof parsed.state === 'object' && 'profile' in parsed.state) return parsed;
    return null;
  } catch {
    return null;
  }
}

function clearPending(userId) {
  if (!userId) return;
  try { localStorage.removeItem(PENDING_PREFIX + userId); } catch { /* nothing to do */ }
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
  // True while a local edit is pending its debounced save — focus-refresh
  // skips while dirty so it never clobbers unsaved work.
  const dirtyRef = useRef(false);
  // Which version of the row this client is editing, and the stored
  // state that came with it. Together they are the merge base: without
  // them a save is an unconditional overwrite of whatever another
  // device did in the meantime.
  const baseUpdatedAtRef = useRef(null);
  const baseStateRef = useRef(null);
  // Set if the compare-and-set predicate proves not to work at all.
  const casBrokenRef = useRef(false);
  // Set when a save had to merge, so the UI can say so once.
  const [mergeNotice, setMergeNotice] = useState(null);
  // Latest unsaved state, so the background-flush handler can persist
  // it when the app is hidden before the 1.5s debounce fires. Without
  // this, an edit made just before locking the phone (e.g. logging a
  // relapse at night) dies with the WebView process and the next
  // morning's load silently reverts it.
  const pendingStateRef = useRef(null);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function init() {
      setLoading(true);
      loadingRef.current = true;
      setLoadError(null);

      // ── Optimistic boot from the local backup ───────────────────────
      // Returning users have a last-known-good snapshot in localStorage
      // (written on every successful load/save). Render it immediately so
      // the app is interactive without waiting on the network round-trip
      // — the single biggest chunk of the initial "LOADING…" wait.
      //
      // Safety: `loadingRef` stays TRUE, so the debounced saver is still
      // blocked until the authoritative cloud copy arrives and reconciles
      // below. The optimistic state can therefore never be written back,
      // and every anomalous cloud outcome (no_row / empty_state / error)
      // still falls through to the exact same guarded handling — it just
      // has a board on screen behind it instead of a blank loader.
      const backup = readBackup(userId);
      if (backup && backup.state) {
        const optimistic = addTransient({ ...DEFAULT_STATE, ...backup.state });
        if (hasMeaningfulData(optimistic)) lastGoodMeaningfulRef.current = true;
        setS(optimistic);
        setLoading(false); // interactive now; cloud reconciles in the background
      }

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
        // The version being edited from here on, and the stored state to
        // measure later edits against.
        baseUpdatedAtRef.current = result.updatedAt;
        baseStateRef.current = result.raw;
        setS(result.state);

        // Discard anything queued against the OPTIMISTIC state.
        //
        // The optimistic paint above comes from the local backup, and
        // slimForBackup deliberately drops the two heaviest things:
        // profile.photo and every entry in backgrounds. That copy is
        // fine to look at, but it must never become the basis of a
        // write.
        //
        // It could. setLoading(false) makes the app interactive during
        // the window, and any update() in that window — a user edit, or
        // an effect like the theme resolver firing before the tier is
        // known — set dirtyRef and parked the merged result in
        // pendingStateRef. setS(result.state) replaced what was on
        // SCREEN but left that ref holding a state built on the slim
        // backup. The next debounce or pagehide flush then wrote it,
        // nulling the photo column and saving backgrounds:{} over the
        // real ones. Everything else survived because everything else
        // is in the backup — which is exactly the reported symptom:
        // profile picture and backgrounds gone, nothing else touched.
        //
        // Clearing here is also the honest choice for a real edit made
        // in that window: setS has already discarded it from the
        // screen, so keeping it queued would silently resurrect a
        // change the user can no longer see.
        dirtyRef.current = false;
        pendingStateRef.current = null;

        // ── Replay an edit the last session never got to save ────────
        // A page killed inside the debounce window leaves its state in
        // localStorage. Merge it against what the cloud holds NOW —
        // which may already include another device's changes — and queue
        // the result. Never adopted wholesale: it is one side of a merge
        // like any other, and it is queued rather than written here so
        // it goes out through the same conflict-aware path as every
        // other save.
        //
        // Deliberately after the clear above: that block exists to
        // discard anything built on the slim optimistic paint, and it
        // would discard this too if this ran first.
        const pending = readPending(userId);
        if (pending) {
          // The base is the cloud copy ONLY when the snapshot is known
          // to have been taken against this exact version. Otherwise the
          // common ancestor is unknown, and an empty base is the safe
          // reading: every key looks changed on both sides, so the merge
          // keeps both rather than letting a stale replay overwrite work
          // another device has done since.
          const mergeBase =
            pending.baseUpdatedAt && pending.baseUpdatedAt === result.updatedAt
              ? result.raw
              : {};
          const { state: merged, conflicts } = mergeState(mergeBase, pending.state, result.raw);
          if (!sameValue(merged, result.raw)) {
            const revived = addTransient({ ...DEFAULT_STATE, ...merged });
            if (result.state.profile?.photo) {
              revived.profile = { ...revived.profile, photo: result.state.profile.photo };
            }
            console.warn(
              '[useVisionBoardState] Replaying an edit the previous session could not save.',
              conflicts,
            );
            setS(revived);
            dirtyRef.current = true;
            pendingStateRef.current = revived;
          } else {
            clearPending(userId);
          }
        }

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
          const firstAt = await saveToCloud(userId, initial);
          baseUpdatedAtRef.current = firstAt;
          baseStateRef.current = stripForSave(initial);
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

  // ── Refresh on focus ────────────────────────────────────────────────
  // The app loads state once at login and never re-syncs, so a device
  // left in the background shows a stale snapshot — most visibly a habit
  // timer that's reset on another device (e.g. desktop 10h, phone 1d).
  // When the tab/app regains focus we re-pull the cloud copy and adopt
  // it, UNLESS the user has unsaved local edits (dirty), we're mid-load,
  // or parked on a load error — so this can never clobber local work.
  // Read-only: it calls loadFromCloud and only adopts a clean `loaded`
  // result; empty/ambiguous results are ignored (kept on screen).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function refresh() {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (dirtyRef.current || loadingRef.current || loadError) return;
      // Throttle — at most once per 8s, so rapid focus toggles don't hammer.
      const now = Date.now();
      if (now - lastRefreshRef.current < 8000) return;
      lastRefreshRef.current = now;

      let result;
      try {
        result = await loadFromCloud(userId);
      } catch {
        return; // network blip — keep what's on screen
      }
      if (cancelled || dirtyRef.current) return; // user started editing meanwhile
      if (result.kind === 'loaded') {
        // Never let a focus refresh blank a good screen: if the cloud
        // copy is factory-default but we currently hold real data, keep
        // what's on screen (and don't overwrite the good local backup).
        if (looksLikeFactoryDefault(result.state) && lastGoodMeaningfulRef.current) {
          console.warn('[useVisionBoardState] Focus refresh skipped: cloud looks wiped but local has data.');
          return;
        }
        markUserSeen(userId);
        if (hasMeaningfulData(result.state)) {
          lastGoodMeaningfulRef.current = true;
          writeBackup(userId, result.state);
        }
        baseUpdatedAtRef.current = result.updatedAt;
        baseStateRef.current = result.raw;
        setS(result.state);
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);

    // Focus alone is not enough. A desktop tab left open on a second
    // monitor never fires focus or visibilitychange, so it held whatever
    // it loaded hours ago — and any edit then saved that stale snapshot
    // over a phone's newer work. That is how two devices showed
    // different OVR at the same moment. Poll while visible; the guards
    // inside refresh() (dirty, loading, 8s throttle) still apply, so
    // this can never interrupt someone mid-edit.
    const poll = setInterval(refresh, 60000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loadError]);

  /**
   * The only place a save happens.
   *
   * Writes with compare-and-set. If another device got there first the
   * write is refused, and rather than dropping either version we re-read
   * the cloud, three-way merge against the version this client loaded,
   * and write the result. The merged state is adopted on screen too —
   * otherwise this device keeps showing its pre-merge view and the next
   * save diverges again.
   *
   * ── The self-check ───────────────────────────────────────────────
   * The predicate is `updated_at = <the value we were handed>`. That
   * relies on the value round-tripping through PostgREST unchanged, and
   * on nothing else rewriting the column. If it did NOT match we would
   * conflict forever and never save at all, which is worse than the bug
   * this fixes.
   *
   * So a conflict is diagnosed before it is trusted: re-read, and if the
   * row still carries the very value we just failed to match on, then
   * nobody else wrote and the mechanism itself is broken. In that case
   * fall back to unconditional writes for the rest of the session and
   * say so loudly. That is exactly today's behaviour — no protection,
   * but no regression either — instead of an app that cannot save.
   */
  const persist = useCallback(async (uid, next, { allowEmpty = false } = {}) => {
    const base = casBrokenRef.current ? null : baseUpdatedAtRef.current;

    const accept = (savedAt, state) => {
      baseUpdatedAtRef.current = savedAt;
      baseStateRef.current = stripForSave(state);
    };

    try {
      const savedAt = await saveToCloud(uid, next, { allowEmpty, baseUpdatedAt: base });
      accept(savedAt, next);
      return { ok: true };
    } catch (err) {
      if (err?.code !== 'CONFLICT') throw err;

      const fresh = await loadFromCloud(uid);
      if (fresh.kind !== 'loaded') throw err;   // ambiguous — never force

      if (base && fresh.updatedAt && fresh.updatedAt === base) {
        // The row never moved. The predicate is the problem.
        casBrokenRef.current = true;
        console.error(
          '[useVisionBoardState] compare-and-set did not match an UNCHANGED row — the '
          + 'updated_at predicate is not working. Falling back to unconditional writes for '
          + 'this session: saving still works, cross-device protection is OFF.',
        );
        const savedAt = await saveToCloud(uid, next, { allowEmpty, baseUpdatedAt: null });
        accept(savedAt, next);
        return { ok: true, degraded: true };
      }

      // A genuine conflict: someone else really did write.
      const { state: merged, conflicts } = mergeState(
        baseStateRef.current, stripForSave(next), fresh.raw,
      );
      // stripForSave nulls the photo because it lives in its own column;
      // the state the app holds must not carry that null back.
      const onScreen = addTransient({ ...DEFAULT_STATE, ...merged });
      const photo = next.profile?.photo || fresh.state.profile?.photo || null;
      if (photo) onScreen.profile = { ...onScreen.profile, photo };

      const savedAt = await saveToCloud(uid, onScreen, { allowEmpty, baseUpdatedAt: fresh.updatedAt });
      accept(savedAt, onScreen);
      setS(onScreen);
      pendingStateRef.current = null;
      if (conflicts.length) {
        console.warn('[useVisionBoardState] Merged another device\'s changes:', conflicts);
      }
      setMergeNotice({ at: Date.now(), conflicts });
      return { ok: true, merged: true, conflicts };
    }
  }, []);

  // ── Flush pending saves when the app is backgrounded ────────────────
  // The 1.5s debounce assumes the JS runtime survives long enough to
  // fire. On mobile it often doesn't: edit → lock phone → WebView
  // frozen/killed → timer never runs → the edit only ever existed in
  // memory. On visibilitychange→hidden / pagehide we fire the save
  // immediately (browsers let an already-started request complete for
  // a short grace window after hide). Same guards as the debounced
  // path so this can't become a new wipe vector.
  useEffect(() => {
    function flushPendingSave() {
      if (!dirtyRef.current) return;
      const uid = userIdRef.current;
      const next = pendingStateRef.current;
      if (!uid || !next) return;
      if (loadError || loadingRef.current) return;
      // Synchronously first. The request below is abandoned if the page
      // is discarded before it completes; this is not, and the next load
      // merges it in. Belt before braces, in that order deliberately.
      writePending(uid, next, baseUpdatedAtRef.current);
      if (
        lastGoodMeaningfulRef.current &&
        !allowEmptyRef.current &&
        looksLikeFactoryDefault(next)
      ) return;
      clearTimeout(saveTimer.current);
      persist(uid, next)
        .then(() => {
          dirtyRef.current = false;
          clearPending(uid);
          if (hasMeaningfulData(next)) writeBackup(uid, next);
        })
        .catch(() => { /* dirty stays set; debounce path retries on resume */ });
    }
    const onHide = () => { if (document.visibilityState === 'hidden') flushPendingSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPendingSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPendingSave);
    };
  }, [loadError, persist]);

  const update = useCallback((updater) => {
    setS(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };

      // Once this user is known to have real data, remember it so the
      // save guard below can refuse a regression to factory defaults.
      if (hasMeaningfulData(next)) lastGoodMeaningfulRef.current = true;

      // Mark unsaved — blocks focus-refresh from overwriting in-flight
      // local edits. Cleared once the debounced save lands. The latest
      // unsaved state is kept in a ref so the background-flush handler
      // can persist it if the app is hidden before the debounce fires.
      dirtyRef.current = true;
      pendingStateRef.current = next;

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

        persist(uid, next)
          .then(() => {
            // Successful write is a new known-good snapshot.
            dirtyRef.current = false;
            clearPending(uid);
            if (hasMeaningfulData(next)) writeBackup(uid, next);
          })
          .catch(err => {
            console.error('[useVisionBoardState] Save failed — keeping last-known-good:', err?.message || err);
          });
      }, 1500);

      return next;
    });
  }, [loadError, persist]);

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
      const freshAt = await saveToCloud(userIdRef.current, fresh, { allowEmpty: true });
      baseUpdatedAtRef.current = freshAt;
      baseStateRef.current = stripForSave(fresh);
      clearPending(userIdRef.current);
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
    // Drop the marker: this restore is the user's explicit decision, and
    // from here on the state is simply their live state. Leaving it set
    // would brand everything derived from it and block every future
    // save behind the slim guard.
    delete restored.__slim;
    try {
      clearUserSeen(uid);
      const restoredAt = await saveToCloud(uid, restored, { fromBackup: true });
      baseUpdatedAtRef.current = restoredAt;
      baseStateRef.current = stripForSave(restored);
      clearPending(uid);
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
    // Set when a save had to merge another device's changes. Nothing
    // renders it yet; it is exposed so telling the user is a UI change
    // rather than another trip through this file.
    mergeNotice,
    dismissMergeNotice: () => setMergeNotice(null),
  };
}

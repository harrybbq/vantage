import { useEffect, useRef } from 'react';
import { metVisionIds, deriveVisionState } from './derive';
import { VISIONS_BY_ID } from './definitions';

/**
 * Side-effect runtime for the Visions system.
 *
 * Job:
 *   1. On first state load (per session), silently stamp any visions
 *      that are already met. This avoids spamming the user with a
 *      barrage of unlock toasts the moment the feature ships.
 *   2. On every subsequent state change, detect newly-met visions and
 *      stamp them WITH a toast each.
 *
 * Why a hook and not a state-mutator wrapper?
 *   The set of mutators is large (logs, habits, achievements, etc.).
 *   Wiring a check into each is invasive and easy to forget. Watching
 *   `S` from one place is cheaper to maintain and impossible to miss.
 *
 * Returns: the derived level/xp object so callers can render it
 * without re-deriving themselves.
 */
export function useVisions(S, update, showToast, onUnlock) {
  // Ref guards against the toast-storm-on-load problem. Stays true
  // until the first run sees a fully-loaded `S` and either backfills
  // or confirms it was already backfilled.
  const backfillRanRef = useRef(false);
  // Tracks IDs already toasted in this session — prevents duplicate
  // toasts if React strict mode runs the effect twice in dev. The
  // server-side stamping in `update` is the durable record; this is
  // just a per-session UI dedupe.
  const toastedRef = useRef(new Set());
  // Hold showToast in a ref so its identity (caller redefines it on
  // every render of Board) doesn't force this effect to re-run on
  // every paint. We always reach for `.current` inside the effect.
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  // Same trick for onUnlock — caller's identity changes each render
  // but we want to fire-and-forget against the latest closure.
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  useEffect(() => {
    if (!S || !update) return;
    // Skip until state has loaded — DEFAULT_STATE has no profile name,
    // and visions checks are cheap, so the only signal we need is
    // "are we past the loading screen". A populated `visions` key or
    // any sign of activity works; here we use the backfill flag.
    const stamped = S.visions || {};

    // ── First run for this user this session: silent backfill ─────
    if (!backfillRanRef.current) {
      backfillRanRef.current = true;

      if (!S.visionsBackfilled) {
        const met = metVisionIds(S);
        const toStamp = met.filter(id => !stamped[id]);
        if (toStamp.length > 0 || !S.visionsBackfilled) {
          const now = new Date().toISOString();
          update(prev => {
            const next = { ...(prev.visions || {}) };
            for (const id of toStamp) {
              if (!next[id]) next[id] = { unlockedAt: now, silent: true };
            }
            return { ...prev, visions: next, visionsBackfilled: true };
          });
        }
        // Mark every backfilled vision as already-toasted so we don't
        // re-fire on the next render after `update` lands.
        for (const id of met) toastedRef.current.add(id);
      } else {
        // Already backfilled in a previous session — preload the
        // toasted set with whatever's stamped so we never re-toast on
        // refresh.
        for (const id of Object.keys(stamped)) toastedRef.current.add(id);
      }
      return;
    }

    // ── Steady-state: stamp + toast newly-met visions ────────────
    const met = metVisionIds(S);
    const newIds = met.filter(id => !stamped[id] && !toastedRef.current.has(id));
    if (newIds.length === 0) return;

    const now = new Date().toISOString();
    update(prev => {
      const next = { ...(prev.visions || {}) };
      for (const id of newIds) {
        if (!next[id]) next[id] = { unlockedAt: now };
      }
      return { ...prev, visions: next };
    });

    /* Fire toasts AFTER scheduling the state update — `showToast` is
       synchronous and reaching for fresh state would race the update.

       A burst is summarised rather than queued. Normally one vision
       lands at a time, but a release that ADDS visions can meet several
       of a long-standing user's milestones at once — the twelve
       category visions added on 2026-08-19 could unlock together for
       someone who has been logging for a year. Twelve stacked toasts is
       the storm the backfill above exists to prevent; this is the same
       courtesy for the steady state. */
    const fireToast = showToastRef.current;
    const BURST = 3;
    if (newIds.length > BURST && fireToast) {
      fireToast(`✦ ${newIds.length} visions unlocked — see them in Visions`, true, 4200);
    }
    for (const id of newIds) {
      toastedRef.current.add(id);
      const def = VISIONS_BY_ID[id];
      if (def && fireToast && newIds.length <= BURST) {
        // Re-uses CoinToast's "earn" affordance (haptic + green tint)
        // — feels right for a milestone unlock. Custom toast surface
        // can come later if visions deserve their own visual.
        fireToast(`${def.icon} Vision unlocked: ${def.title}`, true, 3200);
      }
      // Notify caller — used by App.jsx to fire the push pre-prompt
      // on the user's first vision unlock (a real celebratable moment
      // is the cleanest soft prompt for the OS push dialog).
      onUnlockRef.current?.(id);
    }
    // showToast intentionally excluded from deps — held in a ref above
    // so we re-run only when state or the updater identity changes.
  }, [S, update]);

  return deriveVisionState(S || {});
}

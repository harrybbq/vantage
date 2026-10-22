import { supabase } from './supabase';
import { isNativeApp } from './native/platform';
import { currentBuild, shouldNoteBuild, censusMarker } from './buildGate';

/**
 * The update gate's read and the build census write (Phase 0 of
 * docs/STATE_SIZE_PLAN.md). Decisions live in buildGate.js; this file
 * only talks to Supabase.
 *
 * DB load: one tiny select per page load (started at import, so it runs
 * alongside getSession instead of after it), plus at most one
 * note_client_build() call per user, platform and build on a device —
 * not one per open. Both fail soft: until
 * supabase/state_size_phase0_2026_10.sql is run, the select errors (the
 * gate reads that as "no minimum") and the census call is a no-op.
 *
 * The read is capped at READ_TIMEOUT_MS. A slow config read must never
 * hold up the app: past the cap the gate opens.
 */

const READ_TIMEOUT_MS = 2500;
const NOTED_KEY = 'vb_build_noted';
const NOTE_DELAY_MS = 5000;

export const PLATFORM = isNativeApp() ? 'native' : 'web';
export const BUILD = currentBuild();

let read;                 // undefined until settled
let readPromise = null;
const listeners = new Set();

function settle(next) {
  read = next;
  listeners.forEach(fn => { try { fn(next); } catch { /* listener's problem */ } });
}

/** Resolve min_build once per page load → { ok: true, value } | { ok: false }. */
export function loadMinBuild() {
  if (readPromise) return readPromise;
  readPromise = (async () => {
    let next;
    try {
      const { data, error } = await Promise.race([
        supabase.from('app_config').select('value').eq('key', 'min_build').maybeSingle(),
        new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), READ_TIMEOUT_MS)),
      ]);
      next = error ? { ok: false } : { ok: true, value: data ? data.value : null };
    } catch {
      next = { ok: false };
    }
    settle(next);
    return next;
  })();
  return readPromise;
}

export function peekMinBuild() { return read; }

export function onMinBuild(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Record that this user ran this build (the census that tells the owner
 * when old builds have gone). Off the boot path: it waits a few seconds,
 * never throws and never retries. Returns a cancel function.
 */
export function noteClientBuild(userId) {
  let noted = null;
  try { noted = localStorage.getItem(NOTED_KEY); } catch { /* private mode */ }
  if (!shouldNoteBuild(noted, userId, PLATFORM, BUILD)) return () => {};
  const timer = setTimeout(async () => {
    try {
      const { error } = await supabase.rpc('note_client_build', { p_platform: PLATFORM, p_build: BUILD });
      if (!error) {
        try { localStorage.setItem(NOTED_KEY, censusMarker(userId, PLATFORM, BUILD)); } catch { /* private mode */ }
      }
    } catch { /* the census is best-effort */ }
  }, NOTE_DELAY_MS);
  return () => clearTimeout(timer);
}

// Start the read now, alongside the session restore.
loadMinBuild();

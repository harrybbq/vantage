/**
 * The durable consent record (STARTUP_REQUIREMENTS item 99, DPIA G2).
 *
 * S.consent says what someone chose, but it is state the user can edit
 * and it keeps no history. consent_events (supabase/privacy_lockdown_
 * 2026_10b.sql) is append-only: one row each time health or AI consent
 * is granted or withdrawn — who, which, yes/no, which wording, when (the
 * server stamps the time; the client can't back-date it).
 *
 * Written from here, never from the sheet:
 *   · useConsentLedger watches S.consent after the cloud copy has loaded
 *     and records each change of status. The first hydrated value is
 *     the baseline (loading your own state is not a decision).
 *   · requestConsent (request.js) awaits settleGrant() after a
 *     just-in-time "Allow", so the record — and the state save, via the
 *     registered flush — has landed before the call that needed consent
 *     goes out. The server checks consent too (item 98) and would
 *     otherwise still be reading the pre-grant state.
 *
 * Fails soft: until the SQL runs the table is missing, which is
 * remembered for the session and nothing else happens. A failed insert
 * (offline) is retried once a little later.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { KINDS, consentChanges } from './consent';

/** Which consent wording the person saw. Bump when the copy in
 *  components/consent/consentCopy.js changes meaning. */
export const CONSENT_COPY_VERSION = '2026-10-20';

const RETRY_MS = 30_000;
const SETTLE_TIMEOUT_MS = 4000;

let ledgerUser = null;
let flushFn = null;
let tableMissing = false;
const recorded = new Map(); // `${userId}:${kind}` → { granted, promise }

function isMissingTable(error) {
  const code = String(error?.code || '');
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204'
    || /could not find the table|relation .* does not exist/i.test(String(error?.message || ''));
}

/** Append one event. → Promise<boolean> (true when it landed). Never throws. */
export function recordConsentEvent(kind, granted, { userId = ledgerUser, retry = true } = {}) {
  if (!userId || !KINDS.includes(kind) || typeof granted !== 'boolean') return Promise.resolve(false);
  const key = `${userId}:${kind}`;
  const prev = recorded.get(key);
  if (prev && prev.granted === granted) return prev.promise;   // already recorded / in flight
  const entry = { granted, promise: null };
  entry.promise = (async () => {
    if (tableMissing) return false;
    try {
      const { error } = await supabase.from('consent_events').insert({
        user_id: userId, kind, granted, copy_version: CONSENT_COPY_VERSION,
      });
      if (!error) return true;
      if (isMissingTable(error)) { tableMissing = true; return false; }
    } catch { /* offline */ }
    // Not recorded: forget it so a later change (or the retry) can try again.
    if (recorded.get(key) === entry) recorded.delete(key);
    if (retry) {
      setTimeout(() => {
        if (!recorded.has(key)) recordConsentEvent(kind, granted, { userId, retry: false });
      }, RETRY_MS);
    }
    return false;
  })();
  recorded.set(key, entry);
  return entry.promise;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);
}

/**
 * After a just-in-time grant: record it and save state now, so a server
 * that checks consent sees the yes. Bounded — a slow network delays the
 * feature by at most a few seconds, never blocks it. Never throws.
 */
export async function settleGrant(kind) {
  try {
    // Let React apply the consent update before flushing the save.
    const flush = new Promise(resolve => setTimeout(resolve, 50))
      .then(() => (flushFn ? flushFn() : null))
      .catch(() => null);
    await withTimeout(Promise.all([recordConsentEvent(kind, true), flush]), SETTLE_TIMEOUT_MS);
  } catch { /* never in the way */ }
}

/**
 * Mount once (App's Board). `flushNow` is useVisionBoardState's
 * "save now" (the same guarded path sign-out uses).
 */
export function useConsentLedger(userId, consent, hydrated, flushNow) {
  useEffect(() => {
    ledgerUser = userId || null;
    return () => { if (ledgerUser === userId) ledgerUser = null; };
  }, [userId]);

  useEffect(() => {
    flushFn = flushNow || null;
    return () => { if (flushFn === flushNow) flushFn = null; };
  }, [flushNow]);

  const baseRef = useRef(null); // { userId, consent }
  useEffect(() => {
    if (!userId || !hydrated) return;
    const base = baseRef.current;
    baseRef.current = { userId, consent };
    if (!base || base.userId !== userId) return;   // the baseline, not a decision
    for (const c of consentChanges(base.consent, consent)) recordConsentEvent(c.kind, c.granted, { userId });
  }, [userId, consent, hydrated]);
}

/** Tests only. */
export function _resetLedger() {
  ledgerUser = null; flushFn = null; tableMissing = false; recorded.clear();
}

/**
 * The things the app can work out for itself, run on open.
 *
 * Three passes, in one write:
 *   1. Carry stale subscription renewal dates forward (lib/money/recurring)
 *   2. Arm the plan ledger the first time there is a plan to post from
 *      (lib/savings/planPost) — nothing is ever posted without a tap
 *   3. Fill in trackers from readings already synced (lib/trackers/autoLog)
 *
 * One write because they share a debounce and a save; three modules
 * because they share nothing else.
 *
 * ── Why it is safe to run on every render ────────────────────────────
 * Every pass returns the state it was given when it has nothing to do,
 * by identity. So the composed pass is `prev === next` in the ordinary
 * case, `update` short-circuits, and no save is queued — the same
 * discipline syncWhoop needed after it was found rewriting the whole
 * ~1MB blob on every focus.
 *
 * It waits for `loading` to clear. Writing derived entries into
 * DEFAULT_STATE before the cloud has answered would be inventing logs
 * for an account that already has its own.
 */
import { useEffect, useRef } from 'react';
import { rollSubscriptions } from '../lib/money/recurring';
import { armPlanLedger } from '../lib/savings/planPost';
import { proposeAutoLogs, applyAutoLogs, recentDays } from '../lib/trackers/autoLog';

const recentTwo = () => recentDays(2);

/** The whole pass, as a pure function, so it can be reasoned about
 *  (and tested) without a React tree. */
export function runAutomations(prev, now = new Date()) {
  let next = rollSubscriptions(prev, now);
  next = armPlanLedger(next, now);
  next = applyAutoLogs(next, proposeAutoLogs(next, { now }), { now });
  return next;
}

export function useAutomations(S, update, loading) {
  // A pass is cheap but not free — it walks a fortnight per auto rule —
  // so it runs when the inputs change rather than on every render.
  // The last two days are stringified rather than counted: a strain
  // reading arriving in the afternoon updates a day that already
  // exists, so a key count would never notice it.
  const recent = recentTwo();
  const sig = [
    loading ? 'loading' : 'ready',
    (S.trackers || []).map(t => `${t.id}:${t.auto ? t.auto.source + '/' + t.auto.threshold : ''}`).join(','),
    Object.keys(S.vitalsLog || {}).length,
    Object.keys(S.burnLog || {}).length,
    recent.map(d => JSON.stringify((S.vitalsLog || {})[d] || null)).join(''),
    recent.map(d => ((S.burnLog || {})[d] || []).map(e => e && e.id).join('+')).join(''),
    (S.subscriptions || []).map(x => x.nextDate || '').join(','),
    ((S.projection || {}).items || []).length,
  ].join('|');
  const lastSig = useRef(null);

  useEffect(() => {
    if (loading) return;
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    update(prev => runAutomations(prev));
  }, [sig, loading, update]);
}

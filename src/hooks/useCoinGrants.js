/**
 * useCoinGrants — pays Monday's league winnings into the coin balance.
 *
 * ── Why the client does the paying ───────────────────────────────────
 * Coins live in `S.coins`, inside the one JSON blob that is the user's
 * whole account. The server must not rewrite that blob — the 2026-05-03
 * incident is what that rule was bought with — so settle-leagues records
 * what is owed in `coin_grants` and the client credits itself.
 *
 * ── Why that is not a way to print coins ─────────────────────────────
 * The row is the money. A grant can only be inserted by the service
 * role, RLS lets you read only your own, and column grants let you write
 * exactly one field of it: `claimed_at`, and only while it is still
 * null. So a client can claim a grant once and cannot invent one. If
 * someone edits their own coin balance in the state JSON they have
 * always been able to do that — coins are a local currency for a local
 * shopping list, and nothing ranks on them.
 *
 * ── Order of operations ──────────────────────────────────────────────
 * Stamp claimed_at FIRST, then credit. The other way round, a failure
 * between the two pays the coins again on the next load. This way a
 * failure loses a payout, which is recoverable by a human and is the
 * better of the two.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

export function useCoinGrants(userId, update, onShowCoinToast) {
  // Once per mount. A grant lands weekly; polling for it would be noise.
  const ranRef = useRef(false);

  useEffect(() => {
    if (!userId || !update || ranRef.current) return;
    ranRef.current = true;
    let live = true;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('coin_grants')
          .select('id, amount, reason, week_start')
          .eq('user_id', userId)
          .is('claimed_at', null)
          .order('granted_at', { ascending: true })
          .limit(20);
        // Table missing (schema not applied) or RLS says no — either way
        // there is nothing to pay and nothing to report.
        if (error || !data?.length || !live) return;

        const claimedAt = new Date().toISOString();
        const ids = data.map(g => g.id);
        const { error: claimErr } = await supabase
          .from('coin_grants')
          .update({ claimed_at: claimedAt })
          .in('id', ids)
          .is('claimed_at', null);
        if (claimErr || !live) return;

        const total = data.reduce((s, g) => s + (g.amount || 0), 0);
        if (total <= 0) return;

        update(prev => ({
          ...prev,
          coins: (prev.coins || 0) + total,
          coinHistory: [
            ...data.map(g => ({ type: 'earn', label: g.reason || 'League payout', amount: g.amount, ts: Date.now() })),
            ...(prev.coinHistory || []),
          ],
        }));
        if (onShowCoinToast) {
          onShowCoinToast(`+${total} ⬡ from your group's week`, true);
        }
      } catch {
        // Nothing here is worth interrupting a session for; the grant
        // stays unclaimed and is picked up next load.
      }
    })();

    return () => { live = false; };
  }, [userId, update, onShowCoinToast]);
}

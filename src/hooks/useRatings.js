/**
 * useRatings — keeps S.ratings fresh as state changes and asks the
 * server to recompute the canonical (friend-visible) ratings on a
 * larger debounce.
 *
 * Two cadences:
 *   - Client recompute: 1.5s debounce after S changes. Local-only
 *     write to S.ratings so the user sees their rating update fast.
 *   - Server recompute: 30s debounce. Fires the Netlify function
 *     `recompute-ratings` which re-derives from raw user_data and
 *     writes to profiles.{ratings, ratings_ovr, ratings_computed_at}.
 *     Friends read THOSE columns — not S.ratings — so editing the
 *     local JSON doesn't fool anyone else.
 *
 * The server recompute is intentionally slower than the client one:
 *   - Reduces request volume during heavy editing.
 *   - User sees the local rating tick UP fast (rewarding feel).
 *   - Server canonical value catches up within 30s, plenty for the
 *     friends rail use case.
 */
import { useEffect, useRef } from 'react';
import { deriveRatings } from '../lib/ratings/derive';
import { supabase } from '../lib/supabase';

const CLIENT_DEBOUNCE_MS = 1500;
const SERVER_DEBOUNCE_MS = 30_000;
const MACRO_DAYS_TTL_MS = 5 * 60_000;

export function useRatings(userId, S, update, friendCount = 0) {
  const clientTimerRef = useRef(null);
  const serverTimerRef = useRef(null);
  const lastClientSigRef = useRef(null);
  const lastServerSigRef = useRef(null);
  // Lifetime on-target macro-day count for the fitness rating's local
  // preview. Nutrition lives in Supabase (not S), so we count it here
  // on a 5-min TTL — the server recomputes its own canonical count.
  const macroDaysRef = useRef({ value: 0, fetchedAt: 0 });

  useEffect(() => {
    if (!userId) return;
    const cached = macroDaysRef.current;
    if (Date.now() - cached.fetchedAt < MACRO_DAYS_TTL_MS) return;
    let live = true;
    (async () => {
      try {
        const { data: goalRow } = await supabase
          .from('nutrition_macros').select('daily_goal')
          .eq('user_id', userId).eq('name', 'Calories').maybeSingle();
        const goal = Number(goalRow?.daily_goal) || 0;
        if (!goal) { macroDaysRef.current = { value: 0, fetchedAt: Date.now() }; return; }
        const { count } = await supabase
          .from('nutrition_daily_summary')
          .select('log_date', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('calories', Math.round(goal * 0.5))
          .lte('calories', Math.round(goal * 1.3));
        if (live) macroDaysRef.current = { value: count || 0, fetchedAt: Date.now() };
      } catch { /* preview-only — server count is canonical */ }
    })();
    return () => { live = false; };
  }, [userId, S]);

  useEffect(() => {
    if (!S) return;
    // Cheap signature: anything that affects rating points. Listed
    // explicitly so log-only ticks (which DO affect tracker points
    // through density) trigger recompute, but every state mutation
    // doesn't.
    const sig = JSON.stringify({
      achs: (S.achievements || []).map(a => `${a.id}:${a.category || ''}:${a.completed ? 1 : 0}:${a.completedAt || 0}:${a.createdAt || 0}`).join('|'),
      trks: (S.trackers || []).map(t => `${t.id}:${t.category || ''}`).join('|'),
      logs: Object.keys(S.logs || {}).slice(-30).join(','),
      sav: (S.savings || []).map(g => `${g.id}:${g.target}:${g.current}`).join('|'),
      vis: Object.keys(S.visions || {}).sort().join(','),
      bs:  S.brainScore?.result || 0,
      f:   friendCount,
      vit: Object.keys(S.vitalsLog || {}).length,
      brn: Object.keys(S.burnLog || {}).length,
      md:  macroDaysRef.current.value,
    });

    // ── Client recompute ──
    if (sig !== lastClientSigRef.current) {
      clearTimeout(clientTimerRef.current);
      clientTimerRef.current = setTimeout(() => {
        const next = deriveRatings(S, { friendCount, macroDays: macroDaysRef.current.value });
        const prev = S.ratings || {};
        // Skip the write if nothing changed (avoids endless update loops
        // since update() schedules a cloud save which re-runs this hook).
        if (
          prev.brain === next.brain &&
          prev.finance === next.finance &&
          prev.fitness === next.fitness &&
          prev.social === next.social &&
          prev.ovr === next.ovr
        ) return;
        update(p => ({ ...p, ratings: next }));
        lastClientSigRef.current = sig;
      }, CLIENT_DEBOUNCE_MS);
    }

    // ── Server recompute ──
    // Same signature gate. Function may 404 in dev (Netlify not running)
    // or return an error if the user has no profile yet — we swallow.
    if (userId && sig !== lastServerSigRef.current) {
      clearTimeout(serverTimerRef.current);
      serverTimerRef.current = setTimeout(async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return;
          const res = await fetch('/.netlify/functions/recompute-ratings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ userId }),
          });
          // Cache the canonical prestige locally (S.prestige) so badge
          // surfaces don't need a profiles round-trip. Server remains
          // the source of truth (profiles.prestige).
          if (res.ok) {
            const body = await res.json().catch(() => null);
            if (body && typeof body.prestige === 'number') {
              update(p => (p.prestige === body.prestige ? p : { ...p, prestige: body.prestige }));
            }
          }
          lastServerSigRef.current = sig;
        } catch {
          // Silent — server recompute is a nice-to-have, not a blocker.
        }
      }, SERVER_DEBOUNCE_MS);
    }

    return () => {
      clearTimeout(clientTimerRef.current);
      clearTimeout(serverTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, userId, friendCount]);
}

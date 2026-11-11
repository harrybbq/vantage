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
import { useEffect, useRef, useState } from 'react';
import { deriveRatings, cleanBaseline, cleanRatingInputs, ratingCtx, CATEGORIES } from '../lib/ratings/derive';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/authFetch';

const CLIENT_DEBOUNCE_MS = 1500;
const sameBaseline = (a, b) => !!a && CATEGORIES.every(c => Number(a[c]) === Number(b[c]));
const sameInputs = (a, b) => !!a && !!b && a.friends === b.friends && a.macroDays === b.macroDays && a.createdAt === b.createdAt;
const sameRatings = (a, b) => !!a && !!b && ['brain', 'finance', 'fitness', 'social', 'ovr'].every(k => a[k] === b[k]);
const SERVER_DEBOUNCE_MS = 30_000;
const MACRO_DAYS_TTL_MS = 5 * 60_000;

export function useRatings(userId, S, update, friendCount = 0, hydrated = true) {
  const clientTimerRef = useRef(null);
  const serverTimerRef = useRef(null);
  const lastClientSigRef = useRef(null);
  const lastServerSigRef = useRef(null);
  // Lifetime on-target macro-day count for the fitness rating's local
  // preview. Nutrition lives in Supabase (not S), so we count it here
  // on a 5-min TTL — the server recomputes its own canonical count.
  const macroDaysRef = useRef({ value: 0, fetchedAt: 0 });
  // The account's creation time, until the server's S.ratingInputs has
  // it: it floors and caps the days counted (lib/ratings/derive ratingCtx).
  const [sessionCreatedAt, setSessionCreatedAt] = useState(null);
  useEffect(() => {
    if (!userId) return undefined;
    let live = true;
    supabase.auth.getSession()
      .then(({ data }) => { if (live) setSessionCreatedAt(data?.session?.user?.created_at || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [userId]);

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
    /* Nothing is recomputed against the local backup. It is a slimmed
       copy painted for speed while the cloud answers, and deriving a
       rating from it means writing a number from an incomplete picture
       — then correcting it a moment later. That correction is what the
       user sees, and from the outside it is indistinguishable from the
       app losing their progress. */
    if (!hydrated) return;
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
      pb:  S.prestigeBaseline || null,
      ri:  S.ratingInputs || null,
      ca:  sessionCreatedAt,
    });

    // ── Client recompute ──
    if (sig !== lastClientSigRef.current) {
      clearTimeout(clientTimerRef.current);
      clientTimerRef.current = setTimeout(() => {
        // The same inputs the server counts with (S.ratingInputs), so this
        // preview is the leaderboard's sum, not a bigger one.
        const next = deriveRatings(S, {
          ...ratingCtx(S, { friendCount, macroDays: macroDaysRef.current.value, createdAt: sessionCreatedAt }),
          baseline: S.prestigeBaseline || {},
        });
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
          const res = await fetch(apiUrl('/.netlify/functions/recompute-ratings'), {
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
          // Same for the prestige baseline, which the local rating
          // subtracts — without it the app would read 99 after a
          // prestige while the leaderboard restarted the climb.
          if (res.ok) {
            const body = await res.json().catch(() => null);
            if (body && typeof body.prestige === 'number') {
              update(p => (p.prestige === body.prestige ? p : { ...p, prestige: body.prestige }));
            }
            const baseline = cleanBaseline(body?.baseline);
            if (baseline) {
              update(p => (sameBaseline(p.prestigeBaseline, baseline) ? p : { ...p, prestigeBaseline: baseline }));
            }
            // The inputs it counted with (new key, additive), and its
            // canonical numbers: the app now shows what friends see.
            const inputs = cleanRatingInputs(body?.inputs);
            if (inputs) {
              update(p => (sameInputs(p.ratingInputs, inputs) ? p : { ...p, ratingInputs: inputs }));
            }
            if (body?.ratings && typeof body.ratings.ovr === 'number') {
              update(p => (sameRatings(p.ratings, body.ratings) ? p : { ...p, ratings: { ...(p.ratings || {}), ...body.ratings, computedAt: body.computedAt || p.ratings?.computedAt } }));
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
  }, [S, userId, friendCount, hydrated, sessionCreatedAt]);
}

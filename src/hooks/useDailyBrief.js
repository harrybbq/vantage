import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSnapshot } from '../lib/coach/snapshot';
import { heuristicBrief } from '../lib/coach/heuristicBrief';

/**
 * Fetch the AI Coach daily brief once per UTC day per user, with the
 * cached result stored on the cloud state under `S.coachBrief`.
 *
 * Also maintains a rolling `coachBriefHistory` (last 7 briefs) so the
 * snapshot can include "what you said yesterday and the day before"
 * — without that, identical state two days running produces identical
 * advice from the model.
 *
 *   S         — full app state (must already be loaded)
 *   update    — useVisionBoardState updater (so we can persist the cache)
 *   isPro     — when false the hook is a no-op (saves API calls)
 *
 * Returns:
 *   { brief, loading, error, refresh }
 */
const HISTORY_LIMIT = 7;

export function useDailyBrief({ S, update, isPro }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const today = new Date().toISOString().slice(0, 10);
  const cached = S?.coachBrief;
  const cacheValid = cached && cached.date === today;
  const llmBrief = cacheValid ? cached : null;

  // Local rules-based brief — shown instantly and whenever the LLM
  // isn't available (no API key / offline). The LLM output, once it
  // arrives, supersedes it. Recomputes cheaply as state changes.
  const heuristic = useMemo(
    () => (isPro && S?.profile ? heuristicBrief(S) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPro, S?.profile?.name, S?.habits, S?.logs, S?.macroHistory, S?.vitalsLog, S?.savings]
  );
  const brief = llmBrief || heuristic;

  async function fetchBrief(force = false) {
    if (!isPro) return;
    if (!force && cacheValid) return;
    if (inFlight.current) return;
    if (!S || !S.profile) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const snapshot = buildSnapshot(S);
      const res = await fetch('/.netlify/functions/ai-coach-daily', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });

      // Read once as text, then parse. Doing res.json() blind throws an
      // unhelpful "Unexpected end of JSON input" when the response body
      // is empty (502 with no payload) or HTML (vite dev server falling
      // back to index.html because Netlify Functions aren't running).
      const raw = await res.text();
      const looksHtml = /^\s*<(?:!doctype|html)/i.test(raw);

      if (looksHtml || (!raw && !res.ok)) {
        // The endpoint isn't actually serving the function. Most common
        // cause is `npm run dev` (Vite-only) — it doesn't proxy to
        // Netlify. Use `netlify dev` locally, or rely on the deployed
        // site for AI Coach features.
        throw new Error(
          'AI Coach is offline locally — Netlify Functions only run on the deployed site or under `netlify dev`.'
        );
      }

      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error('Coach returned an unreadable response. Try again in a moment.');
        }
      }

      if (!res.ok) {
        throw new Error(data.error || `Coach request failed (HTTP ${res.status}).`);
      }
      const payload = { ...data, date: today };
      update(prev => {
        // Append to history, trim to the last N. If we already have an
        // entry for today (rare — happens on manual refresh) replace
        // it instead of duplicating.
        const prevHistory = Array.isArray(prev.coachBriefHistory) ? prev.coachBriefHistory : [];
        const filtered = prevHistory.filter(b => b.date !== today);
        const nextHistory = [
          ...filtered,
          { date: today, focus: payload.focus, watch: payload.watch, micro: payload.micro },
        ].slice(-HISTORY_LIMIT);
        return {
          ...prev,
          coachBrief: payload,
          coachBriefHistory: nextHistory,
        };
      });
    } catch (e) {
      setError(e.message || 'Coach unavailable');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  useEffect(() => {
    fetchBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, today, S?.profile?.name]);

  // Suppress the error surface while a heuristic brief is available —
  // the panel still shows useful content, so an error banner would be
  // noise. The error is only meaningful if we have nothing to show.
  return { brief, loading, error: llmBrief || !heuristic ? error : null, refresh: () => fetchBrief(true) };
}

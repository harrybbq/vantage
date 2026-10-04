/**
 * The live lines behind Upgrade's home menu: one card per section plus
 * the hero sentence. Shaping (strings, states, worst-state, times) is in
 * src/lib/upgrade/homeLines.js — see its header for the state rules.
 *
 * Sources, all of them reads the menu already made before this hook:
 *   rotation  S (derived, no request)
 *   diet      the plan's protein target + today's shared day summary
 *             (one cached request, the same one the hub uses)
 *   career    the owner store the Career tab loads anyway
 *   security  the console's cheap `?panel=overview`; only when that
 *             function isn't installed, the crest queue stands in
 * Nothing here writes anything. Every fetch fails soft into state
 * 'unknown' with an error string and a `retry` that re-fetches without
 * opening the section. No polling: the menu is opened, read, left.
 *
 * → { hero: { sub, state }, cards: { career, diet, rotation, security } }
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planProteinG } from '../../../lib/diet/plan';
import { useDaySummary, refreshDaySummary } from '../../../lib/diet/daySummary';
import { useOwnerContent } from '../../../lib/owner/ownerContent';
import { KEYS } from '../../../lib/career/schema';
import { briefFor } from '../../../lib/career/brief';
import { usePacing, useLatestVs, todayIso } from '../career/careerData';
import { crestQueue } from '../../../lib/groups/api';
import { fetchPanel } from '../../../lib/security/api';
import {
  loadingCard, worstState, rotationLine, rotationCard, dietCard, careerCard, daysUntil,
  securityCard, securityHeroBit, crestFallbackCard, crestHeroBit, securityFailedCard, heroSub,
} from '../../../lib/upgrade/homeLines';

function latestKg(S) {
  const log = (S && S.vitalsLog) || {};
  const days = Object.keys(log).sort();
  for (let i = days.length - 1; i >= 0; i--) if (log[days[i]] && log[days[i]].weight != null) return log[days[i]].weight;
  return null;
}

/**
 * Shows the card as loading from a retry until `answer` changes identity
 * (the hook it wraps has answered again). → [pending, start]
 */
function usePending(answer) {
  const [pending, setPending] = useState(false);
  useEffect(() => { setPending(false); }, [answer]);
  const start = useCallback(() => setPending(true), []);
  return [pending, start];
}

function useDietCard(S, userId) {
  const target = planProteinG(S, latestKg(S));
  const day = useDaySummary(userId);
  const [pending, start] = usePending(day);
  const retry = useCallback(() => { if (!userId) return; start(); refreshDaySummary(userId); }, [userId, start]);
  const hour = new Date().getHours();
  return useMemo(() => {
    if (pending) return loadingCard();
    const c = dietCard({ target, day, hour });
    return c.state === 'unknown' ? { ...c, retry } : c;
  }, [pending, target, day, hour, retry]);
}

function useCareerCard(S) {
  const oc = useOwnerContent('career.');
  const d = oc.data;
  const certs = useMemo(() => d[KEYS.certs] || [], [d]);
  const pacing = usePacing(S, certs);
  const vs = useLatestVs(S, oc);
  // reload() never throws (it records 'error' itself), so the pending
  // flag clears whatever it answers — even the same error again.
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const { reload, state: ocState, at: ocAt } = oc;
  const retry = useCallback(async () => {
    setPending(true);
    await reload();
    if (alive.current) setPending(false);
  }, [reload]);
  return useMemo(() => {
    if (pending) return loadingCard();
    let actions = [], exam = null;
    if (ocState === 'ready') {
      const today = todayIso();
      ({ actions } = briefFor({
        apps: d[KEYS.applications] || [], companies: d[KEYS.companies] || [], plan: d[KEYS.plan] || null,
        statusMap: d[KEYS.status] || {}, vs, certs, today,
        pacing: pacing.cert ? { cert: pacing.cert, plan: pacing.plan, examIso: pacing.examIso } : null,
      }, d[KEYS.brief] || null));
      if (pacing.cert && pacing.examIso) {
        exam = {
          name: pacing.cert.name.split(' ·')[0],
          days: daysUntil(pacing.examIso, today),
          behind: !!(pacing.plan && pacing.plan.status === 'late'),
        };
      }
    }
    const c = careerCard({ store: { state: ocState, at: ocAt }, actions, exam });
    return c.state === 'unknown' ? { ...c, retry } : c;
  }, [pending, ocState, ocAt, d, certs, pacing, vs, retry]);
}

/** → { card, bit } — bit is the hero's security fragment, or null. */
function useSecurityCard() {
  const [out, setOut] = useState({ card: loadingCard(), bit: null });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => {
    setOut(o => ({ ...o, card: loadingCard() }));
    setTick(t => t + 1);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      const ov = await fetchPanel('overview');
      if (!live) return;
      const at = Date.now();
      if (ov.state === 'ok') {
        const c = securityCard(ov.data, at);
        setOut({ card: c.state === 'unknown' ? { ...c, retry } : c, bit: securityHeroBit(ov.data) });
        return;
      }
      if (ov.state !== 'not-installed') {
        const c = securityFailedCard(ov, at);
        setOut({ card: c.state === 'unknown' ? { ...c, retry } : c, bit: null });
        return;
      }
      // Not installed yet: the crest queue is still real news.
      try {
        const body = await crestQueue();
        if (!live) return;
        setOut({ card: crestFallbackCard(body, Date.now()), bit: crestHeroBit(body) });
      } catch {
        if (live) setOut({ card: { ...securityFailedCard(null, Date.now()), retry }, bit: null });
      }
    })();
    return () => { live = false; };
  }, [tick, retry]);
  return out;
}

export function useHomeLines(S, userId) {
  const today = todayIso();
  const overrides = S && S.rotation && S.rotation.overrides;
  const rotation = useMemo(() => rotationCard({ rotation: { overrides } }, today), [overrides, today]);
  const rotaLine = useMemo(() => rotationLine({ rotation: { overrides } }, today), [overrides, today]);
  const diet = useDietCard(S, userId);
  const career = useCareerCard(S);
  const security = useSecurityCard();

  return useMemo(() => {
    const cards = { career, diet, rotation, security: security.card };
    return {
      hero: {
        sub: heroSub({ date: new Date(), rotation: rotaLine, security: security.bit }),
        state: worstState(Object.values(cards)),
      },
      cards,
    };
  }, [career, diet, rotation, rotaLine, security]);
}

export default useHomeLines;

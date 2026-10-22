/**
 * The minimised workout (brief §3.5.8) — app-wide, owner-only.
 *
 *   phones   a 56 px bar above the app's bottom nav on every screen:
 *            ● PUSH · 23:14 · 7/19                           [Resume]
 *   desktop  a pill in the top bar.
 * Tapping anywhere resumes: Upgrade → Lifts with the workout open
 * (liveBus.requestLiftsResume, then the caller navigates to Upgrade).
 *
 * READ-ONLY: it reads S.lifts.active and writes nothing — minimising and
 * resuming leave the workout byte-identical. Hidden while the live
 * workout itself is on screen (liveBus). App mounts it lazily, only for
 * the owner and only when OWNER_SURFACES_IN_BUILD, and only once a
 * workout exists — so neither this chunk nor the Lifts lib loads for
 * anyone else.
 *
 * Props: S, isMobile, onOpen() (navigate to Upgrade).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { activeOf, miniBarModel } from '../../../../lib/lifts/workout';
import { isLiftsLive, subscribeLiftsLive, requestLiftsResume } from '../../../../lib/lifts/liveBus';
import { useLiftsScope } from '../ui/scope';
import '../lifts-tokens.css';
import './minibar.css';

export default function MiniBar({ S, isMobile = false, onOpen }) {
  const active = activeOf(S);
  const live = useSyncExternalStore(subscribeLiftsLive, isLiftsLive, () => false);
  const scope = useLiftsScope();
  const [now, setNow] = useState(() => Date.now());
  const show = !!active && !live;
  useEffect(() => {
    if (!show) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [show]);
  // The page keeps its last rows clear of the bar.
  useEffect(() => {
    if (!show) return undefined;
    const r = document.documentElement;
    r.setAttribute('data-lifts-mini', isMobile ? 'bar' : 'pill');
    return () => r.removeAttribute('data-lifts-mini');
  }, [show, isMobile]);

  if (!show) return null;
  const m = miniBarModel(active, now);
  const resume = () => { requestLiftsResume(); if (onOpen) onOpen(); };
  return (
    <div className={`lifts lw-mini is-${isMobile ? 'bar' : 'pill'}`} style={scope.style} data-testid="lw-mini">
      <button type="button" className="lw-mini-btn" onClick={resume}
              aria-label={`Workout in progress: ${m.name}, ${m.clock}, ${m.done} of ${m.sets} sets. Resume`}>
        <span className="lf-live-dot" aria-hidden="true" />
        <span className="lw-mini-txt" aria-hidden="true">
          <b>{m.name.toUpperCase()}</b>
          <span>· {m.clock}</span>
          <span>· {m.done}/{m.sets}</span>
        </span>
        <span className="lw-mini-go" aria-hidden="true">Resume</span>
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { decideBuildGate, latchGate } from '../../lib/buildGate';
import { BUILD, PLATFORM, loadMinBuild, peekMinBuild, onMinBuild, noteClientBuild } from '../../lib/buildGateClient';

/**
 * App's view of the update gate (Phase 0, docs/STATE_SIZE_PLAN.md):
 * 'pending' | 'ok' | 'update'. See lib/buildGate.js for the rules.
 *
 * Once the app is allowed to mount for a signed-in user, the census
 * notes this build for them (at most once per build on this device).
 */
export function useBuildGate({ session }) {
  const userId = session?.user?.id || null;
  const [read, setRead] = useState(peekMinBuild);

  useEffect(() => {
    const off = onMinBuild(setRead);
    loadMinBuild().then(setRead);
    return off;
  }, []);

  // Latched once the app has mounted this page load (latchGate).
  const mounted = useRef(false);
  const decision = latchGate(decideBuildGate({ read, build: BUILD, platform: PLATFORM }), mounted.current);
  useEffect(() => {
    if (decision === 'ok' && userId) mounted.current = true;
  }, [decision, userId]);

  useEffect(() => {
    if (decision !== 'ok' || !userId) return undefined;
    return noteClientBuild(userId);
  }, [decision, userId]);

  return { decision, build: BUILD, platform: PLATFORM };
}

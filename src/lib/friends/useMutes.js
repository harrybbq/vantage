/**
 * Mute, for components: who is muted, and Mute / Unmute.
 *
 * The list lives in the signed-in state (S.mutedUsers — mutes.js says
 * why), which only App's Board holds. The friend surfaces sit several
 * layers below it in four different hosts (classic hub rail, OS hub,
 * phone Friends page, console hub), so the Board provides the list once
 * here instead of threading S through every one — the same arrangement
 * as DesignProvider.
 *
 * The value is rebuilt only when S.mutedUsers changes, not on every edit
 * to S, so a keystroke elsewhere doesn't re-render the friend surfaces.
 *
 * Outside a provider (a pre-auth page, a harness that forgets it) `ready`
 * is false and the Mute controls hide themselves rather than offer an
 * action with nothing behind it.
 */
import { createContext, createElement, useCallback, useContext, useMemo } from 'react';
import { readMutes, muteUser, unmuteUser } from './mutes.js';

const NONE = Object.freeze({ ready: false, map: {}, isMuted: () => false, mute: () => {}, unmute: () => {} });
const MutesContext = createContext(NONE);

export function useMutes() {
  return useContext(MutesContext);
}

/** `mutedUsers` is S.mutedUsers; `update` is useVisionBoardState's. */
export function MutesProvider({ mutedUsers, update, children }) {
  const mute = useCallback(person => update(prev => muteUser(prev, person)), [update]);
  const unmute = useCallback(id => update(prev => unmuteUser(prev, id)), [update]);
  const value = useMemo(() => {
    const map = readMutes(mutedUsers);
    return { ready: true, map, isMuted: id => !!id && Object.prototype.hasOwnProperty.call(map, id), mute, unmute };
  }, [mutedUsers, mute, unmute]);
  return createElement(MutesContext.Provider, { value }, children);
}

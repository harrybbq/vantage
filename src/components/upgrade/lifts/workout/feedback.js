/**
 * The live workout's side effect on the device — it does not write S.
 *
 *   useFocusMode(on)   html[data-lifts-focus] while the live workout is on
 *                      a phone / tablet layout: workout.css hides the app's
 *                      top bar, bottom nav and Upgrade's back bar under it.
 *                      Removed on unmount (or when `on` turns false).
 *
 * The rest timer's wake lock, tone and vibration lived here until
 * 2026-10-21, when the owner had the timer removed.
 */
import { useEffect } from 'react';

export function useFocusMode(on) {
  useEffect(() => {
    if (!on || typeof document === 'undefined') return undefined;
    const r = document.documentElement;
    r.setAttribute('data-lifts-focus', '');
    return () => r.removeAttribute('data-lifts-focus');
  }, [on]);
}

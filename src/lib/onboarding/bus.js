/**
 * Onboarding bus: the one name App and the hub's Getting started card
 * share for "Do it".
 *
 * The card never navigates or opens anything itself. It asks App, and
 * App (which owns navigate + handleOpenModal, so free-tier caps still
 * apply) runs the pick's first thing. App listens:
 *
 *   window.addEventListener(ONBOARDING_DO_EVENT, e => run(e.detail.id))
 *
 * `id` is a pick id (onboarding.js PICK_IDS). Never throws, and does
 * nothing where there is no window (node tests, SSR).
 */
export const ONBOARDING_DO_EVENT = 'vantage:onboarding-do';

/** Ask App to run a pick's first thing. → true if the event was sent. */
export function requestOnboardingDo(id) {
  if (typeof window === 'undefined' || !window || typeof window.dispatchEvent !== 'function') return false;
  if (typeof id !== 'string' || !id) return false;
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_DO_EVENT, { detail: { id } }));
    return true;
  } catch {
    return false;
  }
}

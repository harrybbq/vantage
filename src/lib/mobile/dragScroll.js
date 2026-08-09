/**
 * Edge auto-scroll for the mobile widget reorder.
 *
 * Holding a widget near the top or bottom of the screen scrolls the list
 * that way, so a widget at the bottom can actually reach the top. Without
 * it the drag is bounded by the viewport: you can only move a card as far
 * as you can see, which on a stack of eight widgets means several
 * separate drags.
 *
 * Pure — no DOM, no React. The feel is entirely in the ramp, and a feel
 * you can assert on is one you can tune without a device in your hand.
 */

/** Fraction of the usable height that counts as a hot zone, each end. */
export const ZONE_FRACTION = 0.21;
/** …but never more than this, or on a tall screen the dead middle vanishes. */
export const ZONE_MAX_PX = 130;
/** …and never less, or the zone is unhittable with a thumb. */
export const ZONE_MIN_PX = 56;

export const MIN_SPEED = 2;    // px per frame at the very edge of the zone
export const MAX_SPEED = 15;   // px per frame at the screen edge

/**
 * Ease-in on the depth. A LINEAR ramp still feels like a trapdoor,
 * because the top third of the zone is where a thumb naturally rests
 * while it decides — an exponent pushes the useful speed toward the
 * extremes and keeps the approach gentle.
 */
export const CURVE = 1.7;

export function zoneSize(usableHeight) {
  return Math.max(ZONE_MIN_PX, Math.min(ZONE_MAX_PX, usableHeight * ZONE_FRACTION));
}

/**
 * Scroll speed for a pointer position, in px per frame.
 *
 * @param y       pointer clientY
 * @param bounds  { top, bottom } usable viewport edges — the app bar and
 *                tab bar are not scroll targets, so the zone measures
 *                from the content area rather than from the glass.
 * @returns negative to scroll UP (toward the start of the list),
 *          positive to scroll DOWN, 0 in the dead middle.
 */
export function scrollSpeed(y, bounds) {
  const top = bounds?.top ?? 0;
  const bottom = bounds?.bottom ?? 0;
  const usable = bottom - top;
  if (!(usable > 0)) return 0;
  const zone = zoneSize(usable);

  // Depth is 0 at the inner edge of the zone and 1 at the screen edge.
  // Clamped past the edge so a finger dragged off the top keeps the
  // maximum rather than wrapping to zero.
  const ramp = depth => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(depth, CURVE);

  // Boundaries are INCLUSIVE. Crossing into the zone should do something
  // immediately, even if only 2px a frame — an outer band where nothing
  // happens makes the zone feel smaller than it is and leaves the user
  // pushing further to find the effect. The 0 → MIN_SPEED step at the
  // edge is deliberate: it gives the zone a findable boundary.
  if (y <= top + zone) {
    const depth = Math.min(1, Math.max(0, (top + zone - y) / zone));
    return -ramp(depth);
  }
  if (y >= bottom - zone) {
    const depth = Math.min(1, Math.max(0, (y - (bottom - zone)) / zone));
    return ramp(depth);
  }
  return 0;
}

/**
 * How far the window can still scroll in a direction.
 *
 * Used to stop the loop at the ends: holding at the top of a list that
 * is already at the top should do nothing, not judder against the
 * boundary or keep firing frames forever.
 */
export function scrollableBy(speed, scrollY, maxScroll) {
  if (speed < 0) return -Math.min(-speed, scrollY);
  if (speed > 0) return Math.min(speed, Math.max(0, maxScroll - scrollY));
  return 0;
}

/**
 * Drive the scroll while a drag is live.
 *
 * Returns a controller: feed it pointer positions, call stop() on
 * release. `onScrolled` fires with the accumulated delta so the caller
 * can keep the dragged card pinned under the finger — the card is
 * positioned in viewport space, so a document that moves underneath it
 * has to be compensated for or the card slides out from under the thumb.
 */
export function createDragScroller({ getBounds, onScrolled, win = typeof window !== 'undefined' ? window : null }) {
  let raf = 0;
  let y = null;
  let total = 0;
  let lastY = null;   // scrollY as of the previous frame

  function maxScroll() {
    const doc = win.document.documentElement;
    return Math.max(0, doc.scrollHeight - win.innerHeight);
  }

  function frame() {
    raf = 0;
    if (y == null || !win) return;

    // Bank what actually moved since the LAST frame, before asking for
    // more. Reading scrollY straight back after scrollBy does not work:
    // the scroll is not guaranteed to have landed within the same task,
    // so the read returns the old value, the delta looks like zero, and
    // the compensation below never fires — the dragged card freezes in
    // place while the list slides out from under it. Measuring a frame
    // later is correct whether the scroll was applied instantly or late,
    // and it can never over-count.
    if (lastY != null) {
      const achieved = win.scrollY - lastY;
      if (achieved !== 0) {
        total += achieved;
        onScrolled?.(total, achieved);
      }
    }
    lastY = win.scrollY;

    const speed = scrollSpeed(y, getBounds());
    if (speed !== 0) {
      const by = scrollableBy(speed, win.scrollY, maxScroll());
      // behavior:'instant' is NOT belt-and-braces. index.css sets
      // `html { scroll-behavior: smooth }` globally, which turns every
      // scrollBy into an animation — and issuing one per frame means
      // each call restarts the previous animation, so the list crawls
      // at about a tenth of the requested speed and scrollY lags behind
      // by however long the animation takes. Measured: 61 px/s instead
      // of 570. This is a per-frame nudge, not a navigation.
      if (by !== 0) win.scrollBy({ top: by, left: 0, behavior: 'instant' });
    }
    // Keep the loop alive while the drag is live even at zero speed —
    // the finger can move back into a zone without another touchmove
    // (it is the LIST that moves, not the finger), and a loop that
    // stopped at the boundary would never restart.
    raf = win.requestAnimationFrame(frame);
  }

  return {
    move(clientY) {
      y = clientY;
      if (!raf && win) raf = win.requestAnimationFrame(frame);
    },
    stop() {
      if (raf && win) win.cancelAnimationFrame(raf);
      raf = 0; y = null; lastY = null;
    },
    get scrolled() { return total; },
  };
}

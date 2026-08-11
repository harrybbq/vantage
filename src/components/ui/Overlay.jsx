import { createPortal } from 'react-dom';

/**
 * Render a full-screen overlay into the page root.
 *
 * Anything `position: fixed` still obeys the stacking context it was
 * declared in. The hub's side columns are `position: sticky`, which
 * creates one — so a modal opened from the ratings panel or the friends
 * rail had its z-index resolved against its siblings INSIDE that column
 * rather than against the page, and the widget canvas (later in the
 * markup) painted straight over it. No z-index value can win that; a
 * descendant never escapes its ancestor's stacking context.
 *
 * This is the third time that bug has been fixed one component at a
 * time — the chat, then the ratings breakdown, then the self-checks —
 * so it is a component now. Anything that covers the screen should
 * render through here rather than in place, whether or not its current
 * parent happens to be safe today: a panel that gets moved into a
 * sticky column later must not quietly take its modals down with it.
 */
export default function Overlay({ children }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

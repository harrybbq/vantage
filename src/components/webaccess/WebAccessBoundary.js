import { createElement, Fragment } from 'react';
import { mayMountBoard } from '../../lib/webAccess.js';

/**
 * The one place the main app is allowed to mount on the web.
 *
 * App.jsx wraps <SubscriptionProvider><Board/></SubscriptionProvider> in
 * this. Unless decideWebAccess() said 'full' for a signed-in visitor,
 * `children` is never rendered — not hidden, not rendered — so Board's
 * useVisionBoardState never runs: no user_data read, no save, no
 * migration, nothing written for a gated account (CLAUDE.md data safety).
 * `fallback` (the store-app page or the loader) renders instead.
 *
 * Plain createElement (no JSX) so the node test can render it with
 * react-dom/server: src/lib/webAccess.test.mjs.
 */
export default function WebAccessBoundary({ decision, signedIn, fallback = null, children }) {
  return createElement(Fragment, null, mayMountBoard(decision, signedIn) ? children : fallback);
}

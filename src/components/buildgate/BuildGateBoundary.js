import { createElement, Fragment } from 'react';
import { mayMountApp } from '../../lib/buildGate.js';

/**
 * Board mounts only through this boundary (and WebAccessBoundary inside
 * it). Unless the build gate said 'ok', `children` is never rendered, so
 * useVisionBoardState never runs for an out-of-date build: no user_data
 * read, no save, nothing written (CLAUDE.md data safety). `fallback` (the
 * update page or the loader) renders instead.
 *
 * Plain createElement (no JSX) so the node test can render it with
 * react-dom/server: src/lib/buildGate.test.mjs.
 */
export default function BuildGateBoundary({ decision, fallback = null, children }) {
  return createElement(Fragment, null, mayMountApp(decision) ? children : fallback);
}

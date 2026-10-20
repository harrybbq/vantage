/**
 * <TopBarActions placement="start|end">…</TopBarActions>
 *
 * Lets a console page put controls in the shell's bar without editing the
 * shell: the Track mock's Calendar / Diet / Vitals switch sits beside the
 * title, the Hub mock's "Edit hub" beside the coins.
 *
 *   start  desktop top bar, after the title and date. Desktop only: on a
 *          phone there is no room, so it renders nothing and the page keeps
 *          its own copy in the body.
 *   end    desktop top bar before the search chip; on a phone, the app bar
 *          before the coins. Keep it to one or two 36 px icon buttons there.
 *
 * Renders nothing until the shell has mounted its bar (or outside console),
 * so a page must not depend on it for anything it can't live without.
 * Import read-only from SHELL: '…/design/console/shell/TopBarActions'.
 */
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

const nodes = { start: null, end: null };
const subs = new Set();
const emit = () => subs.forEach(f => f());
const subscribe = f => { subs.add(f); return () => subs.delete(f); };

/** Ref callbacks for the shell's bar (shell-internal). */
export const barRef = {
  start: el => { if (nodes.start !== el) { nodes.start = el; emit(); } },
  end: el => { if (nodes.end !== el) { nodes.end = el; emit(); } },
};

export default function TopBarActions({ placement = 'end', children }) {
  const key = placement === 'start' ? 'start' : 'end';
  const node = useSyncExternalStore(subscribe, () => nodes[key], () => null);
  return node ? createPortal(children, node) : null;
}

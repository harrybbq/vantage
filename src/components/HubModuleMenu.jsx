/**
 * HubModuleMenu — right-click context menu for hub modules.
 *
 * Right-clicking a hub module (Widgets, Friends, Profile, Ratings,
 * Trackers) opens a small menu with a toggle switch that makes the
 * module's background transparent — the same barely-there treatment
 * the Ratings Ledger uses, so the page shows through.
 *
 * The preference is stored per module in S.moduleTransparency and
 * applied via a `data-transparent` attribute on the module element
 * (see useModuleTransparency below + the [data-transparent] rules in
 * index.css). The modules themselves don't need to know about this —
 * we find them by their stable class names, so no prop threading.
 *
 * MODULE_DEFS is the registry: { id, label, selector }. Add a row to
 * extend the menu to another module.
 */
import { useEffect } from 'react';

export const MODULE_DEFS = [
  { id: 'widgets',  label: 'Widgets',  selector: '.hub-canvas-panel' },
  { id: 'ratings',  label: 'Ratings',  selector: '.ratings-ledger' },
  { id: 'profile',  label: 'Profile',  selector: '.profile-card' },
  { id: 'trackers', label: 'Trackers', selector: '.quick-log-section' },
  { id: 'friends',  label: 'Friends',  selector: '.fc-panel' },
];

/**
 * Resolve a right-click target to the module it belongs to. Returns
 * { id, label, el } or null if the click wasn't inside a known module.
 */
export function resolveModuleFromEvent(e, rootEl) {
  for (const def of MODULE_DEFS) {
    const el = e.target.closest(def.selector);
    if (el && (!rootEl || rootEl.contains(el))) {
      return { id: def.id, label: def.label, el };
    }
  }
  return null;
}

/**
 * Effect hook: keeps every module's `data-transparent` attribute in
 * sync with S.moduleTransparency. Re-applies whenever the map changes
 * or `syncKey` bumps (e.g. after the imperative widget canvas
 * re-renders and could otherwise miss the attribute).
 */
export function useModuleTransparency(rootRef, transparency, syncKey) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const def of MODULE_DEFS) {
      const on = !!(transparency || {})[def.id];
      root.querySelectorAll(def.selector).forEach(el => {
        if (on) el.setAttribute('data-transparent', 'true');
        else el.removeAttribute('data-transparent');
      });
    }
  }, [rootRef, transparency, syncKey]);
}

export default function HubModuleMenu({ menu, transparency, onToggle, onClose }) {
  // Dismiss on any outside pointerdown, scroll, or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    // Defer so the opening right-click doesn't immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('scroll', close, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const on = !!(transparency || {})[menu.id];

  // Clamp so the menu never spills off the right/bottom edge.
  const W = 220, H = 92;
  const left = Math.min(menu.x, window.innerWidth - W - 8);
  const top = Math.min(menu.y, window.innerHeight - H - 8);

  return (
    <div
      className="hub-module-menu"
      style={{ left, top }}
      // Keep clicks inside from bubbling to the document close handler.
      onPointerDown={e => e.stopPropagation()}
      role="menu"
    >
      <div className="hub-module-menu-head">{menu.label}</div>
      <button
        type="button"
        className="hub-module-menu-row"
        onClick={() => onToggle(menu.id)}
        role="menuitemcheckbox"
        aria-checked={on}
      >
        <span className="hub-module-menu-label">Transparent background</span>
        <span className={`hub-switch${on ? ' is-on' : ''}`} aria-hidden="true">
          <span className="hub-switch-knob" />
        </span>
      </button>
    </div>
  );
}

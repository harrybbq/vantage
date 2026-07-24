/**
 * HubModuleMenu — right-click context menu for hub modules.
 *
 * Right-clicking a hub module opens a small menu with a toggle switch
 * that makes the module's background transparent — the same barely-
 * there treatment the Ratings Ledger uses, so the page shows through.
 *
 * Two ways a module is recognised (checked in this order):
 *   1. `data-hub-module="<id>"` (+ optional `data-hub-module-label`)
 *      — used by the OS operator-console panels (OsPanel tags itself).
 *   2. A class selector in MODULE_DEFS — used by the cream hub's
 *      modules and the shared Ratings / Friends panels.
 *
 * The preference is stored per id in S.moduleTransparency and applied
 * via a `data-transparent` attribute on the module element (see the
 * [data-transparent] rules in index.css / hub-dark.css). Both layouts
 * drive this through the shared useHubModuleMenu() hook below.
 */
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

// Cream-hub + shared modules, matched by class name (no markup change
// needed in the child components).
export const MODULE_DEFS = [
  { id: 'widgets',  label: 'Widgets',  selector: '.hub-canvas-panel' },
  { id: 'ratings',  label: 'Ratings',  selector: '.ratings-ledger' },
  { id: 'profile',  label: 'Profile',  selector: '.profile-card' },
  { id: 'trackers', label: 'Trackers', selector: '.quick-log-section' },
  { id: 'friends',  label: 'Friends',  selector: '.fc-panel' },
];

/** Resolve a right-click to the module it belongs to. Attribute-tagged
 *  modules win over class-matched ones (handles the OS case where a
 *  panel wraps a class-matched child). Returns { id, label, el } or
 *  null when the click wasn't inside a known module. */
export function resolveModuleFromEvent(e, rootEl) {
  const within = el => el && (!rootEl || rootEl.contains(el));

  const attrEl = e.target.closest('[data-hub-module]');
  if (within(attrEl)) {
    return {
      id: attrEl.dataset.hubModule,
      label: attrEl.dataset.hubModuleLabel || attrEl.dataset.hubModule,
      el: attrEl,
    };
  }
  for (const def of MODULE_DEFS) {
    const el = e.target.closest(def.selector);
    if (within(el)) return { id: def.id, label: def.label, el };
  }
  return null;
}

/** Effect: keep every module's `data-transparent` attribute in sync
 *  with S.moduleTransparency. Re-applies when the map changes or
 *  `syncKey` bumps (e.g. after the imperative widget canvas re-renders
 *  and could otherwise miss the attribute). */
export function useModuleTransparency(rootRef, transparency, syncKey) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const t = transparency || {};
    const apply = (el, id) => {
      if (!id) return;
      if (t[id]) el.setAttribute('data-transparent', 'true');
      else el.removeAttribute('data-transparent');
    };
    root.querySelectorAll('[data-hub-module]').forEach(el => apply(el, el.dataset.hubModule));
    for (const def of MODULE_DEFS) {
      root.querySelectorAll(def.selector).forEach(el => {
        if (el.hasAttribute('data-hub-module')) return; // already handled above
        apply(el, def.id);
      });
    }
  }, [rootRef, transparency, syncKey]);
}

/**
 * Shared wiring for both hub layouts. Returns:
 *   rootRef        — attach to the hub container
 *   onContextMenu  — attach to the same container
 *   menuNode       — render anywhere inside the layout
 */
export function useHubModuleMenu({ S, update, syncKey, adminActions }) {
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const transparency = S.moduleTransparency || {};

  useModuleTransparency(rootRef, transparency, syncKey);

  function onContextMenu(e) {
    const hit = resolveModuleFromEvent(e, rootRef.current);
    if (!hit) return; // not over a module — let the native menu show
    e.preventDefault();
    setMenu({ id: hit.id, label: hit.label, x: e.clientX, y: e.clientY });
  }

  function onToggle(id) {
    update(prev => {
      const cur = prev.moduleTransparency || {};
      return { ...prev, moduleTransparency: { ...cur, [id]: !cur[id] } };
    });
    setMenu(null);
  }

  // Resolve the admin actions list for the currently-targeted module.
  // Owner-only; rows dispatch CustomEvents on document so App can route
  // them without prop-threading owner state through HubSection.
  const moduleAdmin = (() => {
    if (!menu) return [];
    if (adminActions && adminActions[menu.id]) return adminActions[menu.id];
    // Default: if window.__vantageOwner is set (App writes this when
    // useIsOwner returns true), expose the same actions Settings does.
    if (typeof window !== 'undefined' && window.__vantageOwner) {
      if (menu.id === 'ratings') {
        return [{ label: 'Edit ratings & prestige', onClick: () => document.dispatchEvent(new CustomEvent('vantage:admin-edit', { detail: 'rating' })) }];
      }
    }
    return [];
  })();

  const menuNode = (
    <HubModuleMenu
      menu={menu}
      transparency={transparency}
      onToggle={onToggle}
      onClose={() => setMenu(null)}
      adminActions={moduleAdmin}
    />
  );

  return { rootRef, onContextMenu, menuNode };
}

/** Slugify an OsPanel label into a stable module id. */
export function moduleIdFromLabel(label) {
  return String(label || 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function HubModuleMenu({ menu, transparency, onToggle, onClose, adminActions = [] }) {
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
      {adminActions.length > 0 && (
        <>
          <div className="hub-module-menu-sep" />
          <div className="hub-module-menu-head" style={{ color: 'var(--gold, #c8970a)' }}>
            // ADMIN
          </div>
          {adminActions.map((a, i) => (
            <button
              key={i}
              type="button"
              className="hub-module-menu-row"
              onClick={() => { onClose(); a.onClick(); }}
              role="menuitem"
            >
              <span className="hub-module-menu-label">{a.label}</span>
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', display: 'inline-flex' }}><Icon name="chevron-right" size={15} /></span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

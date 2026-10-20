/**
 * useDesign — which whole design the app renders: 'classic' or 'console'.
 *
 *   const { design, isConsole } = useDesign();
 *   return isConsole ? <ConsoleThing … /> : <ClassicThing … />;
 *
 * Components read it from context; App's Board resolves it once and
 * provides it (useApplyDesign + <DesignProvider>). Outside the provider
 * (sign-in screen, legal pages, Board's load-error screen) it is the
 * no-session answer: resolveDesign(null) — 'classic' until the launch
 * flip in lib/design/design.js.
 *
 * useApplyDesign also writes the design to <html data-design="…">, which
 * is what scopes every console stylesheet (src/design/console/), and in
 * console mode sets the user's accent as --cx-accent / --cx-accent-fill /
 * --cx-on-accent / --cx-accent-tint inline on <html>, derived per theme
 * (consoleAccentVars). In classic mode those properties are removed, so
 * classic's <html> carries nothing new except data-design="classic".
 *
 * KNOWN, ACCEPTED: the owner preview can flash classic → console on load.
 * Two async inputs decide it — useIsOwner (an RPC, cached per tab in
 * sessionStorage, so only a tab's first load flashes) and the cloud copy
 * of S replacing the optimistic local one. It is a preview behind an
 * owner gate; do not chase it. At the launch flip the gate goes away and
 * so does the RPC dependency.
 */
import { createContext, createElement, useContext, useLayoutEffect, useMemo } from 'react';
import { resolveDesign, consoleAccentVars, CONSOLE_ACCENT_PROPS } from '../lib/design/design';

/** The design when there is no signed-in state to read. */
export const NO_SESSION_DESIGN = resolveDesign(null, { allowConsole: false });

const DesignContext = createContext(NO_SESSION_DESIGN);

/** { design, isConsole, isClassic } for the nearest provider. */
export function useDesign() {
  const design = useContext(DesignContext);
  return useMemo(() => ({ design, isConsole: design === 'console', isClassic: design !== 'console' }), [design]);
}

/** Provide the resolved design to everything below. */
export function DesignProvider({ design, children }) {
  return createElement(DesignContext.Provider, { value: design === 'console' ? 'console' : 'classic' }, children);
}

/**
 * Put `design` on <html>. With `accent` + `theme`, console mode also sets
 * the derived accent properties; classic mode removes them.
 */
export function applyDesign(design, { accent = null, theme = 'cream-pro' } = {}) {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  const d = design === 'console' ? 'console' : 'classic';
  if (r.dataset.design !== d) r.dataset.design = d;
  if (d === 'console') {
    const vars = consoleAccentVars(accent, theme);
    for (const k of CONSOLE_ACCENT_PROPS) r.style.setProperty(k, vars[k]);
  } else {
    for (const k of CONSOLE_ACCENT_PROPS) r.style.removeProperty(k);
  }
}

/**
 * Resolve the design for the signed-in board and keep <html> in step.
 * Call once, in App's Board, above any early return:
 *   isOwner  useIsOwner's answer (always false in native builds)
 *   accent   the user's accent hex (SettingsSection currentAccentHex(S))
 *   theme    the effective theme id (resolveEffectiveTheme(S.theme))
 * Passed in rather than imported, so this module never imports
 * SettingsSection: screen components import useDesign, and SettingsSection
 * imports screen components. Returns the design. On unmount (sign-out)
 * <html> goes back to the no-session design.
 */
export function useApplyDesign(S, { isOwner = false, accent = null, theme = 'cream-pro' } = {}) {
  const design = resolveDesign(S, { allowConsole: !!isOwner });
  const acc = design === 'console' ? accent : null;
  useLayoutEffect(() => {
    applyDesign(design, { accent: acc, theme });
  }, [design, acc, theme]);
  useLayoutEffect(() => () => applyDesign(NO_SESSION_DESIGN), []);
  return design;
}

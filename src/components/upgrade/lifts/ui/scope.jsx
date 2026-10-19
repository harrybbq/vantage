/**
 * The `.lifts` scope: the accent custom properties every Lifts root and
 * every sheet portalled out of it must carry, and the input mode.
 *
 * useLiftsScope() reads the user's accent (`--em` on <html>, set by
 * SettingsSection applyScheme) and the theme (`data-theme`), and keeps
 * them current with a MutationObserver — so switching scheme or theme
 * re-colours Lifts without a reload. It returns { theme, accent, style }:
 * `style` is { '--lf-accent', '--lf-accent-ink', '--lf-on-accent' } from
 * accentVars(), ready to spread on a root's style.
 *
 * <LiftsScope> provides it to everything below (LiftsTab wraps its root);
 * portalled pieces (Sheet, toasts, Estimate's popover) call useScopeStyle()
 * and put it on their own portal root, since a portal leaves the DOM
 * subtree that carries the inline variables.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { accentVars } from '../../../../lib/lifts/ui';

const read = () => {
  if (typeof document === 'undefined') return { theme: 'cream-pro', accent: '#1A7A4A' };
  const r = document.documentElement;
  const theme = r.getAttribute('data-theme') === 'dark-os' ? 'dark-os' : 'cream-pro';
  let accent = '';
  try { accent = getComputedStyle(r).getPropertyValue('--em').trim(); } catch { accent = ''; }
  return { theme, accent: accent || '#1A7A4A' };
};

/** { theme, accent, style } for the current document — live. */
export function useLiftsScope() {
  const [s, setS] = useState(read);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const r = document.documentElement;
    const mo = new MutationObserver(() => setS(prev => {
      const n = read();
      return n.theme === prev.theme && n.accent === prev.accent ? prev : n;
    }));
    mo.observe(r, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
    return () => mo.disconnect();
  }, []);
  const style = useMemo(() => accentVars(s.accent, s.theme), [s.accent, s.theme]);
  return useMemo(() => ({ ...s, style }), [s, style]);
}

const Ctx = createContext(null);

/**
 * Provide the scope to the subtree (and to portalled sheets via useScopeStyle).
 * Pass `value` (from useLiftsScope) when the caller also needs it — LiftsTab
 * puts `value.style` on its `.lifts` root.
 */
export function LiftsScope({ value = null, children }) {
  return value ? <Ctx.Provider value={value}>{children}</Ctx.Provider> : <OwnScope>{children}</OwnScope>;
}
function OwnScope({ children }) {
  const v = useLiftsScope();
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** The scope from the nearest <LiftsScope>, or a live one of its own when there is none. */
export function useScope() {
  const ctx = useContext(Ctx);
  const own = useLiftsScope();
  return ctx || own;
}
/** The inline accent variables for a portal root. */
export const useScopeStyle = () => useScope().style;

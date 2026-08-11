import { useEffect, useState } from 'react';

/** Themes whose card surface is dark. Everything else is a light card. */
const DARK_THEMES = new Set(['dark', 'dark-os']);

function read() {
  if (typeof document === 'undefined') return false;
  return DARK_THEMES.has(document.documentElement.getAttribute('data-theme') || '');
}

/**
 * Whether the current theme paints on a dark surface.
 *
 * Data-viz colour has to be chosen per surface rather than flipped, so
 * anything drawing its own marks (the ratings donut) needs to know
 * which set of steps to use. Reading `data-theme` off <html> keeps that
 * decision with applyTheme, which is already the one place the theme is
 * decided; the observer covers a live toggle from Settings.
 */
export function useDarkSurface() {
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(read()));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    setDark(read());
    return () => obs.disconnect();
  }, []);
  return dark;
}

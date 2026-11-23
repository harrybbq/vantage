/**
 * A colour per session (owner, 2026-11-23, from the "Workout Moments"
 * mockup): Push, Pull, Legs, Upper and Lower each have their own, and a
 * workout wears it from Start to Save — the Today card, the live
 * workout, the Finish sheet, the week strip, History.
 *
 * It is a VIEW of the session's name: nothing is stored. A workout that
 * is not one of the five (Build my own, a saved template) has no colour
 * and keeps the user's accent — sessionVars returns null.
 *
 * The five hues keep clear of the colours that already mean something
 * in Lifts: gold is a best, indigo a night shift, red a problem. That is
 * why Push is not a warm colour.
 *
 * sessionVars returns the same custom properties accentVars does, built
 * the same way (accentFor against the theme's real surfaces), so every
 * rule written for `--lf-accent` passes contrast in a session's colour
 * too. Spread it on a wrapper's style: the subtree wears the colour.
 */
import { accentVars, themeTokens } from './ui.js';

export const SESSION_COLOURS = Object.freeze({
  push: '#A8CF45',
  pull: '#5AA9E6',
  legs: '#A98BEB',
  upper: '#E36FA6',
  lower: '#34C6B0',
});

/** 'Push', 'push day', 'Upper (adaptive)' → 'push' | … | null. Reads the first word only. */
export function sessionKey(name) {
  const m = /^\s*(push|pull|legs?|upper|lower)\b/i.exec(String(name || ''));
  if (!m) return null;
  const k = m[1].toLowerCase();
  return k === 'leg' ? 'legs' : k;
}

/** The session a workout / session record / plan cell belongs to, by its rota code first, then its name. */
export const sessionKeyOf = w => (w ? sessionKey(w.rotaSession) || sessionKey(w.session) || sessionKey(w.name) : null);

/** Inline custom properties for a subtree that wears `name`'s colour in `theme`, or null. */
export function sessionVars(name, theme) {
  const k = typeof name === 'string' ? sessionKey(name) : sessionKeyOf(name);
  if (!k) return null;
  const v = accentVars(SESSION_COLOURS[k], theme);
  const t = themeTokens(theme);
  return {
    ...v,
    '--lf-done-tint': `color-mix(in srgb, ${v['--lf-accent']} 10%, ${t.s1})`,
    '--lf-focus': v['--lf-accent'],
  };
}

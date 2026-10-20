/**
 * The design switch — which whole visual design the app renders.
 *
 *   'classic'  the app as it shipped before the Oct 2026 redesign. It must
 *              keep rendering exactly as it does today: it is the runtime
 *              backup that lets the redesign be abandoned or rolled back
 *              without a revert (git backup: backup/classic-design-2026-10-20).
 *   'console'  the redesign (Direction A "Console, refined" + C's tier
 *              bands and division table). See src/design/console/README.md.
 *
 * The user's choice is the additive state key `S.design`. Absent or
 * garbage → the default. Nothing here writes state; `withDesign` is the
 * one updater the Settings control uses, and it only ever adds/changes
 * that single key.
 *
 * PREVIEW GATE. While DEFAULT_DESIGN is 'classic' the console design is
 * owner-only (a UI gate via useIsOwner — fine for a preview, never an
 * access control). The gate is derived from the default, so the public
 * launch is ONE line: set DEFAULT_DESIGN = 'console'. That both changes
 * what an absent `S.design` means and opens the console to everyone;
 * anyone who explicitly picked 'classic' keeps it.
 *
 * Pure: no DOM, no React. design.test.mjs pins every rule.
 */
import { accentFor, onAccent, parseColor } from './contrast.js';

export const DESIGNS = Object.freeze(['classic', 'console']);

/** Flip to 'console' at the public launch — that line is the whole launch. */
export const DEFAULT_DESIGN = 'classic';

export const isDesign = v => typeof v === 'string' && DESIGNS.includes(v);

/** Whether `defaultDesign` keeps the console behind the owner preview gate. */
export const isConsoleGated = (defaultDesign = DEFAULT_DESIGN) => (isDesign(defaultDesign) ? defaultDesign : 'classic') !== 'console';

/**
 * The design to render for state `S`.
 *   allowConsole   may this viewer see 'console' while it is gated
 *                  (the owner preview: useIsOwner's answer).
 *   defaultDesign  for tests; leave it to the module default otherwise.
 * Always returns 'classic' or 'console'.
 */
export function resolveDesign(S, { allowConsole = false, defaultDesign = DEFAULT_DESIGN } = {}) {
  const fallback = isDesign(defaultDesign) ? defaultDesign : 'classic';
  const chosen = S && isDesign(S.design) ? S.design : fallback;
  if (chosen === 'console' && isConsoleGated(fallback) && !allowConsole) return 'classic';
  return chosen;
}

/**
 * The additive state updater for the Settings control:
 *   update(prev => withDesign(prev, 'console'))
 * Returns `prev` itself (no save queued) for an unknown value or no change.
 */
export function withDesign(prev, design) {
  if (!isDesign(design)) return prev;
  const base = prev || {};
  if (base.design === design) return prev;
  return { ...base, design };
}

// ── Accent, derived per theme ───────────────────────────────────────

/**
 * The console surfaces the accent is checked against (tokens.css carries
 * the same values; design.test.mjs keeps them in step). Theme ids stay
 * the legacy `dark-os` / `cream-pro`; cream-pro is drawn as "Paper".
 */
export const CX_SURFACES = Object.freeze({
  'dark-os': Object.freeze({ bg: '#0E0E0C', s1: '#151513', s2: '#1D1D1A' }),
  'cream-pro': Object.freeze({ bg: '#EEEDE9', s1: '#FBFBF9', s2: '#F3F2EE' }),
});
const surfacesFor = theme => CX_SURFACES[theme === 'dark-os' ? 'dark-os' : 'cream-pro'];

/**
 * Accent TEXT contrast target per theme. Light: 4.5 (WCAG AA), as Lifts.
 * Dark: 7 — the Direction A table's dark accent text (#3FBF7F) is 7.22:1,
 * a bright accent on near-black; the AA minimum gives a dull #219C5E for
 * the default green. With 7 the default green derives to #2CCE7D.
 */
export const ACCENT_TEXT_MIN = Object.freeze({ 'dark-os': 7, 'cream-pro': 4.5 });

/**
 * The inline custom properties <html> carries in console mode for the
 * user's accent `hex` (their scheme's `em`, or their custom colour):
 *   --cx-accent        accent as TEXT (≥ ACCENT_TEXT_MIN on s1 and s2)
 *   --cx-accent-fill   the fill for primary buttons, checks, bars (≥ 3:1 on s1)
 *   --cx-on-accent     label colour on the fill (≥ 4.5:1 where possible)
 *   --cx-accent-tint   a 12 % (dark) / 9 % (paper) wash of the fill
 * Same method as Lifts accentVars(), against the console surfaces. An
 * unreadable `hex` is treated as the default green.
 */
export function consoleAccentVars(hex, theme) {
  const t = theme === 'dark-os' ? 'dark-os' : 'cream-pro';
  const s = surfacesFor(t);
  const fill = accentFor(parseColor(hex) ? hex : '#1A7A4A', s.s1, 3);
  const min = ACCENT_TEXT_MIN[t];
  const ink = accentFor(accentFor(fill, s.s1, min), s.s2, min);
  const [r, g, b] = parseColor(fill) || [26, 122, 74];
  const tint = `rgba(${r}, ${g}, ${b}, ${t === 'dark-os' ? 0.12 : 0.09})`;
  return {
    '--cx-accent': ink,
    '--cx-accent-fill': fill,
    '--cx-on-accent': onAccent(fill),
    '--cx-accent-tint': tint,
  };
}
export const CONSOLE_ACCENT_PROPS = Object.freeze(['--cx-accent', '--cx-accent-fill', '--cx-on-accent', '--cx-accent-tint']);

/**
 * Whether the trading widget exists in this build at all.
 *
 * App stores treat brokerage data as financial services, and a reviewer
 * sees the whole binary regardless of any owner-only gating. Vantage
 * hasn't shipped yet, so putting a financial-services question in front
 * of a reviewer who would otherwise never see one is a risk to
 * VANTAGE'S launch — not just to this feature. That is the reason this
 * flag exists, and why it is checked at the registry level rather than
 * inside the widget.
 *
 * Two independent layers, because either alone has a failure mode:
 *
 *   1. BUILD FLAG. `npm run cap:*` sets VITE_NATIVE_BUILD=true. Vite
 *      substitutes the literal at build time, so the constant folds to
 *      false and Rollup drops the widget and its module graph — absent,
 *      not merely hidden. This is the layer that matters.
 *
 *   2. RUNTIME CHECK. If someone ever builds for native WITHOUT the
 *      flag (a hand-run `vite build` then `npx cap sync`, say), the
 *      Capacitor check still makes it unreachable inside the shell.
 *      Slower and leaves the code in the bundle, hence the belt and
 *      braces rather than relying on it.
 *
 * Web builds set neither and get the widget.
 */

// Build-time. Must read the full `import.meta.env.VITE_…` expression
// literally for Vite to statically replace it — destructuring or
// dynamic key access defeats the substitution and the dead-code
// elimination that follows.
const EXCLUDED_AT_BUILD = import.meta.env.VITE_NATIVE_BUILD === 'true';

// Runtime. Capacitor sets this global in a native shell. Checked
// defensively so a web build with no Capacitor present is unaffected.
function runningNative() {
  if (typeof window === 'undefined') return false;
  try {
    const cap = window.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    return !!cap.isNative;
  } catch {
    return false;
  }
}

export const TRADING_WIDGET_BUILD_EXCLUDED = EXCLUDED_AT_BUILD;

/** True only where the widget may be registered, listed and rendered. */
export function tradingWidgetAvailable() {
  if (EXCLUDED_AT_BUILD) return false;
  return !runningNative();
}

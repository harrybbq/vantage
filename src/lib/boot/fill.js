/**
 * How full the dials are while the app boots.
 *
 * One scalar, 0 → 1, that every widget with a dial, ring, arc or bar
 * multiplies its own fraction by. At 1 — which is the value whenever no
 * boot is running — the expression is the identity, so a widget that
 * reads this outside the sequence draws exactly what it always drew.
 *
 * It is a module-level store rather than context or props because the
 * widgets are rendered by two entirely separate hosts (the mobile stack
 * and the desktop canvas islands, which mount outside React's tree),
 * and threading a value through both would have meant changing markup
 * in every one of them. Reading a scalar changes nothing but the number
 * a dial is drawn at.
 */
let fill = 1;
const subscribers = new Set();

export function getBootFill() { return fill; }

const clamp = v => (v < 0 ? 0 : v > 1 ? 1 : v);

export function setBootFill(next) {
  const v = clamp(next);
  if (v === fill) return;
  fill = v;
  subscribers.forEach(fn => fn());
}

/**
 * Set the value WITHOUT waking subscribers. Used once, while the boot
 * component is still rendering and before any widget has mounted, so
 * the dials are already at zero the first time they draw. Notifying
 * from inside another component's render is exactly the thing React
 * refuses, and there is nothing to notify at that point anyway — the
 * next clock tick, 33ms later, carries the value to anyone who has
 * subscribed since.
 */
export function primeBootFill(next) { fill = clamp(next); }

export function subscribeBootFill(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Server render and any non-boot read: dials are simply full. */
export const bootFillServerSnapshot = () => 1;

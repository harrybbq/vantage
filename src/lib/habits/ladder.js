/**
 * Milestone-ladder progress for a habit.
 *
 * Milestones own an EQUAL slice of the bar rather than a slice
 * proportional to their duration. On a real ladder — a week, then a
 * month, then a year — a time-linear bar leaves the marker pinned near
 * zero for months, so the early days, when a streak is most fragile,
 * would show no movement at all. Even slices mean every milestone is
 * the same distance away as the last one was.
 *
 * Shared by the desktop habit card and the mobile one so the runner
 * travels the same course on both. It used to live inline in
 * HabitsSection while mobile used a plain elapsed/max ratio, which is
 * why the two surfaces disagreed about how far along you were.
 */

/** Reference span when a habit has no milestones at all. */
export const DEFAULT_SPAN_MS = 7 * 24 * 3600 * 1000;

export function maxDuration(habit) {
  const ms = habit?.milestones || [];
  return ms.length ? Math.max(...ms.map(m => m.duration)) : DEFAULT_SPAN_MS;
}

/** Milestones ascending — the ladder the runner works along. */
export function sortedMilestones(habit) {
  return [...(habit?.milestones || [])].sort((a, b) => a.duration - b.duration);
}

/**
 * @returns 0..1 across the whole ladder.
 */
export function ladderProgress(habit, elapsed) {
  const sorted = sortedMilestones(habit);
  const n = sorted.length;
  if (!n) return Math.min(1, Math.max(0, elapsed / DEFAULT_SPAN_MS));
  let cleared = 0;
  while (cleared < n && elapsed >= sorted[cleared].duration) cleared++;
  if (cleared >= n) return 1;
  const prev = cleared === 0 ? 0 : sorted[cleared - 1].duration;
  const span = sorted[cleared].duration - prev;
  const frac = span > 0 ? (elapsed - prev) / span : 0;
  return (cleared + Math.max(0, Math.min(1, frac))) / n;
}

/** Every milestone awarded — the habit has finished its ladder. */
export function allMilestonesDone(habit) {
  const ms = habit?.milestones || [];
  return ms.length > 0 && ms.every(m => m.awarded);
}

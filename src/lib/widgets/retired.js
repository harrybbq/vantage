/**
 * Widget types that have been withdrawn.
 *
 * A retired type is dropped from the pickers so it can't be added again,
 * and skipped when a saved layout is rendered so anyone who had it
 * pinned simply stops seeing it. Nothing is deleted: the entry stays in
 * `hubWidgets` / `mobileWidgets` and its logged data stays in `S`, so
 * un-retiring a widget brings it back exactly where it was. That is also
 * why this is a render-time filter rather than a migration — a build
 * that rewrites saved state on load is the shape of bug that cost us
 * real user data once already (see CLAUDE.md).
 *
 * mood     — removed 2026-08. `S.moodLog` is deliberately left in place.
 * notepad  — removed 2026-08. `S.notepadText` is left in place; the
 *            desktop notepad was never a hubWidgets entry (it hung off
 *            `S.notepadText`/`_showNotepad`) so only the mobile card
 *            needs retiring here.
 * rotation — removed 2026-08-16. Everything it showed is now on other
 *            widgets: today's shift and session, the 80% load and the
 *            day's fuelling all read from the same pattern.js the
 *            rotation PAGE does, and the page itself is untouched —
 *            only the hub card is withdrawn. `S.rotation` (the anchor,
 *            the overrides, the booked holidays) is left completely
 *            alone; it is what the page and the plan both run on.
 */
export const RETIRED_WIDGET_TYPES = new Set(['mood', 'notepad', 'rotation']);

export function isRetiredWidget(type) {
  return RETIRED_WIDGET_TYPES.has(type);
}

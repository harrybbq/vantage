# TRACK area notes

Owned by the TRACK agent; only it edits this file. One line per item:
new tokens or primitives to consolidate into tokens.css / ui.jsx, and
changes needed in files this area does not own (see ../README.md §7).

## Tokens / primitives to consolidate (track.css, track/*)

- `--cx-track-ink` (#fff) and `--cx-track-scrim` (rgba(10,10,12,.58)): text and chip ground on a user's cover photo, theme-independent. Candidates for `--cx-photo-ink` / `--cx-photo-scrim`.
- `--cx-track-lane` (24px) / `--cx-track-head` (26px): bar lane height and date-row height of the month grid (area-local, keep here).
- `.cx-track-status` booked / planning / done colours on a photo (#9ff0c4, #ffd48a, white 86%) are commented one-offs; if HUB's Up-next shows a trip cover too, fold them into tokens.
- `TIcon` (track/icons.jsx): `pin`, `globe`, `clock`, `pound` drawn Lucide-style because components/Icon.jsx lacks them. Fold into Icon.jsx.
- `useWide(px)` (track/useWide.js): live matchMedia hook; ui.jsx has a private `useIsDesktop` doing the same at 1024 — export one shared hook.
- Classic-in-console re-skin (`.cx-track-reskin`): re-points classic tokens (--surface, --border*, --text*, --mono, --sans, --serif, --os-*) at cx tokens inside a container. Generic enough for SWEEP to reuse on any classic panel it mounts; could move to base.css as `.cx-reskin`.

## For SHELL (App.jsx / bars)

- The Holiday nav entry can go: `ConsoleHoliday` renders Track itself on Calendar › Year (trips, next trip, Visited + map). Nothing else is needed from TRACK to flip it off. The 'holiday' route stays for deep links; `activeSection` stays 'holiday' while it renders, so whether the bar highlights Track on that route is SHELL's call (map 'holiday' → Track's tab in the bars).
- The page renders its own header row (h1 "Track", the Calendar · Diet · Vitals segmented control, the Add button). If SHELL's top bar also prints the section title, drop one of them; tell TRACK and it will hide its h1 (`.cx-track-h1`) on wide screens.
- No new sectionProps keys needed. Used: S, update, userId, isOwner, onOpenModal, onOpenPaywall, onShowCoinToast, requestedTrackTab ('trackers' maps to Calendar).

## For the foundation

- Classic pixel diff noise: the size of ANY console stylesheet perturbs Chromium's antialiasing at the rounded corners of the classic mobile app bar (Track, Dark OS, 390) by ≤2/255 on 14 pixels. Reproduced with a comment-only track.css of the same size (no rules at all), so it is not a selector leak. Other agents will see the same 14 pixels; compare against a same-size comment-only control before chasing it.

## Integration (2026-10-21)

- The page h1 is gone (the shell bar prints "Track"); on narrow screens the Calendar · Diet · Vitals switch shares the row with Add.
- The event-kind legend moved from the month bar into the footer line under the grid, because at 1440 (owner, with Shifts) it squeezed the month name to "Octo…".
- The holiday route now titles the bars "Track" and lights Track in the sidebar (shell/nav.js `navSection`).

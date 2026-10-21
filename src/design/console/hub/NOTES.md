# HUB area notes

Owned by the HUB agent; only it edits this file. One line per item:
new tokens or primitives to consolidate into tokens.css / ui.jsx, and
changes needed in files this area does not own (see ../README.md §7).

- **Shared: `hub/DivisionTable.jsx`** (SWEEP imports it read-only). Props: `rows` [{ id, pos, name, avatarUrl?, prestige?, cats?{brain,finance,fitness,social}, weekly?, ovr?, isSelf?, zone?('up'|'down'|null), sub? }], `showCats`, `limit` (keeps the you-row), `legend` {up, down} (drawn only when a row has a zone), `note`, `onRow(row)`, `label`, `valueLabel` ('Ovr'), `weeklyLabel` ('Wk' | false). Also exports `Avatar`, `Diamonds`, `initialsOf`. Styles are `.cx-dt*` / `.cx-av*` in hub.css (loaded globally under the console scope).
- **League data (owner decision):** the friends board (`useLeaderboard({ scope: 'friends' })`) has no promotion/relegation mechanic, so the hub League widget draws NO zone rails and says "N OVR behind {name}" instead of "N OVR to promotion". Groups divisions (`groups` function standings) do have zones; feed those rows with `zone` set to get rails. Per-category weekly deltas have no data source (only OVR `climb`), so they are not drawn.
- New area classes: `.cx-hub-*` (page, player strip, grid, menus), `.cx-dt-*` (table), `.cx-av` (avatar 50% radius + online dot), `.cx-hub-bar` (progress bar on `--cx-track`). Candidates for ui.jsx/base.css: `Avatar`, a `Bar` primitive, a `Menu` (popover list) primitive.
- **SHELL:** `sectionProps` has no `onOpenRatings`; the console hub opens its own Sheet with classic `RatingsPanel` inside. If SHELL adds a ratings route/sheet, the player strip can call it instead.
- **SHELL:** `HubFooter` (the year countdown) still renders under the console hub — Direction A drops it; it is App.jsx's call.
- **SHELL:** phone drag auto-scroll measures the bars with `.m-appbar` / `.m-tabs`, falling back to `.cx-shell-appbar` / `.cx-shell-tabs`. If the console bars use other class names, tell HUB (HubGrid.jsx `getBounds`).
- **Layout state:** `S.hubGrid = { v: 1, items: [{ id, type, size, picks?, count?, blocks?, title? }] }`, written only by `useHubGrid.commit`, created on the first user change (never on view). Seeding rules and the size table are in `hub/grid.js`; `PRO_SIZES_GATED` is the one switch for "larger sizes are Pro".

## Integration (2026-10-21)

- DivisionTable is now also drawn by SWEEP's leaderboard (sweep/DivisionBoard.jsx adapts groups standings). Added, all defaulting to today's behaviour: `nameLabel` ('Player'), `valueBand` (true), `formatValue` (null), and `rows[].avatarColor`; the `sub` line now shows on link rows too. Rails verified with zoned group data (top 3 / bottom 3).
- Player strip carries `data-cx-tour="hub"` (the tour's hub stop rings it).
- HubFooter: gone under console (App.jsx gates it); resolved.
- Phone drag auto-scroll: the console bars are `.cx-shell-appbar` / `.cx-shell-tabs`, which the fallback already matches (classic `.m-*` bars are not mounted under console). Verified: holding a dragged cell over the tab bar scrolls the page.

## Prestige rewards (2026-10-21)

- Level/XP retired: the player strip's second column is now Prestige (OVR to the next prestige, a bar of OVR/99, the next reward); it and the prestige chip open `PrestigeRewards.jsx` (the rewards sheet). Data: `lib/ratings/prestigeRewards.js`.
- `Avatar` takes `prestige` (ring from `frameAttrs`, styles in `components/prestige-frame.css`, shared with classic); `Diamonds` is solid from Prestige VII. DivisionTable passes `rows[].prestige` to both.
- Hub card styles: `S.cardStyle` (additive, `withCardStyle`), drawn as `data-cx-card` on `.cx-hub` (hub.css). `CardStylePicker` is also mounted in SWEEP's Settings › Appearance.

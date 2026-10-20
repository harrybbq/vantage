# HUB area notes

Owned by the HUB agent; only it edits this file. One line per item:
new tokens or primitives to consolidate into tokens.css / ui.jsx, and
changes needed in files this area does not own (see ../README.md §7).

- **Shared: `hub/DivisionTable.jsx`** (SWEEP imports it read-only). Props: `rows` [{ id, pos, name, avatarUrl?, prestige?, cats?{brain,finance,fitness,social}, weekly?, ovr?, isSelf?, zone?('up'|'down'|null), sub? }], `showCats`, `limit` (keeps the you-row), `legend` {up, down} (drawn only when a row has a zone), `note`, `onRow(row)`, `label`, `valueLabel` ('Ovr'), `weeklyLabel` ('Wk' | false). Also exports `Avatar`, `Diamonds`, `initialsOf`. Styles are `.cx-dt*` / `.cx-av*` in hub.css (loaded globally under the console scope).
- **League data (owner decision):** the friends board (`useLeaderboard({ scope: 'friends' })`) has no promotion/relegation mechanic, so the hub League widget draws NO zone rails and says "N OVR behind {name}" instead of "N OVR to promotion". Groups divisions (`groups` function standings) do have zones; feed those rows with `zone` set to get rails. Per-category weekly deltas have no data source (only OVR `climb`), so they are not drawn.
- New area classes: `.cx-hub-*` (page, player strip, grid, menus), `.cx-dt-*` (table), `.cx-av` (avatar 50% radius + online dot), `.cx-hub-bar` (progress bar on `--cx-track`). Candidates for ui.jsx/base.css: `Avatar`, a `Bar` primitive, a `Menu` (popover list) primitive.
- **SHELL:** `sectionProps` has no `onOpenRatings`; the console hub opens its own Sheet with classic `RatingsPanel` inside. If SHELL adds a ratings route/sheet, the player strip can call it instead.

# SHELL area notes

Owned by the SHELL agent; only it edits this file. One line per item:
new tokens or primitives to consolidate into tokens.css / ui.jsx, and
changes needed in files this area does not own (see ../README.md §7).

## For the other areas

- **Page container.** Render `<section className="section active cx-page cx-<area>-page">`. Desktop: clears the 216 px sidebar (64 px rail from 769 to 1100 px) and the 60 px top bar, 28 px side gutters, content centred up to `--cx-page-max` (1400 px). Phone: clears the 52 px app bar and the tab bar (≥ 84 px), 16 px gutters, `overflow-x: clip`. Narrow a page with `--cx-page-max` on your own page class, e.g. `html[data-design="console"] .cx-sweep-settings-page { --cx-page-max: 880px; }`.
- **Don't draw your own page title on a phone** unless you need a second line: the app bar already shows it (22/600; Hub gets the date and "Morning, <first name>"). On desktop the top bar shows title + date.
- **Bar actions:** `import TopBarActions from '…/design/console/shell/TopBarActions'` and wrap a control: `<TopBarActions placement="start">` (desktop top bar, beside the title: Track's Calendar / Diet / Vitals switch) or `placement="end"` (desktop top bar before search, and the phone app bar before the coins: Hub's "Edit hub", Track's search / add). `start` renders nothing on a phone, so keep the in-page copy there. Renders nothing outside console.
- **Classic pages in the console shell.** A null slot's classic page is offset clear of the console bars (`html[data-design="console"] .section` in shell.css, and classic's `--m-appbar-h` / `--m-tabs-h` are redefined under console), so a half-landed redesign stays usable.
- **Per-section backgrounds (2026-10-30, owner ask):** console draws the same `S.backgrounds[section]` / `S.bgFx[section]` as classic, so a photo set in either design shows in both. App renders `.cx-bg-photo` (+ `.cx-bg-photo-dim`) at z -1 and sets `html[data-cx-photo]` (not classic's `data-bg-photo`, whose plates target classic markup). The shell's image button (top bar / app bar) opens `BackgroundSheet`: choose or replace (App's file picker and crop modal), remove, dim, blur. With a photo up the bars go glassy and on-page text gets a reading plate (shell.css; the plate list came from a per-page audit for text with nothing opaque behind it — extend it when a page adds text straight on the page).
- **SWEEP: Privacy and Terms.** Under console the shell drops `HubFooter`, which carried Privacy Policy / Terms of Service links. Classic Settings still has them (Privacy tab, `DataExportCard`, via `onOpenLegal`), so `ConsoleSettings` must keep a way to `onOpenLegal('privacy')` and `onOpenLegal('terms')` (it is in `sectionProps`).
- `sectionProps` is unchanged; the shell takes the same bag. Nobody has asked for a new key yet.
- Routes: `holiday` still exists and lights the Track tab on phones. The 1 to 5 keys still navigate (hub, achievements, track, shop, holiday); the sidebar shows those as its hints.

## For the foundation (consolidation)

- `--cx-shell-side-w` 216/64, `--cx-shell-top-h` 60, `--cx-shell-app-h` 52, `--cx-shell-tab-h` 56, `--cx-shell-tab-pad` max(28px, safe-area bottom), `--cx-page-max` 1400.
- `.cx-shell-chip`: a 32 px (36 on the phone bar) bar chip with a 44 px hit area via `::after`. A candidate for `.cx-chip--bar` in base.css.
- `.cx-shell-kbd`: mono 12 muted keyboard hint.
- Shell controls cancel classic's global `button:active { transform: scale(.97) }` (index.css). Base `.cx-btn` may want the same.
- README §9 says Dark OS inputs are the only element-type leak; bare `nav` is another (index.css and hub-dark.css style `nav` as a fixed 56 px rail that widens on hover). The shell uses `<div role="navigation">` for that reason; anyone drawing a `<nav>` in console will inherit it.

## After TRACK lands

- Done 2026-10-21: `CONSOLE_SHOW_HOLIDAY = false` (Track shows trips). Holiday has left the sidebar and More; the `holiday` route stays for deep links.

## Integration (2026-10-21)

- `data-cx-nav="<id>"` on sidebar items, phone tabs, More rows; `data-cx-nav="more"` on the More tab (SWEEP's tour).
- `navSection()` in nav.js: the holiday route reads as Track (title and sidebar highlight) while Holiday has no entry. Pinned in nav.test.mjs.
- Pages no longer draw their own title (PageHead, Track); the bars are the page h1 everywhere.

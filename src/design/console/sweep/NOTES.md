# SWEEP area notes

Owned by the SWEEP agent; only it edits this file. One line per item:
new tokens or primitives to consolidate into tokens.css / ui.jsx, and
changes needed in files this area does not own (see ../README.md §7).

## For the foundation (consolidate)
- `.cx-sweep-scope` (sweep.css §1) is a classic-token bridge: inside it `--text/--border/--card/--display/--serif/--mono/--em-text…` point at `--cx-*`, uppercase tracking and italics are off. It is how a classic component is restyled from outside without editing it; HUB/TRACK may want it as a shared `.cx-bridge`.
- `PageHead.jsx` (28/600 title, 13 px meta, actions) is a page-header primitive; SHELL's page header may supersede it.
- `.cx-sweep-pro` (gold ◆ Pro mark), `.cx-sweep-bar` (6 px bar, `.is-gold`), `.cx-sweep-dot.is-<category>` (palette.js colours per theme), `.cx-sweep-tag` ("You"), `.cx-sr` (visually hidden) are candidates for base.css.

## For SHELL (App.jsx / shell)
- Tour targets: please put `data-cx-nav="<section id>"` on console nav items (sidebar, tab bar, More button as `more`), and `data-cx-tour="hub"` on the hub's player strip. ConsoleTutorial falls back to classic `#nav-tab-*` ids and the phone tab labels, then to a centred card.
- ConsoleTutorial accepts an optional `S` prop; passing it in the tutorial slot's props ticks what's already done on the last stop ("Where to start"). Without it only "Create your account" is ticked.
- Paywall "You've used 5 of 5": the slot gets only `openId`, so the console paywall says "You've used all 5 free trackers". A `count` alongside `openId` would allow the literal "5 of 5".

## For HUB
- `ConsoleLeaderboard.jsx` imports `./DivisionTablePlaceholder` behind a SWAP POINT comment. When `hub/DivisionTable.jsx` exists, change that one import. Contract it expects (same as classic groups/DivisionBoard): `{ data /* useGroups().data */, division /* number on screen */, onPickDivision(num) }`.

## Classic issues found (not fixed: classic is frozen)
- `paywall:` (bare, 3 call sites) and `paywall:friends` (2) aren't FREE_CAPS keys, so classic PaywallModal renders nothing for them. Console falls back to the generic sheet.
- "Long streaks breed complacency…" is in `lib/coach/heuristicBrief.js` (hub brief, shared with classic). Gentler wording needs an owner decision because changing it changes classic text.

## Decisions for the owner
- Sign-in: the email field no longer autofocuses (Google/Apple now lead, and focus would pop the phone keyboard over them). Footer links read "Privacy" / "Terms" (classic: "Privacy Policy" / "Terms of Service"); the paywall keeps the full names. Store-copy call.
- Habits keep the word "relapse" (the shared relapse modal says it); tone is softened around it ("since your last relapse", "Log a relapse").
- Paywall sells AI scans as "Fair daily limit", not "Unlimited" (aiQuota still caps Pro). Plans are chosen then confirmed ("Continue with yearly"); classic bought on tap.
- Copy inside classic components mounted whole (Settings tabs, shop, goal board, friends rail, leaderboard panels) keeps classic strings, em-dashes and the "🔒 Pro" chip; only rebuilding those components would change it.

## Integration (2026-10-21)

- Leaderboard › Division draws HUB's DivisionTable through `DivisionBoard.jsx` (classic DivisionBoard props); the placeholder is deleted.
- Tour targets exist: `data-cx-nav` on sidebar items, phone tabs, More (`more`) and More rows; `data-cx-tour="hub"` on the player strip. The tutorial slot now gets `S`.
- The paywall slot now gets `count`; `headline()` says "5 of 5" exactly at the cap and keeps "all 5" over it.
- PageHead no longer prints a title (the shell bar is the page h1); `title` stays as the header's accessible name. Settings dropped its empty PageHead. Classic `.sec-title` text inside `.cx-sweep-scope` is hidden (desktop keeps its "?" help; phones drop the row).

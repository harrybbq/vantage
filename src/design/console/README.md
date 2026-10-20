# Console redesign: the shared contract

Direction A "Console, refined", plus two things from Direction C: tier-band
colouring of rating numbers, and the League widget as a division table with
promotion and relegation rails. Also a Friends widget on the hub, and Track
becoming a calendar with Holiday merged in. The spec is `DIRECTIONS.md` (§A,
C's bands, Recommendation, Migration notes) in the redesign scratchpad.

Four agents build on this foundation at the same time: **SHELL, HUB, TRACK,
SWEEP**. This file is what lets them do that without ever editing the same file.

## 0. The one rule: classic stays identical

The current design ("classic") is the runtime backup. With
`data-design="classic"` the app must render **pixel-identical** to before the
redesign, in both themes and at both widths. That is how the redesign can be
abandoned or rolled back without a revert (the git backup is
`backup/classic-design-2026-10-20`).

- Never edit a classic CSS file for the redesign (list in §7).
- Never change a classic component's markup or behaviour for the redesign.
  Where structure changes, build a **new** console component and mount it
  through a slot (§3) or `useDesign()`.
- Verify it: capture classic before and after your change in the Playwright
  harness and pixel-diff them (§8). Reading selectors is not evidence.
- Data safety (CLAUDE.md) applies unchanged. A console screen reads and writes
  the same `S` as classic, writes are additive (`update(prev => ({ ...prev, key }))`),
  and a new layout gets a NEW key (for example `S.hubGrid`). Never rewrite
  `S.widgetPositions`, `S.widgetSizes`, `S.hubWidgets` or `S.mobileWidgets`,
  because classic still reads them and a rollback must find them intact.

## 1. The design switch

| What | Where |
|---|---|
| Values | `DESIGNS = ['classic', 'console']`, in `src/lib/design/design.js` |
| User's choice | `S.design`, a new additive key. Absent or garbage → default |
| Default | `DEFAULT_DESIGN = 'classic'`. **The launch is one line: set it to `'console'`** |
| Preview gate | While the default is classic, console needs `allowConsole` (the owner, via `useIsOwner`). The gate is derived from the default (`isConsoleGated()`), so the flip opens it for everyone. Someone who explicitly picked classic keeps it |
| Resolver | `resolveDesign(S, { allowConsole, defaultDesign })` → `'classic' \| 'console'`. Pure, tested |
| Updater | `withDesign(prev, 'console')`. Changes one key; returns `prev` itself when nothing changes |
| Toggle | Settings → Appearance → **Design: Classic / New (preview)**, in `src/design/DesignSwitch.jsx`. Owner-only, compiled out of native builds (`OWNER_SURFACES_IN_BUILD` lazy import, then `useIsOwner`) |

### In components

```jsx
import { useDesign } from '../hooks/useDesign';   // src/hooks/useDesign.js
const { design, isConsole, isClassic } = useDesign();
```

`useDesign()` reads context. App's `Board` resolves the design once
(`useApplyDesign`) and provides it (`<DesignProvider>`). Outside the provider
(the sign-in screen, legal pages, Board's load-error screen) you get the
no-session design, `NO_SESSION_DESIGN`, which is classic until the launch flip.

**Hooks rule:** never `if (isConsole) return <X/>` above other hooks in a
classic component. The design can change while mounted (the owner toggles it)
and the hook count would change, which blanks the whole app (see
`eslint.config.js`). Use a slot (§3) or a wrapper component instead.

`useApplyDesign` also writes `<html data-design="classic|console">` (before
paint, `useLayoutEffect`). `main.jsx` sets it before the first render, and
sign-out resets it to the no-session design. In console mode it sets the
user's accent inline on `<html>` (§2, accent).

## 2. Tokens: `tokens.css` (owned by the foundation)

Everything is scoped under `html[data-design="console"]`. Surface and type
tokens are prefixed `--cx-` so they cannot collide with classic's `--text`,
`--mono`, `--bg-base` and so on, which un-redesigned classic components still
read in console mode. Theme ids stay `dark-os` and `cream-pro`. `cream-pro`
is drawn as **Paper**, and Paper is the base block, so pre-auth also gets Paper.
Do not rename `THEMES[].name` (that would change classic Settings text).

| Group | Tokens |
|---|---|
| Surfaces | `--cx-bg` `--cx-s1` `--cx-s2` `--cx-s3` |
| Text | `--cx-text` `--cx-mid` `--cx-muted` |
| Lines | `--cx-line` (decorative) · `--cx-line-strong` (inputs and controls, ≥ 3:1) |
| Accent | `--cx-accent` (as text) · `--cx-accent-fill` · `--cx-on-accent` · `--cx-accent-tint` |
| Semantics | `--cx-gold` `--cx-gold-tint` (◆ achievement) · `--cx-night` (☾) · `--cx-danger` · `--cx-warn` · `--cx-track` (empty bar) · `--cx-shadow` · `--cx-scrim` |
| Bands (C) | `--band-bronze` `--band-silver` `--band-gold` `--band-emerald` `--band-diamond` `--band-ruby` |
| Rails | `--promo` · `--releg` · `--plan` (a trip's "planning" status) |
| Fonts | `--cx-sans` (DM Sans, for words) · `--cx-mono` (DM Mono, **numerals only**) |
| Type scale | `--cx-fs-12/--cx-lh-12` 12/16 · 13/18 · 15/22 · 17/24 · 22/28 · 28/32 · 40/44 (`--cx-fs-40` is for numerals) |
| Radius | `--cx-r-panel` 12 · `--cx-r-cell` 8 (cells, buttons, inputs) · `--cx-r-chip` 6 · `--cx-r-bar` 2 · `--cx-r-sheet` 16 · 50% only for avatars |
| Spacing | `--cx-sp-4` `-8` `-12` `-16` `-20` `-24` `-32` |
| Controls | `--cx-control-h` 40 · `--cx-input-h` 48 · `--cx-chip-h` 28 · `--cx-check` 20 |
| Motion | `--cx-dur-fast` 120ms · `--cx-dur` 200ms · `--cx-ease` `cubic-bezier(.2,.7,.2,1)`. Both durations are 0ms under `prefers-reduced-motion`, so anything built on them stands still for free |

Values come from DIRECTIONS.md §A and dirAC.mjs. `tokens.test.mjs` checks that
every text token and every band is ≥ 4.5:1, and line-strong ≥ 3:1, on bg, s1
and s2 in both themes.

**Accent.** The user's scheme (`--em`, SettingsSection `SCHEMES` and the Pro
custom colour) still drives it. CSS can't do contrast maths, so
`consoleAccentVars(hex, theme)` in `design.js` derives it the way Lifts
`accentVars()` does, and `useApplyDesign` sets it inline on `<html>`. The
fill is ≥ 3:1 on s1. Text is ≥ 4.5:1 on Paper and ≥ 7:1 on Dark: on Dark, AA
alone gives a dull `#219C5E` for the default green, against the table's bright
`#3FBF7F`; the 7:1 target derives `#2CCE7D`. On-accent is black or white,
whichever is more legible. The static values in tokens.css are only a
fallback. **Never hard-code an accent colour.**

**Fonts.** `index.html` loads DM Sans 300/400/500/600 and DM Mono 400/500.
**There is no DM Sans 700**, so weight 700 is faux-bold; use 600. Do not add
700 to the Google Fonts link, because classic already asks for 700 in places
and would change.

## 3. Slots: where console screens mount (App.jsx is SHELL's)

App.jsx wraps each section, and the paywall, tutorial and sign-in screens, in

```jsx
<DesignSlot use={ConsoleHub} props={sectionProps}>{classic element}</DesignSlot>
```

`src/design/DesignSlot.jsx` renders `<ConsoleHub {...props}/>` in its own
Suspense when the design is console **and** the slot holds a component.
Otherwise it renders the classic element untouched. A slot left `null`
therefore shows classic even in console mode, and the redesign can land one
screen at a time.

The slots live in per-area entry modules, and each module is edited only by
its area's agent:

| Entry module | Slots |
|---|---|
| `hub/index.js` (HUB) | `ConsoleHub` (desktop and mobile; `isMobile` is in the bag) |
| `track/index.js` (TRACK) | `ConsoleTrack` ('track') · `ConsoleHoliday` ('holiday' route; Holiday is merged into Track, so this can render Track's trips view) |
| `sweep/index.js` (SWEEP) | `ConsoleHabits` · `ConsoleSettings` · `ConsoleAchievements` · `ConsoleShop` · `ConsoleLeaderboard` · `ConsoleFriends` · `ConsolePaywall` · `ConsoleTutorial` · `ConsoleAuth` |

Fill a slot with a lazy component so classic users never download console code:

```js
import { lazy } from 'react';
export const ConsoleHub = lazy(() => import('./ConsoleHub'));
```

`slots.test.mjs` fails the build if a slot App.jsx names is missing or holds
something other than null or a component.

### Section props (`sectionProps` in App.jsx)

Every **section** slot gets the same bag. Keys can be added but never renamed:

`S, update, hydrated, userId, userEmail, isMobile, isOwner, hasPro, visionState,
navigate, activeSection, onOpenModal, onOpenPaywall(id='generic'), onShowCoinToast,
onCoachAct, onOpenLegal, onOpenVisions, onOpenPalette, onOpenShortcuts, onSignOut,
requestedTrackTab, requestedSettingsTab`

The **overlay** slots get the classic component's own props:
- `ConsolePaywall`: `{ openId, onClose, onManage, onShowToast, onOpenLegal }`
- `ConsoleTutorial`: `{ visible, theme, onNavigate, onClose }`
- `ConsoleAuth`: `{ onOpenLegal, webInviteOnly }`

If you need a new key, ask SHELL to add it to `sectionProps` in App.jsx. Until
then, read it from your own hook. Do not edit App.jsx.

### Page container

A console section renders its own outer element. Use
`<section className="section active cx-page cx-<area>-page">`. Classic
`.section` supplies the offsets for the fixed sidebar, app bar and tab bar,
including safe areas. On phones those are `!important` (index.css, 768px
media). **SHELL owns `.cx-page`** in shell.css and retunes the offsets when it
changes the bars. Do **not** reuse classic ids such as `#hub` or `#track`:
index.css styles `#track.section` with a stock photo and `#hub.section` with
its own padding.

## 4. `base.css` and the cx- family (owned by the foundation)

All of these are scoped, sentence case, and use only the tokens.

| Class | What |
|---|---|
| `body` | Console ground: `--cx-bg`, `--cx-text`, DM Sans. Classic's radial accent glows, the CRT scan lines (`hub-dark.css` `body::before`) and the noise layer (`index.css` `body::after`, z-index 999) are switched off. Verified on computed styles |
| `.cx-t12 … .cx-t40` | The type scale |
| `.cx-num` | Mono, tabular numerals. Numbers only |
| `.cx-eyebrow` | The one mono uppercase eyebrow, at most once per screen |
| `.cx-muted .cx-mid .cx-accent .cx-gold .cx-night .cx-danger` | Text colours |
| `.cx-panel` | s1, hairline, radius 12, the theme's shadow |
| `.cx-btn` + `--primary` / `--ghost` / `--danger` / `--block` / `--icon` | 40px (48px on `pointer: coarse`), radius 8, 15/600. Secondary is the default (a line-strong outline) |
| `.cx-check` | The ONE checkbox: a 20px rounded square with a 44px hit area. `aria-checked="true"` fills it |
| `.cx-chip` | 28px, radius 6. `aria-pressed="true"` or `.is-on` selects it |
| `.cx-seg` / `.cx-seg-opt` | Segmented control; the selected option (`aria-checked`) is raised. 32px (40px coarse) |
| `.cx-input` / `.cx-field` / `.cx-label` | 48px on s2 with a line-strong border, 16px text (iOS zooms below 16) |
| `.cx-wf` / `-head` / `-title` / `-meta` / `-body` | WidgetFrame chrome |
| `.cx-sheet-root` / `.cx-sheet` / … | The sheet (below) |

`.cx-input` uses `:not(#cx-id)` to raise its specificity on purpose.
hub-dark.css styles every input, textarea and select under Dark OS at
specificity (0,5,2), which beats a scoped class. Measured, not assumed.

## 5. React primitives: `ui.jsx` (owned by the foundation)

```jsx
import { Panel, Button, Chip, Segmented, Checkbox, Sheet, WidgetFrame } from '…/design/console/ui';
```

- `Panel({ as = 'section', className, ...rest })`
- `Button({ variant = 'secondary' | 'primary' | 'ghost' | 'danger', icon, iconSize, block, iconOnly, label, type = 'button' })`. `iconOnly` needs `label`
- `Chip({ icon, selected, onClick })`. A button with `aria-pressed` when clickable, a span otherwise
- `Segmented({ options: [{ value, label, disabled }], value, onChange, label })`. A radiogroup; the arrow keys move the choice
- `Checkbox({ checked, onChange(next), label, showLabel, disabled })`. `label` is always the accessible name
- `WidgetFrame({ icon, title, meta, size = 'small' | 'medium' | 'large', onTitleClick, actions })`. A 16px Lucide icon, a 13/600 title and a right-aligned 12px meta. `data-size` is exposed for the hub grid (1×1, 2×1, 2×2); the hub owns spans and heights
- `Sheet({ title, eyebrow, onClose, footer, modal = true, width = 480, placement = 'auto', className, testId, initialFocus, labelId, closeLabel })`. A bottom sheet below 1024px and a right drawer from 1024px. It behaves like the Lifts sheet: the drag handle closes it, it is capped at 88vh and scrolls inside, the footer is sticky with safe-area padding, it rides on the iOS keyboard (`useKeyboardInset`), the scrim tap closes it, focus is trapped and returned, and Esc closes the topmost sheet. It is portalled to `<body>`. Its Esc stack is separate from the Lifts sheet's (the two never open together)

Icons come from `src/components/Icon.jsx` (Lucide, inline). Draw them at
16/18/22 with stroke 1.75. Keep emoji out of chrome.

## 6. Tier bands: `src/lib/ratings/bands.js`

```js
import { bandOf, bandClass, bandVar, BAND_KEYS } from '…/lib/ratings/bands';
bandOf(74)                  // 'emerald'   (thresholds come from tiers.js; never restate them)
bandClass(74)               // 'cx-band-emerald'     → color: var(--band-emerald)
bandClass(74, { bg: true }) // 'cx-band-bg-emerald'  → background
bandVar(84)                 // 'var(--band-diamond)' for inline bars and rails
bandOf(null)                // null; bandClass → ''  (a missing rating is never painted bronze)
```

Colour every rating number: OVR and the four categories, yours and friends'.

## 7. File ownership

Only the owner of a file edits it. To use something you don't own, import it
read-only. If you need a change to it, note it for the owner (below).

### Foundation (this commit). Others treat these as read-only

`src/lib/design/design.js` · `src/lib/design/contrast.js` · `src/lib/ratings/bands.js` ·
`src/hooks/useDesign.js` · `src/design/DesignSlot.jsx` · `src/design/DesignSwitch.jsx` ·
`src/design/console/tokens.css` · `base.css` · `index.css` (the CSS entry) · `ui.jsx` ·
`README.md` · `tokens.test.mjs` · `slots.test.mjs` · `src/lib/design/*.test.mjs` ·
`scripts/check-console.mjs`

### SHELL

- **`src/App.jsx`. SHELL is the only agent allowed to edit it.** That covers routing, which shell components render in console mode, `sectionProps` keys, and whether `HubFooter` (clock and countdown) and `BootSequence` render under console (Direction A drops both). Keep the existing `DesignSlot` wrappers and the fenced design-switch block.
- New components under `src/design/console/shell/`: the desktop sidebar nav (216px, sentence-case labels, keyboard hints), the page header / top bar, the mobile app bar, the 5-tab bottom bar (12px labels) and the More drawer.
- CSS: `src/design/console/shell.css`, including `.cx-page` (§3).
- Read-only references: `Nav.jsx`, `PageHeader.jsx`, `mobile/MobileAppBar.jsx`, `mobile/BottomTabBar.jsx`, `mobile/MoreDrawer.jsx`, `HubFooter.jsx`, `BootSequence.jsx`, `SaveStatusPill.jsx`, `CoinToast.jsx`, `CommandPalette.jsx`.
- Under console, Holiday is merged into Track, so the bars no longer need a Holiday entry. The `'holiday'` route stays, because deep links and saved tabs still reach it, and it renders TRACK's `ConsoleHoliday`. Which entry replaces Holiday on the 5-tab bar is SHELL's call, to be flagged to the owner (C proposed League).

### HUB

- Slot: `src/design/console/hub/index.js` (`ConsoleHub`), and everything under `src/design/console/hub/`.
- Owns: the console hub body on desktop and mobile, the 4-column widget grid of fixed size families (Small 1×1, Medium 2×1, Large 2×2; on mobile a 2-column stack), the player strip (Level/XP, OVR donut and category bars in band colours, prestige, coins, honours, league line), the League widget as a **division table with promotion/relegation rails**, the Friends widget, Up next, and console bodies for the widgets.
- CSS: `src/design/console/hub.css`.
- New layout state is a new additive key (for example `S.hubGrid`), derived the first time from `widgetPositions` / `widgetSizes`, which stay untouched.
- Read-only references: `HubSection.jsx`, `HubOsLayout.jsx`, `mobile/MobileHubSection.jsx`, `mobile/MobileWidget.jsx`, `widgets/LifeWidgets.jsx`, `savings/SavingsWidgets.jsx`, `widgets/prime/*`, `RatingsPanel.jsx`, `ratings/RatingsDonut.jsx`, `PrestigeBadge.jsx`, `LeaderboardPanel.jsx`, `groups/DivisionBoard.jsx`, `friends/*` (FriendsRail, FriendListRow, FriendCard), `lib/hub/*`, `hooks/useLeaderboard.js`, `mobile/AddMobileWidgetModal.jsx`, `Modals.jsx`. Reuse their data hooks and stores, not their markup.
- **Shared component:** HUB builds the division table as `src/design/console/hub/DivisionTable.jsx`. SWEEP's leaderboard page imports it read-only.

### TRACK

- Slots: `src/design/console/track/index.js` (`ConsoleTrack`, `ConsoleHoliday`), and everything under `src/design/console/track/`.
- Owns: the Track section (Calendar / Diet / Vitals), the calendar (month, week and agenda views, trip bands, span events), trips with the Holiday features merged in, and the add sheet.
- CSS: `src/design/console/track.css`.
- Read-only references: `TrackSection.jsx`, `track/*` (VitalsPanel, DietPanel, VitalsEntryModal, AutoFillModal), `diet/LogFoodPanel.jsx`, `HolidaySection.jsx`, `holiday/*`, `calendar/EventModal.jsx`, `lib/calendar/*`, `lib/holiday/*`, `lib/vitals/*`, `lib/diet/*`. `HolidaySection` stays as it is for classic.

### SWEEP

- Slots: `src/design/console/sweep/index.js` (habits, settings, achievements, shop, leaderboard, friends, paywall, tutorial, auth), and everything under `src/design/console/sweep/`.
- Owns: Habits; Settings (except the Design switch, which is the foundation's `DesignSwitch.jsx`. **ConsoleSettings must render it** in Appearance with the same gating, `OWNER_SURFACES_IN_BUILD ? lazy(() => import('../../DesignSwitch')) : null`, passing `{ S, update, userId }`); the paywall (opens on the cap that was hit, with a free-vs-Pro table from `FREE_CAPS`, themes listed as free); auth and sign-in; the tutorial; achievements; the shop; the leaderboard page; the friends page; and the copy sweep (no `//` labels, no em-dashes in UI strings, emoji out of chrome).
- CSS: `src/design/console/sweep.css`.
- Read-only references: `HabitsSection.jsx`, `mobile/MobileHabitsSection.jsx`, `habits/*`, `SettingsSection.jsx`, `settings/*`, `PaywallModal.jsx`, `AuthScreen.jsx`, `TutorialOverlay.jsx`, `AchievementsSection.jsx`, `achievements/*`, `ShopSection.jsx`, `LeaderboardSection.jsx`, `mobile/MobileFriendsSection.jsx`, `VisionsModal.jsx`.

### Nobody edits these for the redesign

Classic CSS: `src/index.css`, `hub-dark.css`, `theme-cream-pro.css`,
`tutorial.css`, `holiday.css`, `groups.css`, `track-panels.css`, `savings.css`,
`prime.css`, `log-food.css`, `boot.css`, `shop.css`, `install-prompt.css`,
`components/habits/habits-page.css`, `components/friends/friends-dm.css`,
`components/widgets/*.css`, and `components/upgrade/**`, which is owner-only
and stays OFF the redesign.

Shared entry and config: `package.json` (the build line is fixed; add tests as
files, §8), `index.html` (the font link), `src/main.jsx`, `vite.config.js`,
`eslint.config.js`, and `public/sw.js`.

Every classic component in `src/components/**` is a read-only reference.

**A new token or primitive?** Put it in your own area file, prefixed for the
area (`--cx-hub-…`, `.cx-track-…`, `HubThing.jsx`), and add a line here under
"Consolidation notes" (append-only, one line each). The foundation folds them
into tokens.css and ui.jsx afterwards.

### Consolidation notes (append-only)

- (none yet)

## 8. Tests and verification

**One build entry:** `npm run check:console` runs `scripts/check-console.mjs`,
which finds every `*.test.mjs` under `src/design/` and `src/lib/design/`. It
runs them one after another with node, prints one line per file, and exits
non-zero if any fail. **To add a test, add a file. Never edit package.json.**
Tests must be hermetic: no env vars, no network, no wall clock. Netlify builds
on Node 20, so check `PATH=/opt/node20/bin:$PATH npm run build` too.

Always on:
- `tokens.test.mjs` checks that every selector in every `.css` file under
  `src/design/` (your area file included) starts with `html[data-design="console"]`,
  that token contrast holds, and that the scales are right.
- `slots.test.mjs` checks the slot contract.
- `src/lib/design/design.test.mjs` and `bands.test.mjs` cover the resolver
  and the bands.

UI changes (CLAUDE.md): use a Playwright harness with realistic heavy data
(the redesign scratchpad's `tools/harness-main.jsx` + `heavy-state.mjs`). The
harness RPC mock answers `is_app_owner`, so add a window flag to make it
`true` for console captures. Check 390 and 1440, both themes, no horizontal
overflow, and classic pixel-identical before and after. Delete harness files
before committing.

## 9. Gotchas

- **Owner preview flash.** `useIsOwner` is an RPC, cached per tab in
  sessionStorage, and the cloud copy of `S` replaces the optimistic local one.
  So an owner's first load in a tab can show classic, then console. This is
  accepted for the preview; don't chase it. The launch flip removes the RPC
  from the path.
- **Sign-in is always the no-session design** (classic until launch), because
  it has no `S` and no owner. Verify `ConsoleAuth` in a harness by calling
  `applyDesign('console')` or by flipping `DEFAULT_DESIGN` locally. Don't
  commit the flip.
- **`data-hub-os="1"` is still set in console mode** (`applyTheme` sets it for
  both themes), so hub-dark.css's `html[data-hub-os] …` layout rules still
  match any classic class you render. Console components should use their own
  `cx-` classes, not `os-panel`, `hub-*`, `m-widget` and the like.
- **Classic element-type rules leak.** The only one is Dark OS's
  input/textarea/select rule at (0,5,2); `.cx-input` beats it. A raw
  `<input>` without `.cx-input` will look like classic.
- **Classic `!important`** (about 187 of them) mostly sits on classic classes,
  so it can't reach `cx-` markup. Mobile `.section` padding is the exception
  that matters (§3, page container).
- **Lazy-loaded classic CSS** (for example `habits-page.css`, imported by its
  component) is injected after `console/index.css`. It only targets classic
  classes, but it means console must not rely on source order against those
  files.
- **Both themes are free; accent schemes beyond the first six stay Pro**
  (the CLAUDE.md tier line). Console changes looks only, never gating.
- The owner-only Upgrade section (Career, Diet, Rotation, Review, Lifts) is
  **not** part of the redesign and stays off the Before & After page.

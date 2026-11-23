# Vantage — session context

Personal productivity/wellness app. React 18 + Vite SPA · Supabase (auth + Postgres, EU) · Netlify (hosting + functions) · Capacitor planned for app stores. Owner: harrym3002@outlook.com.

## Deploy flow (always)
Develop on the designated `claude/*` branch — direct pushes to `master` are blocked.
Build → verify → commit → push → create PR (`harrybbq/visionboardreal`, base `master`) via GitHub MCP → merge it. Netlify auto-deploys master. Bump `CACHE_VERSION` in `public/sw.js` when a deploy should force clients onto the new build.

## Tier line (decided 2026-08-11)
**Both themes are free.** Cream and Dark OS ship to everyone — charging
for the good-looking one meant every new account met the weaker version
of the app first. Pro earns its money on **limits, customisation and
widget count**: accent colour schemes stay Pro, the caps stay Pro, the
wider widget set stays Pro. When adding anything, ask which side of that
line it falls on — looks are free, *more* is paid.

Theme ids keep their legacy `-pro` suffix (`cream-pro`, `dark-os`)
because they are what `S.theme` holds; only the labels changed. The
retired `cream`/`dark` ids map forward in `resolveEffectiveTheme`.

## Hard rules
- **DATA SAFETY IS PRIORITY #1.** All existing user data — the `user_data.state` JSON, `nutrition_log`, uploaded backgrounds, and profile pictures (Supabase Storage `avatars`/backgrounds buckets) — must be preserved and kept safe above all else. Before EVERY Netlify deploy, verify the change cannot lose or corrupt user data: state writes must be **additive** (new keys only, never overwrite/replace whole `state`), never run destructive migrations/Storage deletes/`user_data` rewrites, and never let a new client build wipe or reset state on load. The 2026-05-03 stale-SW incident (git `f6a7a50`) wiped data — treat that class of bug as unacceptable. When unsure whether a change is data-safe, stop and confirm before deploying.
- Commit trailers: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` — never put raw model IDs in commits/PRs/code.
- Supabase migrations can't be applied by tools (approval-gated). Write SQL to `supabase/*.sql` for the owner to run in the SQL editor; make client code fail soft until applied.
- Supabase compute is **Small** (Pro plan; confirmed from billing 2026-10-05 — Micro would cover today's load). Still design for Micro-level load: keep DB load minimal (JSON-path projections, module-scope caches in functions, no full-state transfers).
- Verify UI changes with a Playwright harness before committing: temp `harness.html` + `src/harness-main.jsx`, `npx vite --port 5199`, Playwright from `/opt/node22/lib/node_modules/playwright`, **use realistic heavy data** (sparse test data has hidden real overflow bugs before), delete harness files before commit.
- Mobile: content must FIT the viewport (no horizontal overflow, no zoom-out); modals/sheets cap height with internal scroll so the backdrop stays tappable.

## Architecture pointers
- All user data lives in one JSON state `S` in `user_data.state`, saved debounced. New features = new keys in `S` (no migrations). Key stores: `vitalsLog` (weight/sleep/rhr/recovery/strain — WHOOP + Apple Health + manual), `nutrition_log` table (food), `moodLog`, `bodyLog`, `subscriptions`, `savings`, `habits`, `shopItems`, `hubWidgets`, `privacy`.
- Hub widgets: shared React bodies (see `src/components/widgets/LifeWidgets.jsx`, `savings/SavingsWidgets.jsx`) rendered by `mobile/MobileWidget.jsx` (mobile stack) and as React islands in `HubSection.jsx` (desktop draggable canvas). Add a widget = META entry + renderBody case + both pickers (`AddMobileWidgetModal`, `Modals.jsx`).
- Netlify functions own anything cross-user or secret: leaderboard, WHOOP sync (`netlify/lib/whoop.js`), AI (`ai-food-detect`, `ai-coach-daily` — need `ANTHROPIC_API_KEY` env).
- Social: `profiles`/`friendships`/`messages`/`blocks`/`reports` tables, RLS-gated direct queries in `src/lib/friends/`. Report+block UI exists (friend card + DM ⋯ menu).
- iPhone calendar (iOS app, Pro, 2026-11-01): `lib/calendar/device.js` + `deviceSource.js`. Read on the device, never stored: App hands calendar surfaces a VIEW of S (`withDeviceEvents`, non-enumerable symbol) — never write it back. Settings card `settings/DeviceCalendarCard.jsx`; prefs per phone in localStorage.
- Lifts, two gyms, two plans (owner-only, 2026-11-13): `data/trainingProgramme.js` holds a written plan per gym, `PROGRAMME` (DXC, the base) and `PROGRAMME_GREENOCK`, same sessions and required sets slot for slot; a Greenock entry that takes a different exercise's slot carries `for` (the DXC name). `GYM_ONLY` records which gym has what (a lift's own `only`, set in Manage lifts › ⋯ › "Where you can do it", wins). `lib/lifts/gymPlan.js`: `planOf(gym, session)`, `switchExercise` (a session in progress changes gym: exercises with no set done become the other plan's counterpart, `workout.js` `setWorkoutGym`), `fitForGym` (safety net: nothing a gym lacks is shown). The adaptive Upper/Lower builds from the chosen gym's plan. A new exercise in either plan needs `EXERCISE_PARTS` (adaptive.js) and `PROGRAMME_MUSCLES` (muscles.js). Open: DXC has no seated leg curl, so DXC's Lower shows it as left out until the owner names what DXC has. Home UI (2026-11-23): three views on every screen (Today · Lifts · History, `LiftsTab` `HOME_PAGES`); the Today card puts Start first and folds the coaching detail (muscle tallies, catch-up tags, WHOOP chip, below-standard note) behind one "why" line (`WorkoutToday`); lifts are one list of rows with search, never-logged lifts in a collapsed group (`LiftList`); one week strip, no pips; labels have no `//` and take the console label style in the new design. Colour and motion (2026-11-23, mockup "Workout Moments"): each of the five sessions has its own colour (`lib/lifts/sessionColour.js`, a view of the session's name, nothing stored; it lays the colour over `--lf-accent` on the Today card, the live workout, the Finish sheet, each week-strip day and History's grid, so write new rules against `--lf-accent` and they follow); a workout that is not one of the five keeps the accent. Gold stays a best, indigo a night, red a problem, which is why Push is lime. The moments: a ticked set springs and moves a progress bar, a finished exercise gets a Done chip, a best bursts gold, and the save is the body map filling in (`workout/SavedMoment.jsx`). Confetti is rare on purpose: a small gold burst for a best, the full thing only when the save finishes the week.
- Habits (reworked 2026-11-23, "less like a chore"): the new design's page is **the track** — one lane a habit, all running at once (`design/console/sweep/HabitTrack.jsx` + `habit-track.css`, hosted by `ConsoleHabits.jsx`); classic keeps its roster + detail. The runner (`components/habits/HabitRunner.jsx`), stages, ghost and the relapse rules are untouched. Three shared rules, all in `lib/habits/`, so they apply in both designs and the hub widgets: `record.js` (the number that doesn't reset: clean days of the last 30, or closed periods on budget; it also grows the runner's scenery via `view.js sceneryLevel`), `road.js` (an endless habit past its own milestones gets the next one automatically; one additive key `habit.autoPaid`; first look pays nothing; paid by `useHabitAwards`), and `relapse.js undoRelapse` (the one-tap "I slipped" offers Undo; it restores the habit only if nothing else touched it). A lane's face shows three things only (this run, what's next, the record); totals and the relapse count live in the opened lane's History.
- Goals on a phone (2026-11-23, mockup "Goals on a Phone", option A): in the new design the phone's Goals page is **Next up**, a list of every goal that can be finished now across all paths, then the paths as cards, then Waiting and Done folded (`design/console/sweep/GoalsPhone.jsx`, arranged by `lib/achievements/goalsList.js`). A goal's sheet holds its path as a trail and Edit, Link and Delete as buttons; nothing is behind a long press. `AchievementsSection` mounts it through its `phoneGoals` prop and hands it the board's own handlers, so there is one implementation of completing, linking and deleting. The desktop board and classic's phone player (`achievements/PathPlayer.jsx`) are untouched, on purpose.
- Legal: `/privacy` and `/terms` deep-link pre-auth (store requirement). Onboarding (replaced both old tours, Oct 2026): logic `src/lib/onboarding/onboarding.js`, overlay `components/onboarding/Onboarding.jsx`, hub Getting started card; per-page help: `SectionHelp`.

## Onboarding stays current (owner rule, 2026-10-29)
Every time a feature is added or changed, decide whether the onboarding
should cover it, and say which way you decided (and why) in the PR body
under "Onboarding". If it should, update the onboarding in the same PR.
- The onboarding is "pick what it's for, then do the first thing": one
  stop per pick (`PICKS` in `onboarding.js`), each opening the real add
  flow and done when the STATE says so. Keep it that small. A feature
  earns a place only if it is a better *first thing* for a pick, a new
  area big enough to be its own pick, or it changes how an existing
  first thing works.
- Changed the flow a pick points at (a modal id, the add button, the
  section, what counts as done)? Update that pick's `first`, its
  `data-ob` marker on the real button (both designs), and
  `onboarding.test.mjs`. A stale stop points at nothing.
- New pick: add it to `PICKS` (its copy, icon, section, modal, target,
  check and `done(S)`), mark the button, extend the test, and check the
  pick screen still fits a 360 px phone.
- The picks also decide the navigation for new accounts (below). A new
  pick needs an `AREA_NAV` entry in `lib/onboarding/areas.js` (which
  menu items it turns on) and `areas.test.mjs` extended.
- Owner-only features (the Upgrade section, trading, Open Banking) are
  never in the onboarding.
- Copy follows the house voice: plain, short, no claims the code doesn't
  back (check that a "counts toward your rating" line is true first).

## Direction: fewer tabs, one clear purpose (owner, restated 2026-11-23)
The owner's standing goal for the product, above any single feature:
**shrink the number of tabs and give the app a clearer purpose.** Today it
reads as "a bit of this and a bit of that". Weigh every piece of work
against it.
- **No new top-level destination.** A new feature goes inside an existing
  section, or it replaces one. If it seems to need its own tab, stop and
  ask where it folds first.
- **When touching a section, ask whether it should still be a section.**
  Polishing a tab is not progress on this goal; removing or merging one
  is. (The Nov 2026 Habits rework made Habits better and left the tab
  count where it was. Say so plainly when that is the trade.)
- **Done so far:** Holiday folded into Track (its route remains for deep
  links); new accounts only see the areas they picked (below); the new
  design's navigation is the Hub plus three sections (2026-11-23).
- **Where the count stands** (new design): Hub, Track, Health, Social,
  on desktop and phone alike (+ Upgrade for the owner: last in the
  sidebar, and a fifth seat on the phone's tab bar).
  Settings is behind the avatar and the phone's More sheet is gone.
  Classic still has its seven; it was left alone on purpose.
- **The structure is decided (owner, 2026-11-23, from mockups):** the Hub
  plus THREE sections, with Settings behind the avatar and no More
  drawer on a phone.
  - **Track** — Calendar · Goals (today's Achievements) · Money (savings,
    which lives inside Achievements today) · Rewards (today's Shopping).
  - **Health** — Train (the gym tracker, out of the owner-only Upgrade
    area) · Food · Vitals · Habits.
  - **Social** — League · Friends · Messages.
- **How the sections are built** (`design/console/shell/nav.js`): a
  section is a GROUP of tabs and a tab is a PLACE, an existing route
  plus the view of that page to show. Nothing moved underneath: Goals
  and Money are the `achievements` route's two views, Food and Vitals
  the `track` route's, Messages the `friends` route's. `navigate(route,
  view)` in App carries the view (`subTab`, session state) and console
  pages read it as `activeSub`. So every old route, shortcut and widget
  still lands and lights its tab. A new page goes in as a tab of a
  group, never as a new sidebar entry. Train is the `train` route
  (`UpgradeSection only="lifts"`), owner-only until step 3.
- **Order agreed:** (1) the gym tracker's UI, where it lives now — done,
  see Lifts below; (2) restructure the navigation into the three
  sections — done; (3) open Train to everyone as a PLAIN LOGGER first (start a
  workout, log sets, history, bests), with pick-a-plan as a later piece.
  The owner's programme, rota, two gyms and avoided lifts are written
  into the app today and must sit behind the owner's account before
  step 3: every other user gets no plan by default. Train also has to
  leave the owner-only bundle, which is compiled out of the native build.
- The wider purpose statement (the OVR rating as the spine) is still a
  candidate, not a decision.

## The smaller app (decided 2026-11-12)
Accounts created from `SMALLER_APP_FROM` (`lib/account/cohort.js`) get
two things; every earlier account is left exactly as it was.
- **The redesign by default** (`defaultDesignFor` in `lib/design/design.js`).
  Nothing is written: the account's creation time decides it, and an
  explicit `S.design` still wins. `DEFAULT_DESIGN` stays `'classic'`, so
  for existing accounts the redesign is still the owner preview.
- **A menu that follows the onboarding picks** (`lib/onboarding/areas.js`).
  Hub, Track (the calendar) and Health (Food, Vitals) always show; a
  pick turns on its tabs, and Social appears with the Friends pick; an
  area with data in it always shows; the rest sit behind **Add an area**
  (the sidebar's row on desktop, an Add seat on the phone's tab bar). It is a view: routes, search and widgets reach every
  section, and the only state is `S.onboarding.scoped` / `.added`.
  "Show me everything" in the onboarding means everything.
- Not done yet, on purpose: seeded trackers (`Amount Saved`) and the
  example goals still arrive for everyone — removing them is a delete,
  which the data rule forbids without a decision. Diet and Vitals tabs
  inside Track are not scoped either.

## Startup / store readiness
`STARTUP_REQUIREMENTS.md` is the ordered checklist for getting Vantage
onto the App Store and Google Play — company formation, developer
accounts, native build steps, and the security/scale work that has to
land first. Update its status markers as things get done; it is the
single source of truth for "what's left before launch".

## Back burner: Open Banking (owner-only) — decided 2026-09-09
Money is the one place left where the app asks for data it could sense.
An Open Banking link (TrueLayer / Plaid / GoCardless) would do to
savings and expenses what WHOOP did to calories burned: continuous,
accurate, arriving unattended. **Owner-only, and not now** — the
implications of shipping it in a public build are too heavy for release.
Same constraint as the trading widget below: owner-gating is a UI gate,
and a store reviewer sees the whole binary regardless. If it is ever
built, it is web-only and absent from the native build until that is
settled. Keep it in mind when touching the savings surfaces — do not
design them in a way that would have to be unpicked — but do not build
toward it.

The cheaper pattern is already in use and should be preferred: DERIVE
rather than sense. Subscriptions roll their own renewal dates forward;
the monthly plan post proposes the finished month from the cash flow and
takes one tap. Neither needs a bank.

## Possible future: trading P/L widget (owner-only)
Owner is building a separate "sibling" app where AI agents trade stocks
automatically — a "digital factory" of agents. That app owns:
allocate/withdraw funds per agent, halt/start each agent, per-agent
stats UI. Vantage gets a **read-only** view of it.

Widget spec as described: one bar per agent showing its total fund,
profit/loss % (since start and today), and which stocks it holds.
**Owner-only for the foreseeable future.** Constraints agreed before any
build starts:
- **Broker credentials never touch the client.** `VITE_*` vars are
  bundled into public JS. Keys live in Netlify function env only, and
  the function verifies the JWT + checks the owner email SERVER-side
  (pattern: `netlify/functions/admin-set-rating.js`). `useIsOwner` is a
  UI gate, not an access control — the leaderboard forgery proved that.
- **Trading data does NOT go in `S`.** State is already ~967 kB and is
  re-downloaded on open / rewritten on save (items 25-26). Fetch live
  from the function on mount with a short cache, or give it its own
  RLS-gated table.
- **The link is a read-only pull, one direction.** Vantage never sends
  orders and never holds broker credentials. Sibling app exposes one
  signed read-only endpoint; Vantage's function fetches and caches it.
  Token: `getRandomValues`, sent as a HEADER not a query string, and
  rotatable — the health-sync token got both of those wrong.
- ⚠️ **Store risk, decide before building:** an app showing live
  brokerage positions draws financial-services review from Apple/Google
  (often needs to BE the institution or be authorised by it), and
  reviewers see the whole binary regardless of owner-gating. May argue
  for keeping this web-only and absent from the native build. UK: showing
  your own numbers isn't FCA-regulated; arranging/advising, managing
  anyone else's money, or selling signals IS.

## Next project: Vantage Home
A new dashboard surface styled like a Home Assistant wall panel (owner has a reference screenshot — ask for it): dense dark tile grid, at-a-glance stats with mini graphs/gauges, header chips, right rail with day recap + forecast-style rows + media-player-style card. Reimagines the hub's widgets (vitals, macros, body, mood, savings, subscriptions, weather?, calendar?) as compact tiles. Keep it OPTIONAL alongside the existing hub, reuse existing widget bodies/stores where possible, respect the existing theme system (`SettingsSection` SCHEMES) and Pro gating conventions.

## Playtest feedback (Finlay, 2026-08-10) — LIVING DOCUMENT
Artifact: https://claude.ai/code/artifact/d192f4b0-0bf1-431b-b636-001f685e6f37
(also https://claude.ai/artifact/SszHK487TVbY3nJ27WmZj4 — same page.)
File: `/tmp/.../scratchpad/ba-site-237/vantage-feedback.html` — republish
with that URL as `url` to keep the link. Since 2026-10-21 screenshots
are image FILES (`img/*.jpg`, published via `files` with `root` set to
the folder), not data URIs — the page had reached 13.6 MB of a 16 MB
cap. A scratchpad doesn't survive the session: in a new one, `read` the
artifact with `path` for the page and each `img/` file, add entries,
and publish the page plus every referenced image (≤255 files a call).

**Keep it current, with evidence.** Whenever anything visual ships,
update the artifact in the same session — it is the running record of
what we changed and why, and a stale version is worse than none.

Every visual change gets a **before/after pair** in its "Change log"
section, captured from the running app rather than drawn:

1. Screenshot the new state from a Playwright harness (same component,
   same data, tight crop round the module).
2. `git checkout <pre-change-sha> -- <files>` , screenshot again, then
   `git checkout HEAD -- <files>`. The "before" must be the real thing,
   not a reconstruction from memory.
3. Add an entry with the date, the merged SHA and PR, one paragraph on
   what the change is FOR, and a measurements table where there are
   numbers worth keeping.

The point is that a decision can be re-examined by looking. If something
turns out to have been better the old way, the old way is on the page
next to the commit that replaced it — which is what makes a revert a
decision rather than an archaeology exercise.

The five named defects, in order:
1. Visions unlock toast is a dead end; catalogue only opens from Settings
2. Achievement anti-gaming rules (7-day spacing · first 8 full credit ·
   sqrt taper) are invisible to the user
3. Seven `SectionHelp` tooltips are 200–400 char run-on prose
4. Export is `JSON.stringify(S)` — ~1 MB plaintext of weight/meals/money
5. Audit features not touched in months (Mood was the first — removed)

Also captured there: the "500+ apps in one" argument (the fix is to stop
rendering unchosen features as empty states, not to cut features), the
"looks like Claude" diagnosis (cream #fdfaf3 + Playfair + one accent is
the generated-design house style; the operator console is the answer we
already own), and the OVR-as-spine bet.

**Not recorded there:** anything in the owner-only Upgrade section
(Career, Diet, Rotation, Review and its menu) stays OFF the Before &
After page from 2026-09-27 on, at the owner's request.

**Correction worth remembering:** Vantage gathers NO purchase history
and has no bank/Open Banking integration — savings and expenses are
manual entry only. Don't repeat that claim.

## Shop prices (Diet → Planner) — refresh every ~4 months
`src/lib/diet/shopping.js` hard-codes typical pack sizes and prices for
Tesco, Morrisons, Aldi and Lidl (`CATALOGUE`, `PRICES_AS_OF`). There is
no live feed by the owner's choice. Every four months or so, review the
table, update the prices and `PRICES_AS_OF`, and keep `shopping.test.mjs`
passing. The owner's own corrections (`S.shopPrefs.storePacks`, `.out`)
always win over the table, so a refresh never overrides them.
Last refresh: Sep 2026 (#219), Tesco/Morrisons/Aldi checked on their
websites. Lidl UK lists no grocery prices online, so `PRICED_AS` makes
Lidl read Aldi's column; drop that entry once Lidl prices are verified
(Lidl Plus app or a receipt).
Check the SPEC, not just the product name: the Sep 2026 refresh priced
"beef mince" from the 20% pack while recipes use 5%. Lean mince now has
its own entry (Morrisons £5.05/500 g, owner-checked); Tesco and Aldi 5%
are `U` (stocked, price unchecked — shows "price not checked", never a
guess). Fill those in at the next refresh.

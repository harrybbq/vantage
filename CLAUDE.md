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
- Supabase compute is Micro — keep DB load minimal (JSON-path projections, module-scope caches in functions, no full-state transfers).
- Verify UI changes with a Playwright harness before committing: temp `harness.html` + `src/harness-main.jsx`, `npx vite --port 5199`, Playwright from `/opt/node22/lib/node_modules/playwright`, **use realistic heavy data** (sparse test data has hidden real overflow bugs before), delete harness files before commit.
- Mobile: content must FIT the viewport (no horizontal overflow, no zoom-out); modals/sheets cap height with internal scroll so the backdrop stays tappable.

## Architecture pointers
- All user data lives in one JSON state `S` in `user_data.state`, saved debounced. New features = new keys in `S` (no migrations). Key stores: `vitalsLog` (weight/sleep/rhr/recovery/strain — WHOOP + Apple Health + manual), `nutrition_log` table (food), `moodLog`, `bodyLog`, `subscriptions`, `savings`, `habits`, `shopItems`, `hubWidgets`, `privacy`.
- Hub widgets: shared React bodies (see `src/components/widgets/LifeWidgets.jsx`, `savings/SavingsWidgets.jsx`) rendered by `mobile/MobileWidget.jsx` (mobile stack) and as React islands in `HubSection.jsx` (desktop draggable canvas). Add a widget = META entry + renderBody case + both pickers (`AddMobileWidgetModal`, `Modals.jsx`).
- Netlify functions own anything cross-user or secret: leaderboard, friends-trending/global-trending (anonymous, `shareTrending` opt-out), WHOOP sync (`netlify/lib/whoop.js`), AI (`ai-food-detect`, `ai-coach-daily` — need `ANTHROPIC_API_KEY` env).
- Social: `profiles`/`friendships`/`messages`/`blocks`/`reports` tables, RLS-gated direct queries in `src/lib/friends/`. Report+block UI exists (friend card + DM ⋯ menu).
- Legal: `/privacy` and `/terms` deep-link pre-auth (store requirement). Tutorial: `TutorialOverlay.jsx`; per-page help: `SectionHelp`.

## Startup / store readiness
`STARTUP_REQUIREMENTS.md` is the ordered checklist for getting Vantage
onto the App Store and Google Play — company formation, developer
accounts, native build steps, and the security/scale work that has to
land first. Update its status markers as things get done; it is the
single source of truth for "what's left before launch".

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
File: `/tmp/.../scratchpad/vantage-feedback.html` — republish the SAME
path (or pass the URL as `url`) to keep that link.

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

**Correction worth remembering:** Vantage gathers NO purchase history
and has no bank/Open Banking integration — savings and expenses are
manual entry only. Don't repeat that claim.

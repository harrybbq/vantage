# Vantage — session context

Personal productivity/wellness app. React 18 + Vite SPA · Supabase (auth + Postgres, EU) · Netlify (hosting + functions) · Capacitor planned for app stores. Owner: harrym3002@outlook.com.

## Deploy flow (always)
Develop on the designated `claude/*` branch — direct pushes to `master` are blocked.
Build → verify → commit → push → create PR (`harrybbq/visionboardreal`, base `master`) via GitHub MCP → merge it. Netlify auto-deploys master. Bump `CACHE_VERSION` in `public/sw.js` when a deploy should force clients onto the new build.

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
automatically. Idea is a Vantage hub widget showing profit/loss at a
glance. **Owner-only for the foreseeable future.** Constraints agreed
before any build starts:
- **Broker credentials never touch the client.** `VITE_*` vars are
  bundled into public JS. Keys live in Netlify function env only, and
  the function verifies the JWT + checks the owner email SERVER-side
  (pattern: `netlify/functions/admin-set-rating.js`). `useIsOwner` is a
  UI gate, not an access control — the leaderboard forgery proved that.
- **Trading data does NOT go in `S`.** State is already ~967 kB and is
  re-downloaded on open / rewritten on save (items 25-26). Fetch live
  from the function on mount with a short cache, or give it its own
  RLS-gated table.
- ⚠️ **Store risk, decide before building:** an app showing live
  brokerage positions draws financial-services review from Apple/Google
  (often needs to BE the institution or be authorised by it), and
  reviewers see the whole binary regardless of owner-gating. May argue
  for keeping this web-only and absent from the native build. UK: showing
  your own numbers isn't FCA-regulated; arranging/advising, managing
  anyone else's money, or selling signals IS.

## Next project: Vantage Home
A new dashboard surface styled like a Home Assistant wall panel (owner has a reference screenshot — ask for it): dense dark tile grid, at-a-glance stats with mini graphs/gauges, header chips, right rail with day recap + forecast-style rows + media-player-style card. Reimagines the hub's widgets (vitals, macros, body, mood, savings, subscriptions, weather?, calendar?) as compact tiles. Keep it OPTIONAL alongside the existing hub, reuse existing widget bodies/stores where possible, respect the existing theme system (`SettingsSection` SCHEMES) and Pro gating conventions.

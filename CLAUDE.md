# Vantage — session context

Personal productivity/wellness app. React 18 + Vite SPA · Supabase (auth + Postgres, EU) · Netlify (hosting + functions) · Capacitor planned for app stores. Owner: harrym3002@outlook.com.

## Deploy flow (always)
Develop on the designated `claude/*` branch — direct pushes to `master` are blocked.
Build → verify → commit → push → create PR (`harrybbq/visionboardreal`, base `master`) via GitHub MCP → merge it. Netlify auto-deploys master. Bump `CACHE_VERSION` in `public/sw.js` when a deploy should force clients onto the new build.

## Hard rules
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

## Next project: Vantage Home
A new dashboard surface styled like a Home Assistant wall panel (owner has a reference screenshot — ask for it): dense dark tile grid, at-a-glance stats with mini graphs/gauges, header chips, right rail with day recap + forecast-style rows + media-player-style card. Reimagines the hub's widgets (vitals, macros, body, mood, savings, subscriptions, weather?, calendar?) as compact tiles. Keep it OPTIONAL alongside the existing hub, reuse existing widget bodies/stores where possible, respect the existing theme system (`SettingsSection` SCHEMES) and Pro gating conventions.

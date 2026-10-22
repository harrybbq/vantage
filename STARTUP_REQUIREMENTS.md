# STARTUP REQUIREMENTS

Everything standing between Vantage as it is today and Vantage on the
App Store and Google Play. Ordered — later steps depend on earlier ones.

Owner: Harry (harrym3002@outlook.com) — sole director and shareholder at
launch (decided 2026-10-20). Aidan (anotherone650@gmail.com) may join
later; see item 2.

Status key: `[ ]` to do · `[x]` done · `[~]` done in code, needs an
action outside the repo.

---

## Phase 1 — Company (start immediately; everything queues behind it)

1. `[ ]` **Register a UK limited company** at Companies House (~£50,
   usually same-day), Harry as sole director and sole shareholder.
   Still a company rather than a sole trader: Apple's organisation
   enrolment and the D-U-N-S number need a legal entity, and a personal
   Play account means the 12-testers-for-14-days rule (item 6).
2. `[ ]` **Aidan, in writing, before it matters.** No shareholders'
   agreement is needed while there is one shareholder. But if Aidan is
   to get a stake later, write the intent down now (a short dated note:
   what he'd get and on what terms, e.g. shares that vest over time), so
   it can't become a "you said…" later. When he joins, the company
   issues him shares or options, and THAT is when the shareholders'
   agreement is signed (who owns what %, leaving, who decides).
2b. `[ ]` **Assign the app's IP to the company** once it exists: a
   one-page assignment from Harry, and from Aidan for anything he has
   contributed, so the company cleanly owns the code, name and assets.
   Stores rarely ask; investors and acquirers always do.
3. `[ ]` **Open a business bank account.** Apple and Google pay out to
   an account matching the legal entity name exactly.
4. `[ ]` **Apply for a D-U-N-S number** from Dun & Bradstreet. Free, up
   to ~5 business days. **This is the critical path** — both Apple and
   Google organisation accounts require it. Apply the day the company
   exists.

## Phase 2 — Developer accounts

5. `[ ]` **Apple Developer Program**, organisation enrolment — $99/year.
   Needs the D-U-N-S number and the legal entity.
6. `[ ]` **Google Play Console**, **organisation** account — $25 one-off.
   Register as an organisation, *not* personal: personal accounts opened
   after Nov 2023 must run a closed test with **12 testers for 14
   continuous days** before they can ship to production. Organisation
   accounts are exempt. That rule alone justifies waiting for the D-U-N-S.
7. `[ ]` **Pay the ICO data protection fee** — £52/year (Tier 1, micro).
   Penalty for not paying is £4,350.

## Phase 3 — Legal and data protection

8. `[~]` **Get a DPIA done for the health data.** Weight, sleep, resting
   HR and recovery are *special category* data under UK GDPR — a higher
   bar than ordinary personal data, and a DPIA is likely mandatory
   (Art. 35). Worth an hour with a solicitor; this is the one area where
   guessing is expensive.
   *Status 2026-10-20: draft for the solicitor in `docs/DPIA_DRAFT.md` (ICO 7-step structure, data-flow
   inventory, risks, measures, 18 solicitor questions, gaps G1–G26 → items 98–108).*
9. `[x]` **Privacy policy and terms**, deep-linkable before sign-in —
   `/privacy` and `/terms` already do this.
10. `[~]` **Fill in App Store privacy labels** — declare health,
    financial and contact data collection. Must match what the app
    actually does.
    *Status 2026-10-20: drafted from code in `docs/STORE_PRIVACY_LABELS.md` (Apple + Play Data safety +
    health declarations); fix items 100–102 first, then the labels can be entered as drafted.*

## Phase 4 — Make it build natively

11. `[x]` **Bundle id fixed to `com.vantage.app`** (was
    `com.visionboard.app`, which predated the name). A bundle id is
    **permanent once shipped** — this was the last chance to change it.
    - `[ ]` ⚠️ If you register the Firebase Android app under the *old*
      id, push will break. Register `com.vantage.app` and download a
      fresh `google-services.json`.
12. `[ ]` **Decide the Mac question.** There is no `ios/` project and
    `npx cap add ios` needs macOS + Xcode. Either buy a Mac (a Mac mini
    is the cheap route) or use cloud macOS CI — Codemagic, Bitrise, or
    GitHub Actions macOS runners. **Nothing iOS moves until this is
    decided.**
13. `[ ]` **Create the iOS project** — `npx cap add ios`, then
    `npx cap sync`.
14. `[ ]` **Add native permission strings.** `NSCameraUsageDescription`
    for the food scanner, plus the Android manifest equivalent. A
    missing usage string is an automatic iOS rejection.
15. `[ ]` **Set up push credentials** — an APNs key for iOS, FCM for
    Android. The `push-dispatch` function and `FCM_*` env vars already
    exist.
    *Status 2026-10-05: no Firebase project exists on the owner's Google account (checked in the console; it now asks for 2-step verification). Create one, register `com.vantage.app`, then set `FCM_SERVICE_ACCOUNT_JSON` + `FCM_PROJECT_ID` in Netlify. Until then push-dispatch queues and never sends.*
16. `[ ]` **Test the service worker inside the Capacitor shell.** The SW
    is network-first on HTML and assumes a server; in a native shell the
    app loads from the local bundle. Verify the two don't fight.
17. `[ ]` **Test RevenueCat purchases on a real device**, both stores.
    The plugins are installed but no purchase has ever been made.

## Phase 5 — Security and correctness before launch

18. `[x]` **Paywall bypass closed.** `profiles.tier` was client-writable
    via the social self-update policy — any user could grant themselves
    lifetime with the public anon key. Locked with column-level grants.
19. `[~]` **Spending endpoints gated.** The AI endpoints were open to
    anyone and spent `ANTHROPIC_API_KEY`. 24 of 33 functions now require
    a JWT (audit 2026-09-30). **Still open:** every rate limit is
    in-memory per function instance, so concurrency multiplies it and
    there is no daily cap; no server-side tier/owner check on
    ai-coach-daily (Pro) or recipe-from-video (owner-only, top-tier
    model). See item 45.
20. `[x]` **Account deletion actually deletes the account** — required by
    App Store 5.1.1(v). Deletes the auth user; every user-scoped table
    cascades from it.
    - ⚠️ **Rule to keep:** every new user-scoped table must declare
      `references auth.users(id) on delete cascade`, or it will survive
      deletion and quietly become a GDPR problem.
21. `[x]` **Security headers added.** CSP is deliberately **Report-Only**
    — promote it to enforcing once the violation reports are quiet.
22. `[x]` **Triage the dependency vulnerabilities** — 1 critical, 12 high
    in production deps, mostly the Capacitor toolchain.
    *Status 2026-10-20: `npm audit --omit=dev` → 0. Capacitor core/android/cli 8.3.1 → 8.5.3 together (the
    critical: remote content could load at the app origin through the native HTTP proxy path, GHSA-rvm3-566m-v7fv);
    `ws` 8.20.0 → 8.22.0 under supabase-js (two highs). What remains is dev/build tooling that never ships
    (babel, vitest, brace-expansion, xmldom via the assets generator) — re-check monthly. Run `npx cap sync` after
    pulling, on the build machine.*
23. `[~]` **`prestige` and `ratings*` writes moved server-side.**
    The leaderboard ranks by `prestige * 100 + ratings_ovr` and both
    were granted to `authenticated`, so any signed-in user could PATCH
    PostgREST directly and hold first place forever. AdminEditModal now
    writes through `netlify/functions/admin-set-rating` (session
    verified, owner checked against `OWNER_EMAIL`, values re-clamped).
    - `[x]` **Run `supabase/leaderboard_column_lockdown.sql`** — confirmed
      applied in the live DB 2026-09-30 (tier/prestige/ratings not
      updatable by `authenticated`). ⚠️ Never re-run
      `profiles_column_lockdown.sql` — its grant list predates this and
      re-opens the hole.
    - ⚠️ Locking the COLUMNS was not enough: the server recomputes ratings
      from `user_data.state`, which the user writes. See item 44.
    - `[x]` **Set `OWNER_EMAIL`** on Netlify (comma-separated). The
      function fails closed without it.
      *Set by the owner, confirmed 2026-10-20.*
    - `level` is deliberately still client-writable: cosmetic on the
      friend card, published on a debounce by `usePublishProfile`, and
      not a leaderboard input. Moving it needs that write server-side
      first.
      *2026-10-21: moot — Level was retired. The client no longer writes
      or reads `profiles.level` / `public_stats.level`; the columns and the
      UPDATE grant stay (no destructive SQL). Revoking that grant later is
      optional tidying. Prestige (server-owned via `prestige-up`) is the
      long-term goal now, and its rewards are looks only
      (`src/lib/ratings/prestigeRewards.js`): accents, avatar frame and
      badge, console hub card styles. `supabase/prestige_rewards_2026_10.sql`
      (owner-run, either order) adds prestige to handle search and the
      invite preview.*
24. `[~]` **Health-sync token hardened.** It was minted with
    `Date.now() + Math.random()` whenever `crypto.randomUUID` was
    missing — not a CSPRNG, so the token guarding health writes was
    guessable. Now 192 bits from `getRandomValues` with no weak
    fallback, plus a **New URL** button that revokes the old one.
    - `[ ]` Still travels in the query string, so it can land in logs
      and history. `health-sync` already accepts `x-health-token`;
      moving the Shortcut onto the header is the remaining half.
    - ⚠️ Anyone who enabled sync **before this** has a weak token —
      tell them to tap **New URL**.
24b. `[ ]` **Set `CRON_SECRET`** on Netlify if you want to trigger
    `whoop-cron`, `oura-cron`, `snapshot-ratings` or `push-dispatch` by
    hand. Scheduled runs work without it; manual HTTP triggering is
    refused until it exists.

## Phase 5b — Pre-launch audit, 2026-09-30

Six parallel reviews (functions, database, client, economy, store/legal,
ops) plus read-only checks of the LIVE database. Every item marked
**BLOCKS** was confirmed in code or in the live catalogue, not taken on
an agent's word. Full report: see the audit artifact linked in the PR.
Tiers: **BLOCKS** = store rejection or live data exposure · **LAUNCH** =
fix before real users · **AFTER** = hardening.

### Run today — `supabase/security_hotfix_2026_09_30.sql` (items 32–38)
Grants, policies, view options, one FK and one index. No data touched.
*Both applied live and verified 2026-10-02 (grants, views, block helper, FKs, index; ai_usage, client_errors, report status/snapshot, suspended_at/prestiged_at, throttles, health-token index, new vb_state_meaningful).* Then run `supabase/audit_schema_2026_10.sql` — the new tables and columns
the wave-1 code uses (AI caps, client errors, moderation, suspension,
prestige cooldown, throttles, health-token index, anti-wipe mirror). The
code fails soft until it is run, so order doesn't matter.

32. `[x]` **BLOCKS** Two SECURITY DEFINER views are readable with the
    public anon key: `notifications_pending` (every user's queued
    pushes) and `coach_nudges_active` (every user's AI nudges).
33. `[x]` **BLOCKS** `profiles` is readable by `anon` — anyone with the
    anon key can list searchable users (photo, name, handle, tier, last
    active). Contradicts the privacy policy.
34. `[x]` **BLOCKS** Blocking doesn't block. Policies check `blocks`
    under the caller's RLS, and a blocked user can't see the row; the
    addressee can also rewrite `requester_id` and forge an accepted
    friendship with anyone. Apple 1.2 requires a working block.
35. `[x]` **LAUNCH** A DM recipient can rewrite `body`/`sender_id` of
    messages they received — forged evidence for reports.
36. `[x]` **AFTER** Definer RPCs executable by `anon`
    (`search_profiles_by_handle`, `seed_default_macros` for ANY user id).
37. `[x]` **LAUNCH** `tracker_streaks` FK is NO ACTION — account deletion
    fails for anyone with a row. Breaks the item-20 rule.
38. `[x]` **LAUNCH** `nutrition_log` has no `(user_id, log_date)` index.
39. `[x]` **LAUNCH** Enable **Leaked Password Protection** (Supabase →
    Auth). Dashboard toggle.
    *Status 2026-10-04: enabled by the owner.*

### Native build — nothing server-side works in the app shell yet
40. `[~]` **BLOCKS** Every call is a relative `/.netlify/functions/…`
    URL (~30 sites; `authFetch.js` passes it through). In Capacitor
    these hit the local bundle: delete-account, AI, leaderboard, groups,
    food search, weather all fail. Add one `API_BASE` helper.
    *Status 2026-09-30: done in code (apiUrl/authFetch); untested on a device.*
41. `[~]` **BLOCKS** RevenueCat loads through
    `import(/* @vite-ignore */ '@revenuecat/purchases-capacitor')` — a
    bare specifier a WebView can't resolve, so purchase is impossible and
    Upgrade falls through to the waitlist. Static imports; install
    `@capacitor/browser`; `cap sync`. (This is why item 17 never worked.)
    *Status 2026-09-30: done in code (bundled imports, native-only init); needs a real-device purchase test (item 17).*
42. `[~]` **BLOCKS** Google/Apple sign-in, email confirmation and the
    WHOOP/Oura callbacks all return to `window.location.origin`; there is
    no deep-link handler. Google refuses OAuth in an embedded WebView.
    Native sign-in (system browser + custom scheme/universal link +
    `appUrlOpen`), and apply the 13+/Terms gate to OAuth signups too.
    Also: the Apple button only renders when width ≤ 768px while Google
    always shows — breaks 4.8 on iPad / landscape.
    *Status 2026-09-30: done in code (system-browser OAuth + PKCE, com.vantage.app://auth-callback, Apple at every width, 13+/Terms on OAuth). Owner: add `com.vantage.app://auth-callback` to Supabase redirect URLs; untested on device.*
43. `[~]` **LAUNCH** Android project is stale for Capacitor 8
    (min/compile/target 23/35/35 vs 24/36/36); `allowBackup="true"`
    copies the session + cached health state to Google Drive. Skip the
    PWA install prompt / cookie banner / "no App Store needed" copy on
    native. Don't register the service worker natively.
    *Status 2026-09-30: done in code (SDK 24/36/36, AGP/Gradle bumped, allowBackup=false, web-only prompts/SW); run `npx cap sync android` on a machine with the SDK.*

### Rankings and money
44. `[~]` **LAUNCH** Anyone can reach global #1. `recompute.js` scores
    client-written state: any key in `logs` counts as a day, visions are
    not re-verified, undated achievements skip spacing. And
    `prestige-up` checks the stored OVR but takes the new baseline from
    the state as it is *then* — empty it in between and prestige climbs
    to 99. Fix: recompute inside prestige-up; accept only ISO-date keys
    within the account's age; cap day-counts at account age; a DB
    cooldown between prestiges. Real fix is item 26.
    *Status 2026-09-30: only real, in-age ISO day keys count; day counts and vision XP capped by account age (identical client/server, parity-tested); prestige recomputes from one read + 7-day cooldown (needs audit SQL). The durable fix is still item 26.*
45. `[~]` **LAUNCH** AI spend has no durable cap. Today: set a monthly
    limit in the Anthropic console. Then a Postgres daily counter per
    user, a server-side tier check on the coach, owner check on
    recipe-from-video, and cap the coach snapshot (~8 KB).
    *Status 2026-09-30: done in code (daily caps per feature, coach tier check, recipe owner-only, 8 KB snapshot cap). Needs audit SQL for durable caps + an Anthropic console spend limit.*
46. `[~]` **LAUNCH** RevenueCat webhook trusts event order and type:
    a late RENEWAL after EXPIRATION re-grants Pro, sandbox events aren't
    rejected, lifetime can be overwritten to `pro`. Treat the webhook as
    a trigger and read the subscriber from RevenueCat's API.
    *Status 2026-09-30: done in code (sandbox rejected, lifetime never overwritten, event ordering, subscriber API when REVENUECAT_SECRET_API_KEY is set).*
47. `[x]` **LAUNCH** Leagues: members who joined mid-week carry their
    whole week's climb into the new group; users can lower their state
    before the Monday snapshot. Count only `joined_at <= weekStart`.
    *Status 2026-09-30: done.*

### Server functions
48. `[x]` **LAUNCH** `cronAuth.js:42` accepts any body with `next_run`
    as "the scheduler". Delete that branch (item 24b's "refused until
    CRON_SECRET exists" is not true while it's there).
    *Status 2026-09-30: resolved — Netlify docs (verified 2026-10-02): scheduled functions can't be invoked by URL in production and `schedule` can't be combined with `path`, so the `next_run` branch is only reachable by the scheduler.*
49. `[~]` **LAUNCH** `health-sync`: no login, rate-limited per
    *caller-chosen* token, and the lookup is an unindexed JSONB filter
    that unpacks every user's ~1 MB state — a script can saturate the
    Micro DB. Move tokens to a hashed, indexed table; limit per IP too;
    header-only token (item 24).
    *Status 2026-09-30: done in code (per-IP limit, header preferred, generic errors, CAS write); needs audit SQL for the token index.*
50. `[x]` **LAUNCH** health-sync, whoop-cron and oura-cron rewrite the
    WHOLE state with no `updated_at` check — a save landing in between
    is lost. Same class as the 2026-05-03 wipe.
    *Status 2026-09-30: done (compare-and-set on updated_at, one retry, never forced).*
51. `[x]` **LAUNCH** SSRF in `productPage.js` (shop-autofill,
    shop-price-check): the host block misses 0.0.0.0, IPv6-mapped,
    ULA/CGNAT and DNS names that resolve privately, and follows
    redirects unchecked. Resolve + check IP, `redirect: 'manual'`.
    *Status 2026-09-30: done (resolved-IP checks, manual redirects re-checked, 80/443 only).*
52. `[x]` **LAUNCH** A group owner deleting their account deletes the
    group for everyone (FK cascade; delete-account skips the heir
    hand-over that leaveGroup does).
    *Status 2026-09-30: done (heir hand-over; Storage objects + RevenueCat subscriber removed on deletion).*
53. `[x]` **AFTER** Error bodies leak DB error text and env-var names;
    weather/destination-brief send `Cache-Control: public`; cron
    deadline (60 s) may exceed Netlify's scheduled limit — a kill
    mid-refresh loses a rotating WHOOP token.
    *Status 2026-09-30: done (generic errors, private caching, 20 s cron deadline, refresh token persisted first).*

### Client and data safety
54. `[~]` **BLOCKS** The anti-wipe guard (`hasMeaningfulData`,
    `looksLikeFactoryDefault`, SQL `vb_state_meaningful`) ignores
    vitalsLog, bodyLog, burnLog, subscriptions, holidays, backgrounds…
    A wearable-only user on a new device can have defaults saved over
    real data. Treat any non-empty collection as meaningful.
    *Status 2026-09-30: done in the client (ignore-list predicate, check:wipeguard); SQL mirror in audit SQL.*
55. `[x]` **LAUNCH** Stored XSS: the GitHub hub widget puts repo
    name/description/language/url into `outerHTML` unescaped
    (`HubSection.jsx:1816-1830`). `escapeHtml`/`safeUrl` already exist.
    *Status 2026-09-30: done (GitHub widget, link preview and leaderboard templates escaped).*
56. `[x]` **LAUNCH** Sign-out and account deletion leave the full state
    (health, meals, money) in localStorage and SW caches. Clear per-user
    keys + `caches.delete` on explicit sign-out/delete.
    *Status 2026-09-30: done (explicit sign-out/deletion only; never on session expiry).*
57. `[x]` **LAUNCH** Service worker caches every function GET
    cache-first until the next CACHE_VERSION bump (weather, news, market,
    food search, GitHub). Cache-first only `/assets/*`.
    *Status 2026-09-30: done (cache-first only /assets; CACHE_VERSION bumped; no SW in the native shell).*
58. `[x]` **LAUNCH** One error boundary for the whole app — any widget
    crash is a dead app for a reviewer. Boundary per widget/section.
    *Status 2026-09-30: done (WidgetBoundary on every widget and section, reporting to client-error).*
59. `[x]` **LAUNCH** Profile photo stored full-size and re-sent on every
    save/poll (~5 MB); "remove photo" never clears the server copy.
    Full state re-downloaded every 60 s while visible — poll
    `updated_at` first.
    *Status 2026-09-30: done (512 px photos, photo only sent when changed, explicit remove flag, poll checks updated_at first).*
60. `[~]` **AFTER** CSP has no report endpoint, so "promote when quiet"
    (item 21) can never be observed; inline scripts and Google Fonts
    would break under enforcement.
    *Status 2026-09-30: report-uri/report-to wired to csp-report, inline scripts and handlers removed from index.html and the hub, Google Fonts allowed; still Report-Only. Enforcing needs `unsafe-eval` for the owner-only Career runner (web only) and keeps `style-src unsafe-inline`.*

### Store, legal and moderation
61. `[x]` **BLOCKS** Settings says "Your login email is retained" and
    the button reads "Delete All Data" — reads as the account surviving
    (5.1.1(v)). Say "Delete account", and warn that store subscriptions
    must be cancelled in the store.
    *Status 2026-09-30: done.*
62. `[~]` **BLOCKS** Owner-only surfaces (Upgrade, Apple Health
    Shortcut panel, admin editors) ship in the binary behind a client
    email check — hidden features (2.3.1), and `VITE_OWNER_EMAIL` is
    readable in the bundle. Compile them out of native builds the way
    `trading/enabled.js` does; check owner server-side.
    *Status 2026-09-30: done in code (owner surfaces compiled out of native; owner check via is_app_owner RPC).*
63. `[~]` **BLOCKS** UGC (Apple 1.2): no filter on display names,
    handles, group names or trending items; avatars unscreened yet shown
    on the global board; no report from leaderboard/group rows; nothing
    reads `reports`, no suspend/ban, and deleting an account cascades
    away the reports against it. Global trending lets two accounts put
    any text + URL on every user's Shop page.
    *Status 2026-09-30: report/block from leaderboard + group rows, owner moderation queue, suspension hidden everywhere, name filter on names/handles/groups/trending (client + server), profile pictures screened before others see them, message/friend-request throttles. Needs audit SQL. Binding enforcement of names/avatars needs profile writes moved server-side (revoke update on handle/display_name/avatar_url).*
64. `[~]` **BLOCKS** Privacy policy vs reality: no controller identity
    or contact; missing processors (ipwho.is gets every user's IP,
    GitHub, Google favicons, FatSecret, USDA, YouTube/TikTok, GNews,
    Finnhub, Open-Meteo); "not retained by Anthropic" needs a ZDR
    contract or must go; says leaderboard/search are opt-in but both
    default ON; no mention of 14 history snapshots.
    *Status 2026-09-30: factual corrections done; controller identity and security contact are placeholders until the company exists.*
65. `[x]` **BLOCKS** Paywall lacks Terms/Privacy links and renewal
    wording from the store product; price is hard-coded.
    *Status 2026-09-30: done (store-product wording, Terms/Privacy, Restore).*
66. `[x]` **LAUNCH** No explicit consent for special-category health
    data (UK GDPR Art. 9) — "you logged it" is not explicit consent —
    and the AI coach sends data to Anthropic on page load for Pro users.
    Consent screen before health features and before AI.
    *Status 2026-09-30: done (one-time consent sheet + just-in-time asks; coach brief waits for AI consent; withdraw in Settings).*
67. `[~]` **LAUNCH** Deletion leaves Storage objects (`cv/`,
    `recipes/`), the RevenueCat subscriber, and un-revoked WHOOP/Oura
    grants. Export omits `nutrition_log`, messages and profile, and
    `a.download` does nothing in a WebView.
    *Status 2026-09-30: done except WHOOP/Oura grant revocation (no documented endpoint found); export now includes food log, profile, friendships, messages.*
    *Status 2026-10-20: WHOOP grant revocation done (item 125 — WHOOP does document an endpoint); Oura's still unverified.*
    *Still open (pack P7, 2026-10-20): export `download()` uses `a.download`, a no-op in a WebView — use
    the share sheet (`navigator.share` with a File, or @capacitor/share + filesystem).*
    *Status 2026-10-20 (P7): in the app the export is built, then a "Save or share the file" button hands it
    to `navigator.share` with a File (`src/lib/data/saveExport.js`, 7 tests); the web still downloads. iOS
    WKWebView supports this (iOS 15+); Android's System WebView has no `navigator.share`, so Android shows
    "export from the website" until `@capacitor/share` + `@capacitor/filesystem` are added (npm install +
    `npx cap sync`, a native step) — verify both on a device.*
68. `[~]` **LAUNCH** Defaults for 13–17s: handle search and leaderboard
    are ON; `shareStreak` publishes habit names (e.g. a quit-drinking
    streak) to friends by default.
    *Status 2026-09-30: done in the client (streak opt-in, toggles show real state); new-account DB defaults in audit SQL.*
69. `[ ]` **LAUNCH** The trading app's schemas (`ledger`, `paper`,
    `research`) live in Vantage's Supabase project — one service-role
    key, one Micro instance, one restore unit. Move them to their own
    project before launch.
    *Status 2026-10-22: runbook in `docs/TRADING_SCHEMA_MOVE.md`. Checked live: the three schemas are
    self-contained (no FK, view or function crosses into `public`/`auth`; no `anon`/`authenticated`
    grants; ~158 rows), and Vantage only reaches the trading app over HTTP (`trading-summary` →
    `TRADING_REPORT_URL`). Owner: create the new project, then follow the runbook.*
70. `[~]` **AFTER** Repo hygiene: personal emails in
    `lifetime_grants.sql`/`recomp_schema.sql`; an apparent real salary
    comment in `career/companies.js`; a Last.fm key in dead
    `SpotifyBar.jsx`; `dist/` committed (78 MB .git); no CI outside the
    Netlify build. Move `@capacitor/cli` + `@capacitor/assets` to
    devDependencies (clears item 22's critical/high — none ship).
    *Status 2026-09-30: personal emails replaced with placeholders in SQL; dead SpotifyBar removed (revoke that Last.fm key — it stays in git history); salary comment neutralised; Capacitor CLI/assets moved to devDependencies; PR build workflow added. `TRADING_APP_CLAUDE.md:9` still holds a real email; `dist/` is still committed per the deploy flow.*

83. `[x]` **LAUNCH** Any signed-in user can still read every column of a
    searchable profile — `tier` (who pays), `ratings`,
    `prestige_baseline`, `last_active_at` — whatever `leaderboard_optin`
    says. Fix with column-level SELECT grants (the `groups` pattern in
    `group_crest_schema.sql`), after moving own-row reads of `tier` and
    `last_active_at` to a definer RPC. Needs a client audit of every
    `from('profiles').select(...)` first.
    *Status 2026-10-20: done in code. Public set = id, handle, display_name, avatar_url, level, ratings_ovr, suspended_at (`src/lib/friends/profileColumns.js`; a build test keeps it equal to the SQL grant and fails if any client select names another column). Own private fields (tier, is_searchable, leaderboard_*) via `my_profile()`, friends' last_active_at via `friend_presence()` (accepted friends only) — both fall back to today's selects until the SQL runs. Category `ratings` stay visible only where the leaderboard/group functions show them (service role; item 103 still open). Owner: deploy, THEN run `supabase/privacy_lockdown_2026_10b.sql` (header has verify queries). SQL applied 2026-10-20; verified: the seven public columns are the only SELECT grant, and UPDATE is is_searchable, last_active_at, leaderboard_color, leaderboard_optin, level.*
84. `[x]` **LAUNCH** Name filter and avatar screening bind honest clients
    only: a user can still PATCH `handle`/`display_name`/`avatar_url` on
    their own row directly. Binding needs those writes moved to a
    service-role function, then
    `revoke update (handle, display_name, avatar_url) on public.profiles from authenticated;`.
    *Status 2026-10-20: done in code — `netlify/functions/profile-update` (requireUser, `social` kill switch, 10/min brake + 40 changing writes/day durable via ai_usage, server name filter, avatar screening that fails closed) is the client's only writer of the three; the SQL revokes their UPDATE and INSERT grants. Order: deploy first (the new client works under either grant set), then run `supabase/privacy_lockdown_2026_10b.sql`. SQL applied 2026-10-20; verified: handle/display_name/avatar_url have no UPDATE grant.*

85. `[~]` **LAUNCH** Supabase is retiring the legacy `anon`/`service_role`
    keys by the end of 2026. The new `sb_secret_…` keys go in the `apikey`
    header, are not JWTs, and are refused when the request carries a
    browser User-Agent. Every Netlify function sends the service key as
    both `apikey` and `Authorization: Bearer` — that breaks on the switch.
    Move server calls to supabase-js (handles both) or send `apikey` only,
    and test against a secret key before swapping it in.
    *Status 2026-10-20: done in code — every function reads keys through `netlify/lib/sbKeys.js` (secret key preferred, legacy fallback), service calls send a NEW key on `apikey` only (Supabase's rule) while a LEGACY key keeps apikey + Bearer exactly as before (the apikey-only form couldn't be tested live from the build sandbox — supabase.co is blocked there — so today's behaviour is unchanged until the switch), user session checks send the public key + the user's JWT; `check:sbkeys` fails the build on a regression; the client prefers `VITE_SUPABASE_PUBLISHABLE_KEY`. Owner switch: (1) Supabase → Project Settings → API Keys → create a secret key and a publishable key; (2) Netlify → env vars: set `SUPABASE_SECRET_KEY` (Functions scope), `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_PUBLISHABLE_KEY`; (3) redeploy; (4) open `/.netlify/functions/health` (should say `"db":"ok"`) and the Security console (both use the service key) — and sign in, sync WHOOP once, and delete a throwaway test account (account deletion uses the Auth admin API — the one path to prove on the new key); (5) roll back = delete those three vars and redeploy; (6) only later, once old app builds have updated, deactivate the legacy keys in Supabase.*
86. `[ ]` **LAUNCH** Netlify Web security center (observed 2026-10-02):
    no WAF, no rate-limiting rules, no firewall traffic rules. Add a
    rate-limit rule on `/.netlify/functions/*` (per-IP) before launch —
    the in-function limits are per instance.
87. `[x]` **AFTER** `push-dispatch` runs every minute — ~44k invocations a
    month on credit-based pricing, mostly finding nothing. Consider
    every 5 minutes, or trigger it from the queue insert instead.
    *Status 2026-10-20: every 5 minutes (`*/5 * * * *` in netlify.toml) — ~44.6k → ~8.9k invocations and empty-queue reads a month. Nothing needs 1-minute latency: the only queue producers are the friend-request/accept triggers; DMs don't push; push isn't live until FCM (item 15). Trigger-on-insert rejected: scheduled functions aren't URL-invocable and pg_net would need a secret in the DB. Revisit if DM pushes are added.*
88. `[x]` **AFTER** Supabase compute is **Small**, not Micro — about $5/month
    over the Pro plan's $10 compute credit. Micro covers today's load; Small
    gives the whole-state saves headroom. Owner's call; switching restarts
    the database for a few minutes (do it while traffic is near zero).
    *Decided 2026-10-20: stays on Small (owner confirmed). Revisit after items
    25/26 shrink the state — that is what would make Micro comfortable.*
89. `[ ]` **AFTER** The Netlify Pro team also hosts `gammonbeastshundred` and
    `vantagetrader` — about a third of builds are Vantage's. Production
    deploys cost 15 credits each (~970 used 27 Sep–5 Oct), so batch
    releases; Personal's 1,000 credits would not cover the current pace.
90. `[x]` **AFTER** `global-trending` read every user's state on each refresh
    — the first thing to saturate the DB. *Done 2026-10-05 (#225): Trending removed.*
91. `[x]` **AFTER** `get-leaderboard` has no shared cache and pulls ~500
    profiles with avatars per view. Cache 5–10 min; avatars for the top 100 only.
    *Status 2026-10-20: done in code — the global top 100 (per timeframe) is built at most once per 5 min and shared: module scope per instance + one `function_cache` row across instances (lib/sharedCache.js; falls back to module scope until the SQL runs). A cached view is auth + the caller's own profile (+ rank count / colour for a caller outside the top 100) instead of ~10 queries incl. 500 profiles with avatars. Per-caller parts (isSelf, current numbers, opt-out, true rank, pinned row) stay live; friends boards are never cached. Weekly pool reads 500 candidates without avatars and fetches avatars for the 100 shown; friends boards past 100 rows get initials. Others see an opt-out/suspension within ≤ 5 min. Owner: run `supabase/retention_2026_10b.sql` (creates `function_cache`). SQL applied 2026-10-20; `function_cache` exists.*
92. `[~]` **AFTER** Presence writes a `profiles` UPDATE every 60 s per open
    app (`usePublishProfile.js`). Every 5 min is enough.
    *Status 2026-10-20: done in code — heartbeat every 5 min while visible, plus on sign-in and on return (if the last ping is ≥ 2 min old); the debounced publish writes level/presence only when they change. Online threshold 3 → 11 min (`ONLINE_THRESHOLD_MS`), Settings copy updated. Ships with the deploy; no SQL.*
93. `[~]` **LAUNCH** `whoop-cron` syncs users one by one inside a 20 s
    budget — only ~10–20 users a night. Batch in parallel or run every 2 h.
    *Status 2026-10-20: done in code — whoop-cron and oura-cron run accounts through a bounded pool (4 at a time, oldest first, stop starting at 20 s, in-flight finish; refresh-token-first and CAS writes unchanged). WHOOP's limit is 100 requests/min and 10,000/day per app, so a run spends ≤ 60 WHOOP calls (~12 accounts) and whoop-cron now runs every 10 min 06:00–08:50 UTC (not :30, when oura-cron runs), skipping accounts already synced that morning — ~180 accounts a morning for <10% of the daily limit. Owner: after the deploy, check one morning's Netlify function log for "not reached" counts; WHOOP also caps an unapproved app at 10 users — apply for production approval / a higher limit in the WHOOP developer dashboard before launch.*
94. `[ ]` **LAUNCH** Custom SMTP for Supabase Auth. The built-in mailer
    allows a few emails an hour; signups and resets fail at ~50 users.
95. `[~]` **AFTER** `weather` has no auth and calls ipwho.is per request;
    `client-error` and `vitals-beacon` are open writes. Require auth / cache
    by IP / rate-limit (pairs with item 86).
    *Status 2026-10-20: done in code — weather reads Netlify's own `x-nf-geo` header (lat/lon, or the city name → Open-Meteo geocoder); **ipwho.is is no longer called at all**, so no third party receives the IP (closes STORE_PRIVACY_LABELS Q3 — the privacy policy / labels can drop ipwho.is once this is live). No geo header → chip hidden (logged once per instance). Per IP: 12 calls/h anonymous, up to 60/h with a valid session (verified only past the allowance, verdict cached), 10/min burst; weather cached 30 min per ~11 km cell; `useWeather` sends the session. client-error / vitals-beacon: per-IP minute+hour limits, identical-report dedupe, empty/non-object/no-UA input dropped, and a durable cross-instance cap (1,000 errors / 3,000 vitals an hour, trigger in `retention_2026_10b.sql`). Owner: after deploy, confirm the weather chip still shows (if not, the function log says "no usable x-nf-geo" — tell the next session); still add the Netlify rate-limit rule (item 86). SQL applied 2026-10-20 (`ingest_caps` exists); weather chip check and item 86 still open.*
96. `[x]` **AFTER** Retention: nothing prunes `client_errors`,
    `rating_snapshots` or `web_vitals` — schedule a monthly delete of old rows.
    *Status 2026-10-20: done in code (also DPIA G11, G13) — `retention-prune` scheduled function, weekly Sun 04:47 UTC, calls `public.retention_prune` in batches of ≤ 500 (250 ms apart, ≤ 20 batches per table, 20 s budget): client_errors 30 d, web_vitals 90 d, rating_snapshots 90 d (readers need ≤ 21), sent/dead notifications 30 d, coach_nudges 60 d, CLOSED reports 12 months after closing (with their evidence snapshot; never open ones, never `retention_hold = true`), expired caches. User content (user_data, nutrition_log, messages, friendships, profiles, …) is refused by the JS and by the SQL, and asserted in `check:efficiency`. Stops for `VANTAGE_PAUSE=all|retention` (incident evidence). No pg_cron in the project, so Netlify cron. Owner: run `supabase/retention_2026_10b.sql`, then the dry-run query in its header; set `retention_hold` on any report referred to police/IWF. Privacy policy should state the windows (batch A). SQL applied 2026-10-20; verified `retention_prune` exists and is not callable by app users.*
97. `[x]` **LAUNCH** AI food scans had no server-side tier check.
    *Done 2026-10-05 (#225): 3 free a week, unlimited on Pro, enforced in ai-food-detect.*

### Non-code tasks missing until now
71. `[~]` **Online Safety Act 2023** — DMs, groups and the leaderboard
    make Vantage a user-to-user service: Ofcom illegal-content risk
    assessment + children's access assessment, and Terms describing
    moderation.
    *Status 2026-10-20: drafts in `docs/ONLINE_SAFETY_ACT_DRAFT.md` (scope, illegal-content risk
    assessment, children's access + risk assessment, Codes measures checklist, proposed Terms text,
    record-keeping, 14 solicitor questions). Ofcom's site was blocked from the drafting environment —
    measure numbers are from memory; check against the current Codes. Likely conclusion: in scope
    NOW (social features are live on the web), small, "multi-risk" (grooming + harassment rated
    medium), children's duties apply. New gaps → items 109–114.*
72. `[~]` **Support URL + support email** (both stores require one; the
    policy already promises it) and a written **subject-access** process.
    *Status 2026-10-04: in-app channel live — Settings → Report a problem files a ticket into Upgrade → Security (security_console_2026_10.sql run). A public support URL + email are still needed.*
    *Status 2026-10-20: public `/support` and `/delete-account` pages built (pre-auth, like /privacy; linked from the sign-in footer, the policy and the terms). `/delete-account` is the Play Console account-deletion URL (item 74). Owner: fill `SUPPORT_EMAIL` (and `SECURITY_EMAIL`, with SECURITY.md + security.txt) in `src/lib/support.js` once the domain and inbox exist — until then both pages show a marked placeholder. Subject-access process still to write.*
73. `[~]` **Reviewer kit** — demo account with Pro, sandbox testers,
    review notes (WHOOP/Oura need hardware).
74. `[~]` **Store forms** — Apple age-rating questionnaire, Play IARC,
    Data safety, Health apps declaration, Financial features (none),
    account-deletion web URL, export-compliance/encryption declaration.
    *Status 2026-10-20: drafted — `docs/STORE_SUBMISSION_PACK.md` (reviewer kit, Apple age rating → 13+,
    Play IARC/audience, declarations, listing copy, shot list, rejection risks) and
    `docs/STORE_PRIVACY_LABELS.md` (labels + Data safety). Decisions: item 121. Gaps: items 115–122.*
75. `[ ]` **DPAs** with Anthropic, RevenueCat, Netlify, Supabase; WHOOP
    production approval for other people's data; trademark check on
    "Vantage".

### From the DPIA and privacy-label drafts — 2026-10-20
`docs/DPIA_DRAFT.md` (gaps G1–G26) and `docs/STORE_PRIVACY_LABELS.md`. New findings only; everything
else maps onto existing items.
98. `[~]` **LAUNCH** Consent is enforced in the app only. `whoop-cron`, `oura-cron`, `whoop-sync`,
    `oura-sync` and `health-sync` keep syncing after a user withdraws health consent (until they also
    press Disconnect), and the AI functions don't check AI consent server-side. Skip/refuse on the server
    (one JSON-path read), or have withdrawal call `wearable-disconnect`. (DPIA G1)
    *Status 2026-10-20: done in code — `netlify/lib/consentGate.js` (pure rule + tests). Health: sync stops when consent is declined/withdrawn; never-asked accounts keep syncing, matching the app. AI: only an explicit yes. Crons filter with one batched `state->consent` read; whoop-sync/oura-sync/health-sync and ai-coach-daily/ai-food-detect (scan)/recipe-from-video refuse with a clear 403. destination-brief left out: no AI call, no user data. Live once deployed; consent_events (item 99) refines it after the SQL.*
99. `[x]` **LAUNCH** No durable consent record — consent lives only in the user-editable state. Add an
    append-only `consent_events` table (kind, granted/withdrawn, time, copy version, cascade). (G2)
    *Status 2026-10-20: done in code — table in `supabase/privacy_lockdown_2026_10b.sql` (RLS insert/select own, no update/delete for anyone, server-stamped time, 60/h throttle, cascade); `src/lib/consent/ledger.js` records each consent change after hydration and a just-in-time "Allow" waits for the record + a state save. Fails soft until the owner runs the SQL. Bump `CONSENT_COPY_VERSION` when the consent wording changes. SQL applied 2026-10-20; verified `consent_events` has no UPDATE/DELETE for anyone.*
100. `[~]` **BLOCKS** Privacy policy vs code (labels draft "Mismatches", DPIA G10/G13):
    - says accounts are erased "within 30 days" — deletion is immediate, backups keep 7 days;
    - says "we do not collect purchase history" — RevenueCat keeps it, linked to the user id;
    - crash reports (`client_errors`: stack, page, UA, user id) not mentioned, never purged;
    - Apple Health and recipe-from-video described as user features — both owner-only, compiled out
      of native (and the native build's tutorial/Track help/auto-fill/consent strings still say Apple
      Health);
    - the coach is said to send vitals and macros — it sends first name, habit names + relapse counts,
      trackers, holiday destinations and wish-list counts;
    - Anthropic's API retention not mentioned; money data, body measurements/age/sex/height, relapses,
      old mood entries and community foods (`food_contributions`) not named;
    - invite links show the inviter's name, handle, picture, level and rating before sign-in;
    - "health data is never shown to others" needs a qualifier (the Fitness rating counts logging days);
    - report retention "as long as needed" vs 12 months in ABUSE_HANDLING with nothing deleting them —
      add automatic 12-month deletion of closed reports; fix the stale reporter-cascade line there.
    *Status 2026-10-20: policy, terms and consent-sheet copy rewritten from the code (`LegalPage.jsx`,
    `consentCopy.js`; evidence list at the top of PrivacyPolicyContent); section numbers unchanged; Last
    updated 20 Oct 2026. Still needed outside this change: the 12-month closed-report deletion (batch B's
    SQL — the policy already states it), a scheduled 30-day `client_errors` purge (item 96 — the policy
    states 30 days), confirm `REVENUECAT_SECRET_API_KEY` is set in Netlify (the policy says the RevenueCat
    record goes with the account), the controller identity and inboxes (`src/lib/support.js`).*
101. `[x]` **BLOCKS** The "Join Waitlist" form (AI Coach — already shipped) stores emails for marketing
    and is reachable in the native build, including the paywall's fallback button. Remove it
    (recommended) or declare marketing use.
    *Done 2026-10-20 (owner's decision: remove). The form is gone; the coach teaser opens the paywall
    ("See Pro"); the paywall with no store product shows OK + where Pro is bought. The `waitlist`
    table and its rows are untouched — owner to decide whether to delete them (SQL, owner-run).
    Also decided: friend list declared as Apple "Contacts"; wearable data stays out of the AI coach
    at launch (`AI_WEARABLE_DATA_ALLOWED` unset).*
102. `[~]` **BLOCKS** Android: the manifest has no `CAMERA` permission (barcode + AI food scan can't
    work natively); Firebase Messaging mints a token at startup before notification consent; check the
    merged manifest for the advertising-ID permission.
    *Status 2026-10-20: done in code — manifest declares CAMERA (camera features `required=false`) and
    POST_NOTIFICATIONS, `firebase_messaging_auto_init_enabled=false`, and AD_ID `tools:node="remove"`;
    `useCapacitor` registers (mints the token) only after the user's own opt-in on that device, not
    merely because Android ≤12 grants notifications at install. On the build machine: `npx cap sync
    android`, build, then check `app/build/intermediates/merged_manifests/*/AndroidManifest.xml` has
    CAMERA and no AD_ID; on a device: barcode scan asks for the camera, and no FCM token is created
    (no `push_tokens` row) until Enable is tapped.*
103. `[ ]` **LAUNCH** Decide whether category ratings (fitness, finance) are visible to others — the
    fitness rating draws on health data (`netlify/lib/recompute.js`). (G10)
104. `[~]` **LAUNCH** Lock-screen-safe push text before push goes live (esp. coach nudges). (G8)
    *Status 2026-10-20: done in code — every push goes through `netlify/lib/lockScreenSafe.js` in
    `push-dispatch.js`: fixed generic title/body per kind (friend request/accepted, coach nudge,
    streak warning, daily reminder, honour, and the not-yet-written DM, group message and safety
    notice kinds; anything unknown gets "Vantage / You have a new notification."), nothing from the
    queued payload shown, `data` = kind + id-shaped references only, Android visibility PRIVATE; client
    toasts show the title, never a body. No preview setting exists, so safe by default. Tested in the
    build (`check:lockscreen`). Outside the repo: optionally run
    `supabase/notifications_lockscreen_2026_10.sql` (triggers stop queueing names/handles); check on a
    real locked phone when push goes live (item 15).*
    *2026-10-22: `notifications_lockscreen_2026_10.sql` applied by the owner and verified live (neither
    trigger function writes `display_name` any more).*
105. `[~]` **LAUNCH** Test the AI coach with eating-disorder, self-harm and relapse style inputs and
    record the results. (G15)
    *Status 2026-10-20: done in code — safe mode (`netlify/lib/coachSafety.js`, client twin
    `src/lib/coach/safety.js`): self-harm signals → fixed brief with Samaritans 116 123 / 999 and no
    model call; eating-disorder, relapse, over-training and under-18 signals → gentle mode (reduced
    snapshot, no food/weight/body/exercise data or day counts, fixed helpline line); every model brief
    checked against an output policy and replaced if it breaks it; local brief, tips and nudges follow.
    System prompt gained a Safety block. 36 invented red-team cases run through the production path in
    the build (`check:coachsafety`). Results: `docs/COACH_REDTEAM_RESULTS.md`. Outside the repo: run the
    live-model pass (`ANTHROPIC_API_KEY=… npm run coach:redteam:live -- --repeat 3`) and commit the
    updated results; verify the helpline numbers on each service's site.*
106. `[~]` **LAUNCH** Confirm the Netlify functions' region (none set in netlify.toml — likely US) for
    the transfer analysis; written policy for owner/admin access to user data and a log of moderation
    reads; Art. 30 records / LIAs if the solicitor says so. (G5, G18, G25)
    *Status 2026-10-20: drafted — region finding + steps in `docs/ROPA.md` §2: all 44 functions are v1
    with no per-function config, so the site-level region applies; default for sites made after 4 Oct
    2023 is `cmh` US East (Ohio); `lhr`/`fra`/`dub` are self-serve on Pro (Netlify's
    context-and-tools repo + docs extracts, checked 2026-10-20). Even in the EU, Netlify Inc. (US) stays
    a restricted transfer under its DPA (EU SCCs + UK Addendum); DPF status unconfirmed.
    `docs/ADMIN_ACCESS_POLICY.md` (who, five purposes, what's logged today vs not, `ops_mark('access',…)`
    habit, record template, specs A1–A4 to log evidence reads and bans). `docs/ROPA.md` (Art. 30 —
    REQUIRED: the under-250 exemption doesn't cover special category data, ICO; activities A1–A14,
    recipients, transfers, retention as built, LIAs L1–L7 for the solicitor). Owner: read the Supabase
    region, set the Netlify Functions region to match, redeploy, record it; check Netlify on the DPF
    list; adopt the access policy; solicitor: Q-A1–A4, LIAs, R-1–R-4.*
107. `[x]` **AFTER** Legacy `moodLog` still sits in users' state though Mood was removed — tell users
    and offer deletion, or remove it additive-first per CLAUDE.md. (G12)
    *Done 2026-10-20 (owner's decision: delete, never returning): `lib/state/retiredKeys.js` removes
    `moodLog` once after hydration (only that key; identity otherwise; the merge keeps the deletion).
    Copies age out of user_data_history (14 days) and backups. Privacy policy to say so (item 100).*
108. `[ ]` **AFTER** Let a habit be private (kept out of AI and friend surfaces) (G14); self-host the
    fonts so devices don't contact Google Fonts (G16); consider ipwho.is → Netlify's own geo for
    weather so no third party sees the IP.

### From the Online Safety Act draft — 2026-10-20 (`docs/ONLINE_SAFETY_ACT_DRAFT.md`)
109. `[~]` **LAUNCH** Governance the Codes expect: a named accountable person with written
    responsibilities; written content policies, queue prioritisation and moderator guidance; a written
    appeals process; a complaints route that works without an account (pairs with item 72).
    *Status 2026-10-20: drafted — `docs/OSA_GOVERNANCE.md`: what the Codes expect scaled to a one-person
    company (ICU A2 named person = all services; A3 written responsibilities = multi-risk, which Vantage
    is on the draft's ratings), fill-in appointment, responsibilities + cover arrangement, 5-line code of
    conduct, training record, monthly evidence log (with query), complaints/appeals procedure, yearly
    review checklist. Cross-refers to the OSA draft rather than repeating it. Owner: fill in and sign
    §2–§4, do the §5 training, set the monthly/yearly reminders, fill the complaint timings here and in
    the Terms; support address still item 72.*
110. `[x]` **LAUNCH** Reporting loop: acknowledge reports to the reporter and tell them the outcome;
    tell the reported user about action taken; more report reasons (child safety, threats, self-harm,
    sexual content, scams); report + block from an incoming friend request.
    *Status 2026-10-20: done in code — in-app `safety_notices` (report received by DB trigger; outcome on
    dismiss/resolve/suspend; suspension, reset and lift told to the reported user, never who reported and
    never for a child-safety report); reasons child safety, threats or violence, hate, sexual content,
    self-harm, scam or fraud added (old stored labels unchanged), urgent ones first in the queue with crisis
    signposting on the sheet; Report/Block on incoming requests. Owner: run `supabase/safety_2026_10b.sql`. SQL applied 2026-10-20 (`moderation_actions` exists).*
111. `[x]` **LAUNCH** Suspension doesn't stop DMs — a suspended user can still message friends. Block
    sends (and probably receipt) for suspended accounts in RLS.
    *Status 2026-10-20: done in code — RLS refuses a suspended account's messages, reactions, friend
    requests/accepts and unsends; its earlier messages/reactions are hidden from the other person while
    suspended (never deleted; the report snapshot and the queue keep them); the app shows a calm suspended
    banner and read-only conversations. Policy-tested on Postgres 16. Owner: run `supabase/safety_2026_10b.sql`. SQL applied 2026-10-20 (`messages_safety_guard` trigger live).*
112. `[~]` **LAUNCH** Owner tools the Terms already promise: reset a user's display name / handle /
    avatar from the moderation queue; re-screen avatars published before screening existed.
    *Status 2026-10-20: done in code — queue "Reset…" (service role, audited in `moderation_actions`, the
    same value refused if the app re-publishes it, user told) and "Resolve"; "Re-screen profile pictures"
    in Security → Moderation (4 per press, owner daily AI cap 200, flags only — keep or remove). Owner: run
    `supabase/safety_2026_10b.sql`, then press re-screen until the backlog is 0 (needs ANTHROPIC_API_KEY). SQL applied 2026-10-20; the avatar re-screen backlog is still to clear.*
113. `[~]` **LAUNCH** NCA child-sexual-abuse reporting duty (in force for user-to-user services since
    7 Apr 2026): register and write the procedure (how evidence is preserved, who files, within what
    time). Add a mute option (Codes user control); supportive information for child users.
    *Status 2026-10-20 (part): procedure skeleton in `docs/ABUSE_HANDLING.md` (in force since 7 Apr 2026;
    register, who files, preserve-don't-spread, file within the SI 2026/268 time, record) — the owner fills
    the blanks and the solicitor confirms. Registration, mute and child supportive information still open.*
    *Status 2026-10-20 (procedure): `docs/ABUSE_HANDLING.md` NCA section completed from sources checked
    today — verified: s.66 + s.69 commenced 7 Apr 2026 by SI 2026/262 (Commencement No. 7); SI 2026/268
    made 9 Mar 2026, in force 7 Apr (the earlier SI 2025/368 was revoked before commencing). Grooming
    text counts, not only images; the IWF doesn't discharge the duty. Registration via the NCA CSEA-IRP
    (organisation → Referral Bureau review Mon–Fri → administrator adds filers); 999 first if
    unregistered and a child is at imminent risk; `retention_hold` on the report at once; URN 5 years,
    content ≥ 1 year (secondary source — verify). The 2026 urgency time frames weren't readable (sites
    blocked) — working rule in the doc, solicitor to confirm. Still open: **register on the CSEA-IRP**
    (and who registers before the company exists), fill the blanks, rehearse once; specs for approval in
    ABUSE_HANDLING "Open product gaps": G-1 mute, G-2 "Staying safe" supportive info (shown to everyone
    until item 114 gives an age signal), G-3 a reported user can delete their account and cascade the
    evidence away (recommend: refuse deletion while a report is on hold).*
114. `[ ]` **LAUNCH** Teen defaults only apply to NEW accounts: older accounts kept handle search and
    leaderboard on; online status and the heatmap default on. There is no age signal at all — decide
    (with the solicitor) on collecting a birth year and age-specific defaults. Fix the stale lines in
    `docs/ABUSE_HANDLING.md` (reports now survive reporter deletion; the 10-message evidence copy; the
    NCA duty is in force). Confirm `audit_schema_2026_10.sql` and `dm_upgrade_2026_10.sql` are run in
    production (the DM one is confirmed 2026-10-18).
    *Status 2026-10-20 (part): `docs/ABUSE_HANDLING.md` stale lines fixed (reports survive reporter
    deletion; the 10-message snapshot at report time; NCA duty in force). The age signal and old-account
    defaults are still open.*
    *Status 2026-10-22: confirmed live — `audit_schema_2026_10.sql` and `dm_upgrade_2026_10.sql` are both
    applied (every table, column, function, trigger, index and policy they create is present).*

### From the store submission pack — 2026-10-20 (`docs/STORE_SUBMISSION_PACK.md` §8, P1–P12)
115. `[~]` **BLOCKS** WHOOP/Oura connect fails inside the native app: the panel navigates the WebView to
    the provider, the callback returns to the website root, and the OAuth `state` is bound to an
    HttpOnly cookie the system browser doesn't have. Open the authorize URL with `Browser.open`, bind
    state without a cookie for native starts, redirect native callbacks to `com.vantage.app://…`;
    verify on a device. (P1)
    *Status 2026-10-20: done in code. Native starts send a PKCE-style challenge (verifier stays on the
    device); the state is signed + 10-min + provider + challenge, no cookie; the callback hands code+state
    to `com.vantage.app://wearable-callback` WITHOUT exchanging, and the app's POST finish exchanges only
    with the verifier and a session for the state's user (lib/oauthState.js "Native starts" says why a
    cookie-less signed state alone would reopen the cross-account attack). Same registered redirect URI;
    web flow byte-for-byte unchanged; `check:wearableconnect`. Needs: the `wearable-callback` host in the
    Android intent filter, `com.vantage.app` as an iOS URL type once `ios/` exists, then a device test.
    Later hardening: verified App Links / Universal Links instead of the custom scheme.*
116. `[~]` **BLOCKS** Review purchases: sandbox events are dropped unless `REVENUECAT_ALLOW_SANDBOX=true`,
    so a reviewer who buys Pro gets a 403 from the coach. Recommended: set it for the review window
    only, then off. And `config.pro_live` must be `'true'` before submission. (P2, P3)
    *Status 2026-10-20: done in code. The global switch is replaced by narrow routes
    (`netlify/lib/reviewSandbox.js`, tested): sandbox events are honoured for accounts on the owner's
    reviewer list (`supabase/reviewer_access_2026_10.sql`: email-keyed, RLS locked, SQL-editor-only
    functions, each row expires within 90 days, confirmed emails only), or for anyone while
    `REVIEW_WINDOW_UNTIL` is open (≤ 30 days ahead, closes itself). `REVENUECAT_ALLOW_SANDBOX=true` still
    works as a legacy override and logs a warning. Any failure closes the gate. Subscriber-API reads
    leave sandbox entitlements out unless sandbox is honoured. `reviewer_access_add(…, grant_pro)` gives
    demo account A a recorded, revertible lifetime grant that no webhook can demote.
    `review_preflight()` / `scripts/reviewer-demo/preflight.mjs` checks `pro_live` and the reviewer
    accounts before submission. Owner: run the SQL, add the accounts, unset `REVENUECAT_ALLOW_SANDBOX`
    if set (`docs/REVIEWER_KIT.md`).*
    *2026-10-22: `reviewer_access_2026_10.sql` applied by the owner and verified live. Still to do: add the
    reviewer accounts (once they exist on the company domain), and unset `REVENUECAT_ALLOW_SANDBOX` if set.*
117. `[~]` **BLOCKS** Sign in with Apple tokens aren't revoked on account deletion (Apple expects it):
    needs the native SIWA flow's authorization code, or the provider token captured at sign-in. (P8)
    *Status 2026-10-20: done in code. Both web and native sign in through Supabase OAuth; there is no
    native SIWA plugin. The Apple refresh token Supabase hands over once at sign-in is posted by
    `src/lib/auth/appleTokenCapture.js` (wired in `lib/supabase.js` and `lib/native/deepLinks.js`) to the new
    `apple-token` function. It stores the token only when the caller's newest identity is a fresh Apple
    sign-in, in `apple_tokens` (`supabase/apple_revocation_2026_10.sql`: RLS on, no policies; AES-256-GCM
    with `APPLE_TOKEN_SECRET`). `delete-account` reads it before the auth delete and revokes it at Apple
    after, with an ES256 client secret. Every failure is logged and none blocks deletion. Owner: Apple key +
    Netlify env (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICES_ID`,
    `APPLE_TOKEN_SECRET`), run the SQL, then the smoke test in `docs/SIGN_IN_WITH_APPLE.md`. That test
    confirms Supabase returns Apple's refresh token, which could not be checked from here. Tokens are
    captured from deployment on; earlier Apple sign-ins have none until they sign in again.*
    *2026-10-22: `apple_revocation_2026_10.sql` applied by the owner and verified live. Still to do: the
    Apple key and the five Netlify env vars (needs the Apple developer account), then the smoke test.*
118. `[~]` **BLOCKS** DM text (and the opt-in shared streak habit name) isn't filtered (Apple 1.2 asks
    for a filtering method): reuse `checkPublicText` on send, mirror it server-side. (P9)
    *Status 2026-10-20 (DMs): done in code — the composer refuses slurs and unambiguous explicit terms
    with an inline reason (draft kept), and a BEFORE INSERT trigger refuses the same list in the database
    (`vb_message_text_blocked`; list parity checked in the build, JS↔SQL verdicts compared on Postgres 16).
    Same normalisation as `checkPublicText`, deliberately narrower list: no general swearing, links or
    help-seeking words ("rape", "paedo", "nudes"). The shared-streak habit name is batch C's half.*
119. `[~]` **LAUNCH** Copy and widgets for things that don't ship: remove "Recent Mail — coming soon"
    from the mobile picker (keep its META for existing stacks); the tutorial still describes Trending
    and Apple Health; Track says "Syncs from WHOOP, Oura or Apple Health"; drop the "Our Apps" preset
    (links to a separate external app, URL carries a personal account name) from the native build.
    (P5, P10, P11)
    *Status 2026-10-20: done in code — Recent Mail out of the picker (META/stub kept); tutorial steps rewritten (no
    Trending, no Apple Health); Track help and auto-fill hints name Apple Health only for the owner;
    `APP_PRESETS` is empty in native builds (URL absent from the native bundle — checked with a
    `VITE_NATIVE_BUILD=true` build), old cards show the retired-preset stub.*
120. `[~]` **LAUNCH** Subscription copy (3.1.2): the More drawer hard-codes "from £3.99/mo" — read it from
    the store product like SubscriptionPanel; soften "Unlimited everything" (AI still has daily caps).
    Rename the hub's rule-based "AI Coach" banner to "Coach" or add a not-medical-advice line. (P6, P12)
    *Status 2026-10-20: done in code — chip price from `getOfferings()` (none quoted when nothing loads); "No caps on your
    lists" / "Higher limits" with the AI fair-use cap stated; scan upsell "More with Pro"; the banner is
    "Coach" with "Tips from your own logs · not medical advice".*
121. `[ ]` **LAUNCH** Store-form decisions (pack §2–4): Apple "Social Media" = No (Yes → 16+ in
    Australia); alcohol references Infrequent (or change the habit placeholder); export compliance
    "none of the algorithms" + `ITSAppUsesNonExemptEncryption=false` (one line from the solicitor);
    iPad support or not; Play audience 13+ bands or 18+.
122. `[~]` **LAUNCH** Create the reviewer demo accounts 4–6 weeks before submitting — ratings cap
    history at account age, so a fresh account looks empty. (Pack §1.)
    *Status 2026-10-20: tooling done. `scripts/reviewer-demo/seed.mjs` creates (with `--create`) and seeds
    A (Pro), B (free, five habits = the cap) and the demo friends with 6–8 weeks of invented history in
    the app's own state shapes (checked through the app's pure libs in `plan.test.mjs`): trackers,
    habits, hand-entered vitals, savings, trips, wish list, food log, friendships, DMs and a group. It
    touches only `--allow` addresses, refuses owner addresses, stops before any write if a row holds
    data it did not write, uses compare-and-set for the state, never deletes and never sets tier. It
    is a dry run unless `--write` is given (`seed.test.mjs` proves this end to end). Steps:
    `docs/REVIEWER_KIT.md`. Still to do (owner): create the accounts on the company domain (item 72)
    4–6 weeks before submitting, then run the seeder and `reviewer_access_add`.*

123. `[ ]` **BLOCKS** `REVENUECAT_SECRET_API_KEY` is not set in Netlify (owner confirmed 2026-10-20). Without
    it, account deletion can't remove the RevenueCat subscriber (the /delete-account page says it does),
    and the webhook can't confirm a subscriber's real state from RevenueCat's API (item 46 falls back to
    trusting event order). Harmless today — RevenueCat only creates records for native purchases, and none
    exist yet — but set it when the store products are created: RevenueCat → Project settings → API keys →
    Secret API key (`sk_…`, v1) → Netlify env `REVENUECAT_SECRET_API_KEY`, Functions scope → redeploy.

### From the wearable approvals pack — 2026-10-20 (`docs/WEARABLE_APPROVALS.md`, C1–C17, D1–D10)
Confirmed (official pages, via search excerpts — read the full terms in a browser before submitting):
WHOOP caps an unapproved app at **10 members**; Oura's API also caps at **10 users** without approval;
WHOOP 100 req/min + 10,000/day; Oura can't read Gen3/Ring 4 users without an active Oura Membership;
both providers' terms bar using their data to train/feed AI (keep `AI_WEARABLE_DATA_ALLOWED` unset —
for Oura effectively permanently).
124. `[x]` **BLOCKS (WHOOP approval)** Wearable-derived values reach ratings and the friends heatmap that
    others see, with no opt-in (`recompute.js` sleep/RHR days, workout burn, auto-ticked trackers, active
    days; `usePublishProfile.js`). WHOOP's terms count "derivatives" as WHOOP Data and require the user's
    explicit opt-in before showing it to others. Owner decision D1: exclude wearable-sourced data from
    shared ratings/heatmap (recommended) or add an opt-in. Fix the "never shown to others" copy to match.
    *Status 2026-10-20: D1 = exclude, done. `src/lib/wearables/strip.js` (`shareableView`, reusing the
    coach's `wearableProvenance.js` rule) feeds the client ratings, vision unlocks (so the level friends
    see) and the friends heatmap; `netlify/lib/wearableShare.js` mirrors it in `recompute.js` (state
    projection gains `logsAuto`), and `check:parity` proves both sides agree and that band data adds
    nothing. Band users' public ratings drop on their next recompute — expected; say so in the release
    note. Vision stamps already earned are kept (never removed); prestige baselines snapshotted before
    this may sit above the new totals until the user climbs past them. Consent + privacy copy updated.*
125. `[~]` **LAUNCH** Revoke provider grants: WHOOP documents `DELETE /developer/v2/user/access` and asks
    apps to call it on disconnect — call it on disconnect AND account deletion (corrects item 67's "no
    documented endpoint"); Oura: check whether an endpoint exists.
    *Status 2026-10-20: WHOOP done — `netlify/lib/wearableRevoke.js` (refresh first, 5 s timeout, fail
    soft) runs before the token row is deleted in `wearable-disconnect` and before the auth delete in
    `delete-account`, which now also sweeps `whoop_tokens`/`oura_tokens`/`user_data`/`user_data_history`
    by user id after the auth delete (the `user_data` FK isn't in the repo's SQL to confirm). Oura:
    UNVERIFIED — its docs weren't reachable from the build machine; a community client points at
    `GET https://api.ouraring.com/oauth/revoke?access_token=…`. Owner: confirm on
    cloud.ouraring.com/docs/authentication (or in the §3.2 email), then set `PROVIDERS.oura.revoke`.*
126. `[ ]` **LAUNCH** Branding/labels per WHOOP's guidelines: no home-made WHOOP/Oura logos, don't rename
    provider metrics (WHOOP Recovery shown under "Readiness"; Oura Readiness stored as "Recovery"), WHOOP's
    recovery colours, name the provider instead of "wearable"; drop the unused `read:profile` scope.
127. `[~]` **LAUNCH** While approval is pending: a server-side allow-list for connect (≤10 incl. one slot for
    WHOOP's reviewer) with a clear message instead of "connect failed (denied)"; surface Oura errors
    (today "Synced 0 days"); budget sync-on-open against WHOOP's daily limit (~400–600 DAU would exhaust it)
    and request an increase in the approval. Decide D4 (delete device history on disconnect option) and
    D7 (first native build with WHOOP/Oura hidden or held).
    *Status 2026-10-20 (decided D4, D7): allow-list done in code — `supabase/wearable_access_2026_10.sql`
    (ships `open`; config switch + list by handle + owner RPCs, 9 slots + the owner), gate in
    `whoop-connect`/`oura-connect` (`netlify/lib/wearableAccess.js`; already-connected accounts can
    always reconnect; fails OPEN before the SQL runs), owner panel Settings → Tools → Wearable access,
    a "you're on the list / not yet" note and plain-language connect results. Oura errors surface
    (401 → reconnect, 403 → membership; `ouraLastError`). D4: no prompt on disconnect; Settings → Tools →
    Health & sync → "Delete data synced from WHOOP/Oura" (`stripWearableData`, user-confirmed, manual
    data kept). D7: `WEARABLES_IN_NATIVE = false` in `src/lib/native/wearableGate.js` hides Connect in
    native builds; linked accounts keep Disconnect + delete. Owner: run the SQL, add handles (keep one
    for WHOOP's reviewer), flip to Invite-only. Still open here: the sync-on-open budget (C13).*
128. `[ ]` **LAUNCH** Submit WHOOP's production approval (draft answers + 13-shot list in the pack §2) and
    register Oura + send the questions email (§3), after 124–127; file both replies with the DPIA (G7).

### From the domain-day pack — 2026-10-20 (`docs/domain-day/`)
129. `[~]` **LAUNCH** Invite links made inside the native app point at `localhost`:
    `src/lib/friends/invites.js` builds the URL from the current page address — use `webOrigin()`
    (as deepLinks does). Unverified on a device; fix after the safety batch merges (it owns src/lib/friends).
    *Status 2026-10-20: fixed in code — invites.js uses webOrigin(); verify a shared invite from the native app opens on another phone.*
130. `[ ]` **LAUNCH** Domain day (when bought): follow `docs/domain-day/CHECKLIST.md` in order — every
    allow-list first, keep `vantagevision.netlify.app` live (native builds, webhooks and the Health Shortcut
    call it by name; no day-one redirect), sign in to a heavy real account on the new origin before
    switching the Supabase Site URL (local stashes are per-origin), change `DEFAULT_API_BASE` before the
    first store build. Email: Resend (EU region) for Auth SMTP — free tier caps at 100/day, upgrade before
    any launch push; Zoho mailbox + aliases (`EMAIL.md`). Links/Universal links wait for the native apps.
131. `[~]` **LAUNCH** Mobile-only public launch: web gate (owner decision 2026-10-20). In a web browser the full
    app is for an owner-kept allow-list (owner + friends); everyone else signed in on the web gets "Vantage is
    on iPhone and Android" with store links, Sign out and Delete my account (Google's web-deletion rule). Native
    apps, `/privacy` `/terms` `/support` `/delete-account` are never gated; `/invite/<code>` keeps the preview
    but its call to action becomes the store apps. A server-side SWITCH (`config.web_access`), shipped OPEN.
    Launch-day steps (owner): (1) run `supabase/web_access_2026_10b.sql` (needs owner_content.sql; verify block
    in its header); (2) Settings → Tools → Web access: add friends' sign-in emails (you are always allowed);
    (3) at launch press "Switch web to invite-only…" → confirm; (4) verify in a private window with a
    non-listed test account: it gets the app-store page, the public pages still open. Reopen with the same
    panel. Fill `src/lib/storeLinks.js` when the listings exist (null shows "Coming soon").
    *Status 2026-10-20: done in code — `src/lib/webAccess.js` (decision, `check:webaccess`, incl. a test that
    the gated path never mounts the state hook), gate page + owner panel in `src/components/webaccess/`,
    delete flow shared with Settings (`src/lib/account/deleteAccount.js`); SQL dry-run on Postgres 16
    (`scripts/webaccess/test-web-access-sql.sh`). Owner: steps 1–4 above.*
    *2026-10-22: step 1 done — `web_access_2026_10b.sql` applied by the owner and verified live
    (`config.web_access` = `open`). Steps 2–4 are for launch day.*
    *Launch-day copy (from the gate agent): when switching to invite-only, change the privacy policy's
    opening line "available on the web and as a mobile app" (LegalPage.jsx) to "…as a mobile app; the web
    version is by invitation"; export and Settings-path lines stay true in the apps. /delete-account already
    tells gated web visitors to use the gate page's Delete button.*

## Phase 7 — Running it safely once it's public

The point is that when something goes wrong, you find out first, you
can stop the bleeding in minutes, and you meet the legal clock.

76. `[~]` **A way in for reporters.** `security@<domain>` inbox (both
    owners), `/.well-known/security.txt` pointing at it, and a short
    disclosure page: what's in scope, "we reply within 3 working days",
    no legal action for good-faith reports. A hall of fame costs
    nothing; paid bounties can wait.
    *Status 2026-09-30: SECURITY.md + /.well-known/security.txt written with a `security@[your-domain]` placeholder — create the inbox and fill it in.*
77. `[~]` **Know before users tell you.** Sentry (client + functions,
    PII scrubbing on), an uptime check on `/` and one function, the
    Anthropic spend alert and hard limit, Supabase usage alerts, and an
    in-app "not saved" indicator. Weekly: Supabase security advisors +
    `npm audit` (a scheduled Claude routine can do this and report).
    *Status 2026-09-30: client crash reports → client_errors (needs audit SQL); /.netlify/functions/health for an uptime monitor. Owner: point an uptime monitor at it, set the Anthropic spend limit, Supabase usage alerts.*
    *Status 2026-10-04: security_console_2026_10.sql run — the hourly security sweep raises tickets (DB slow/unreachable, disk, connections, error spikes, stale reports, slow LCP), real-user web vitals are recorded, and the Security console shows database health. `SUPABASE_ACCESS_TOKEN` and `NETLIFY_AUTH_TOKEN` set in Netlify env (Functions scope) — every console panel is configured. Rotate the Netlify token before its expiry.*
78. `[~]` **Incident runbook (one page, both owners have it).**
    - *Contain:* Netlify → publish previous deploy (instant rollback);
      a `MAINTENANCE`/feature-flag env var that disables AI, social or
      sync functions without a deploy; Supabase → pause a function or
      revoke a grant.
    - *Rotate:* list of every secret and where it lives (Supabase JWT
      secret + service role, Anthropic, WHOOP/Oura, RevenueCat webhook,
      CRON/PUSH secrets, FCM). Rotating the Supabase JWT secret signs
      everyone out — that is the "kill all sessions" lever.
    - *Assess:* what data, whose, since when (Supabase + Netlify logs).
    - *Notify:* UK GDPR Art. 33 — tell the **ICO within 72 hours** of
      becoming aware of a personal-data breach unless it's unlikely to
      risk people's rights; health data almost always is. Art. 34 —
      tell affected users without undue delay if high risk. Keep a
      **breach log** of every incident, reported or not (Art. 33(5)).
      Stores: Apple/Google may need telling if the app is the vector.
    - *Review:* write-up, fix, and a test or check so it can't recur
      (the pattern already used after the 2026-05-03 wipe).
    *Status 2026-09-30: docs/INCIDENT_RUNBOOK.md (contain, secrets inventory, ICO 72 h, breach log, post-mortem). No kill-switch env var exists yet — the runbook documents today's options.*
    *Status 2026-10-20: kill switch built — `VANTAGE_PAUSE=ai|social|sync|push|all` (comma list) makes those functions answer 503 "Paused for maintenance — back soon" (crons skip their run); moderation, deletion, health and the security tools never pause. Needs a Netlify redeploy to take effect (env changes apply on deploy), no code change. Direct-to-Supabase traffic (DMs, friends) still needs a grant revoke. Owner: read runbook §3 "Pause an area" once, and try it on a quiet evening (`VANTAGE_PAUSE=ai`, redeploy, check, remove, redeploy).*
79. `[~]` **Abuse handling with a clock on it.** Reports reach an owner
    within hours (push or email), a target of acting within 24 h (what
    Apple expects), a suspend flag that hides a user everywhere, and
    evidence kept when an account is deleted.
    *Status 2026-09-30: docs/ABUSE_HANDLING.md; moderation queue built. Nothing alerts an owner when a report arrives yet — check the queue daily until it does.*
    *Status 2026-10-20: the hourly security sweep now pings the owner within ~1 h of a new report ("N new report(s) — open the moderation queue", tap opens Moderation; no report content or ids), once per batch, regardless of ALERT_MIN_SEVERITY. Owner: make sure `ALERT_NTFY_TOPIC` (or `ALERT_WEBHOOK_URL`) is set on Netlify and press "Send test alert"; then file a test report from a second account and time the ping.*
80. `[ ]` **Accounts that can't be taken over.** 2FA (authenticator
    app, not SMS) on GitHub, Supabase, Netlify, Apple, Google Play,
    RevenueCat, Anthropic, the domain registrar and the owner email;
    secrets in a shared password manager, never in chat or the repo;
    GitHub secret scanning + push protection on (the repo is public).
    Consider making the repo private before launch.
    *Status 2026-09-30: docs/ACCOUNT_SECURITY.md lists every service and step — the doing is the owners'.*
81. `[x]` **Every change stays safe by default.** A pre-merge checklist:
    new table → RLS + `on delete cascade` + column grants; new function
    → `requireUser` + durable limit + no raw errors; new view →
    `security_invoker`; run Supabase advisors after every SQL file.
    *Status 2026-09-30: .github/pull_request_template.md.*
82. `[~]` **Practise recovery.** Decide PITR (item 27); once a quarter,
    restore a `user_data_history` snapshot to a test account and time
    it. A backup that has never been restored is a hope, not a backup.
    *Status 2026-09-30: docs/RESTORE_RUNBOOK.md (restore from user_data_history, drill checklist, PITR notes). Run the first drill.*
    *Status 2026-10-20: runbook rewritten as a decision tree (history restore → copy + one-user recovery → whole-project restore as last resort) with a quarterly drill that uses a free daily backup + one-user recovery on a test account, and a results log. The SQL is dry-run tested on Postgres 16 (`scripts/recovery/test-recovery-sql.sh`). First drill still to run by the owner, after `recovery_2026_10b.sql` is applied. `recovery_2026_10b.sql` applied 2026-10-20 (ops_log shows "done"); first drill still to run.*

## Phase 6 — Scale readiness (before real user numbers)

25. `[ ]` **Get the base64 images out of `state` and into Storage.**
    Measured state is ~967 kB per user; `holidays` + `backgrounds` are
    ~539 kB of that, all base64 data URIs. It is re-downloaded on every
    app open and rewritten on every save. Roughly halves state size.
    *Status 2026-10-20: planned — `docs/STATE_SIZE_PLAN.md` + `supabase/state_size_DRAFT_not_run.sql`
    (DRAFT, do not run). Images → private `media` bucket, references in state, server-side swap with a
    90-day originals ledger; Phase 0 first (build census, update gate, flags, restore drill, PITR).
    Owner decisions listed in the plan. Estimate ~967 kB → ~430 kB.*
    *Status 2026-10-22: Phase 0 built (shared with item 26) — build stamp, update-required gate (fails
    open; never stops a running app), build census, `app_config` flags all off.
    `supabase/state_size_phase0_2026_10.sql` (dry-run tested) is for the owner to run. Measured live
    (plan §1.1): mean 247 kB, max **1.55 MB**; `backgrounds` up to 834 kB on one account; there is no
    backgrounds Storage bucket. Next: the owner runs the SQL, does the restore drill and decides on PITR,
    then Track I1.*
26. `[ ]` **Move the per-day logs (`vitalsLog`, `burnLog`, `moodLog`)
    into tables**, the way `nutrition_log` already is. Together with 25
    this takes state from ~967 kB to ~90 kB.
    *Status 2026-10-20: planned in the same docs — one `daily_log(user_id, kind, day, data)` table,
    function-only writes (no client delete), journal 90 days, dual-write → backfill → 14 days of zero
    mismatches → read switch → owner-run per-user cleanup. The first native binary must be built from the
    read-switch build or later.*
    *Status 2026-10-22: Phase 0 built (see item 25). Measured: `burnLog` is the largest single key on the
    account that has it (281 kB, WHOOP workouts), so Track L matters as much as the pictures.*
27. `[~]` **Decide on Supabase PITR.** Pro gives 7-day daily backups;
    PITR is a paid add-on. Given data safety is the project's stated #1
    rule and there has already been one wipe incident, decide
    deliberately rather than during an incident.
    *Status 2026-10-20: decided — PITR ON for the state-size migration window (enable before the image migration I4, off 30 days after the last L7 cleanup) and recommended permanently from public launch; 7 days ≈ $100/month ($0.137/h, outside the spend cap, stops daily backups, needs Small — we're on Small). Foundations built so it's useful the day it's bought and daily backups are useful today: `supabase/recovery_2026_10b.sql` (append-only `ops_log` restore markers + `ops_mark()`, and one-user recovery `export_user_bundle` in a restored copy → `import_user_bundle` dry_run/restore_missing in production, insert-only, never overwrites state), `netlify/lib/opsMark.js`, `docs/RESTORE_RUNBOOK.md` (decision tree, whole-project checklist, "Buying PITR" checklist), `scripts/recovery/README.md`. Owner: run `recovery_2026_10b.sql`; buy PITR before I4 using the runbook checklist (and update DPIA row 23 + running costs). `recovery_2026_10b.sql` applied 2026-10-20.*

---

## Food search — keys that unlock coverage

Search federates several sources; each is optional and keyed by env, so
an unconfigured one contributes nothing and the app keeps working.
Adding a key needs no code change.

- `[ ]` [A] **FatSecret** (`FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`)
  — **the important one.** ~1.9M items across 56 countries including
  RESTAURANT menus, which is the gap for fast food. Free tier is 5,000
  calls/day. Open Food Facts and USDA are both weak on menu items, so
  this is what makes "Big Mac Meal" findable.
- `[ ]` [A] **USDA FoodData Central** (`FDC_API_KEY`) — free key from
  data.gov, ~600k foods including ~380k branded. 1,000 requests/hour.
  Public domain data.
- `[x]` **Open Food Facts** — no key, already live. ~3M barcoded
  products, Europe-strong.

## Auth — the email confirmation link (FIXED)

A tester confirmed their signup email and landed on Netlify's "Site not
found". The link pointed at `…phoenix-b512b8.netlify.app` — the
auto-generated subdomain this site had before it was renamed to
vantagevision. Supabase had no redirect to use, so it fell back to the
Site URL in its dashboard, which nobody updated after the rename.

The code half is fixed: `signUp` and `resetPasswordForEmail` now name
`window.location.origin` explicitly, so the link returns to wherever the
person actually signed up. That is not sufficient on its own — Supabase
only honours a redirect that matches its allow list, and silently falls
back to the Site URL when it doesn't.

28. `[x]` **Fix the Supabase auth URLs.** ✅ done 2026-07-29 — Site URL
    and redirect allow list corrected; signup confirmation verified
    working. Dashboard → Authentication →
    URL Configuration
    (`supabase.com/dashboard/project/mtbloqcvkvazmehvsaqk/auth/url-configuration`):
    - **Site URL** → `https://vantagevision.netlify.app`
    - **Redirect URLs** → add `https://vantagevision.netlify.app/**`,
      plus `http://localhost:5173/**` for local dev and
      `https://deploy-preview-*--vantagevision.netlify.app/**` if you
      want testers to be able to sign up from a PR preview.
    - `[ ]` ⚠️ Re-check this the day a custom domain is added, and again
      when the Capacitor build lands — a native shell's origin is not an
      https URL, so it needs its own deep-link entry or confirmation
      emails break for app users exactly as they did here.

Resolved 2026-07-29. Kept here as the record of why the code names the
origin explicitly — remove the redirect and this breaks again silently.

## Wearables — Oura setup, and WHOOP's redirect URL

The code shipped and is open to every signed-in account, but the Oura
integration is inert until items 29 and 30 are done. Until then the panel
says "Oura env missing" rather than failing quietly.

WHOOP was listed here as needing nothing "because it is already
configured". That was true right up until it wasn't, and because the
value was never recorded, nobody could check — see item 31.

29. `[x]` **Run `supabase/oura_schema.sql`** in the Supabase SQL editor.
    Creates `oura_tokens` — RLS on, no policies, so only the service
    role ever sees a refresh token. Migrations are approval-gated, so
    tooling cannot apply this; it has to be run by hand.
    *Run 2026-07-31 by the owner.*
30. `[ ]` **Register the Oura app and set its keys in Netlify.** Create
    it at `cloud.ouraring.com/oauth/applications`, then set
    `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` as Netlify env vars.
    Redirect URI must be exactly
    `https://vantagevision.netlify.app/.netlify/functions/oura-callback`.
    - `[ ]` ⚠️ **Confirm the terms for multi-user use while you're in
      the portal.** Personal use of the Oura API has been free, but
      distributing an app that reads *other people's* Oura data may
      need registration or review — the way WHOOP did. This decides
      whether Oura stays a general feature or becomes invite-only, so
      settle it before anyone outside the team connects a ring.

31. `[ ]` **Check the WHOOP app's registered redirect URL.** WHOOP was
    described here as "already configured", and its redirect URL was
    never written down — which is how it drifted unnoticed. On
    2026-08-08 a reconnect failed at WHOOP's authorize step with
    `invalid_request` / *"The redirect_uri parameter does not match any
    of the OAuth 2.0 Client's pre-registered redirect urls"*.
    The code no longer derives that value from the request host
    (`netlify/lib/redirectUri.js`), so it is now a constant — but a
    constant still has to be the RIGHT one. In the WHOOP developer
    dashboard, the app's redirect URLs must contain exactly:
    `https://vantagevision.netlify.app/.netlify/functions/whoop-callback`
    *Origin confirmed by the owner 2026-08-08 — the site has NOT moved
    domain, so the failure was the registration itself, not a stale
    host.*
    - Register **every** origin the app is reachable on, not just one.
      The apex domain, `www.`, the `*.netlify.app` fallback and any
      custom domain are separate entries as far as OAuth is concerned.
    - If a custom domain has been added, Netlify's `URL` env var follows
      it, so the sent value changes with it. Either add the new origin in
      WHOOP, or pin `OAUTH_REDIRECT_BASE` in Netlify to whichever origin
      is registered.
    - The Track → Vitals → WHOOP panel prints the exact string it sent
      after a failed connect, with a Copy button. That is the value to
      paste into the dashboard — don't retype it.
    - `[ ]` ⚠️ **Re-check on the day a custom domain is added**, exactly
      as item 28 says for Supabase auth. Same failure, same cause: an
      origin changed and a registered allow-list didn't.

Standing rules for both wearables, so a third one doesn't relearn them:

- **A redirect URI is registered, so it must be a constant.** Never
  rebuild it from `event.headers.host` — one site has many hosts, and
  only the registered one works. `netlify/lib/redirectUri.js` resolves it
  once for both providers and both halves of the flow (the authorize call
  and the token exchange must match byte for byte).
- **Never make the OAuth `state` deterministic.** It carries a nonce
  matched against an HttpOnly cookie, a signed 10-minute expiry, and the
  provider name (`netlify/lib/oauthState.js`). The original static
  version let one account's linking flow be used to file *another*
  user's tokens under the attacker's id — health data to the wrong
  person. The cookie is `SameSite=Lax` on purpose: the provider's
  redirect is a top-level GET, which Lax allows and Strict would block.
  Native (app) starts can't use the cookie, so they bind with a
  verifier the app keeps (PKCE shape) and the callback never exchanges
  their code itself — the app finishes with verifier + session. A
  cookie-less state that the callback would exchange on its own is the
  same hole again (item 115).
- **Every new user-scoped table needs `on delete cascade`** to
  `auth.users(id)`, or account deletion leaves it behind (see item 20).
- **Disconnect must delete the tokens**, because the privacy policy says
  it does — `wearable-disconnect` covers both providers.

## Running costs — confirmed 2026-10-05

From the Supabase and Netlify billing pages (read-only check by a local
session). USD at ~£0.75. Record of cash out lives in Upgrade → Books.

| Service | Plan | Monthly | Notes |
|---|---|---|---|
| Supabase | Pro + Small compute | $29.83–30.33 (~£22–23) | Spend cap on; next invoice 5th of the month |
| Netlify | Pro | $20 (~£15) | Shared with two other sites (~⅓ Vantage) |
| Domain | — | £0 | `vantagevision.netlify.app` |
| Firebase / GCP | none | £0 | No project yet (item 15) |
| Apple / Google Play / ICO | not yet paid | — | £79/yr, $25 once, £52/yr at launch |
| Anthropic API | unknown | ? | Console moved to platform.claude.com — check per-scan cost there |

Today ≈ **£37/month** (Vantage's share ≈ £28 with Netlify apportioned);
≈ **£48/month** once Apple and ICO are paid. 12 months to date: $214.55.
The owner's Claude subscription is a development cost, kept out of the
per-user margin.

## Standing operational notes

- **Lifetime is a grant, never a purchase.** It's filtered out of the
  paywall in code (`UNSELLABLE` in `PaywallModal.jsx`) so a re-enabled
  RevenueCat SKU can't silently become buyable. The public can only buy
  Free → Pro. Grants are applied by running
  `supabase/lifetime_grants.sql`, which is the only route now that
  `tier` is server-owned.
- **Migrations can't be applied by tooling** — they are approval-gated.
  SQL goes in `supabase/*.sql` and the owner runs it in the SQL editor.
- **Netlify deploys cost 15 credits each.** Pro gives 3,000/month, so
  ~200 deploys. Batch merges rather than deploying per change.
- **Netlify auto-publishes on push to `master`.** Merging a PR *is* a
  deploy unless auto-publishing is turned off in Netlify.

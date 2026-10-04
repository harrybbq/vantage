# STARTUP REQUIREMENTS

Everything standing between Vantage as it is today and Vantage on the
App Store and Google Play. Ordered — later steps depend on earlier ones.

Owners: Harry (harrym3002@outlook.com) · Aidan (anotherone650@gmail.com)

Status key: `[ ]` to do · `[x]` done · `[~]` done in code, needs an
action outside the repo.

---

## Phase 1 — Company (start immediately; everything queues behind it)

1. `[ ]` **Register a UK limited company** at Companies House (~£50,
   usually same-day). Two co-owners means limited liability and a clean
   ownership split; a sole trader can't hold shares between two people.
2. `[ ]` **Sign a shareholders' agreement.** Who owns what %, what
   happens if one of you leaves, who decides what. The step people skip
   and regret. Cheap now, expensive later.
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

8. `[ ]` **Get a DPIA done for the health data.** Weight, sleep, resting
   HR and recovery are *special category* data under UK GDPR — a higher
   bar than ordinary personal data, and a DPIA is likely mandatory
   (Art. 35). Worth an hour with a solicitor; this is the one area where
   guessing is expensive.
9. `[x]` **Privacy policy and terms**, deep-linkable before sign-in —
   `/privacy` and `/terms` already do this.
10. `[ ]` **Fill in App Store privacy labels** — declare health,
    financial and contact data collection. Must match what the app
    actually does.

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
22. `[ ]` **Triage the dependency vulnerabilities** — 1 critical, 12 high
    in production deps, mostly the Capacitor toolchain.
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
    - `[ ]` **Set `OWNER_EMAIL`** on Netlify (comma-separated). The
      function fails closed without it.
    - `level` is deliberately still client-writable: cosmetic on the
      friend card, published on a debounce by `usePublishProfile`, and
      not a leaderboard input. Moving it needs that write server-side
      first.
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
68. `[~]` **LAUNCH** Defaults for 13–17s: handle search and leaderboard
    are ON; `shareStreak` publishes habit names (e.g. a quit-drinking
    streak) to friends by default.
    *Status 2026-09-30: done in the client (streak opt-in, toggles show real state); new-account DB defaults in audit SQL.*
69. `[ ]` **LAUNCH** The trading app's schemas (`ledger`, `paper`,
    `research`) live in Vantage's Supabase project — one service-role
    key, one Micro instance, one restore unit. Move them to their own
    project before launch.
70. `[~]` **AFTER** Repo hygiene: personal emails in
    `lifetime_grants.sql`/`recomp_schema.sql`; an apparent real salary
    comment in `career/companies.js`; a Last.fm key in dead
    `SpotifyBar.jsx`; `dist/` committed (78 MB .git); no CI outside the
    Netlify build. Move `@capacitor/cli` + `@capacitor/assets` to
    devDependencies (clears item 22's critical/high — none ship).
    *Status 2026-09-30: personal emails replaced with placeholders in SQL; dead SpotifyBar removed (revoke that Last.fm key — it stays in git history); salary comment neutralised; Capacitor CLI/assets moved to devDependencies; PR build workflow added. `TRADING_APP_CLAUDE.md:9` still holds a real email; `dist/` is still committed per the deploy flow.*

83. `[ ]` **LAUNCH** Any signed-in user can still read every column of a
    searchable profile — `tier` (who pays), `ratings`,
    `prestige_baseline`, `last_active_at` — whatever `leaderboard_optin`
    says. Fix with column-level SELECT grants (the `groups` pattern in
    `group_crest_schema.sql`), after moving own-row reads of `tier` and
    `last_active_at` to a definer RPC. Needs a client audit of every
    `from('profiles').select(...)` first.
84. `[ ]` **LAUNCH** Name filter and avatar screening bind honest clients
    only: a user can still PATCH `handle`/`display_name`/`avatar_url` on
    their own row directly. Binding needs those writes moved to a
    service-role function, then
    `revoke update (handle, display_name, avatar_url) on public.profiles from authenticated;`.

85. `[ ]` **LAUNCH** Supabase is retiring the legacy `anon`/`service_role`
    keys by the end of 2026. The new `sb_secret_…` keys go in the `apikey`
    header, are not JWTs, and are refused when the request carries a
    browser User-Agent. Every Netlify function sends the service key as
    both `apikey` and `Authorization: Bearer` — that breaks on the switch.
    Move server calls to supabase-js (handles both) or send `apikey` only,
    and test against a secret key before swapping it in.
86. `[ ]` **LAUNCH** Netlify Web security center (observed 2026-10-02):
    no WAF, no rate-limiting rules, no firewall traffic rules. Add a
    rate-limit rule on `/.netlify/functions/*` (per-IP) before launch —
    the in-function limits are per instance.
87. `[ ]` **AFTER** `push-dispatch` runs every minute — ~44k invocations a
    month on credit-based pricing, mostly finding nothing. Consider
    every 5 minutes, or trigger it from the queue insert instead.

### Non-code tasks missing until now
71. `[ ]` **Online Safety Act 2023** — DMs, groups and the leaderboard
    make Vantage a user-to-user service: Ofcom illegal-content risk
    assessment + children's access assessment, and Terms describing
    moderation.
72. `[ ]` **Support URL + support email** (both stores require one; the
    policy already promises it) and a written **subject-access** process.
    *Status 2026-10-04: in-app channel live — Settings → Report a problem files a ticket into Upgrade → Security (security_console_2026_10.sql run). A public support URL + email are still needed.*
73. `[ ]` **Reviewer kit** — demo account with Pro, sandbox testers,
    review notes (WHOOP/Oura need hardware).
74. `[ ]` **Store forms** — Apple age-rating questionnaire, Play IARC,
    Data safety, Health apps declaration, Financial features (none),
    account-deletion web URL, export-compliance/encryption declaration.
75. `[ ]` **DPAs** with Anthropic, RevenueCat, Netlify, Supabase; WHOOP
    production approval for other people's data; trademark check on
    "Vantage".

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
79. `[~]` **Abuse handling with a clock on it.** Reports reach an owner
    within hours (push or email), a target of acting within 24 h (what
    Apple expects), a suspend flag that hides a user everywhere, and
    evidence kept when an account is deleted.
    *Status 2026-09-30: docs/ABUSE_HANDLING.md; moderation queue built. Nothing alerts an owner when a report arrives yet — check the queue daily until it does.*
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

## Phase 6 — Scale readiness (before real user numbers)

25. `[ ]` **Get the base64 images out of `state` and into Storage.**
    Measured state is ~967 kB per user; `holidays` + `backgrounds` are
    ~539 kB of that, all base64 data URIs. It is re-downloaded on every
    app open and rewritten on every save. Roughly halves state size.
26. `[ ]` **Move the per-day logs (`vitalsLog`, `burnLog`, `moodLog`)
    into tables**, the way `nutrition_log` already is. Together with 25
    this takes state from ~967 kB to ~90 kB.
27. `[ ]` **Decide on Supabase PITR.** Pro gives 7-day daily backups;
    PITR is a paid add-on. Given data safety is the project's stated #1
    rule and there has already been one wipe incident, decide
    deliberately rather than during an incident.

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
- **Every new user-scoped table needs `on delete cascade`** to
  `auth.users(id)`, or account deletion leaves it behind (see item 20).
- **Disconnect must delete the tokens**, because the privacy policy says
  it does — `wearable-disconnect` covers both providers.

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

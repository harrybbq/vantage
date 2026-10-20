# Data Protection Impact Assessment: Vantage (DRAFT)

| | |
|---|---|
| **Status** | DRAFT v0.1, for review by a solicitor. **Not legal advice, and not a statement that Vantage complies with anything.** |
| **Date drafted** | 2026-10-20 |
| **Controller** | `[Company name, company number, registered address: to be completed on incorporation]` (STARTUP_REQUIREMENTS.md item 1) |
| **Controller contact** | `[privacy / support email: to be confirmed]` (items 64, 72, 76) |
| **Prepared by** | The owner, from a draft written with AI help by reading the code and documents in this repository. Every factual claim about the app cites the file it came from. |
| **Legal framework** | UK GDPR (especially Arts. 5, 6, 7, 8, 9, 13, 25, 28, 30, 32–36, 37, 44–49), Data Protection Act 2018, PECR, the ICO Age Appropriate Design Code (Children's Code). The Online Safety Act 2023 is related but separate. |

> **How this draft was built.** The ICO website (ico.org.uk) could not be
> reached from the drafting environment: the DNS lookup failed. The
> structure below follows the seven steps of the ICO's sample DPIA template,
> written from knowledge of that template: need, description, consultation,
> necessity and proportionality, risks, measures, sign-off. It uses the
> template's scales: likelihood *remote / possible / probable*, severity
> *minimal / significant / severe*, overall risk *low / medium / high*.
> Before relying on it, check it against the current template on the ICO
> website. Also confirm whether any commenced provisions of the Data (Use
> and Access) Act 2025 change the analysis.
>
> `docs/STORE_PRIVACY_LABELS.md` did not exist yet when this was written,
> so the data inventory in §2 was built straight from the code.

---

## Step 1: Why a DPIA is needed

Vantage is a personal life and wellness app. It holds habits, trackers, a
food diary with calories and macros, body weight, sleep and recovery data
from wearables, savings and subscriptions entered by hand, holidays and a
calendar. It also has social features: friends, direct messages, groups, a
leaderboard and an "OVR" rating. Optional AI features (a daily coach and
food-photo scanning) use Anthropic's API.

Art. 35(1) requires a DPIA where processing is "likely to result in a high
risk". Several of the ICO's high-risk indicators, and of the European
criteria the ICO draws on, apply here:

| Criterion | Applies? | Why (evidence) |
|---|---|---|
| **Special category data (health)** | **Yes** | Weight, sleep, resting heart rate, HRV, recovery, strain, calories burned, steps (`S.vitalsLog`, `S.burnLog`) and food intake (`nutrition_log`). The app treats these as Art. 9 data itself: `src/lib/consent/consent.js`, `src/components/LegalPage.jsx` §3, STARTUP_REQUIREMENTS.md item 8. |
| **Scale** | Possibly, later | Today it is a small beta. The plan is a public App Store / Google Play release (STARTUP_REQUIREMENTS.md Phases 2–4). Each account holds about 967 kB of state (item 25). Whether this becomes "large scale" depends on how many people sign up. Revisit at fixed user counts (Step 7). |
| **Innovative technology / AI** | **Yes** | A large language model (Anthropic Claude Haiku) gets a summary of the user's habits, goals and some health-derived tracker data to write a daily coaching brief (`netlify/functions/ai-coach-daily.js`). It also gets food photos to estimate nutrition (`netlify/functions/ai-food-detect.js`) and profile and group pictures to screen them (`netlify/functions/avatar-check.js`, `netlify/lib/imageModeration.js`). |
| **Children / vulnerable people** | **Yes** | The minimum age is 13 (`src/components/AuthScreen.jsx`, `src/components/TermsAcceptanceSheet.jsx`, Terms §2). So 13–17 year olds can use it, and it offers an online service directly to them. The Children's Code applies. Calorie, weight and body-goal features carry extra risk for young people and for people with eating disorders. |
| **Matching or combining data from several sources** | **Yes** | Manual entries, WHOOP (`netlify/lib/whoop.js`), Oura (`netlify/lib/oura.js`) and Apple Health (`netlify/functions/health-sync.js`, `src/lib/appleHealth.js`) are merged into one daily record (`S.vitalsLog`). |
| **Systematic monitoring / tracking** | **Yes** | Scheduled server jobs pull wearable data every day with no user action (`whoop-cron` 06:00 UTC, `oura-cron` 06:30 UTC, `netlify.toml`). An iOS Shortcut can push Apple Health data on a schedule (`health-sync.js`). Online status is published (`last_active_at`, `src/lib/friends/usePublishProfile.js`, item 92). |
| **Evaluation / scoring / profiling** | **Yes** | Every user gets four category ratings (brain, finance, fitness, social) and an OVR from 1 to 99, computed on the server from their data (`netlify/lib/recompute.js`, `docs/RANKING_SYSTEM.md`). These are shown to friends, to group members and, if the user opts in, on a global leaderboard (`netlify/functions/get-leaderboard.js`). The **fitness** rating partly uses health data: days with weight, sleep or resting heart rate logged, calories burned including WHOOP and Oura workouts, and days the calorie goal was hit (`recompute.js` `vitalsPoints`, `burnPoints`, `fetchMacroDays`). |
| **Automated decisions with legal or similar effect (Art. 22)** | Probably not | The ratings decide rank and league position, not access to services or money. Ask the solicitor whether rankings shown to minors count as having a "similarly significant" effect (see Questions). |
| **Invisible processing** | Partly | Image screening of profile pictures runs on legitimate interests without a consent step (`LegalPage.jsx` §7). The IP address goes to ipwho.is for weather (`netlify/functions/weather.js`). Both are disclosed in the privacy policy, but users may not expect them. |

**Conclusion (to be confirmed by the solicitor):** a DPIA is very likely
**required**. Health data, a 13+ audience, AI and profiling each count as a
high-risk indicator on their own, and here they come together.
STARTUP_REQUIREMENTS.md item 8 already records it as "likely mandatory".

---

## Step 2: Describe the processing

### 2.1 Nature: how data is collected, used, stored and deleted

**Architecture.** Vantage is a React single-page app. Native iOS and Android
builds are planned through Capacitor (STARTUP_REQUIREMENTS.md Phase 4).

- **Supabase** (Postgres, Auth, Storage, Realtime) holds all server-side
  data. The project is in an EU region, with the exact region to be
  confirmed from the dashboard (`CLAUDE.md`, `LegalPage.jsx` §8). The
  browser talks to Supabase directly with the public anon key. Access is
  limited by row-level security (RLS) and column-level grants
  (`supabase/*.sql`).
- **Netlify** hosts the static app and about 40 serverless functions
  (`netlify/functions/`). These handle anything that crosses users, needs a
  secret, or spends money: AI, the leaderboard, wearable sync, account
  deletion, moderation, push. `netlify.toml` sets no function region.
  Netlify's default region is believed to be in the US. **Confirm this.**
  *(2026-10-20: default for new sites is `cmh`, US East (Ohio); EU/UK
  regions are self-serve on Pro. Steps and the transfer effect:
  `docs/ROPA.md` §2. Records of processing: `docs/ROPA.md`; owner access:
  `docs/ADMIN_ACCESS_POLICY.md`.)*
- **Most user data sits in one JSON document per user**, `user_data.state`,
  called `S` (`CLAUDE.md`). It is saved on a debounce, re-downloaded when the
  app opens and rewritten on save. The food diary, messages, social graph,
  groups and tokens have their own tables.
- **A local copy** of the state is kept in the device's localStorage as a
  backup (`LegalPage.jsx` §13). It is cleared on explicit sign-out or account
  deletion (`src/lib/state/clearLocal.js`, item 56).

**Sources of data**

1. **The user**, typing it in: habits, trackers, food, weight, savings,
   subscriptions, holidays, messages and so on.
2. **WHOOP**, through OAuth: a daily server pull plus a pull when the app
   opens (`netlify/lib/whoop.js`, `netlify/functions/whoop-cron.js`,
   `whoop-sync.js`, `whoop-callback.js`).
3. **Oura**, through OAuth: the same pattern (`netlify/lib/oura.js`,
   `oura-cron.js`, `oura-sync.js`). It does nothing until its keys are set
   (item 30).
4. **Apple Health**, either from a manual export file parsed on the device
   (`src/lib/appleHealth.js`) or from an iOS Shortcut that posts to
   `health-sync` with a per-user token (`netlify/functions/health-sync.js`).
   **Both are owner-only today** and are left out of native builds
   (`src/lib/appleHealth.js` header, item 62). Live HealthKit and Android
   Health Connect are planned (`docs/FEATURES.md`). This DPIA must be
   updated before either ships.
5. **Google / Apple sign-in**: email, name, picture and an identifier
   (`LegalPage.jsx` §9).
6. **RevenueCat, Apple and Google**: subscription status
   (`netlify/functions/revenuecat-webhook.js`, `src/lib/billing/revenuecat.js`).
7. **Other users**: messages, friend requests, reports.
8. **Derived by the app**: ratings, OVR, prestige, streaks, coins, league
   position, AI coach briefs and nudges.

**There is no bank connection.** Savings, subscriptions and expenses are
typed in by hand (`CLAUDE.md`, "Correction worth remembering"). A dormant
table schema exists for a possible future Open Banking link
(`supabase/bank_connections_schema.sql`, marked "FOUNDATION, not yet used").
No client or function code uses it. Open Banking is parked, owner-only, and
"not now" (`CLAUDE.md`). If it is ever built, this DPIA must be redone first.

### 2.2 Data inventory and flow

Abbreviations: **S** = `user_data.state`; **SB** = Supabase (EU); **NF** =
Netlify functions; **cascade** = deleted automatically when the auth user is
deleted (`on delete cascade` to `auth.users`), triggered by
`netlify/functions/delete-account.js`.

| # | Data | Source | Where stored | Who receives it (country) | Retention | Deletion |
|---|---|---|---|---|---|---|
| 1 | Email, password hash, auth identifiers, sessions | Sign-up form; Google / Apple sign-in | SB Auth (`auth.users`) | Supabase (EU hosting; US parent company). Google, Apple (US) as sign-in providers | Life of the account | `delete-account.js` deletes the auth user, and every user table cascades from it |
| 2 | Core app content: habits, trackers and `logs`, achievements, visions, boards, links, notes, holidays (with base64 images), `calendarEvents`, shop wish-list, coins, preferences, `privacy`, `consent`, `profile` | User | **S**, plus the device's localStorage | Supabase; NF read some of it (ratings, prestige, push prefs: `netlify/lib/recompute.js`, `push-dispatch.js`) | Life of the account | Cascade. Local copy cleared on explicit sign-out or delete (`clearLocal.js`) |
| 3 | **Health: vitals** (`vitalsLog`: weight, sleep, rhr, hrv, recovery, strain, steps), **burn** (`burnLog`), body (`bodyLog`, `bodyGoal`), lifts. Legacy **mood** (`moodLog`, feature removed 2026-08 but data kept: `src/lib/widgets/retired.js`) | User; WHOOP; Oura; Apple Health (owner-only) | **S** | Supabase; NF (wearable crons write to it; `recompute.js` counts logged days for the fitness rating). Anthropic gets only tracker series that do not come from a band, with AI consent (§2.4) | Life of the account. Data already synced stays after a wearable is disconnected (`VitalsHistoryCard.jsx`) | Cascade. The user can delete individual entries |
| 4 | **Health: food diary** (`nutrition_log`, `nutrition_macros`, `nutrition_daily_summary`) | User; food search; barcode; AI scan | SB tables (`supabase/nutrition_schema.sql`) | Supabase. Search text or barcode only, with no account details, goes from NF to Open Food Facts (FR), USDA FDC (US) and FatSecret (US) (`LegalPage.jsx` §8) | Life of the account | Cascade |
| 5 | Food photo (one camera frame) | Device camera | **Not stored** (`LegalPage.jsx` §2, §11) | NF → Anthropic (US) (`ai-food-detect.js`) | Gone after the request on our side. Anthropic keeps API data for a limited time under its commercial terms. **Confirm the period, and whether zero data retention is available** | n/a |
| 6 | AI coach snapshot (8 KB or less: first name, tracker names and series, habits, achievements, holidays, shop counts; no wearable data unless `AI_WEARABLE_DATA_ALLOWED=true`) | Built on the device from **S** (`src/lib/coach/snapshot.js`) | Not stored. The **result** goes in `S.coachBrief` and `coachBriefHistory` | NF → Anthropic (US) (`ai-coach-daily.js`) | Snapshot: as row 5. Brief: life of the account | Cascade |
| 7 | Recipe-from-video text (video title and description) | User pastes a link | Result in **S** (`mealVideos`, `recipes`) | NF → YouTube or TikTok page fetch; Anthropic (US) (`recipe-from-video.js`). **Owner-only** (item 45) | Life of the account | Cascade |
| 8 | WHOOP and Oura OAuth tokens | OAuth exchange | SB `whoop_tokens`, `oura_tokens` (RLS on, no policies, service role only: `supabase/whoop_schema.sql`, `oura_schema.sql`) | WHOOP (US), Oura (Finland) | Until the user disconnects or deletes the account | `wearable-disconnect.js` deletes them; cascade on deletion. **The grant is not revoked at the provider** (`delete-account.js` TODO, item 67) |
| 9 | Health-sync token (`S.healthToken`) | Made on the device (192-bit, `getRandomValues`: item 24) | **S** | Sent by the user's iOS Shortcut to NF | Until the user taps "New URL" | Cascade |
| 10 | Profile and social: handle, display name, avatar (stored as a data URL in `profiles.avatar_url` and `user_data.photo`), level, ratings and OVR, prestige, tier, `last_active_at`, search and leaderboard opt-ins, `suspended_at`; `public_stats` (streak, heatmap, wins) | User; server recompute | SB `profiles`, `public_stats` (`supabase/paywall_schema.sql`, `social_schema.sql`, `avatars_schema.sql`) | Friends; group members; global leaderboard if opted in; any signed-in user can read every column of a *searchable* profile (item 83). Avatars are screened by Anthropic (US) before others see them (`avatar-check.js`) | Life of the account | Cascade |
| 11 | Direct messages, reactions, friendships, invites, blocks | Users | SB `messages`, `message_reactions`, `friendships`, `friend_invites`, `blocks` (`supabase/messages_schema.sql`, `dm_upgrade_2026_10.sql`, `social_schema.sql`); delivered over Realtime | The other person in the conversation; Supabase. Not end-to-end encrypted (`LegalPage.jsx` §2) | Until unsent or the account is deleted | Cascade, on **both** sides of a conversation |
| 12 | Groups: name, crest image, members, weekly league scores, coin grants | Users; `settle-leagues` | SB `groups`, `group_members`, `league_weeks`, `coin_grants` (`supabase/groups_schema.sql`, `group_crest_schema.sql`) | Group members; other groups in the division see the group's name, picture and score. Crests screened by Anthropic (US) | Life of the group | If the owner deletes their account, the group passes to the longest-standing member (`delete-account.js`, `netlify/lib/leagues.js`). Membership cascades |
| 13 | Reports: reason, free text, snapshot of the reported handle and name, and up to 10 recent DMs between the two people | Reporting user; DB trigger | SB `reports` (`supabase/audit_schema_2026_10.sql`, `dm_upgrade_2026_10.sql`) | The owner (moderation queue: `netlify/functions/moderation.js`, `security-console.js`) | **Target 12 months** (`docs/ABUSE_HANDLING.md`). **No automatic deletion** | **Kept** when either account is deleted. Only the user link is cleared (`on delete set null`, `audit_schema_2026_10.sql` lines 76–90) |
| 14 | Rating snapshots (daily OVR plus 4 categories) | `snapshot-ratings` cron | SB `rating_snapshots` (`supabase/leaderboard_schema.sql`) | Service role only; used for the "weekly climb" | **Never pruned** (item 96) | Cascade through `profiles` |
| 15 | Subscription status; RevenueCat app user ID (= the Supabase user ID) | Store purchase | SB `profiles.tier`; RevenueCat | RevenueCat (US), Apple, Google | Life of the account | RevenueCat subscriber deleted on account deletion if `REVENUECAT_SECRET_API_KEY` is set (`delete-account.js`). Store subscriptions have to be cancelled in the store |
| 16 | Push tokens; queued notifications (title and body) | Device; DB triggers | SB `push_tokens`, `notifications_queue` (`supabase/push_tokens_schema.sql`, `notifications_schema.sql`) | Firebase Cloud Messaging (Google, US), which also delivers to APNs (Apple). **Not live yet**: there is no Firebase project (item 15) | Queue rows: no pruning found | Cascade |
| 17 | AI coach nudges (title, body, feedback) | NF / client (`src/hooks/useCoachNudges.js`) | SB `coach_nudges` (`supabase/coach_nudges_schema.sql`) | Can be sent as push type `coach-nudge` (`push-dispatch.js`) | No pruning found | Cascade |
| 18 | AI usage counters (per user, per feature, per day) | NF (`netlify/lib/aiQuota.js`) | SB `ai_usage` | n/a | No pruning found | Cascade |
| 19 | Client crash reports: user ID, message, stack trace, URL, user agent | App (`netlify/functions/client-error.js`) | SB `client_errors` | Owner (Security console) | **30 days intended, but nothing deletes them yet** (`audit_schema_2026_10.sql` comment, item 96) | User link cleared on account deletion (`set null`) |
| 20 | Web performance timings (no user ID, no IP) | About 1 in 5 page loads (`netlify/functions/vitals-beacon.js`) | SB `web_vitals` | Owner | Never pruned (item 96) | n/a (anonymous) |
| 21 | "Report a problem" tickets | User (`netlify/functions/support-ticket.js`) | SB `security_tickets` (`supabase/security_console_2026_10.sql`) | Owner | Until dealt with | User link cleared on account deletion (`set null`) |
| 22 | History snapshots of **S**: newest 14 per user, backgrounds and photo removed | `BEFORE UPDATE` trigger (`supabase/user_data_history_schema.sql`) | SB `user_data_history` | Service role only | Rolling, newest 14 | Cascade |
| 23 | Database backups | Supabase | Supabase | Supabase | 7 days of daily backups on the Pro plan. Point-in-time recovery (PITR) **not decided** (item 27, `docs/RESTORE_RUNBOOK.md`) | Expire in rotation. Cannot be selectively erased |
| 24 | IP address | Every request | Not stored by Vantage. Kept in provider logs | Netlify; ipwho.is (approximate city for weather: `weather.js`). The device itself contacts Google Fonts, Google's favicon service, the GitHub API (only with the GitHub widget) and i.ytimg.com (`LegalPage.jsx` §8) | Provider log retention | n/a |
| 25 | Storage files: `recipes/` images; `cv/` (owner-only Career feature) | User upload | Supabase Storage, private buckets (`supabase/recipe_images.sql`, `cv_storage.sql`) | Supabase | Life of the account | Removed after the auth user is deleted, best effort (`delete-account.js` `STORAGE_BUCKETS`) |
| 26 | Food contributions (user-added foods) and reports of them | Users | SB `food_contributions`, `food_contribution_reports` | **All users** (shared database) | Life of the account | Cascade through `profiles` |
| 27 | Data export file | User, Settings → Account | The user's device | The user | The user decides | The user decides (`src/components/settings/DataExportCard.jsx`) |

**Doc-vs-code note.** `CLAUDE.md` refers to Supabase Storage
"`avatars`/backgrounds buckets". The code holds no such buckets. Avatars are
data URLs in database columns (`supabase/avatars_schema.sql`,
`docs/RESTORE_RUNBOOK.md`). Backgrounds are base64 inside **S**
(STARTUP_REQUIREMENTS.md item 25). The only Storage buckets in code are `cv`
and `recipes` (`delete-account.js`). Confirm this against the live project.

### 2.3 Scope

- **Categories of data subject:** account holders aged 13 and over; people
  who appear in another user's messages, reports or friend lists; beta
  testers; the owner.
- **Special category data:** health (rows 3, 4, 5, 6). Possibly
  sensitive by inference: habit names (row 2), such as quitting drinking
  or self-harm recovery, which `src/lib/friends/privacy.js` gives as
  examples. Pictures (row 10) could show health or ethnicity, though the app
  does not process them for that.
- **Volume:** `[expected users at launch / 12 months: owner to estimate]`.
  Each user's state is about 967 kB (item 25), with a target of about 90 kB
  after items 25 and 26. Wearable users add one vitals row per day.
- **Geography:** the service is aimed at the UK. The privacy policy is
  written for the UK and EEA (`LegalPage.jsx` §1). App store distribution
  may reach other countries `[decide which store territories]`.
- **Duration:** ongoing. Records build up over years (daily logs).

### 2.4 Context

- **Relationship with users:** consumers using a free app with an optional
  Pro subscription. They do not owe the company anything.
- **Control:** users choose what to enter. Wearable connections, AI
  features, handle search, leaderboard visibility, friend-card items and
  push are each opt-in or have a toggle (`LegalPage.jsx` §6,
  `src/lib/friends/privacy.js`). Explicit consent for health data and AI is
  asked once on a sheet, and again just in time
  (`src/components/consent/ConsentHost.jsx`, item 66). It can be withdrawn
  in Settings → Privacy → Consent (`src/components/settings/ConsentCard.jsx`).
- **Reasonable expectations:** users of a wellness app expect their health
  data to stay private. They probably do **not** expect:
  - an AI vendor in the US to see a summary of their habits;
  - their "fitness" rating, which partly reflects health logging, to be
    visible to friends and groups (row 10 and Step 1);
  - their profile picture to be sent to an AI service for screening;
  - reports and DM excerpts about them to survive account deletion.
- **Minors:** 13–17 year olds can sign up. The age gate is a self-declared
  checkbox. No date of birth is collected, so the app cannot tell who is
  under 18 and cannot give them different defaults (`AuthScreen.jsx`,
  `TermsAcceptanceSheet.jsx`). Some defaults were changed with minors in
  mind:
  - Handle search and leaderboard are **off** for new accounts
    (`supabase/audit_schema_2026_10.sql` lines 128–129, item 68).
  - The habit streak is opt-in, because it would publish a habit's name
    (`src/lib/friends/privacy.js`).
  - Heatmap, recent wins and online status are still **on** by default
    for friends (`privacyOn` returns true unless set false).
- **Known concerns and past incidents:**
  - **2026-05-03 data-wipe incident (reliability, not confidentiality).**
    A stale service-worker cache kept old builds on clients
    (`public/sw.js` header comment). A read-modify-write of `S` to save a
    push token raced with other saves (`src/lib/push/handlers.js`). As a
    result, at least one real user's state was overwritten with defaults
    on a phone, and a dev preview was also reset
    (`src/hooks/useVisionBoardState.js` history note, `CLAUDE.md`). No data
    was exposed to anyone else. It was a loss of integrity and
    availability. Fixes:
    - push tokens moved to their own table (`supabase/push_tokens_schema.sql`);
    - the loader returns explicit outcomes and will not save defaults when
      unsure, with a "seen before" breadcrumb (`useVisionBoardState.js`);
    - the service worker never caches `index.html` (`public/sw.js`);
    - a database trigger keeps pre-wipe and daily snapshots
      (`supabase/user_data_history_schema.sql`);
    - the anti-wipe check now treats any non-empty collection as real data
      (`src/lib/state/meaningful.js`, item 54);
    - server writes compare-and-set on `updated_at` (`netlify/lib/stateWrite.js`, item 50);
    - "additive writes only" is now a hard rule in `CLAUDE.md`.
  - **Pre-launch security audit (2026-09-30)** found and fixed several
    access-control holes (STARTUP_REQUIREMENTS.md items 18, 32–38): the
    paywall bypass, `profiles` readable by `anon`, blocking not blocking,
    and two views readable with the anon key. Some items are still open
    (items 83, 84, 85, 86). This history is why "unauthorised access
    between users" is rated **probable** before mitigation in Step 5.
  - **Wearable providers' API terms** are reported to limit using their
    data with AI. This is not yet confirmed: the owner has asked both
    providers in writing (`netlify/lib/coachWearableGuard.js` header).
  - **A beta tester flagged** that the export was a plain-text ~1 MB file of
    weight, meals and money (`CLAUDE.md` playtest defect 4). It is now
    encrypted by default (`src/lib/data/exportCrypto.js`).
- **Current state of the art:** RLS, column grants, server-only secrets,
  CSP (report-only), compare-and-set writes, encrypted export, durable AI
  caps (sections below).
- **Organisation:** one owner (sole director at launch), possibly a second
  person later (STARTUP_REQUIREMENTS.md item 2). No staff, and no DPO
  (Step 7).

### 2.5 Purposes

1. Provide the service the user signed up for: store and sync their
   trackers, logs, goals, savings, holidays and calendar across devices.
2. Show the user their own health and fitness trends, with data from
   wearables they choose to connect.
3. Run optional social features: friends, DMs, groups, leaderboard, ratings.
4. Provide optional AI features: daily coach brief, food-photo
   identification, recipe extraction (owner-only).
5. Keep the service safe: screen images, handle reports and blocks,
   suspend or ban, prevent abuse and cheating of rankings.
6. Keep the service secure and reliable: crash reports, security sweep,
   history snapshots for recovery, backups.
7. Manage Pro subscriptions.
8. Send push notifications the user has enabled (not live yet).

For the controller, the benefit is a working product and subscription
revenue. Vantage does **not** use personal data for advertising, does not
sell it, and runs no analytics or ad trackers (`LegalPage.jsx` §2, §8, §13).

---

## Step 3: Consultation

| Who | Why | Done so far | Still to do |
|---|---|---|---|
| **Users (via beta testers)** | Find out what they expect: AI, ratings visibility, minors | A playtest round (2026-08-10) produced named defects, including the export-security point (`CLAUDE.md`). No structured privacy questions were asked | Short structured questions to testers: Do you expect a fitness rating to be visible to friends? Are you comfortable with an AI summary of your habits going to a US provider? What should be off by default for under-18s? Ideally include a parent or guardian of a 13–17 year old |
| **Processors** (Supabase, Netlify, Anthropic, RevenueCat, Google/Firebase) | Confirm DPAs, sub-processors, regions, retention, transfer mechanisms | None recorded. DPAs are item 75, still open | Sign or accept each DPA. Record sub-processor lists, regions and retention (Anthropic API retention especially) |
| **Data sources** (WHOOP, Oura, Apple) | API terms on AI use and multi-user apps | The owner has written to WHOOP and Oura about AI use (`coachWearableGuard.js`). Oura multi-user terms still unchecked (item 30). WHOOP production approval still needed (item 75) | Get written answers and keep them with this DPIA |
| **Solicitor** (standing in for a DPO) | The legal calls listed under "Questions for the solicitor" | Not yet | Review this draft |
| **Security reviewers** | Technical risk | Six parallel code and database reviews plus read-only live database checks on 2026-09-30 (STARTUP_REQUIREMENTS.md Phase 5b). An hourly automated security sweep (`netlify/functions/security-sweep.js`) | An independent penetration test before or soon after launch (optional, recommended) |
| **ICO** | Prior consultation (Art. 36) only if high residual risk remains after measures | Not needed yet | Decide after the solicitor's review (Step 7) |

---

## Step 4: Necessity and proportionality

### 4.1 Lawful basis per purpose (proposed, for the solicitor to confirm)

| Purpose | Data | Art. 6 basis (proposed) | Art. 9 condition | Source / note |
|---|---|---|---|---|
| Account, sync, core features | Rows 1, 2 | 6(1)(b) contract | n/a | `LegalPage.jsx` §4 |
| Health features: wearables, vitals, food diary | Rows 3, 4, 8, 9 | 6(1)(b) contract or 6(1)(a) consent | **9(2)(a) explicit consent** | `src/lib/consent/consent.js`; `LegalPage.jsx` §3 |
| ⚠️ Health data **entered by hand** when health consent was declined | Rows 3, 4 | as above | **Unclear.** The consent sheet only gates *connected sources*. Manual weight and meals are saved either way (`LegalPage.jsx` §3; `VitalsHistoryCard.jsx` comment "starts a new source of it asks for explicit consent") | Solicitor question 1 |
| AI coach, food scan, recipe | Rows 5, 6, 7 | 6(1)(a) consent | 9(2)(a) where health data is included | `consentCopy.js` `ai`; `useDailyBrief.js` waits for `S.consent.ai`; `CameraScanner.jsx` asks before the scan |
| Social: profile, friends, DMs, groups, leaderboard | Rows 10, 11, 12 | 6(1)(b) contract (optional features the user turns on) | ⚠️ The fitness rating partly comes from health data (Step 1). Is it special category once shown to others? | Solicitor question 3 |
| Ratings and OVR | Row 10, 14 | 6(1)(b) or 6(1)(f) | as above | `recompute.js` |
| Image screening (avatars, crests) | Row 10, 12 | 6(1)(f) legitimate interests (safety) | Not intended to process special category data | `LegalPage.jsx` §7; needs a written LIA |
| Moderation, reports, kept evidence | Row 13 | 6(1)(f), possibly 6(1)(c) for Online Safety Act duties | n/a, unless the content reveals it | `docs/ABUSE_HANDLING.md`; needs an LIA |
| Security, crash reports, snapshots, backups | Rows 19–23 | 6(1)(f) | 9(2)(a) covers the health data inside snapshots? | Needs an LIA |
| Subscriptions | Row 15 | 6(1)(b) | n/a | |
| Push notifications | Row 16, 17 | 6(1)(a) consent (OS permission) / PECR | n/a, unless the content is health-related | `LegalPage.jsx` §4 lists push under consent |
| Weather from IP | Row 24 | 6(1)(f) | n/a | `weather.js` |

**Explicit consent mechanics (what exists):**

- Nothing is pre-ticked. Declining still leaves a working app. Consent is
  per kind (`health`, `ai`) with a timestamp. Withdrawal is in Settings
  (`ConsentHost.jsx`, `consent.js`, `ConsentCard.jsx`).
- The text is shared between the sheet and Settings, so the two cannot drift
  apart (`consentCopy.js`).
- Wearable pulls on the device stop if health consent is declined
  (`src/lib/whoopClient.js` line 73, `src/lib/ouraClient.js` line 50).

**Weaknesses found while drafting:**

- **Consent is only enforced in the client.** No Netlify function checks
  `S.consent`:
  - The scheduled `whoop-cron` and `oura-cron` keep syncing for anyone with
    stored tokens after they withdraw health consent, until they also press
    Disconnect. `health-sync` likewise accepts data without checking consent.
  - The AI functions do not check AI consent on the server.
  - The privacy policy and Settings tell users to press Disconnect as well
    (`LegalPage.jsx` §3; `ConsentCard.jsx` line 70). Whether that is enough
    for Art. 7(3) ("as easy to withdraw as to give") is a solicitor
    question. Either way, enforcing it on the server is a gap (G1).
- **The consent record lives in `S`.** That is user-writable state, and it is
  rewritten on every save. There is no separate audit trail to show that
  consent was given (Art. 7(1)). Gap G2.

### 4.2 Data minimisation

**In place**

- **AI coach snapshot:**
  - capped at 8 KB, with strings clipped to 300 characters
    (`ai-coach-daily.js` `SNAPSHOT_MAX_BYTES`, item 45);
  - built on the device with only first name, tracker series, habits and
    achievements, never `vitalsLog` or `burnLog` directly
    (`src/lib/coach/snapshot.js`, `wearableProvenance.js`).
- **Wearable data kept out of AI:**
  - WHOOP and Oura values are stripped on the device
    (`src/lib/coach/wearableProvenance.js`);
  - they are stripped again on the server whatever the client sends
    (`netlify/lib/coachWearableGuard.js`, tested in
    `coachWearableGuard.test.mjs`), unless `AI_WEARABLE_DATA_ALLOWED` is
    exactly `'true'`.
- **AI caps:** per-user daily caps by feature (coach 20, food scan 40,
  recipe 15, crest 10, avatar 10), held in Postgres (`netlify/lib/aiQuota.js`).
  Free food scans are 3 a week, checked on the server (item 97). The coach
  checks the user's tier on the server.
- **Food photos and AI snapshots are not stored** by Vantage
  (`LegalPage.jsx` §11).
- **History snapshots** leave out backgrounds and photos
  (`docs/RESTORE_RUNBOOK.md`).
- **Profile photos** are resized to 512 px and sent only when they change
  (item 59).
- **Web performance timings** are stored without user ID or IP
  (`vitals-beacon.js`).
- **Apple Health** imports only weight, resting heart rate, sleep and steps
  (`src/lib/appleHealth.js`).

**Gaps**

- `moodLog` is kept in existing users' state although the Mood feature was
  removed (`src/lib/widgets/retired.js`). That is mood (health) data with no
  current purpose. Gap G12.
- State is about 967 kB per user. All of it, health data included, is
  re-downloaded on open and rewritten on save (items 25, 26). Each transfer
  is more exposure.
- Any signed-in user can read every column of a searchable profile,
  including `tier`, `ratings` and `last_active_at` (item 83).
- The leaderboard shows category ratings, including **fitness** and
  **finance** (`get-leaderboard.js`). Consider whether only OVR needs to be
  public.

### 4.3 Accuracy

- Users can edit or delete their own entries (`LegalPage.jsx` §14).
- Wearable data comes from the provider's API. If two sources write
  `sleep` or `rhr` for the same day, the band sync overwrites the value,
  and no per-value source is recorded (`wearableProvenance.js` header).
- AI output is labelled "AI-generated · not medical advice"
  (`ai-coach-daily.js` comment, `CoachBriefPanel.jsx`). The coach is told not
  to diagnose, not to prescribe calories or doses, and to suggest a GP if
  the data looks concerning (`ai-coach-daily.js` "Boundaries"). Nutrition
  estimates are labelled as estimates (Terms §6).
- Ratings only count real ISO date keys within the account's age, with caps,
  to stop fabricated history (item 44, `recompute.js`).

### 4.4 Storage limitation (retention)

The policy is to keep data for the life of the account. Exceptions are in
§2.2 rows 13, 14, 17–23. Gaps:

- Nothing deletes old `client_errors`, `rating_snapshots`, `web_vitals`,
  `notifications_queue` or `coach_nudges` rows (item 96).
- Closed reports have a 12-month target but nothing enforces it
  (`docs/ABUSE_HANDLING.md`). The privacy policy says "as long as needed",
  not 12 months (`LegalPage.jsx` §11).
- The privacy policy says deleted accounts are "permanently erased within 30
  days" (`LegalPage.jsx` §11). The database deletion is immediate
  (`delete-account.js`). Supabase daily backups keep data for up to 7 days
  (item 27), and PITR would extend that if enabled. Ask the solicitor
  whether the wording covers backups.
- `docs/ABUSE_HANDLING.md` says a report is deleted when the *reporter*
  deletes their account. Since `audit_schema_2026_10.sql` (lines 84–90),
  the report is **kept** and only `reporter_id` is cleared. The runbook
  table is out of date. Gap G13.

### 4.5 Transparency

- The privacy policy and terms can be opened before sign-in at `/privacy`
  and `/terms` (`src/components/LegalPage.jsx`, item 9). The policy lists
  processors, the services the server contacts, and the services the device
  contacts (§8). It was last updated 2 October 2026.
- **Controller identity and contact are placeholders** (`LegalPage.jsx` §1,
  item 64).
- Not covered, or covered loosely, in the policy:
  - the fitness rating being partly derived from health data;
  - retained `moodLog`;
  - the Netlify function region;
  - the 12-month report retention;
  - consent withdrawal not stopping the server crons until Disconnect is
    pressed (the policy does say to press Disconnect).
- Under-18 users need a child-friendly explanation (Children's Code
  "transparency" standard). None exists yet.

### 4.6 Data subject rights

| Right | How it is met today | Evidence | Gap |
|---|---|---|---|
| Access (Art. 15) | In-app export plus a request to support | `DataExportCard.jsx`, `src/lib/data/accountExport.js` (state, `nutrition_log`, profile, friendships, messages) | There is no written subject-access process (item 72). The export leaves out reports about the user, `coach_nudges`, group data, rating snapshots and `client_errors` |
| Rectification (Art. 16) | Edit in the app | `LegalPage.jsx` §14 | Ratings are derived and cannot be edited, which is fine if the inputs can be |
| Erasure (Art. 17) | Settings → Account → Delete account deletes the auth user, cascades, removes Storage and the RevenueCat subscriber, hands groups over | `delete-account.js`, items 20, 52, 61, 67 | WHOOP and Oura grants are not revoked at the provider (item 67). Reports and DM excerpts are kept (row 13). Backups remain for up to 7 days |
| Portability (Art. 20) | JSON export, encrypted by default (PBKDF2-SHA256 at 600k iterations, AES-GCM 256), plain text available by choice | `exportCrypto.js` | The export contains other people's messages (Art. 20(4)). `a.download` may do nothing in a native WebView (item 67 said so; `DataExportCard.jsx` still uses `a.download`). Verify on a device |
| Withdraw consent (Art. 7(3)) | Settings → Privacy → Consent | `ConsentCard.jsx` | Not enforced on the server (G1) |
| Object / restrict (Arts. 18, 21) | By request | `LegalPage.jsx` §14 | No process written down (item 72) |
| Automated decisions (Art. 22) | n/a, probably (Step 1) | | Solicitor question 4 |

### 4.7 Processors, sources and DPAs

| Party | Role (proposed) | Data | Location | DPA status |
|---|---|---|---|---|
| Supabase | Processor | Everything server-side | EU hosting; US parent company and sub-processors | **Not recorded** (item 75) |
| Netlify | Processor | IP addresses; all function traffic, including health data in transit and in function logs | US (default function region: confirm) | **Not recorded** (item 75) |
| Anthropic | Processor | Coach snapshots, food photos, recipe text, avatar and crest images | US | **Not recorded** (item 75). Retention period and zero-data-retention option to confirm |
| RevenueCat | Processor | User ID, subscription events | US | **Not recorded** (item 75) |
| Google (Firebase Cloud Messaging) | Processor | Push tokens, notification text | US | Not live (item 15). DPA not yet on the checklist: **add it** |
| Apple / Google (stores, sign-in, APNs) | Probably independent controllers for billing and sign-in, processor for APNs | Purchase, sign-in identity | US | Store terms. Confirm roles |
| WHOOP | Source; independent controller | OAuth-authorised health data | US | API terms; production approval (item 75) |
| Oura | Source; independent controller | OAuth-authorised health data | Finland | API terms; multi-user terms unchecked (item 30) |
| ipwho.is | Recipient of IP addresses (role to decide) | IP address | Unknown: **check** | None |
| Open-Meteo, Frankfurter, Open Food Facts, USDA, FatSecret, GNews, Finnhub, YouTube, TikTok, shop sites | Called by the server with no account details | Search text, coordinates, tickers | Various | Probably not processors (no personal data beyond request content). Confirm |
| Google Fonts, Google favicon service, GitHub API, i.ytimg.com | Contacted by the device; they receive IP addresses | IP address, plus a GitHub username if entered | US | None. Consider self-hosting fonts (G16) |

### 4.8 International transfers (flagged for the solicitor; no conclusion drawn)

These processors or recipients are, or may be, outside the UK and EEA:
Anthropic (US), Netlify (US), RevenueCat (US), Google/Firebase (US),
Supabase's US parent and sub-processors (support or ops access), Apple (US),
WHOOP (US, as a source), GitHub and Google Fonts (device-initiated),
ipwho.is (unknown).

Possible mechanisms to assess for each:

- the **UK Extension to the EU–US Data Privacy Framework** ("UK–US data
  bridge"), only if the recipient is certified *with* the UK Extension
  (check the DPF list for each);
- the **UK International Data Transfer Agreement (IDTA)**;
- the **UK Addendum to the EU Standard Contractual Clauses**.

For each restricted transfer the solicitor should advise:

- which mechanism applies;
- whether a transfer risk assessment is needed;
- whether onward transfers by sub-processors are covered.

The privacy policy already says transfers are protected by "UK adequacy
regulations, the UK International Data Transfer Addendum and/or EU Standard
Contractual Clauses" (`LegalPage.jsx` §10). **That has not been checked
against signed contracts** (item 75 is open).

---

## Step 5: Identify and assess risks

These are risks **to individuals**: physical, material or emotional harm,
loss of control, discrimination, embarrassment. The ratings below are
**inherent**, meaning before the measures in Step 6. Scale: likelihood
remote / possible / probable; severity minimal / significant / severe;
overall low / medium / high.

| ID | Risk | Likelihood | Severity | Overall |
|---|---|---|---|---|
| R1 | **Breach of health data.** An attacker or a misconfiguration exposes vitals, food diary, weight history or AI snapshots. Harms: embarrassment, discrimination (employment, insurance), distress | Possible | Severe | **High** |
| R2 | **Unauthorised access between users.** An RLS policy, column grant, view or definer RPC lets one user read or change another's data (this has happened: items 18, 32–36; item 83 still open) | Probable | Severe | **High** |
| R3 | **Data loss or corruption (the "state wipe" class).** A client or server write replaces a user's state with defaults or stale data, and years of logs are lost (2026-05-03 incident) | Probable | Significant | **High** |
| R4 | **AI processing of health data and inaccurate advice.** A summary of a user's habits and health-related trackers goes to a third-party model. The output may be wrong or harmful: diet, weight, mental health | Possible | Significant | **Medium** |
| R5 | **Processor and international transfer risk.** Data processed in the US without a valid transfer mechanism or DPA. A processor retains or misuses data, or suffers a breach | Possible | Significant | **Medium** |
| R6 | **Minors' data and social exposure.** 13–17 year olds' health data, picture, online status and ratings are visible to others. Contact from adults through friend requests and DMs. Defaults are not tailored to age | Possible | Severe | **High** |
| R7 | **Harassment and abuse in DMs and groups.** Bullying, grooming, threats. Reports are only seen when the owner opens the queue (item 79) | Probable | Significant | **High** |
| R8 | **Leaderboard, rating and profiling effects on wellbeing.** Public scores, streaks, coins and leagues push people to over-log or over-train. Calorie and weight features can feed disordered eating, especially in teenagers. A low fitness or finance rating visible to friends causes embarrassment | Possible | Significant | **Medium** (high for minors) |
| R9 | **Over-retention.** Snapshots, crash logs, rating history, reports and DM excerpts, legacy `moodLog`, and backups kept longer than needed or after erasure | Probable | Minimal | **Medium** |
| R10 | **Secrets or key compromise.** A leaked service-role key, JWT secret, Anthropic key, WHOOP/Oura secret, or a top-tier management token (`SUPABASE_ACCESS_TOKEN`, `NETLIFY_AUTH_TOKEN`) gives full database access or deploy rights. The repo is public | Possible | Severe | **High** |
| R11 | **User account takeover.** A reused password, phishing, or a leaked health-sync token (it can travel in a query string: item 24) lets someone read the account or write false health data into it | Possible | Significant | **Medium** |
| R12 | **Inference of sensitive information from habits.** Habit and tracker names ("days sober", "no self-harm") reveal health, addiction or sexuality when shown to friends (streak card), sent to the AI coach, or left in an export or on a shared device | Possible | Significant | **Medium** |
| R13 | **Push notification content on lock screens.** Health-related content (coach nudges, streak warnings) or social content (friend names) visible to others on a locked phone | Possible | Minimal | **Low** (medium if coach nudges carry health content) |
| R14 | **Export file and on-device copies.** An unencrypted export (optional) or the localStorage backup on a shared or handed-down device exposes the whole history | Possible | Significant | **Medium** |
| R15 | **Owner or admin access to user data.** The service role and SQL editor give the owner unrestricted access. The moderation queue shows DMs. There is no audit trail of owner reads, and a future second admin widens this | Possible | Significant | **Medium** |
| R16 | **Processing without a valid Art. 9 condition.** Consent not enforced on the server (crons keep syncing after withdrawal); the consent record cannot be proven; manual health entries saved without explicit consent | Probable | Significant | **High** |

---

## Step 6: Measures to reduce risk

"Planned" items cite the STARTUP_REQUIREMENTS.md item number. **G**-numbers
refer to "Gaps to close before launch" at the end. Residual risk assumes the
planned measures are done. Where launch-blocking items are still open, the
residual risk *today* is closer to the inherent rating.

| Risk | Measures in place (evidence) | Measures planned | Residual risk | Approved? |
|---|---|---|---|---|
| **R1** Health data breach | TLS everywhere. HSTS (`netlify.toml`). RLS on every table. Token tables have RLS with no policies (`whoop_schema.sql`, `oura_schema.sql`). Server secrets only in Netlify env (`docs/INCIDENT_RUNBOOK.md` §4). Security headers, with CSP in **report-only** mode (`netlify.toml`, items 21, 60). Stored-XSS fixes (item 55). SSRF guard (`netlify/lib/ssrfGuard.js`, item 51). Hourly security sweep raising tickets (`security-sweep.js`). Incident runbook with the ICO 72-hour step and a breach log (`docs/INCIDENT_RUNBOOK.md`, item 78). Vulnerability disclosure policy (`SECURITY.md`, item 76). Production dependencies show 0 known vulnerabilities (item 22). Leaked Password Protection on (item 39). Android `allowBackup=false` (item 43) | Enforce CSP (items 21, 60). Netlify WAF / rate-limit rule (item 86). Real `security@` inbox (item 76). Sentry or uptime monitor with PII scrubbing (item 77). Shrink state (items 25, 26). Make the repo private (item 80). Move the trading schemas to their own project (item 69) | **Medium** | `[ ]` |
| **R2** Cross-user access | Column-level grants on `profiles` (items 18, 23). Hotfix for anon views, block logic, DM forgery, definer RPCs (`supabase/security_hotfix_2026_09_30.sql`, items 32–36). Server-side owner checks (`netlify/lib/owner.js`, `admin-set-rating.js`). PR template checklist: RLS, cascade, column grants, `security_invoker`, advisors (`.github/pull_request_template.md`, item 81). Supabase advisors shown in the Security console | Column SELECT grants on `profiles` (item 83). Move handle, name and avatar writes server-side (item 84). Change keys before legacy keys retire (item 85). Run advisors after every SQL file (item 81) | **Medium** | `[ ]` |
| **R3** Data loss / wipe | Loader with explicit outcomes and a "seen before" breadcrumb (`useVisionBoardState.js`). Anti-wipe check covering all collections (`src/lib/state/meaningful.js`, item 54; SQL `vb_state_meaningful`). Pre-wipe and daily snapshots, newest 14 (`user_data_history_schema.sql`). Compare-and-set server writes (`netlify/lib/stateWrite.js`, item 50). Push tokens moved out of state (`push_tokens_schema.sql`). Service worker never caches HTML (`public/sw.js`). Additive-writes rule (`CLAUDE.md`). Restore runbook (`docs/RESTORE_RUNBOOK.md`). Supabase daily backups, 7 days | Decide on PITR (item 27). Run the first restore drill, then quarterly (item 82). Move daily logs into tables (item 26) | **Medium** | `[ ]` |
| **R4** AI and health data / bad advice | Separate explicit AI consent before any AI call. The coach waits for consent (`useDailyBrief.js`, `CameraScanner.jsx`, item 66). Wearable data stripped on the device and the server (`wearableProvenance.js`, `coachWearableGuard.js`). 8 KB snapshot cap. Durable daily caps (`aiQuota.js`, item 45). Server tier check. The system prompt forbids diagnosis and dose or calorie prescriptions and points to a GP (`ai-coach-daily.js`). "Not medical advice" label. Terms §6 disclaimer. Photos and snapshots not stored | Spend limit in the Anthropic console (item 45). Confirm Anthropic retention and decide on zero data retention (G6). Enforce AI consent on the server (G1). Keep `AI_WEARABLE_DATA_ALLOWED` unset until both providers agree in writing. Test the coach's behaviour with eating-disorder and self-harm style inputs (G15) | **Medium** (likelihood stays "possible") | `[ ]` |
| **R5** Processors / transfers | EU database hosting. Processors listed in the privacy policy (`LegalPage.jsx` §8, §10). Function-side calls send no account details to search, weather and news APIs | DPAs with Anthropic, RevenueCat, Netlify, Supabase, plus Google/Firebase (item 75 + G7). Check the transfer mechanism and any transfer risk assessment per processor (solicitor). Confirm the Netlify function region. Replace or justify ipwho.is (items 64, 95). Self-host Google Fonts (G16) | **Low–Medium** once contracts are in place | `[ ]` |
| **R6** Minors | 13+ checkbox on email and OAuth sign-up (`AuthScreen.jsx`, `TermsAcceptanceSheet.jsx`, item 42). Search and leaderboard off by default for new accounts (`audit_schema_2026_10.sql`, item 68). Habit streak opt-in (`src/lib/friends/privacy.js`). Health data never shown to others (`LegalPage.jsx` §3). DMs only between accepted friends (`LegalPage.jsx` §2). Block and report (items 34, 63). Message and friend-request throttles (item 63) | Children's Code conformance review and a decision on age assurance (G9). Under-18 defaults: friend-card items off, profiling off, possibly no DMs with adults. Online Safety Act children's access and risk assessments (item 71). Child-friendly privacy notice | **High → Medium** depending on the solicitor's answers and age-tailored defaults. **The most likely trigger for Art. 36 prior consultation if left unresolved** | `[ ]` |
| **R7** Harassment / abuse | Report from friend card, DM, leaderboard and group rows. Block that works (item 34). Owner moderation queue with suspend and ban (`moderation.js`, `security-console.js`). Evidence kept after deletion. Name filter (`netlify/lib/nameFilter.js`). Avatar and crest screening (`imageModeration.js`, `avatar-check.js`). DMs cannot be forged (item 35). Escalation routes for CSAM, CEOP, 999 (`docs/ABUSE_HANDLING.md`) | Alert the owner when a report arrives (item 79). Bind the name filter and avatar screening on the server (item 84). Online Safety Act illegal-content risk assessment and a complaints route (item 71). Public support address (item 72) | **Medium** | `[ ]` |
| **R8** Wellbeing / profiling | Leaderboard opt-in for new accounts. Ratings reward consistency, not size, with per-day caps (`recompute.js`). Coach boundaries against extreme restriction and over-training (`ai-coach-daily.js`). Health disclaimer (Terms §6) | Decide whether category ratings (fitness, finance) should be public at all (G10). Consider hiding calorie targets and body-goal features, or showing support resources, for under-18s (G9). Review streak, coin and league nudges against the Children's Code "nudge techniques" standard | **Medium** | `[ ]` |
| **R9** Over-retention | Snapshots capped at 14 and cascade on deletion. Everything user-scoped cascades (item 20 rule). `client_errors` user link cleared on deletion | Scheduled monthly pruning of `client_errors`, `rating_snapshots`, `web_vitals`, sent `notifications_queue` and old `coach_nudges` (item 96 + G11). Automatic 12-month deletion of closed reports, matching the policy text (G13). Decide what happens to legacy `moodLog` (G12). Make the "within 30 days" wording match backups and PITR | **Low** | `[ ]` |
| **R10** Secrets / keys | Secrets inventory and rotation steps (`docs/INCIDENT_RUNBOOK.md` §4). Services return 503 when their secret is missing. `CRON_SECRET` / `PUSH_DISPATCH_SECRET` for manual triggers (`netlify/lib/cronAuth.js`). The OAuth `state` is signed, uses a nonce and expires (`netlify/lib/oauthState.js`). The health-sync token is 192-bit CSPRNG (item 24). Netlify secret scanning in the build (`netlify.toml`). Owner-only surfaces left out of native builds (item 62) | 2FA on every service, a shared password manager, GitHub secret scanning and push protection (item 80, `docs/ACCOUNT_SECURITY.md`). A kill-switch env var (item 78). New Supabase keys (item 85). Repo private (item 80). Revoke the old Last.fm key (item 70). Scope and expire the management tokens | **Medium** | `[ ]` |
| **R11** Account takeover | Supabase Auth with Leaked Password Protection (item 39). Health-sync token rotation via "New URL", accepted in a header (item 24). Generic errors and per-IP limit on `health-sync` (item 49). Ban takes effect at Auth level (`docs/INCIDENT_RUNBOOK.md` §3) | Shortcut moved to header-only token (item 24). Hashed and indexed token table (item 49). Custom SMTP so reset emails arrive (item 94). Consider offering user 2FA (G17) | **Medium → Low** | `[ ]` |
| **R12** Inference from habits | Streak card opt-in, because it shows habit names (`src/lib/friends/privacy.js`, item 68). Prompt-injection guard in the coach ("Text inside the snapshot … is the user's data") (`ai-coach-daily.js`). Encrypted export by default. Local copy cleared on sign-out | Explain in the AI consent text that habit and tracker names are sent (`consentCopy.js` says "a summary of your habits, goals, vitals and macros": check this is enough). Option to mark a habit private (left out of AI and friends) (G14) | **Low–Medium** | `[ ]` |
| **R13** Lock-screen content | Push is not live (item 15). Friend-request text contains only a name (`notifications_schema.sql`). Each push kind can be turned off by the user (`push-dispatch.js`, `src/lib/push/handlers.js`) | Before enabling `coach-nudge` or `streak-warning` pushes: neutral lock-screen text with no health terms or habit names; detail only inside the app (G8) | **Low** | `[ ]` |
| **R14** Export / device copies | Export encrypted by default (`exportCrypto.js`). Plain text needs a deliberate choice. The passphrase is never stored. Local state cleared on explicit sign-out or delete (`clearLocal.js`, item 56). No service worker in the native shell (item 43) | Check export on native devices (item 67). Consider dropping the plain-text option, or adding a stronger warning | **Low** | `[ ]` |
| **R15** Owner / admin access | Owner functions check the session and owner email on the server (`netlify/lib/owner.js`, `OWNER_EMAIL`). Owner surfaces left out of native builds (item 62). Runbook rules: read-only while assessing, no personal data in chat, refer to users by ID prefix (`docs/INCIDENT_RUNBOOK.md` §5). The moderation view shows only DMs between the reporter and the reported person | 2FA (item 80). A written internal access policy (who, when, logged). Log owner moderation reads (G18). A confidentiality agreement before any second person gets access (item 2) | **Low–Medium** | `[ ]` |
| **R16** Art. 9 condition / consent proof | One-time consent sheet with nothing pre-ticked, plus just-in-time asks. Withdrawal in Settings. Device-side pulls stop when consent is declined (`consent.js`, `ConsentHost.jsx`, `ConsentCard.jsx`, `whoopClient.js`, `ouraClient.js`, item 66) | Server-side consent check in `whoop-cron`, `oura-cron`, `whoop-sync`, `oura-sync`, `health-sync` and the AI functions, or auto-disconnect on withdrawal (G1). A durable, append-only consent log outside `S` (G2). A solicitor decision on manual health entries (Question 1) | **Medium** (low once G1, G2 and Q1 are resolved) | `[ ]` |

---

## Step 7: Sign-off and outcomes

| Item | Name / date | Notes |
|---|---|---|
| Measures approved by | `[ ]` | Put the measures into the project plan with dates and owners |
| Residual risks approved by | `[ ]` | If any residual **high** risk remains (most likely R6), consult the ICO before processing (Art. 36) |
| DPO advice provided | `[ ]` | See below |
| Summary of DPO / solicitor advice | `[ ]` | |
| DPO / solicitor advice accepted or overruled by | `[ ]` | If overruled, say why |
| Consultation responses reviewed by | `[ ]` | Beta-tester answers (Step 3) |
| This DPIA will be kept under review by | `[ ]` | **Review triggers:** before the first native store release; before HealthKit or Health Connect; before setting `AI_WEARABLE_DATA_ALLOWED=true`; before enabling push; before any Open Banking work; when user numbers pass `[N]`; after any SEV1 incident; and at least once a year |

**DPO.** Art. 37(1)(c) requires a DPO where a controller's *core activities*
involve *large-scale* processing of special category data. A small startup
at launch probably does not meet "large scale". But health data is close to
the core of what Vantage does, and "large scale" has no fixed number. That
makes it a judgement for the solicitor, not something the owner can decide
alone (Question 8). Until then, the solicitor review stands in for DPO
advice.

---

## Questions for the solicitor

1. **Manual health entries.** The consent sheet gates *connected* health
   sources only. Weight, meals and so on typed by a user who declined health
   consent are still stored (`LegalPage.jsx` §3). Is a user deliberately
   entering their own data a sufficient Art. 9 condition? Or must storing
   any health data depend on explicit consent? Is a food diary health data
   in itself?
2. **Withdrawal mechanics.** Withdrawing consent stops device-side pulls,
   but the scheduled server sync continues until Disconnect is pressed.
   Does that meet Art. 7(3)? Does withdrawal require deleting data already
   collected, or only stopping new collection?
3. **Ratings from health data.** The fitness rating is partly computed from
   health logging, wearable burn and days on the calorie goal, and is shown
   to friends, groups and the leaderboard. Is that special category data? If
   so, which condition covers showing it? Should category ratings be
   private?
4. **Profiling and Art. 22.** Do the OVR, ratings and league placements
   count as profiling with "similarly significant effects", especially for
   13–17 year olds? Does the Children's Code require profiling to be off by
   default for children?
5. **Children.** Is a self-declared 13+ checkbox enough age assurance under
   the Children's Code, given the health, social and DM features? Should
   13–17s get different defaults, or be excluded from some features (DMs
   with adults, calorie and body-goal tools, the global leaderboard)? Can a
   13–17 year old give valid *explicit* consent under Art. 9, given that the
   UK age for ISS consent under Art. 8 / DPA 2018 s.9 is 13?
6. **Who is the controller today?** The company does not exist yet. Beta
   users' data is being processed now. Is the owner personally the
   controller until incorporation? What notice, and what transfer step,
   moves controllership to the company? Should the ICO fee (item 7) be paid
   now?
7. **International transfers.** For each of Anthropic, Netlify, RevenueCat,
   Google/Firebase, Supabase's US entities, Apple and ipwho.is: which
   mechanism applies (UK–US data bridge if certified with the UK Extension,
   IDTA, or the UK Addendum to SCCs)? Is a transfer risk assessment needed?
   Is the statement in `LegalPage.jsx` §10 accurate?
8. **DPO.** Is a DPO mandatory now, or at what scale would it become so?
9. **Keeping evidence after erasure.** Reports, with snapshots and up to 10
   DMs, are kept after both accounts are deleted. Is 12 months on legitimate
   interests (or a legal obligation under the Online Safety Act) defensible?
   How should an erasure request that touches a report be answered?
10. **Backups and "within 30 days".** Is it acceptable that deleted data
    remains in 7-day backups (and in PITR, if enabled)? Does the privacy
    policy wording need to change?
11. **Anthropic retention.** Do health-adjacent AI inputs need zero data
    retention, or is the standard API retention acceptable if disclosed? Is
    "we do not store the photo or the summary" misleading if Anthropic keeps
    it for a period?
12. **Image screening.** Profile pictures are sent to an AI service on
    legitimate interests with no opt-out other than not uploading one. Is
    that proportionate? Does it raise any biometric or special category
    issue?
13. **Legitimate interests assessments.** Which processing needs a written
    LIA: crash reports with user ID and user agent, moderation, image
    screening, weather IP lookup, security logs? Will the solicitor provide
    a template?
14. **Records of processing (Art. 30).** Is the small-organisation exemption
    unavailable because special category data is processed? Should a ROPA be
    kept alongside this DPIA?
15. **Wearable provider terms.** If WHOOP or Oura terms restrict AI use,
    does using WHOOP and Oura data in *ratings* (`burnPoints`) also breach
    them? Is that a data protection issue or only a contract issue?
16. **Prior consultation.** If R6 (minors) or R16 (consent) stays high after
    the agreed measures, does Art. 36 require consulting the ICO before the
    public launch?
17. **Adjacent regulation (outside the DPIA, but related).** Does the AI
    coach or the food estimation risk being treated as software as a medical
    device (MHRA)? Which Online Safety Act duties apply at launch (item 71),
    including the duty to report CSEA content to the NCA?
18. **Data (Use and Access) Act 2025.** Do any commenced provisions change
    the lawful bases, legitimate-interest options or DPIA requirements
    relied on here?

---

## Gaps to close before launch

**Bold** = likely to block a lawful launch. Items marked *(new)* are not on
STARTUP_REQUIREMENTS.md yet. Suggest adding them.

| # | Gap | Maps to |
|---|---|---|
| G1 | **Enforce consent on the server.** `whoop-cron`, `oura-cron`, `whoop-sync`, `oura-sync` and `health-sync` should skip users whose `S.consent.health` is not granted, or withdrawal should trigger `wearable-disconnect`. The AI functions should refuse without AI consent. A read of a single JSON path keeps database load low | *(new)*, extends item 66 |
| G2 | **Durable consent record.** An append-only table (user, kind, granted or withdrawn, timestamp, copy version) with `on delete cascade`, written alongside `S.consent` | *(new)*, item 66 |
| G3 | **Controller identity, contact and security inbox** in the privacy policy, `SECURITY.md` and `security.txt` | Items 1, 64, 72, 76 |
| G4 | **ICO fee** paid | Item 7 |
| G5 | **DPAs and transfer mechanisms** for Supabase, Netlify, Anthropic, RevenueCat and Google/Firebase. Record sub-processors and regions. Confirm the Netlify function region | Item 75 (add Firebase) |
| G6 | Confirm Anthropic API retention. Decide on zero data retention. Make the privacy policy and consent text match | Items 64, 45 |
| G7 | WHOOP production approval and Oura multi-user terms, in writing. Keep `AI_WEARABLE_DATA_ALLOWED` unset until both providers agree | Items 30, 75; `coachWearableGuard.js` |
| G8 | Lock-screen-safe push text before push goes live, especially `coach-nudge` | *(new)*, item 15 |
| G9 | **Children's Code conformance review.** Age-assurance decision. Under-18 defaults (friend-card items, profiling, DMs, calorie and body-goal tools). Child-friendly privacy notice. Online Safety Act children's access and risk assessments | Items 68, 71 |
| G10 | Decide whether category ratings (fitness, finance) are visible to others. Disclose that the fitness rating draws on health logging | *(new)*, `get-leaderboard.js`, item 83 |
| G11 | Scheduled retention pruning: `client_errors` (30 days), `rating_snapshots`, `web_vitals`, sent `notifications_queue`, old `coach_nudges` | Item 96 (extend to the last two) |
| G12 | Decide on legacy `moodLog`: tell users and offer deletion, or remove it with a data-safe, additive-first approach that respects the `CLAUDE.md` data-safety rule | *(new)* |
| G13 | Automatic 12-month deletion of closed reports. State it in the privacy policy. Fix the stale reporter-cascade line in `docs/ABUSE_HANDLING.md` | Item 79 / *(new)* |
| G14 | Option to keep a habit private (left out of AI and friend surfaces) | *(new)*, item 68 |
| G15 | Test the AI coach with eating-disorder, self-harm and relapse style inputs. Record the results | *(new)*, item 45 |
| G16 | Self-host fonts so the device does not contact Google Fonts | *(new)*, item 64 |
| G17 | Consider offering user 2FA. Custom SMTP so resets and confirmations are reliable | Item 94 / *(new)* |
| G18 | Written internal access policy for owner and admin access. Log moderation reads | *(new)*, items 78, 80 |
| G19 | **Close the open security items** that bear on R1, R2 and R10: `profiles` column grants (83), server-side profile writes (84), new Supabase keys (85), Netlify rate limiting (86), header-only health token plus hashed token table (24, 49), CSP enforcement (21, 60), kill switch (78), 2FA on every service and a private repo (80), trading schemas moved out (69) | Items 21, 24, 49, 60, 69, 78, 80, 83–86 |
| G20 | **Recovery:** decide on PITR and run the first restore drill | Items 27, 82 |
| G21 | Report alerting so the 24-hour moderation target does not rely on a daily manual check | Item 79 |
| G22 | Revoke WHOOP and Oura grants on account deletion once the providers document an endpoint. Verify export works in the native shell | Item 67 |
| G23 | Written subject-access, objection and restriction process. Public support URL and email | Item 72 |
| G24 | Store privacy labels and the Play Data safety form must match this inventory | Items 10, 74 |
| G25 | Records of processing (Art. 30) and legitimate interests assessments, if the solicitor confirms they are needed | *(new)* |
| G26 | Update this DPIA before HealthKit or Health Connect, push, `AI_WEARABLE_DATA_ALLOWED=true`, or any Open Banking work | *(new)* |

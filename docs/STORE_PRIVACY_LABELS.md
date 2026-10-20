# Store privacy labels — App Store "App Privacy" and Google Play "Data safety"

**Summary.** This is the draft answer sheet for both store privacy forms. It is
built from what the code does, not from what the privacy policy says. It covers
the **native build** only (`npm run cap:*`, which sets `VITE_NATIVE_BUILD=true`).
Owner-only surfaces are compiled out of that build. They are listed in Appendix A
so nobody is surprised, but they do not appear on the labels. In short: Vantage
stores a lot about the person — health, fitness, food, money, messages, photos
and social data — all in Supabase (EU) and all linked to their account. It uses
no advertising or analytics SDK, reads no advertising ID and does no tracking. It
shares nothing with anyone in the stores' sense. Every outside party is a
processor working for us, or receives an anonymous request. Before submitting,
fix the items in section 4. Several of them would make the label contradict the
privacy policy, or the app contradict the label.

**Last verified against commit `0aadc1b`** (2026-10-20). Re-check this sheet
whenever a new Supabase table, state key, Netlify function or SDK ships.

**Sources.**
- Apple's definitions were fetched from
  <https://developer.apple.com/app-store/app-privacy-details/> on 2026-10-20.
  The data type names and purpose names below are copied from it exactly.
- Google's help page (answer/10787469) **could not be fetched**. This
  environment blocks support.google.com. The Google category names, definitions
  and exemptions below come from my own knowledge of the form. Check each name
  against the live Play Console form while filling it in.
- RevenueCat's own App Privacy and Data safety guidance pages were also
  unreachable. The RevenueCat rows are written from the SDK calls in our code
  plus my knowledge of their docs. Check them against RevenueCat's page.

---

## 0. Definitions this sheet relies on

- **Apple "collect"** — "transmitting data off the device in a way that allows
  you and/or your third-party partners to access it for a period longer than
  what is necessary to service the transmitted request in real time." Data
  that stays on the device (localStorage, the local state backup, an export
  file) is **not** collected.
- **Apple "linked"** — linked unless it is de-identified *before* collection
  and never re-linked. Everything in `user_data.state` and in the user-keyed
  tables is linked.
- **Apple "tracking"** — combining our data with other companies' data for
  targeted ads or ad measurement, or sharing it with a data broker. We do
  neither.
- **Google "collected"** — sent off the device. Data processed *ephemerally*
  (only in memory, only for that request) is still declared as collected, but
  can be marked "processed ephemerally". *(From knowledge; verify.)*
- **Google "shared"** — sent to a third party. The exemptions are: a service
  provider processing it for us; a transfer the user starts and expects (e.g.
  a social feature); legal reasons; and fully anonymised data. *(From
  knowledge; verify.)*

---

## 1. Apple — App Privacy

### 1.1 Data types that ARE collected

Unless a row says otherwise: **Used for tracking: No.** There is no ad SDK, no
IDFA, no ATT prompt and no data broker (see 1.3).

#### Contact Info

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Name** | Profile name (`S.profile.name`). Public display name (`profiles.display_name`). The name Google or Apple sign-in hands to Supabase Auth. | `src/components/settings/AccountPanel.jsx`, `src/lib/friends/usePublishProfile.js`, `src/components/AuthScreen.jsx` | Yes. Stored on the account. | No | App Functionality |
| **Email Address** | Supabase Auth login email. Also the **AI Coach waitlist** email, typed into a form and stored in `waitlist` (see M2). | `src/components/AuthScreen.jsx`, `src/components/Modals.jsx:1866-1945` | Yes. It is the account key, and `waitlist.user_id` links it too. | No | App Functionality. **Also Developer's Advertising or Marketing while the waitlist exists.** The form's promise is "be the first to know when AI Coach launches", which is a marketing message. Remove the waitlist to drop this purpose (M2, Q1). |

#### Health & Fitness

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Health** | `S.vitalsLog`: weight, sleep, resting HR, HRV, recovery/readiness. Entered by hand or synced from WHOOP or Oura. Food log in `nutrition_log`, `nutrition_macros` and `nutrition_daily_summary`. `S.macroHistory`. `S.bodyLog` body measurements and `S.bodyGoal`. `S.burnProfile` (age, sex, height, for the calorie estimate). "Quit" habits with relapse history (`S.habits`). Legacy `S.moodLog` entries still held for older accounts. | `src/hooks/useNutrition.js`, `src/lib/burn.js`, `netlify/lib/whoop.js` (`mapWhoop`), `netlify/lib/oura.js` (`mapOura`), `src/lib/widgets/retired.js` | Yes | No | App Functionality; Product Personalization (the on-device coach heuristics read `vitalsLog`, `macroHistory` and `bodyGoal`: `src/lib/coach/heuristics.js`) |
| **Fitness** | `S.burnLog`: workouts, steps, calories burned and strain, from WHOOP, Oura or the manual activity log. Fitness trackers and their daily logs. Fitness self-check score. Training programme progress. | `netlify/lib/whoop.js:276-283`, `netlify/lib/oura.js:201-208`, `src/lib/trackers/autoLog.js`, `src/components/FitnessCheck.jsx` | Yes | No | App Functionality; Product Personalization |

#### Financial Info

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Other Financial Info** | Savings pots, contributions and balances (`savings`, `savingsAccounts` with bank name and interest rate, `savingsHistory`). Monthly cash flow, income and expenses (`FlowEditor`, `planLedger`). Subscriptions the user pays for, with cost and renewal date (`subscriptions`). Wish-list prices (`shopItems`). Finance self-check score. All typed in by hand. There is **no** bank link. | `src/components/savings/FlowEditor.jsx`, `src/lib/savings/derive.js`, `src/lib/money/recurring.js`, `src/components/FinanceCheck.jsx` | Yes | No | App Functionality; Product Personalization (the heuristic brief reads `S.savings`) |

*Payment Info is **not** collected. Purchases go through Apple or Google
billing, and we never see card details. Apple says that is not collection.*

#### Location

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Coarse Location** | The weather chip. It is on by default and can be switched off (`S.weatherEnabled`). Our `weather` function sends the caller's **IP address** to ipwho.is, gets a city-level lat/lon back, rounds it to about 11 km and asks Open-Meteo for the weather. Vantage does not store the location against the account. It sits only in an anonymous per-instance cache keyed by the rounded coordinates, and in the device's localStorage for 30 minutes. | `netlify/functions/weather.js:37-87`, `src/hooks/useWeather.js` | **No.** No user id is involved. The function never reads the session. | No | App Functionality |

*Why declare it at all: strictly, we do not keep it beyond the request. But
ipwho.is is a third party whose retention of the IP and lookup we do not
control, and Apple counts "third-party partners". Declaring it as Not Linked
is the safer answer. If the owner switches to Netlify's built-in geo header
(Q3), the third party goes away, and this row can be dropped with a clear
conscience.*

*No precise location is collected. Nothing calls `navigator.geolocation`
(grep of `src/` and `netlify/`). Holiday destinations and visited countries
are typed-in user content, not device location (see Other User Content).*

#### Contacts

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Contacts** | The in-app social graph: friends (`friendships`), blocks (`blocks`), friend invites (`friend_invites`) and group memberships (`group_members`). Vantage **never** reads the phone's address book. | `src/lib/friends/queries.js`, `src/lib/friends/invites.js`, `netlify/functions/groups.js` | Yes | No | App Functionality |

*Apple defines Contacts as "a list of contacts in the user's phone, address
book, **or social graph**". The friend list is a social graph, so declaring it
is the safe reading (Q2).*

#### User Content

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Emails or Text Messages** | Direct messages between friends (`messages`, with `reply_to`). Message reactions (`message_reactions`). | `src/lib/friends/messages.js`, `supabase/dm_upgrade_2026_10.sql` | Yes | No | App Functionality |
| **Photos or Videos** | Profile photo: a data URL in `S.profile.photo`, plus a 96 px copy in `profiles.avatar_url` once it passes screening. Section background images (data URLs in `S.backgrounds`). Group crest images (`groups.crest_image`). The **food-scan camera frame** sent to Anthropic. We do not store it, but Anthropic keeps API inputs for a limited period (M7). The 96 px avatar and the crest are also sent to Anthropic for screening. | `src/components/HubSection.jsx:568`, `src/App.jsx:750`, `src/components/groups/GroupCrest.jsx`, `src/components/CameraScanner.jsx:349-363`, `netlify/functions/avatar-check.js`, `netlify/lib/imageModeration.js` | Yes | No | App Functionality (screening falls under "implement security measures") |
| **Gameplay Content** | Coins and coin history, levels and Visions, the four ratings plus OVR, prestige, group leagues and weekly climbs (`profiles.ratings`, `rating_snapshots`, `league_weeks`, `coin_grants`). Other users see these on friend cards, boards and the leaderboard. | `netlify/functions/recompute-ratings.js`, `snapshot-ratings.js`, `settle-leagues.js`, `prestige-up.js` | Yes | No | App Functionality |
| **Customer Support** | Settings → Account → Report a problem. Stores the title, the text the user typed, the category, the page path, the build id and `reporter_id` in `security_tickets`. | `src/components/settings/SupportCard.jsx`, `netlify/functions/support-ticket.js` | Yes | No | App Functionality |
| **Other User Content** | Everything else the user makes. The achievement board, trackers and daily logs (`logs`, `logsAuto`), habits, links, shop wish list, holidays, visited countries and travel policy, calendar events and spans, hub widget setup, group names, reports and their notes (plus a snapshot of the reported messages), **community foods** (`food_contributions`, opt-in), coach feedback, saved AI briefs (`coachBriefHistory`), consent and terms-acceptance records. Also up to 14 daily snapshots in `user_data_history`. | `src/data/initialState.js`, `src/lib/friends/queries.js:346-373`, `src/components/diet/LogFoodPanel.jsx:383`, `src/components/FoodLogSheet.jsx:144`, `src/hooks/useCoachNudges.js` | Yes | No | App Functionality; Product Personalization (the coach reads habits, trackers, achievements, holidays and the wish list) |

*Why not use Apple's optional-disclosure exemption for Customer Support: it
needs the user's name or account name to be prominently shown in the form. The
Report-a-problem card does not show it. Declare it.*

#### Search History

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Search History** | Food search text and scanned barcode numbers. Our `food-search` function forwards them to Open Food Facts, USDA and FatSecret. News topics go to GNews through `news-today`. Vantage does not store queries, and the outgoing request carries no user identifier. | `src/lib/diet/foodSearch.js`, `netlify/functions/food-search.js`, `netlify/lib/foodSources.js`, `netlify/functions/news-today.js:87` | **No** | No | App Functionality |

*Borderline. The queries are not stored by us. They reach the providers from
our server's IP with no user id. Declaring "Not Linked" is the conservative
answer, because those providers may keep request logs. Dropping the row is
defensible too.*

#### Identifiers

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **User ID** | The Supabase user id. The `@handle`. The RevenueCat app user id, which **is** the Supabase id (`Purchases.configure({ appUserID: userId })`). Friend invite codes. | `src/lib/billing/revenuecat.js:85,240`, `supabase/social_schema.sql` | Yes | No | App Functionality |
| **Device ID** | The push token in `push_tokens` (token, platform, last seen), delivered through Firebase Cloud Messaging. | `src/lib/push/handlers.js:38-56`, `netlify/functions/push-dispatch.js` | Yes | No | App Functionality |

*Apple's example for Device ID is the advertising identifier, which we never
read. A push token is a per-install device-level id, though, and declaring it
is the common, safe reading. RevenueCat reads no IDFA unless
`collectDeviceIdentifiers()` is called, and our code never calls it.*

#### Purchases

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Purchase History** | The RevenueCat subscriber record: receipts and transactions, the entitlement and its expiry, linked to the Supabase user id. `profiles.tier`, written by the RevenueCat webhook. The user's own typed-in list of subscriptions and spending (also listed under Other Financial Info). | `src/lib/billing/revenuecat.js`, `netlify/functions/revenuecat-webhook.js`, `netlify/functions/delete-account.js:128` | Yes | No | App Functionality. **Add Analytics** if anyone reads RevenueCat's charts and cohorts to judge buying behaviour (Q4). Safer to tick it. |

*This contradicts the privacy policy's "We do not collect … purchase history"
(M1).*

#### Usage Data

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Product Interaction** | The `profiles.last_active_at` presence heartbeat (when Online status is on). The `public_stats.heatmap_days` grid of days the user logged anything (when the heatmap is shared). `ai_usage` rows: per-user, per-feature daily counts of AI calls, used for the free allowance and abuse caps. `S.coachMemory`: how often each coach insight was shown, dismissed or acted on. Coach-nudge dismiss and act timestamps. `tutorialCompleted`. Notification preferences. | `src/lib/friends/usePublishProfile.js:160-162`, `netlify/lib/aiQuota.js`, `netlify/lib/freeAllowance.js:74-90`, `src/components/AiCoachWidget.jsx:130-150` | Yes | No | App Functionality; Product Personalization (coach cooldowns use it) |

#### Diagnostics

| Apple data type | What it is in Vantage | Source | Linked? | Tracking? | Purposes |
|---|---|---|---|---|---|
| **Crash Data** | The `client_errors` table: the error kind, message and stack. Sent from the native app too, because `reportError` goes through `authFetch` → `apiUrl`, which uses the absolute site URL in the native shell. | `src/lib/telemetry/reportError.js`, `netlify/functions/client-error.js`, `supabase/audit_schema_2026_10.sql:48-63` | Yes. `user_id` is filled from the session when signed in (`on delete set null`). | No | App Functionality |
| **Other Diagnostic Data** | The same rows also hold the user agent, the build id (hashed bundle name) and the page path, with query strings stripped. | same | Yes | No | App Functionality |

*Performance Data is **not** collected in the native build. The web-vitals
beacon only installs on the web: `src/lib/telemetry/webVitals.js:88` checks
`!isNativeApp()`. CSP reports also never come from native: the Netlify headers
do not apply to bundled `capacitor://` assets.*

### 1.2 Apple data types NOT collected (tick "not collected")

- Phone Number — never asked for.
- Physical Address — never asked for.
- Other User Contact Info — none.
- Payment Info — Apple and Google billing handle it. We never see it.
- Credit Info — none.
- Precise Location — no geolocation API anywhere.
- Sensitive Info — none of Apple's listed categories. Health data is declared
  under Health instead.
- Audio Data — no microphone use.
- Browsing History — none. Pasted shop and video links are user content.
- Advertising Data — no ads.
- Other Usage Data — nothing beyond Product Interaction.
- Performance Data — web build only (see above).
- Environment Scanning — the food frame is a photo, not AR or scene scanning.
  Barcode decoding is on-device (`@zxing/browser`).
- Hands — none.
- Head — none.
- Other Data Types — none.

### 1.3 "Data Used to Track You": none

- No advertising SDK and no analytics SDK. The dependencies in `package.json`
  are Capacitor core plugins, RevenueCat, supabase-js, zxing and UI libraries.
  There is no Firebase Analytics, Crashlytics, Sentry, Meta, AppsFlyer or
  similar.
- No IDFA or ATT. No `AppTrackingTransparency` usage. RevenueCat is not told
  to collect device identifiers.
- No data broker. Nothing is sold or shared for advertising (policy §8).
- Every third party (Appendix B) is a processor working for us, or receives an
  anonymous request from our server. None of them combines our data with other
  apps' data for ads, as far as their published terms say.
- Answer **"No, we do not track"**. No ATT prompt is needed.

### 1.4 App Store Connect, in one place

- **Data Linked to You:** Name, Email Address, Health, Fitness, Other Financial
  Info, Contacts, Emails or Text Messages, Photos or Videos, Gameplay Content,
  Customer Support, Other User Content, User ID, Device ID, Purchase History,
  Product Interaction, Crash Data, Other Diagnostic Data.
- **Data Not Linked to You:** Coarse Location, Search History.
- **Data Used to Track You:** none.

---

## 2. Google Play — Data safety

### 2.1 Top-level answers

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share any of the required user data types? | **Yes** | See 2.2. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Device → Supabase (`*.supabase.co`), Netlify functions (`https://vantagevision.netlify.app`, `src/lib/native/apiUrl.js`), RevenueCat and FCM are all HTTPS. Android has `allowMixedContent: false` (`capacitor.config.ts`) and no cleartext config. There are no `http://` endpoints in `src/` (grep). One caveat: server-side shop page fetches may follow `http://` product URLs (`netlify/lib/ssrfGuard.js:127`). They carry only the URL the user pasted, not user data. |
| Do you provide a way for users to request that their data is deleted? | **Yes** | In the app: Settings → Account → Delete account (`src/components/SettingsSection.jsx:567` → `netlify/functions/delete-account.js`). It deletes the auth user, and the cascade takes every user table with it. Storage objects and the RevenueCat subscriber go afterwards. **The web URL is missing** (M14). Google requires one. |
| Account creation methods | Username/email + password; OAuth (Google, Apple) | `src/components/AuthScreen.jsx` |
| Delete account URL | **To build**: e.g. `https://vantagevision.netlify.app/delete-account` | M14 |
| Does your app use the advertising ID? (separate App content question) | **No** | The manifest only declares `INTERNET`. Check the *merged* manifest after a release build for `com.google.android.gms.permission.AD_ID`. If a library adds it, strip it with `tools:node="remove"` (M16). |
| Independent security review | No | — |

### 2.2 Data types

"Shared" is **No** for every row. The reasons are in 2.4.

| Google category | Data type | Collected | Shared | Ephemeral? | Required / Optional | Purposes | What it is (source as in §1.1) |
|---|---|---|---|---|---|---|---|
| Personal info | **Name** | Yes | No | No | Optional | App functionality, Account management | Profile name, display name, OAuth name. |
| Personal info | **Email address** | Yes | No | No | Required | Account management, App functionality, Fraud prevention/security/compliance (+ **Developer communications** / **Advertising or marketing** while the waitlist exists — M2) | Login email; waitlist email. |
| Personal info | **User IDs** | Yes | No | No | Required | App functionality, Account management, Fraud prevention/security/compliance | Supabase id, @handle, RevenueCat app user id, invite codes. |
| Personal info | **Other info** | Yes | No | No | Optional | App functionality, Personalization | Age and sex in `S.burnProfile` (for the calorie estimate). Also declared under Health. |
| Financial info | **Purchase history** | Yes | No | No | Optional | App functionality (+ Analytics, Q4) | RevenueCat transactions; `profiles.tier`; typed-in subscriptions. |
| Financial info | **Other financial info** | Yes | No | No | Optional | App functionality, Personalization | Savings, accounts, cash flow, subscription costs, wish-list prices. |
| Health and fitness | **Health info** | Yes | No | No | Optional | App functionality, Personalization | Vitals, food log, macros, body measurements, burn profile, quit habits, legacy mood. |
| Health and fitness | **Fitness info** | Yes | No | No | Optional | App functionality, Personalization | Workouts, steps, calories burned, strain, fitness trackers. |
| Messages | **Other in-app messages** | Yes | No | No | Optional | App functionality, Fraud prevention/security/compliance (reported conversations go into `reports`) | DMs and reactions. |
| Photos and videos | **Photos** | Yes | No | No | Optional | App functionality, Fraud prevention/security/compliance (image screening) | Avatar, backgrounds, group crests, food-scan frame. |
| Contacts | **Contacts** | Yes | No | No | Optional | App functionality | The in-app friend list, blocks and invites. The device address book is never read. |
| Calendar | **Calendar events** | Yes | No | No | Optional | App functionality | Events the user adds to Vantage's own calendar (`S.calendarEvents`, `S.calendarSpans`). The device calendar is never read. *Conservative: Google defines this as "information from a user's calendar", and this is their calendar inside the app.* |
| App activity | **App interactions** | Yes | No | No | Required | App functionality, Personalization, Fraud prevention/security/compliance (AI abuse caps) | Presence, activity heatmap, `ai_usage`, coach memory. |
| App activity | **In-app search history** | Yes | No | **Yes** | Optional | App functionality | Food search text and barcodes, news topics. Not stored. |
| App activity | **Other user-generated content** | Yes | No | No | Required | App functionality, Personalization, Fraud prevention/security/compliance (reports) | Boards, trackers, habits, holidays, wish list, groups, reports, community foods, support tickets, saved AI briefs, gameplay data. |
| App info and performance | **Crash logs** | Yes | No | No | Required | App functionality, Analytics | `client_errors` message and stack. *Google's "Analytics" purpose includes diagnosing crashes. Apple puts that under App Functionality.* |
| App info and performance | **Diagnostics** | Yes | No | No | Required | App functionality, Analytics | User agent, build id, page path. |
| Device or other IDs | **Device or other IDs** | Yes | No | No | Required *(Optional if FCM auto-init is turned off — M16)* | App functionality, Developer communications (reminders and streak warnings) | Push token (`push_tokens`). The Firebase Messaging SDK also creates a Firebase installation id at startup. |
| Location | **Approximate location** | Yes | No | **Yes** | Optional (weather can be switched off) | App functionality | IP → city-level location for weather. Not stored. |

### 2.3 Google data types NOT collected

Address · Phone number · Race and ethnicity · Political or religious beliefs ·
Sexual orientation · User payment info · Credit score · Emails · SMS or MMS ·
Videos · Voice or sound recordings · Music files · Other audio files · Files
and docs (export and import are local files; the CV upload is owner-only) ·
Installed apps · Other actions · Web browsing history · Other app performance
data (web vitals are web-only) · Precise location.

### 2.4 Why nothing is "shared"

| Recipient | What it receives | Why it is not "sharing" |
|---|---|---|
| Supabase, Netlify | Everything stored; all function traffic, including IPs | Service providers (hosting, database, functions). |
| Anthropic | The food frame; the coach snapshot; 96 px avatars and group crests for screening. **No user id or email is sent** (checked `ai-food-detect.js`, `ai-coach-daily.js`, `lib/imageModeration.js`). | Service provider. API use under commercial terms, no training on the data. |
| RevenueCat | App user id (= Supabase id), purchase receipts and tokens, device and platform basics | Service provider (entitlement management). |
| Google FCM | Push token plus notification text (e.g. a friend's display name in a friend-request push) | Service provider (message delivery). |
| ipwho.is | The caller's IP address, from our server | Arguably a service provider (geolocation for us), but there is no contract (Q3). Switching to Netlify's own geo header removes the question. |
| Open Food Facts, USDA, FatSecret, GNews, Finnhub, Open-Meteo, Frankfurter, shop websites | Query text, barcode, ticker, rounded coordinates, place name, or a product URL — from **our server**, with no user identifier | Anonymous, and started by the user, who expects the lookup. |
| WHOOP, Oura | OAuth requests only. Their data flows **into** Vantage. | Inbound. We send them nothing about the user beyond the OAuth handshake. |
| Other Vantage users | Profile, leaderboard, group and DM content, per the privacy toggles | Started by the user through a social feature. Not a third-party transfer. |
| Device-direct: Google Fonts, Google favicon service, GitHub API (if the widget is added), i.ytimg.com | The device's IP; a brand domain or GitHub username | Ordinary web resource loads. Not data we collect. Listed for honesty (policy §8 already does). |

### 2.5 Deletion details to put in the form and on the web page

- **In the app:** Settings → Account → Delete account. There are two confirmations
  in the client, plus a server check (`confirm: 'DELETE'`).
- **What goes, at once:** the auth user, then the cascade: `user_data`,
  `user_data_history`, `profiles`, the `nutrition_*` tables, `messages` (both
  directions), `friendships`, `blocks`, `push_tokens`, `whoop_tokens`,
  `oura_tokens`, `coach_nudges`, `rating_snapshots`, `notifications_queue`,
  `waitlist`, `food_contributions`. Owned groups are handed to the next member
  first. Storage objects under `<uid>/` in `cv` and `recipes` are removed. The
  RevenueCat subscriber is deleted **only if `REVENUECAT_SECRET_API_KEY` is set
  in Netlify** (`delete-account.js:128-131`).
- **What stays, unlinked:** `client_errors` rows (`user_id` → null; the only
  retention is a manual 30-day purge), `security_tickets` (`reporter_id` →
  null), and `reports` (kept for abuse handling, with the reported user's id
  set to null). Also Supabase's own backups for their retention window.
- **Not done:** the WHOOP/Oura grant is not revoked at the provider. The
  tokens are deleted, so Vantage can no longer use the grant.
- Individual entries can be deleted in the app. Google asks whether partial
  deletion is possible: **Yes**.

### 2.6 Families and target audience

- There is a 13+ gate on email sign-up and on OAuth sign-up
  (`src/components/AuthScreen.jsx:109,127,237,390`), and again for brand-new
  OAuth accounts (`src/components/TermsAcceptanceSheet.jsx:93`). Terms §2 and
  Policy §15 say 13+.
- Do **not** opt into "Designed for Families". Do not pick any under-13 age
  band. Picking 13–15 and 16–17 is allowed, but it brings the UK Children's
  Code and Play's teen expectations into play: DMs, a public leaderboard and
  community content (Q7). The new-account defaults are already private
  (`supabase/audit_schema_2026_10.sql:128-129`, applied 2026-10-02).

---

## 3. Health data specifics

### 3.1 Apple

- **HealthKit is not used.** No HealthKit plugin is in `package.json`, there is
  no `ios/` project yet, and nothing calls HealthKit. Apple Health only ever
  arrived through a Shortcut that posts to `netlify/functions/health-sync`, or
  through an export-file import. Both panels (`AppleHealthImport` in
  `src/components/VitalsHistoryCard.jsx`) are owner-only, and the Settings
  entry is compiled out of the native build (`src/components/SettingsSection.jsx:26`).
  So: **do not enable the HealthKit capability**, and do not claim HealthKit
  anywhere.
- Health data is still collected (manual entry, WHOOP, Oura, food log), so the
  **Health** and **Fitness** types above must be declared regardless.
- **Native UI still names Apple Health** (M4). A reviewer who reads "Vitals sync
  from WHOOP, Oura, or Apple Health" and finds no HealthKit prompt may reject
  the app under 2.3.1/2.1 (inaccurate features), and Apple marks are sensitive
  (5.2.5). Remove those strings from the native build before submitting.
- **Suggested review note:** "Vantage does not use HealthKit and does not read
  Apple Health. Health and fitness data comes from manual entry, or from WHOOP
  or Oura through their official APIs (OAuth, user-initiated, disconnect at any
  time in Settings → Tools). Health data is used only to show the user their
  own trends. It is never used for advertising, never sold, and never shown to
  other users. Health consent is asked once on a consent sheet, and again
  before connecting a device. WHOOP and Oura need hardware; the demo account has
  sample data."
- If HealthKit is ever added: guideline 5.1.3 applies (no advertising or data
  mining use, no iCloud storage of health records, a policy that covers it).
  Sending HealthKit-sourced values to Anthropic would need its own consent and
  wording, the same way `coachWearableGuard` treats WHOOP/Oura data today.

### 3.2 Google Play — Health apps declaration (every app must complete it)

Tick:
- **Activity and fitness** — workouts, steps, strain, WHOOP/Oura activity.
- **Nutrition and weight management** — food log, macros, weight, body
  measurements, weight goal.
- **Sleep management** — sleep hours and recovery from WHOOP/Oura or manual
  entry.

Do not tick: medical or clinical features, medication, reproductive health,
health research, or anything that implies diagnosis. Consider *mental and
behavioural health* only if "Quit" habits are ever marketed as addiction
support (Q8). The Mood feature was removed in 2026-08.

Other Play health points:
- **Health Connect: not used.** No Health Connect permissions are declared
  (the manifest only has `INTERNET`). Answer "no" to Health Connect access.
- **Health content disclaimer:** the Terms already say "not a medical device"
  (`src/components/LegalPage.jsx:284`). Put the same line in the store listing
  and on an in-app screen the user actually sees.
- **External hardware:** the listing must say that the WHOOP and Oura features
  need those devices. Text only, no logos.
- **Prominent disclosure and consent** for health data exists: a one-time
  consent sheet plus just-in-time asks (`src/lib/consent/`,
  `src/components/consent/`).

---

## 4. Mismatches to fix before submitting

Each item is a place where the policy, the code and the proposed label disagree.

**M1 — Purchase history.** The policy says "We do not collect … purchase
history" (`src/components/LegalPage.jsx:92`). RevenueCat (our processor) keeps
the full transaction history against the Supabase user id
(`src/lib/billing/revenuecat.js:85`). Users also type in their subscriptions
and spending. The label must declare Purchase History.
*Fix:* drop "purchase history" from that sentence. In §2, say RevenueCat keeps
the purchase and renewal history of Vantage Pro, and that money you type in
(savings, subscriptions, cash flow) is stored in your account.

**M2 — AI Coach waitlist collects email for marketing.** "Join Waitlist — Be
the first to know when AI Coach launches" stores an email in `waitlist`
(`src/components/Modals.jsx:1866-1945`). It is reachable in the native build
from the free-tier coach teaser (`src/components/AiCoachWidget.jsx:48,156`) and
from the paywall's fallback button when offerings fail to load
(`src/App.jsx:991`, `src/components/PaywallModal.jsx:297`). The policy says "we
send no marketing emails" (`LegalPage.jsx:119`) and never mentions the
waitlist. The AI coach has also already shipped for Pro, so the promise is
stale. In the paywall, a "Pro" button that ends in an email form is also a
review risk.
*Fix (recommended):* remove the waitlist. Point the teaser at the paywall, and
point the paywall fallback at "Try again". Otherwise declare the marketing
purpose on both forms and add a waitlist bullet to the policy.

**M3 — Crash reports are not in the policy.** `client_errors` stores the error
message, stack, page path, user agent, build and `user_id`
(`netlify/functions/client-error.js:91-97`, `supabase/audit_schema_2026_10.sql:48-63`).
It is sent from the native app too. The policy only mentions web-only
"anonymous performance measurements" (`LegalPage.jsx:89`).
*Fix:* add a policy bullet ("Crash reports — when the app hits an error it
sends us the error text, the screen it happened on, your device/browser type
and app version, linked to your account if you are signed in; kept 30 days").
Schedule the 30-day purge. It is currently "delete by hand".

**M4 — Apple Health is described as available.** It is owner-only everywhere
(rendered only when `window.__vantageOwner`, `SettingsSection.jsx:1000`) and
compiled out of native. Yet the policy (`LegalPage.jsx:80,96,98,100`) and the
Terms (`:287,:322`) describe it as a user feature. So do strings that **ship
in the native build**: `src/components/TutorialOverlay.jsx:96,138,168`,
`src/components/TrackSection.jsx:898`, `src/components/track/AutoFillModal.jsx:29,32,33`,
`src/components/consent/consentCopy.js:11,13`, `src/components/settings/ConsentCard.jsx:70`.
*Fix:* remove "Apple Health" from user-facing copy, or gate it on
`OWNER_SURFACES_IN_BUILD`. In the policy, either drop it or say "not available
in the iOS or Android app".

**M5 — Recipe-from-video is listed as a user AI feature.** The policy lists it
(`LegalPage.jsx:141,168,178`), and so does the AI consent copy
(`src/components/consent/consentCopy.js:18,20`). The server refuses anyone but
the owner (`netlify/functions/recipe-from-video.js`, the header and
`isOwnerEmail`), and the only caller is the owner-only Diet surface, which is
compiled out.
*Fix:* remove it from the public policy and the consent copy, or mark it "not
available in the app". Keep the YouTube/TikTok and i.ytimg.com lines only if
something public still uses them.

**M6 — The coach snapshot is described wrongly.** The policy and the consent
copy say vitals and macro trends are sent (`LegalPage.jsx:140`,
`consentCopy.js:18`). `src/lib/coach/snapshot.js:187-201` actually sends: first
name; habit names with days clean and relapse counts; achievements; tracker
names with 14-day values; holiday destinations and countdowns; wish-list counts;
coins; recent briefs; and dismissed topic families. Trackers fed by WHOOP/Oura
are stripped unless both `VITE_AI_WEARABLE_DATA_ALLOWED` and
`AI_WEARABLE_DATA_ALLOWED` are `'true'`.
*Fix:* list what is actually sent. Habit names (e.g. "Alcohol") and holiday
destinations matter more to a reader than "macro trends". If the wearable
switch is ever turned on, the policy and consent must change first.

**M7 — Anthropic retention.** "We do not store the camera frame or the snapshot"
(`LegalPage.jsx:144,202`) is true for us. But Anthropic keeps API inputs and
outputs for a limited period under its commercial terms, unless a
zero-data-retention agreement is in place. Apple counts what third-party
partners keep. The label already declares Photos, so no label change is needed.
*Fix:* add "Anthropic may keep what we send for a limited period (currently up
to N days) for safety and abuse monitoring, then deletes it". Check the current
N in Anthropic's terms. Or get zero retention (Q9).

**M8 — Financial data is not named in policy §2.** The label declares Other
Financial Info (STARTUP_REQUIREMENTS item 10 expects it), but §2 only mentions
"savings pots" under user content.
*Fix:* add a bullet: "Money you enter — savings balances and contributions,
accounts and interest rates, monthly income and spending, subscriptions and
their costs. Entered by hand; we have no bank connection."

**M9 — Health detail is not named in policy §2.** It omits body measurements,
age, sex and height (the calorie estimate), quit-habit relapse history,
self-check scores, and legacy mood entries for older accounts.
*Fix:* extend the health bullet.

**M10 — Community foods are not in the policy.** An opt-in "share this food"
publishes the name, brand and nutrition panel to every user's search
(`food_contributions`, `src/components/diet/LogFoodPanel.jsx:383`,
`src/components/FoodLogSheet.jsx:144`). `contributed_by` is kept for moderation
and is deleted with the account.
*Fix:* add it to §2 and to §6 ("what others can see": the food, never your
name).

**M11 — Invite links show the inviter to anyone.** `preview_friend_invite` is
granted to `anon` and returns the inviter's display name, handle, avatar,
level and OVR (`supabase/dm_upgrade_2026_10.sql:381-446`). Policy §6 does not
mention it.
*Fix:* add "If you share an invite link, anyone who opens it sees your display
name, @handle, picture, level and rating until it expires."

**M12 — "Health data … never shown to other users"** (`LegalPage.jsx:99`). The
Fitness rating and OVR, shown to friends and on the leaderboard, are partly
derived from **how many days** you logged vitals or activity
(`src/lib/ratings/derive.js:372-398`). The opt-in streak card shows a habit
name.
*Fix:* add one sentence: ratings reflect how often you log, never the values.

**M13 — Policy placeholders.** The data controller, address and security email
are still TODOs (`LegalPage.jsx:68-69,209`). The support contact points to "the
store listing", which does not exist yet. Both stores need a working contact
in the policy, and Google's Data safety form links to it.
*Fix:* fill them in before submitting (STARTUP_REQUIREMENTS items 72 and 76).

**M14 — No public account-deletion URL.** Google needs a web page where users
can ask for deletion without the app. Only `/privacy` and `/terms` are
reachable before sign-in (`src/App.jsx:1076-1083`). The web app can delete an
account after sign-in, but there is no page that explains this.
*Fix:* add a pre-auth `/delete-account` page, routed the same way as `/privacy`.
It should give the steps (sign in on the web or in the app → Settings →
Account → Delete account), an email route for people who cannot sign in, and
the list of what is deleted and what is kept (2.5). Link it from policy §11
and enter it in Play Console.

**M15 — Deletion promise vs reality.** "your login and all associated data are
permanently erased within 30 days" (`LegalPage.jsx:196`). The RevenueCat
subscriber is only removed if `REVENUECAT_SECRET_API_KEY` is set. Unlinked
`client_errors` and `security_tickets` rows remain (§11 covers problem
reports, not crash rows). WHOOP/Oura grants are not revoked.
*Fix:* confirm the env var is set in Netlify. Add crash rows to §11. Keep the
existing "reports may be kept" line.

**M16 — Native build details that change the answers.**
- `android/app/src/main/AndroidManifest.xml` declares **no `CAMERA`
  permission**, so barcode scanning and the AI food scan (`getUserMedia`,
  `src/components/CameraScanner.jsx:157`) cannot work on Android. iOS will need
  `NSCameraUsageDescription` when the project is created. Fix both, or the
  food-scan rows describe a feature that cannot run.
- The Firebase Messaging SDK (pulled in by `@capacitor/push-notifications`
  when `google-services.json` is present) creates a token and installation id
  at startup, before the user agrees to notifications. Set
  `firebase_messaging_auto_init_enabled=false` in the manifest. The push token
  then exists only after opt-in, and "Device or other IDs" can be marked
  Optional.
- Check the merged manifest for `AD_ID` (see 2.1).

---

## 5. Open questions for the owner

1. **Waitlist (M2):** remove it (recommended), or keep it and declare marketing
   use of email on both forms?
2. **Apple "Contacts":** declare the in-app friend list as Contacts
   (recommended — Apple's definition says "social graph"), or leave it out?
3. **Weather location:** keep ipwho.is and declare Coarse Location "Not
   linked" (current draft)? Or switch the `weather` function to Netlify's own
   geo data, so no third party sees the IP? Either way the policy line must
   match.
4. **Analytics purpose:** do you use RevenueCat's charts (or plan to use the
   security console's counts) to judge how people use or buy the app? If yes,
   tick Analytics for Purchase History and Product Interaction. Recommended:
   tick it for Purchase History.
5. **iOS push route:** `push-dispatch` sends through FCM HTTP v1, but Capacitor
   on iOS hands over an APNs token. Add the Firebase iOS SDK (which brings
   Firebase into the iOS binary and its privacy manifest) or send to APNs
   directly? The policy currently names FCM for both.
6. **Target audience on Play:** include the 13–15 and 16–17 bands, or 18+
   only? This decides how much of the Children's Code and teen policy applies.
7. **Anthropic zero data retention:** worth asking for? It would let the
   policy say AI inputs are never kept by anyone.
8. **Wearable data to the AI coach:** keep `AI_WEARABLE_DATA_ALLOWED` off for
   launch, until WHOOP and Oura confirm in writing? Turning it on changes the
   policy, the consent copy and the review note.

---

## Appendix A — Owner-only surfaces compiled out of the native build

`OWNER_SURFACES_IN_BUILD` (`src/lib/native/ownerSurfaces.js`) is `false` when
`VITE_NATIVE_BUILD=true`. Every lazy import behind it is dropped with its
module graph. `useIsOwner` also returns false inside the native shell
(`src/hooks/useIsOwner.js:78`). The trading widget has its own flag
(`src/lib/trading/enabled.js`). None of the flows below are on the labels.

| Surface | Gate | Data flows it would add |
|---|---|---|
| Upgrade section: Career (CV upload), Diet (meal library, planner, recipes with photos, shopping planner prices), Rotation (shift pattern), Review/Books, Lifts and workouts, Security console, Moderation queue | `src/App.jsx:66` | `cv` and `recipes` Storage buckets (`src/lib/diet/recipeImages.js`); recipe-from-video (YouTube/TikTok page → Anthropic); `books` function (RevenueCat API for revenue); `security-console` (Supabase Management API, Netlify API; reads `client_errors`, `web_vitals`, tickets); `moderation` function |
| Lifts mini-bar | `src/App.jsx:69` | Workout state |
| Admin rating/coin editor | `src/App.jsx:67`, `admin-set-rating` | Writes other users' ratings/coins (server checks owner email) |
| Apple Health import panel and Shortcut sync | `src/components/SettingsSection.jsx:26,1000` | `health-sync` token URL (the token sits in a query string — fine while owner-only, a problem if ever public); Apple Health export parsing |
| Rotation shifts on the calendar | `src/components/TrackSection.jsx:478-479` | `S.rotation` |
| Trading P/L widget | `src/lib/trading/enabled.js` | `trading-summary` function |
| Security deep link | `src/App.jsx:235` | — |

Other things in the repo that do **not** reach users:
- `supabase/bank_connections_schema.sql` is a foundation only. No client or
  function uses it, and there is **no** bank or Open Banking integration.
- `body_measurements`, `body_weight_log`, `training_sessions`, `training_sets`
  and `rota_config` have SQL files but no client or function reads them.
- `web_vitals` (vitals-beacon) and `csp-report` are web-only.
- `S.lastfm`, `S.ytWidgets` and `S.notepadText` are dead keys. Older accounts
  may still hold values; nothing reads or sends them.

## Appendix B — Third parties and what each receives (native build)

| Party | Role | Receives |
|---|---|---|
| Supabase (EU) | Database, auth, storage | All stored data in §1.1, auth email and password hash, OAuth identity, auth log IPs |
| Netlify | Hosting and functions | IP and request contents of every function call, transiently; function logs |
| Anthropic | AI (food scan, coach brief) and image screening | The food frame; the coach snapshot (M6); the 96 px avatar; the group crest. No user id or email. |
| RevenueCat | Subscriptions | App user id (= Supabase id), store receipts and tokens, entitlement state; device and OS basics from the SDK |
| Apple / Google billing | Payments | Payment details. We never see them. |
| Google Firebase Cloud Messaging | Push delivery | Push token, Firebase installation id, notification text |
| Google / Apple sign-in | Optional OAuth | Supabase receives email, name, avatar URL (Google) and provider id |
| WHOOP, Oura | Wearable data sources (inbound) | The OAuth handshake. Vantage stores their tokens and pulls recovery, sleep, strain, workouts, HR, HRV and readiness. |
| ipwho.is | IP geolocation (server-side) | The caller's IP address |
| Open-Meteo | Weather, climate, geocoding | Rounded lat/lon; holiday place names |
| Frankfurter | FX rates | Currency codes |
| Open Food Facts, USDA FoodData Central, FatSecret | Food search | Search text or barcode, from our server |
| GNews | News widget | Topic text, from our server |
| Finnhub | Market widget | Ticker symbols, from our server |
| Shop websites | Wish-list autofill and price checks | The product URL the user pasted, fetched by our server |
| Google Fonts, Google favicon service, GitHub API, i.ytimg.com | Device-direct loads | Device IP; brand domain / GitHub username |
| ntfy.sh (owner alerts) | Owner notifications | Generic alert text only. Never ticket text or user ids (`support-ticket.js:115-120`). |

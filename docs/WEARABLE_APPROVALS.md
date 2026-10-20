# Wearable partner approvals: WHOOP and Oura (DRAFT)

Drafted 2026-10-20. Covers STARTUP_REQUIREMENTS items 30 (Oura app +
multi-user terms), 31 (WHOOP redirect URL), 75 (WHOOP production approval)
and DPIA gap G7. Touches items 67, 93, 98, 100, 103 and 115.

This repo is public. Nothing here is a secret. Where a value has to come from
the owner (company name, contact inbox, reviewer password) it is shown as
`[placeholder]`. Send credentials to WHOOP and Oura through their own forms,
never through this file.

**How the research was done, and what it could not reach.** On 2026-10-20 the
drafting environment could not open `developer.whoop.com`,
`community.whoop.com`, `cloud.ouraring.com`, `api.ouraring.com` or any
third-party integrator page. Every fetch failed DNS or got a proxy 403. All
outside facts below come from **web-search result excerpts** of those pages,
not from reading them in full. Each one is marked:

- **[official]**: the excerpt came from the provider's own page;
- **[secondary]**: an integrator's blog or docs;
- **[community]**: a developer forum post.

Before submitting anything, open the WHOOP API Terms, the WHOOP Brand &
Design Guidelines PDF and the Oura API and MCP Agreement in a browser and
check the clauses quoted in §0.

**Update 2026-10-20 (later the same day): owner decisions D1 = (a) exclude,
D2 = allow-list, D4 = keep history + a separate Settings delete, D7 = hide in
the first native build. Built: C1/C2 (item 124), C3 for WHOOP (item 125; Oura
still unverified), C9 (the Settings delete), C11/C12 and the §5.1 allow-list
(item 127). Sections 1 and 4 below describe the code BEFORE those changes;
STARTUP_REQUIREMENTS items 124–127 carry the current status. For §2.2, pick
the D1 = (a) wording; for shot 13 (§2.3), screenshot the consent copy saying
WHOOP/Oura data never counts toward ratings.**

---

## 0. What the providers require (confirmed 2026-10-20)

### WHOOP

| Topic | Finding | Source |
|---|---|---|
| **Unapproved-app cap** | **Confirmed: 10 WHOOP members.** "Apps can be used for development immediately with a limit of 10 WHOOP members. To launch your app to all WHOOP members, you must first submit your app for approval." The forum's "~10 users" is right. | [official] developer.whoop.com/docs/developing/app-approval |
| **Tiers** | Developers describe tiers: "Sandbox" at 10 members, then a "Build" tier at **100 members** requested from the dashboard. One October 2026 post: a Build request filed 13/10/2026 with no answer yet. WHOOP's own page only says "App approval". Treat the tier names as unconfirmed. | [community] community.whoop.com threads 16470, 15723, 16372 |
| **How to apply** | Developer Dashboard → open the app → **Open Request** → **App approval**, "including designs and other helpful context". Checklist: (1) read and follow the API Terms; (2) test with at least one WHOOP member; (3) App Name, Contact Email(s) and Privacy Policy URL filled in and accurate ("accelerates the approval process"); (4) follow the Design and Brand Guidelines. A rejection arrives by email with reasons, and you can resubmit. | [official] app-approval page |
| **Review time** | None published. Integrators say 1–2 weeks to several weeks. 2026 forum posts describe **months**, with several resubmissions and no status updates. **Apply as early as possible.** | [secondary] Terra help centre, ROOK; [community] |
| **Rate limits** | **Confirmed: 100 requests/minute and 10,000/day** per app by default. Shown in `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers; 429 when exceeded. "Upon request, WHOOP can increase your rate limits" (explain the use case). | [official] developer.whoop.com/docs/developing/rate-limiting |
| **API Terms version** | API Terms of Use page shows **effective 6 October 2026**. | [official] developer.whoop.com/api-terms-of-use |
| **User authorisation** | §2: apps "must (i) be expressly authorized by each end user … prior to Company accessing any of such End User's data"; users must be able to access the data the app collected. | [official] API Terms §2 |
| **Privacy policy** | The company "will provide and adhere to a privacy policy … that clearly and accurately describes to End Users the information the app collects and how it uses and shares it", and will not transfer or disclose user information to third parties except as the Terms or the policy allow. | [official] API Terms |
| **Showing data to others** | §4 (WHOOP Data): unless authorised by the WHOOP Data owner or by law, do not "expose WHOOP Data to other users or third parties without explicit opt-in consent from the user that provided the WHOOP Data". **"WHOOP Data" includes WHOOP calculations and analysis "and any copies or derivatives".** | [official] API Terms §4 |
| **Storage** | §4: no scraping or "building databases" from WHOOP Data, and no cached copies kept longer than the cache header allows, "unless expressly authorized by the WHOOP Data owner or by applicable law". | [official] API Terms §4 (excerpt) |
| **AI** | §4.2: do not use the APIs or WHOOP Data to **train, fine-tune or improve** AI / large language models. The excerpt was cut off, so it is not known whether it also covers *prompting* a model (Oura's agreement does). | [official] API Terms §4.2 (truncated excerpt) |
| **Selling** | Selling or licensing API data to third parties is prohibited. | [secondary] Terra 2026 blog |
| **Branding** | You may not use WHOOP's names, trademarks or logos without written authorisation, but you may state that you use the WHOOP API. Brand guidelines: logo black or white only, never distorted, recoloured or rotated. **"Ensure that any data from WHOOP communicates it as such"** (there is an "Imported from" label pattern). **Don't** "rebrand or rename WHOOP proprietary metrics", "use other metrics for our scores", "use different colors for our main scores". Recovery colours are fixed: green 67–100 % `#16EC06`, yellow 34–66 % `#FFDE00`, red 0–33 % `#FF0026`. Use the data in a "value-added" way. | [official] API Terms; WHOOP Brand & Design Guidelines PDF (fragmentary excerpt) |
| **Revoking on disconnect** | **There is an endpoint.** The OAuth guide says that when a user disables your integration you should revoke their token with `revokeUserOauthAccess`, which is `/developer/v2/user/access`. The method is DELETE according to two independent implementations. It has existed since the 2023-02-01 changelog entry. **This refutes the "no documented endpoint found" note in item 67 and `delete-account.js`.** | [official] developer.whoop.com/docs/developing/oauth, /api; [secondary] whoop-mcp, ClawHub |
| **Steps** | `Cycle.step_count` is on `/v2/cycle` under the existing `read:cycles` scope. Null means no data. The post is dated 6 Oct 2026 and says it applies to cycles from 23 Sep 2026. | [official] community.whoop.com/t/16424 (WHOOP staff post) |

### Oura

| Topic | Finding | Source |
|---|---|---|
| **Personal vs app** | A personal access token is for your own data only. Reading anyone else's data needs a registered OAuth **API Application**. Integrators report that new applications now go through Oura's newer developer portal, with the old `cloud.ouraring.com/oauth/applications` kept for editing existing apps. **Check which one applies when registering.** | [official] cloud.ouraring.com/v2/docs (excerpt); [secondary] |
| **Unapproved-app cap** | **Confirmed: 10 users.** "API Applications are limited to 10 users before requiring approval from Oura." After approval there is no limit. Free for personal and commercial use. Review criteria and timeline are not published. | [official] Oura API v2 docs (excerpt) |
| **Consent** | Users consent per data type the application can access. | [official] |
| **Membership** | **Gen3 and Oura Ring 4 users without an active Oura Membership cannot use the API, and partner apps lose access to their data.** Gen2 is unaffected. | [official] support.ouraring.com article 4415266939155 |
| **Rate limit** | **5,000 requests per 5 minutes** (contact Oura to raise it). This comes from one third-party source, so it is **unverified**. | [secondary] Nango docs |
| **Terms version** | **"Oura API and MCP Agreement", effective 8 June 2026**, between Ouraring, Inc. and anyone using the API. It replaces the 2021 agreement (in force until 7 June 2026). | [official] cloud.ouraring.com/legal/api-agreement |
| **AI** | §4(d): do not use the API to "develop, train, **prompt**, or supply input to" any AI model or platform, including through third parties. LLM use may happen through Oura's own MCP Server. Training, fine-tuning and embeddings need prior written consent. User consent does not override this. | [official] agreement excerpt; [secondary] Terra |
| **Competition** | Do not "create, inform, design, develop, or improve any product, service, or technology that competes with or merely replicates those of Oura". | [official] agreement excerpt |
| **Charging** | Charging users for API-related functionality reportedly needs Oura's prior written consent. | [secondary] Terra |
| **Aggregators** | Aggregators need a separate registration per end customer and may not pass Oura data, including derived data, to AI. Vantage is not an aggregator. | [secondary] Terra |
| **Revoke** | An official revoke endpoint was **not found** in what could be reached. A third-party v2 client has a `revokeAccessToken` call, so ask Oura. Refresh tokens are single-use. | [official] auth page; [secondary] deno `oura_api` |
| **Scopes** | The official page lists 8 scopes, including `email`, `personal`, `daily`, `heartrate` and `workout`. Third-party notes say `daily` covers readiness, activity and sleep summaries. **Whether `/usercollection/sleep` needs `daily` alone or a separate scope is unverified.** | [official] excerpt; [secondary] |
| **Not found** | Branding and attribution rules, retention or deletion after disconnect, and whether derived data may feed rankings shown to others. These go into the email in §3. | — |

---

## 1. What Vantage does with each provider's data (from the code, 2026-10-20)

### 1.1 Common to both

- **The connect flow.** The signed-in user presses Connect in Settings → Tools
  → Health & sync (`src/components/VitalsHistoryCard.jsx`, `WearableSync`).
  The explicit health-consent ask comes first (`requestConsent('health')`).
  Then `whoop-connect` / `oura-connect` (POST with the Supabase JWT, limited
  to 10 a minute per account) returns the authorize URL. The browser goes to
  the provider, the provider redirects to `<provider>-callback`, the code is
  exchanged server-side, and the tokens are stored. The user lands back on
  `/?<provider>=connected` and a 7-day sync runs.
- **OAuth `state`** (`netlify/lib/oauthState.js`): an HMAC-signed payload
  (user id, provider, random nonce, 10-minute expiry), with the nonce echoed
  in an `HttpOnly; Secure; SameSite=Lax` cookie. The callback refuses a state
  that is forged, expired, for the wrong provider, or arrives without its own
  cookie. The nonce is cleared on every outcome. This closes the
  token-misfiling attack described in that file's header.
- **Redirect URI** (`netlify/lib/redirectUri.js`): a constant
  (`OAUTH_REDIRECT_BASE`, else Netlify `URL`), the same for the authorize call
  and the token exchange. Today it is
  `https://vantagevision.netlify.app/.netlify/functions/<provider>-callback`.
- **Tokens:** `whoop_tokens` / `oura_tokens` (`supabase/whoop_schema.sql`,
  `oura_schema.sql`) hold `user_id` (PK, `on delete cascade` to
  `auth.users`), `access_token`, `refresh_token`, `expires_at` and
  `updated_at`. RLS is on with **no policies**, so only the service role (the
  Netlify functions) can read them. Clients never see a token. Storage is
  Supabase Postgres in the EU, encrypted at rest at the platform/disk level.
  There is **no column-level encryption**. TLS is used on every hop. A token
  is refreshed within 2 minutes of expiry, and the rotated refresh token is
  persisted **before** any data call, retried once, and logged loudly on
  failure.
- **Where the data lands:** the user's own row in `user_data.state` (the JSON
  blob `S`):
  - `S.vitalsLog[YYYY-MM-DD]`: one row per day, merged shallowly;
  - `S.burnLog[YYYY-MM-DD]`: an array of workout entries, namespaced by id
    prefix (`whoop-` / `oura-`), so each sync replaces only its own entries;
  - flags `S.whoopConnected` / `S.ouraConnected`, and
    `S.whoopLastError = { at, message, reconnect }`.

  Every merge is additive (`mergeWhoopIntoState`, `mergeOuraIntoState`, and
  the client merges in `whoopClient.js` / `ouraClient.js`). Server writes are
  compare-and-set on `updated_at` (`netlify/lib/stateWrite.js`).
- **What is never stored:** raw API records, sleep stages, SpO2, skin
  temperature, HR zones and time series, sport ids, and any profile, name,
  email or body measurement from the provider.
- **Disconnect** (`netlify/functions/wearable-disconnect.js`) deletes the
  token row and clears the local flag (`disconnectWearable` in
  `src/lib/ouraClient.js`). **Synced history stays in `S`** by design: the
  confirm dialog says so (`VitalsHistoryCard.jsx:276`, `:442`). **The grant
  is not revoked at the provider** (see gap C3).
- **Account deletion** (`netlify/functions/delete-account.js`) deletes the
  auth user, and the cascade removes `user_data` and both token tables.
  Copies age out of `user_data_history` (14 days) and Supabase backups
  (7 days). The provider grant is **not revoked** (TODO at
  `delete-account.js:45`).
- **Export:** the encrypted export (`src/lib/data/exportCrypto.js`) includes
  `vitalsLog` / `burnLog`. This meets WHOOP §2's "users can access data the
  app collected".
- **Kill switch:** `paused('sync')` / `pausedCron('sync', …)`
  (`netlify/lib/killSwitch.js`) stops connects, syncs and crons in minutes.

### 1.2 WHOOP

| | |
|---|---|
| **Scopes requested** | `offline read:recovery read:sleep read:workout read:cycles read:profile` (`netlify/functions/whoop-connect.js:23`). **`read:profile` is requested but never used.** No code calls a profile or body-measurement endpoint (gap C4). |
| **Endpoints** | `GET /developer/v2/recovery`, `/v2/activity/sleep`, `/v2/activity/workout`, `/v2/cycle`, each with `start` / `end` / `limit=25` and up to 5 pages (`netlify/lib/whoop.js:130`, `fetchWhoopData` `:238`). Token: `POST /oauth/oauth2/token` (authorization_code, then refresh_token with `scope=offline`). No webhooks. |
| **Fields kept** (`mapWhoop`, `whoop.js:157`) | `vitalsLog[d].sleep`: hours asleep, from light + REM + SWS (naps skipped; in-bed time as fallback), filed under the sleep's end date. `.rhr`, `.hrv` (RMSSD ms), `.recovery` (0–100), from recovery. `.strain` (0–21, 1 dp), `.burnKcal` (kJ ÷ 4.184) and `.stepsWhoop` (`step_count`, skipped if null or 0), from cycle. `burnLog[d]`: `{ id: 'whoop-<workoutId>', label: 'WHOOP workout', kcal, start: 'YYYY-MM-DDTHH:MM' local }` for each workout with kJ > 0. Days are keyed by the UTC date of the record. |
| **When** | **On open / focus**: `useWhoopAutoSync` (`src/App.jsx:174`, `src/lib/whoopClient.js:72`), 7 days, at most once per 10 minutes per tab, only when connected and health consent is not `declined`. **Manual**: Sync (7 days), **30d** button, and a 7-day sync after connect. `whoop-sync` caps `days` at 30 and limits each account to 6 calls a minute. **Cron**: `whoop-cron`, `netlify.toml:187` (`0,10,20,40,50 6-8 * * *` UTC, 15 runs a morning). Each run covers 3 days, 4 accounts at a time, oldest first, at most 60 WHOOP calls (~12 accounts). It skips accounts whose token was touched in the last 3 h, so roughly 180 accounts and ~900 calls a morning. |
| **Call cost** | About 4–5 calls per sync (a refresh at most hourly, plus 4 collections, plus extra pages). The 10,000/day cap ÷ ~5 ≈ **2,000 syncs a day across all users**, crons included. That is about 400–600 daily-active WHOOP users before an increase is needed (gap C13). |

### 1.3 Oura

| | |
|---|---|
| **Status** | **Not live in production.** `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` are not set (item 30), so `oura-connect` answers "Oura is not set up on this site yet." The panel is open to every account once the keys exist. |
| **Scopes requested** | `daily heartrate workout` (`netlify/functions/oura-connect.js:20`). `personal` and `email` are deliberately left out. |
| **Endpoints** | `GET /v2/usercollection/sleep`, `/daily_readiness`, `/daily_activity`, `/workout`, with `start_date` / `end_date` (end + 1 day) and up to 5 pages (`netlify/lib/oura.js:93`). Token: `POST /oauth/token`. **A non-OK response is silently treated as "no data"** (`oura.js:100`), so a lapsed membership or revoked grant reads as "Synced 0 days" (gap C12). |
| **Fields kept** (`mapOura`, `oura.js:115`) | `vitalsLog[d].sleep` (`total_sleep_duration` → hours, `long_sleep` only), `.rhr` (`lowest_heart_rate`), `.hrv` (`average_hrv`). `.recovery` ← **`daily_readiness.score`** (Oura's Readiness, stored and shown as "Recovery"; gap C6). `.burnKcal` ← `total_calories`, `.stepsOura` ← `steps`. `burnLog[d]`: `{ id: 'oura-<id>', label: 'Oura · <activity>', kcal, start }`. |
| **When** | On open / focus (`useOuraAutoSync`, `src/App.jsx:175`), same 10-minute throttle and consent check. Manual Sync. `oura-cron` once a day at 06:30 UTC (`netlify.toml:195`), 3 days, 4 at a time, no request budget. |

### 1.4 Who sees it

**The user, on their own screens.** The data appears on:

- Track → Vitals (`src/components/track/VitalsPanel.jsx`; readiness defers to
  the device's score, `src/lib/vitals/readiness.js:85`);
- the Vitals history card;
- the hub and mobile widgets (Calories burned shows "· WHOOP",
  `src/components/mobile/MobileWidget.jsx:917`);
- auto-filled trackers (`src/lib/trackers/autoLog.js`: sleep, strain,
  recovery, burn, steps and workout rules, each tick recording its source in
  `S.logsAuto`);
- the on-device, rule-based coach heuristics (`src/lib/coach/heuristics.js`;
  no network, no model).

**Not the AI coach.** Band-derived values are stripped on the device
(`src/lib/coach/wearableProvenance.js`, `snapshot.js`) and again on the server
(`netlify/lib/coachWearableGuard.js`, applied in `ai-coach-daily.js:254`). The
server strip applies unless `AI_WEARABLE_DATA_ALLOWED === 'true'`. That flag
is **unset**, as the owner decided on 2026-10-20 (item 101). Nothing from
WHOOP or Oura reaches Anthropic.

**But derived values do reach other people.** No raw WHOOP or Oura number is
shown to anyone else. However, `netlify/lib/recompute.js` builds the
ratings from `S`, and several of its inputs are fed by the bands:

| Rating input | How WHOOP/Oura feed it | Code |
|---|---|---|
| `vitalsPoints` (fitness) | +0.4 for each day whose vitals row has `sleep` or `rhr`, which both syncs write every day | `recompute.js:252` |
| `burnPoints` (fitness) | Daily kcal in `burnLog`, including `whoop-` / `oura-` workouts (capped at 600 kcal → 0.5 a day) | `recompute.js:264` |
| `categoryDayPoints`, `trackerPoints` (fitness) | Fitness trackers that `autoLog` ticks from band data (sleep ≥ X, strain, recovery, burn, steps, workout) | `recompute.js:190`, `:163`; `autoLog.js:150-210` |
| `socialPoints` (social) | Any non-empty `logs[day]` counts as an active day, auto-ticks included | `recompute.js:234` |
| Visions / level | e.g. `vitals-7` (75 xp, fitness) | `netlify/lib/visionXp.js:42` |

These become `profiles.ratings` / `ratings_ovr`, which are shown:

- to **friends** on the friends board, whatever the leaderboard setting;
- to **group members** (rating and weekly climb);
- on the **global leaderboard** (opt-in, off by default for new accounts:
  `get-leaderboard.js`, `LegalPage.jsx:151`);
- on invite links before sign-in (item 100).

Separately, the **friends heatmap** (`src/lib/friends/usePublishProfile.js:76`,
on unless `privacy.shareHeatmap === false`) counts tracker ticks per day,
auto-ticks from a band included.

So Vantage exposes **derivatives** of WHOOP data to other users. WHOOP
counts derivatives as WHOOP Data and requires explicit opt-in consent from
that user. Neither the consent sheet nor the policy asks for or discloses
this. In fact both say the opposite: `consentCopy.js:12` says "Only you see
it: never shown to friends", and `LegalPage.jsx:121` says "never shown to
other users". Oura's position is unknown. See gaps C1 and C2.

---

## 2. WHOOP production approval: draft answers

WHOOP's form asks for App Name, Contact Email(s), Privacy Policy URL and
redirect URLs on the app record, then free text plus attachments in the
**Open Request → App approval** ticket. The fields below cover both. Owner
items are marked **[OWNER]**.

### 2.1 App record (Developer Dashboard)

| Field | Value |
|---|---|
| App name | **Vantage** |
| Company / legal entity | **[OWNER: `[company name]`, company number, registered address]**. If the WHOOP developer account is personal today, move the app to a company-owned login once the company exists (item 1), or say in the request who the controller is. |
| Contact email(s) | **[OWNER: support@`[domain]` and security@`[domain]`.]** The same inboxes as `src/lib/support.js` (item 72). A role address, not a personal one. |
| Privacy policy URL | `https://vantagevision.netlify.app/privacy` (move it to the custom domain later and update here **the same day**) |
| Terms URL (if asked) | `https://vantagevision.netlify.app/terms` |
| Support URL (if asked) | `https://vantagevision.netlify.app/support` |
| Account deletion URL (if asked) | `https://vantagevision.netlify.app/delete-account` |
| Redirect URL(s) | `https://vantagevision.netlify.app/.netlify/functions/whoop-callback`. **Check it is byte-identical in the dashboard (item 31).** Register any custom domain as a separate entry on the day it is added, or pin `OAUTH_REDIRECT_BASE`. The native app (item 115) will keep this same https callback and bounce on to `com.vantage.app://…` afterwards, so no custom-scheme redirect needs registering with WHOOP. |
| Scopes | `offline`, `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`. **Remove `read:profile` from `whoop-connect.js` before submitting** (gap C4). A reviewer will ask why an unused scope is requested. |
| Webhooks | None. Vantage pulls data and does not subscribe to webhooks. |

### 2.2 App approval request: free text

**Summary (one paragraph)**

> Vantage is a personal life-dashboard app (habits, goals, food diary,
> savings, health) for adults and teenagers 13+ in the UK. It is a web app
> today and will ship as an iOS and Android app. WHOOP members can link
> their own WHOOP account so that their daily recovery, sleep, HRV, resting
> heart rate, strain, all-day energy expenditure, steps and workouts appear
> in their Vantage dashboard without typing, next to their food diary and
> goals. Each member sees only their own data. Vantage operates the
> integration as `[company name]`, a UK company, and processes the data
> under UK GDPR with explicit consent.

**Use case: what the member gets ("value-added")**

> - Recovery, sleep, HRV, RHR and strain on a single Vitals page with trends
>   and correlations against their own logged habits ("sleep vs. caffeine",
>   etc.).
> - WHOOP's measured all-day burn alongside the calories they ate, so the
>   food diary shows a real energy balance instead of an estimate.
> - Habit trackers that tick themselves: "slept 7 h+", "recovery ≥ 60 %",
>   "10,000 steps", "worked out". The member opts in per tracker, and every
>   automatic tick is labelled with where it came from and can be undone.
> - A workout on a night shift counts for the shift's day, using the
>   workout's local start time.

**Data used, field by field**

| WHOOP collection | Fields read | What Vantage keeps |
|---|---|---|
| Recovery (`read:recovery`) | `score.recovery_score`, `resting_heart_rate`, `hrv_rmssd_milli`, `created_at` | One daily value each |
| Sleep (`read:sleep`) | `stage_summary` light/REM/SWS totals, `start`, `end`, `nap` | Hours asleep a night (naps ignored) |
| Cycle (`read:cycles`) | `score.strain`, `score.kilojoule`, `step_count`, `start` | Daily strain, kcal and steps |
| Workout (`read:workout`) | `score.kilojoule`, `start`, `timezone_offset`, `id` | kcal and local start time per workout |
| `offline` | — | A refresh token, so morning data arrives without the member opening the app |

> We do not request profile or body-measurement data. Raw records, sleep
> stages, heart-rate zones and sport types are not stored.

**How and when data is fetched**

> On the member's request (Sync button, last 7 or 30 days), when they open
> the app (last 7 days, at most once per 10 minutes), and by one scheduled
> job each morning (06:00–08:50 UTC, last 3 days, each account at most once
> a morning). The scheduled job keeps itself to at most 60 WHOOP calls per
> run so it stays well under the 100/min limit even with members syncing at
> the same time.
>
> **Rate-limit request:** we expect `[OWNER: N]` connected members in the
> first three months. At about 5 calls per sync, the default 10,000/day
> covers roughly 2,000 syncs a day. We ask for `[OWNER: e.g. 50,000/day]`
> once connected members pass `[400]`.

**Storage, retention and deletion**

> Tokens live in a dedicated Postgres table (Supabase, EU region). Row-level
> security is on with no client policies, so only our server functions can
> read it. Storage is encrypted at rest by the platform, and every hop uses
> TLS. Synced values live in the member's own account record and nowhere
> else.
>
> - **Disconnect** (Settings → Tools → Health & sync → Disconnect) deletes
>   the tokens immediately and calls WHOOP's `revokeUserOauthAccess`
>   **[after gap C3 is fixed]**. The values already synced stay in the
>   member's history unless they choose to delete them.
> - **Account deletion** (Settings → Account → Delete account, or
>   `/delete-account`) erases the account, the tokens and every synced value
>   at once. It also revokes the WHOOP grant **[after C3]**. Rolling backups
>   expire within 7 days.
> - The member can export their data at any time.

**Sharing**

> WHOOP data is never sold, never used for advertising, never shared with
> data brokers and never sent to any AI model. Our server enforces the AI
> exclusion independently of the app.
>
> Our processors are Supabase (database, EU) and Netlify (hosting and
> functions). They process the data only to run the service.
>
> **[Pick one, per decision D1:]**
> - (a) "No WHOOP-derived value contributes to anything another user can
>   see."
> - (b) "Vantage has an optional social rating. A member's WHOOP data counts
>   toward it only if they switch on 'Let my WHOOP data count toward my
>   ratings' (off by default). Raw WHOOP values are never shown to anyone
>   else."

**AI statement**

> Vantage has an AI daily brief (Anthropic API, with separate opt-in AI
> consent). WHOOP data is excluded from it: the app strips it before
> building the request, and the server strips it again. WHOOP data is never
> used to train, fine-tune or improve any model. We will not change this
> without WHOOP's written agreement.

**Security measures**

> - OAuth 2.0 authorization-code flow. The client secret is held only in
>   server environment variables, never in the app bundle.
> - `state` is HMAC-signed, single-use (nonce bound to an HttpOnly, Secure,
>   SameSite=Lax cookie), expires after 10 minutes and is bound to the
>   provider.
> - The redirect URI is a fixed, registered constant.
> - Rotated refresh tokens are persisted before anything else.
> - Each account is rate-limited on connect and sync.
> - A kill switch pauses all syncing within minutes.
> - Hourly automated security sweep; written incident runbook with the
>   72-hour ICO step; vulnerability disclosure policy (`SECURITY.md`,
>   `/.well-known/security.txt`).
> - A Data Protection Impact Assessment covers the integration.

**User controls**

> - Explicit health-data consent before connecting (nothing pre-ticked;
>   declining leaves the rest of the app working).
> - Withdraw consent in Settings → Privacy → Consent.
> - Disconnect at any time.
> - Delete individual entries.
> - Export.
> - Delete the account in the app or on the web.

**Compliance**

> UK GDPR / Data Protection Act 2018. Health data is special category data,
> processed on explicit consent (Art. 9(2)(a)). The DPIA is drafted and
> under solicitor review. The privacy policy names WHOOP as a source and
> lists exactly what is read (§3, §8). ICO registration: `[OWNER: reference
> once registered]`.

**Branding**

> WHOOP is named in plain text wherever its data appears ("Recovery ·
> WHOOP"). WHOOP's proprietary metrics keep their WHOOP names, and the
> Recovery score uses WHOOP's colour bands **[after gaps C5–C7]**. We do
> not use the WHOOP logo. If WHOOP prefers an official "Connect with WHOOP"
> asset, we will use it as supplied.

**Testing done**

> Tested end-to-end with `[OWNER: n]` WHOOP members since `[date]`: connect,
> sync, the morning job, token refresh and rotation, disconnect and
> reconnect. Recent issues and their fixes:
> - a redirect-URI mismatch (now a constant);
> - lost rotated tokens under a race (now persisted first, with re-read on
>   conflict);
> - the morning job reaching too few accounts (now pooled and budgeted).

### 2.3 Screenshots to attach (shot list)

Take these **after** the display fixes in §4 (C5–C7), so WHOOP reviews what
it will get. Use a throwaway test account linked to the owner's own WHOOP
(the store pack says never link a demo account). Crop out the email and
handle.

1. Settings → Tools → Health & sync, not connected ("Connect WHOOP" and the
   one-line description).
2. The health-consent sheet that appears on Connect (shows explicit consent).
3. WHOOP's own authorize screen listing the scopes (proves the scope list,
   minus `read:profile`).
4. Back in Vantage: panel connected, "Synced N days of vitals · M workout
   days", with Sync / 30d / Disconnect.
5. Track → Vitals: the Readiness/Recovery block showing WHOOP's score with
   attribution and colour bands.
6. Track → Vitals chart with HRV / Strain chips and the source label.
7. Mobile hub: Calories burned widget ("kcal burned today · WHOOP") beside
   the food diary.
8. An auto-ticked tracker showing its source ("from WHOOP: slept 7.4 h").
9. The Disconnect confirm dialog, then the "WHOOP disconnected" message.
10. Settings → Privacy → Consent (withdraw).
11. Settings → Account → Delete account.
12. `/privacy` §3 and §8 (the WHOOP paragraphs).
13. *If D1 = (b):* the ratings opt-in switch, off by default. *If D1 = (a):*
    a friend card or leaderboard row, to show that only the rating appears.

### 2.4 Test account instructions for WHOOP's reviewer

> **Keep one of the 10 development slots free for the reviewer.** Their
> WHOOP account counts toward the cap.
>
> 1. Open https://vantagevision.netlify.app in a desktop or mobile browser.
>    (The native apps are not yet released. The web build is the same app.)
> 2. Sign in with the test account: email `[OWNER: reviewer address]`,
>    password `[OWNER: send in the request only]`. Or create a new account.
>    A new account sees a one-time consent sheet; choose "Allow" for health
>    data.
> 3. Go to Settings (gear) → Tools → Health & sync → **Connect WHOOP**.
>    Confirm the health-data consent if asked.
> 4. Sign in with your own WHOOP member account and approve the requested
>    permissions.
> 5. You return to Settings with "Synced N days of vitals". Open **Track →
>    Vitals** to see recovery, sleep, HRV, strain and burn. The Calories
>    burned widget on the hub shows WHOOP's all-day burn.
> 6. To disconnect: Settings → Tools → Health & sync → **Disconnect**. To
>    erase everything: Settings → Account → **Delete account**.
>
> We will delete the test account after the review.

---

## 3. Oura: registration, then questions in writing

### 3.1 Registration steps (item 30)

1. Sign in to Oura's developer portal (the newer portal if it exists for new
   apps; otherwise `cloud.ouraring.com/oauth/applications`) with a
   company-controlled login **[OWNER]**.
2. Create the application:
   - name **Vantage**;
   - website `https://vantagevision.netlify.app`;
   - privacy `/privacy`, terms `/terms`;
   - redirect URI exactly
     `https://vantagevision.netlify.app/.netlify/functions/oura-callback`;
   - scopes `daily`, `heartrate`, `workout`. Confirm in the portal that
     `daily` covers `/usercollection/sleep`. If a separate sleep scope
     exists, add it and update `oura-connect.js:20`.
3. Set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` in Netlify (Functions
   scope) and redeploy. Check that the panel connects and syncs with the
   owner's ring.
4. **Until Oura replies in writing, keep Oura to ≤ 10 named users** (Oura
   enforces this cap anyway) and do not advertise it in the store listing.
5. Send the email below. File the reply with the DPIA (G7).

### 3.2 Email draft to Oura (API / partner support)

> **Subject:** API application "Vantage": multi-user approval and terms
> questions
>
> Hello,
>
> We are `[company name]`, a UK company. We make Vantage, a personal
> dashboard app (habits, goals, food diary, health), on the web now and on
> iOS and Android soon. We have registered an API application, "Vantage"
> (client ID `[OURA_CLIENT_ID]`), and would like to (1) request approval to
> go beyond 10 users and (2) confirm a few points under the Oura API and
> MCP Agreement (effective 8 June 2026) before we let members connect.
>
> **What the integration does.** A member links their own Oura account
> (scopes: `daily`, `heartrate`, `workout`; we do not request `personal` or
> `email`). Once a day, and when they open the app, we read the last few
> days of sleep, daily readiness, daily activity and workouts. We keep:
> nightly sleep hours, lowest heart rate, average HRV, the readiness score,
> total calories, steps, and per-workout calories and start time, in that
> member's own account (EU servers). Only that member sees these values.
> Nothing is sold, used for advertising or shared with data brokers.
>
> Our questions:
>
> 1. **Approval.** What do you need from us to lift the 10-user limit? Is
>    there a form, screenshots or a test account? What is the usual
>    timeline?
> 2. **AI (§4(d)).** Vantage has an optional AI daily brief. Oura data is
>    excluded from it today, on the device and again on our server. Please
>    confirm this is compliant. Also confirm that a fully on-device,
>    rule-based summary (no machine-learning model, no third party) that
>    reads the member's Oura values falls outside §4(d).
> 3. **Derived values shown to others.** Vantage has an optional social
>    rating. A member's friends, and the global leaderboard if the member
>    opts in, see a single 1–99 number. Some of its inputs are counts, such
>    as "days with sleep recorded" and "days with a workout", which can come
>    from Oura. No Oura value is ever shown. May Oura-derived counts
>    contribute to a score visible to other users if the member explicitly
>    opts in? Or must Oura data be excluded from it?
> 4. **Retention after disconnect.** When a member disconnects, we delete
>    their tokens. Today we keep the values already synced in their own
>    history (they can delete them, or their whole account, at any time).
>    Is that permitted, or must Oura-sourced data be deleted on disconnect,
>    or after a set period?
> 5. **Revocation.** Is there a supported endpoint to revoke a member's
>    grant when they disconnect or delete their account? (We found
>    references to `/oauth/revoke` but no official documentation.)
> 6. **Competition clause.** Vantage shows the member's own sleep, HRV and
>    readiness alongside their food and habits. We do not offer our own
>    sleep or readiness algorithm in place of Oura's when Oura data is
>    present. Please confirm this does not "compete with or merely
>    replicate" Oura.
> 7. **Paid tier.** Connecting Oura and seeing the data is free in Vantage.
>    Our optional subscription removes general limits (number of trackers,
>    habits and similar) and adds an AI brief that does not use Oura data.
>    Does this count as "charging for API-related functionality" that needs
>    your consent?
> 8. **Branding and attribution.** Do you have guidelines for naming Oura
>    and its metrics in a third-party app? For example, should the readiness
>    score always be labelled "Oura Readiness"? Is there an official
>    "Connect Oura" asset?
> 9. **Membership.** We understand that Gen3 and Ring 4 members without an
>    active Oura Membership cannot be read through the API. What response
>    does the API return in that case, so we can explain it to the member?
> 10. **Rate limits.** Please confirm the current limit (we have seen 5,000
>     requests per 5 minutes quoted) and how to request more.
> 11. **Data protection.** We treat Oura as an independent controller and
>     ourselves as a controller for the copy the member asks us to fetch. Is
>     that your view too, or do you expect a data processing or data sharing
>     agreement?
>
> Our privacy policy is at https://vantagevision.netlify.app/privacy. We
> are happy to share screenshots or a test account.
>
> Kind regards,
> `[name, role]`, `[company name]`, `[contact email]`

### 3.3 Questions to WHOOP in writing

The owner has already asked WHOOP about AI use (`coachWearableGuard.js`
header). Put these in the approval request's "helpful context", or send them
to WHOOP's developer support as a follow-up:

1. §4: do derived counts (days with sleep recorded, days with a workout)
   contributing to a 1–99 rating visible to friends count as "exposing
   WHOOP Data to other users"? Is an explicit, default-off opt-in switch
   enough?
2. §4 storage: the member authorises storing synced values in their own
   account, and keeps them after disconnecting until they delete them. Does
   this count as authorisation by "the WHOOP Data owner"? Or must WHOOP
   data be deleted on disconnect, or kept only as long as the cache header
   allows?
3. §4.2: confirm that keeping WHOOP data out of our AI brief is enough.
   Does the clause also cover *prompting* a model (inference), or only
   training, fine-tuning and improving?
4. Branding: may we show "Recovery · WHOOP" in our own type and layout,
   using your recovery colour bands? Is there an official Connect button?
5. Rate limit: the increase requested above.

---

## 4. Compliance gaps (code vs. terms)

Severity: **B** blocks approval or creates a likely breach; **L** fix before
launch; **A** after launch.

| # | Gap | Terms | Code location | Suggested fix | Sev |
|---|---|---|---|---|---|
| **C1** | **Wearable-derived values feed ratings and the heatmap that other users see**, with no opt-in. | WHOOP §4 (derivatives; explicit opt-in). Oura unknown (Q3). DPIA G10, item 103 | `netlify/lib/recompute.js:252` `vitalsPoints`, `:264` `burnPoints`, `:163`/`:190` tracker points via `autoLog` ticks, `:234` `socialPoints`; `src/lib/friends/usePublishProfile.js:76` `buildHeatmap`; client mirror `derive.js` | **(a) Exclude by default:** in `recompute.js` (and `derive.js`, kept in step), count a vitals day only for `weight`, or for `sleep`/`rhr` on a row with no band key (`hrv`, `recovery`, `strain`, `burnKcal`, `stepsWhoop`, `stepsOura`: the same rule as `coachWearableGuard`); skip `burnLog` entries whose id starts `whoop-`/`oura-`; skip `logs` cells whose `S.logsAuto` source is a wearable rule (in rating maths and in `buildHeatmap`). **(b) Add an opt-in later:** `S.privacy.wearablesInRatings` (new key, default off) that restores them. This only changes how ratings are *computed*. No state is rewritten. Ratings fall on the next recompute for band users, so tell them in the release note. | **B** |
| **C2** | Policy and consent copy say health data is **never shown to others**. True for raw values, not for derivatives. | WHOOP API Terms (accurate privacy policy); UK GDPR transparency; item 100 | `src/components/LegalPage.jsx:121`; `src/components/consent/consentCopy.js:12` | If C1(a) is fixed: add "Health data does not count toward your ratings unless you switch that on." If not fixed: say that the fitness rating counts days with health data, including from WHOOP or Oura, and that friends see the rating. | **B** |
| **C3** | **The provider grant is not revoked** on disconnect or account deletion. **WHOOP has a documented revoke endpoint** and its OAuth guide says to call it. | WHOOP OAuth guide; DPIA G22; item 67 | `netlify/functions/wearable-disconnect.js:753`; `delete-account.js:45` (TODO) | Before deleting the token row: `getFreshToken` → `DELETE https://api.prod.whoop.com/developer/v2/user/access` with the Bearer token, best effort with a 5 s timeout. Always delete the row, even if the revoke fails. Same in `delete-account.js`. For Oura, wait for Q5. Fix the wrong "no documented endpoint" notes in item 67 and `delete-account.js`. | **B** (WHOOP) |
| **C4** | `read:profile` is requested but never used. | Data minimisation; reviewer scrutiny | `netlify/functions/whoop-connect.js:23` | Remove it from `SCOPES`. Existing tokens keep working, and the next reconnect simply asks for less. | **B** (cheap) |
| **C5** | **Home-made WHOOP wordmark** (hand-drawn zigzag "W" + "WHOOP") and a ring glyph + "OURA" badge. | WHOOP Terms (no marks without written authorisation); WHOOP logo rules; Oura unknown | `src/components/VitalsHistoryCard.jsx:499` `WhoopBadge`, `:513` `OuraBadge` | Replace the SVGs with plain text: "Connected · WHOOP" / "Connected · Oura". Use an official asset only if a provider supplies one. | **B** |
| **C6** | **Proprietary metrics renamed.** WHOOP Recovery sits under a "Readiness" heading. Oura **Readiness** is stored as `recovery` and labelled "Recovery". | WHOOP guidelines ("don't rename … proprietary metrics", "don't use other metrics for our scores"); Oura Q8 | `src/components/track/VitalsPanel.jsx:98`; `src/lib/vitals/readiness.js:85`, `:120`; `src/lib/vitals/metrics.js:31`; `netlify/lib/oura.js` `mapOura` | Display only, no data change. When the row's score came from a device, label it by provider: "WHOOP Recovery" or "Oura Readiness" (use `sourceLabel` / the connected flags today; an additive per-row source key such as `recoverySrc` could come later). Keep "Readiness" only for Vantage's own computed score when no device is linked. Do **not** rename the stored key. | **B** |
| **C7** | **Recovery colour** is Vantage gold `#d4a017`, not WHOOP's bands. | WHOOP guidelines (fixed recovery colours) | `src/lib/vitals/metrics.js:31`; readiness ring in `VitalsPanel.jsx` | When the value is WHOOP's, colour it by band: `#16EC06` ≥ 67, `#FFDE00` 34–66, `#FF0026` ≤ 33. Otherwise keep theme colours. Check contrast on Cream. | **L** |
| **C8** | **Attribution is incomplete.** Some surfaces say "wearable" instead of naming the provider. | WHOOP guidelines ("data from WHOOP communicates it as such") | `src/components/mobile/MobileWidget.jsx:716` (`'wearable'`); `readiness.js:120` ("Your wearable's own recovery score"); hub/desktop vitals widgets; auto-tick provenance text (`autoLog.js` `sourceById`) | Name the provider: "WHOOP", "Oura", or "WHOOP + Oura" when both apply. | **L** |
| **C9** | **History kept after disconnect**, with no in-app way to remove only band data. | WHOOP §4 (no databases or permanent copies unless the data owner authorises); Oura Q4 | `wearable-disconnect.js` header; disconnect confirms at `VitalsHistoryCard.jsx:276` / `:442` | Keep the current default (CLAUDE.md data safety) and make it an explicit choice. The disconnect dialog offers "Keep my synced history" (default) or "Also delete WHOOP-synced values". The second is user-initiated and confirmed, and removes only `whoop-` burn entries and the band-only keys. It leaves `sleep`/`rhr` alone because they may be hand-entered. Add one line to the consent copy: "Synced values stay in your account until you delete them." Change this only if a provider requires deletion. | **L** |
| **C10** | Consent is enforced only on the device. The crons keep pulling after consent is withdrawn. | WHOOP §2 (express authorisation); DPIA G1; item 98 | `whoop-cron.js` `syncOne`; `oura-cron.js` `syncOne`; `whoop-sync.js`; `oura-sync.js` | Before fetching, read `state->consent->health` (one JSON path) and skip on `declined`. Or have consent withdrawal call `wearable-disconnect` for each linked provider. | **L** |
| **C11** | Hitting WHOOP's 10-member cap shows a bare "WHOOP connect failed (denied)". | User experience during review | `whoop-callback.js` (`q.error` → `denied`); `VitalsHistoryCard.jsx` ~`:270` | See §5: a server-side allow-list plus a clear message. | **L** |
| **C12** | Oura errors are swallowed. A lapsed membership (Gen3/Ring 4) or a revoked grant shows as "Synced 0 days". | Oura membership rule; DPIA accuracy | `netlify/lib/oura.js:100` | Port the `whoopList` pattern: return `{ records, error }`, throw when every collection fails, and map 401 → reconnect and 403 → "Oura needs an active membership for other apps to read your data". Record `ouraLastError` the way `whoopLastError` is recorded. | **L** |
| **C13** | WHOOP's daily limit is shared by on-open syncs, which have no global budget. Around 400–600 daily-active WHOOP users would exhaust 10,000/day. | WHOOP rate limits | `src/lib/whoopClient.js:72` (10-minute per-tab throttle); `whoop-sync.js` | Ask for an increase in the approval request. Later, add a server-side "synced < 60 min ago → return cached/empty" check in `whoop-sync` using `whoop_tokens.updated_at` (already bumped by refresh; no schema change), and handle 429 + `X-RateLimit-Remaining`. | **A** |
| **C14** | Connect does not work inside the native app. | Reviewer can't test natively; item 115 | `VitalsHistoryCard.jsx` `connect()`; `oauthState.js` (cookie-bound) | Item 115. Until then, submit the **web** flow to WHOOP and Oura, and hide the panels in the native build (§5). | **B** for native |
| **C15** | Tokens are stored as plain text columns (disk-level encryption only). | Good practice; reviewers may ask | `supabase/whoop_schema.sql`, `oura_schema.sql` | Optional: move them into Supabase Vault / pgsodium. This is a migration (owner-run SQL) and the functions would need changing, so it is not needed for approval. Describe it honestly as "encrypted at rest by the platform; RLS service-only". | **A** |
| **C16** | WHOOP/Oura data passes through Netlify functions whose region is not set (likely US). | Transfer analysis; DPIA G5; item 106 | `netlify.toml` (no region) | Confirm the region. Name the US transit in the policy if applicable. WHOOP is itself US-based, so this mainly matters for UK GDPR. | **A** |
| **C17** | AI: compliant today, but only through an env flag. | WHOOP §4.2; Oura §4(d) | `netlify/lib/coachWearableGuard.js`; `src/lib/coach/wearableProvenance.js` | Keep `AI_WEARABLE_DATA_ALLOWED` and `VITE_AI_WEARABLE_DATA_ALLOWED` unset. Oura's agreement bans **prompting** a model with its data, so for Oura the flag may never be set, whatever WHOOP says. Consider a test that fails the build if `netlify.toml` sets either flag. | OK |

### Decision for the owner

1. **D1: wearables in ratings.** Choose one:
   - (a) exclude WHOOP/Oura-derived inputs from ratings and the heatmap now
     (**recommended**: fastest route to "compliant" for both providers, and
     it settles DPIA G10 for wearables);
   - (b) exclude by default, and add a default-off opt-in once WHOOP and
     Oura confirm it is allowed;
   - (c) keep as is and ask first (**not recommended**: it is a live §4
     issue now).
2. **D2: WHOOP access while unapproved.** Choose one:
   - keep it open (WHOOP's cap stops the 11th user with a WHOOP error);
   - add a **server-side allow-list** now (**recommended**: clear message,
     and a slot stays free for the reviewer).
3. **D3: Oura.** Register now and keep it to ≤ 10 invited users until Oura
   answers (**recommended**). Or don't register until the answers arrive.
4. **D4: disconnect behaviour.** Keep history by default and add an
   explicit "also delete" option (**recommended**). Or keep today's
   behaviour.
5. **D5:** approve the display-only branding fixes (C5–C8). None of them
   changes data.
6. **D6:** approve removing `read:profile` (C4).
7. **D7: native release.** Ship the first store build with WHOOP/Oura
   hidden (no hardware claims, no item 115 dependency). Or hold the release
   until both approvals and item 115 are done.
8. **D8:** the expected connected-member numbers and the rate-limit
   increase to ask WHOOP for.
9. **D9:** which legal entity and role inbox appear on both developer
   accounts. Move both apps to company-owned logins once the company exists.
10. **D10:** confirm `AI_WEARABLE_DATA_ALLOWED` stays unset. For Oura, treat
    it as permanent unless Oura says otherwise in writing.

---

## 5. If approval is refused or delayed

**Today, WHOOP is open to every signed-in account**
(`VitalsHistoryCard.jsx:187`), but WHOOP will only let 10 members link. If
nothing changes, the 11th person to press Connect bounces off WHOOP's error
page and sees "WHOOP connect failed (denied)". Oura is inert until its keys
are set, and then it hits the same wall at 10.

### 5.1 While pending (recommended now)

- **A server-side allow-list for connect.** In `whoop-connect` /
  `oura-connect`, after `requireUser`, allow only accounts on a list. That
  can be an env var `WHOOP_ALLOWED_USERS` (comma-separated UUIDs; no SQL) or,
  later, a `wearable_access` table (owner-run SQL, RLS service-only,
  `on delete cascade`). This has to be server-side: `useIsOwner` is a UI
  gate, not access control (CLAUDE.md).
  - **Accounts already connected keep syncing.** Don't touch `whoop_tokens`.
  - Return
    `{ error: 'WHOOP linking is limited while WHOOP reviews Vantage.', limited: true }`.
- **The panel shows that message** instead of a broken button: "WHOOP
  linking is limited while WHOOP reviews Vantage. Everything else works as
  normal, and you can log sleep, heart rate and workouts by hand on Track."
  Do **not** collect emails for a waiting list. The waitlist was removed for
  data-protection reasons (item 101).
- **Map a provider `error=access_denied` / cap error** in the callback
  redirect to a friendly `?whoop=limited`, as distinct from the user
  pressing Cancel.
- **Keep one slot free for the reviewer** (§2.4).
- **Native build:** hide both panels (as Apple Health is compiled out). Keep
  WHOOP/Oura out of the store listing, screenshots and "syncs from …" copy
  (items 115, 119), so a reviewer never meets a dead feature. The web build
  keeps them.
- Product copy (tutorial, Track help, consent copy) should say "WHOOP and
  Oura (limited beta)" or just leave them out, rather than promising them to
  everyone.

### 5.2 If WHOOP or Oura refuses

1. Read the reasons. Most refusals on record are about branding, privacy
   policy accuracy or scopes, which C2–C8 already cover. Fix them and
   resubmit through Open Request.
2. While refused, the integration is **owner and invite-only (≤ 10)**,
   enforced server-side as above. It is invisible in native builds.
3. If refused outright for good:
   - stop new connects;
   - revoke existing grants (C3) and delete the tokens;
   - stop the cron (`pausedCron('sync','whoop-cron')`, then remove it from
     `netlify.toml`);
   - tell connected users in the app.

   **Already-synced values stay in each user's account** unless the
   provider's terms demand deletion. If they do, deletion is a one-off,
   explicit, owner-approved job that removes only band-sourced keys and
   entries, never a whole-state rewrite (CLAUDE.md data safety).
4. **The fallback is manual entry**, which works today. Longer term:
   HealthKit / Health Connect, since many WHOOP and Oura users already sync
   into them (DPIA review trigger, G26). That is a separate, larger piece of
   work.

### 5.3 If delayed past launch

Launch without wearables in native and with the web allow-list in place.
Nothing in the core app depends on WHOOP or Oura. Calories burned falls
back to the activity log and resting estimate (`dayBurn`), and readiness
falls back to Vantage's own manual-input score. Chase the request monthly.
The forum record suggests status updates are rare, so keep the request
open rather than filing duplicates.

---

## 6. Next steps, in order

1. **Owner, WHOOP dashboard (today):** check the redirect URL against
   `…/whoop-callback` byte for byte (item 31). Fill in App Name, role Contact
   Email(s) and Privacy Policy URL. Note how many of the 10 slots are used.
2. **Decide D1, D2, D4, D6, D7** (§4).
3. **Code, one small PR, before submitting:**
   - C4 (drop `read:profile`);
   - C3 (WHOOP revoke on disconnect and deletion);
   - C5–C8 (labels, colours, attribution: display only);
   - C1 per D1;
   - C2 (policy and consent copy);
   - C11 + §5.1 allow-list.

   Verify with the Playwright harness on heavy data, per CLAUDE.md. Then do
   C10 (server consent check) and C12 (Oura errors).
4. **Capture the §2.3 screenshots** from the fixed build. Add before/after
   pairs to the feedback artifact (these are visual changes outside the
   Upgrade section).
5. **Submit WHOOP App approval** (§2.1–2.4) with the rate-limit request and
   the §3.3 questions. Record the date in item 75.
6. **Register the Oura app** (§3.1). Set the env vars, test with the owner's
   ring, keep it to ≤ 10 invited users, and **send the §3.2 email**. Record
   it in item 30.
7. **File both replies with the DPIA** (G7). If answers change the AI or
   ratings position, update DPIA §2.4/§4.2, the policy and
   `docs/STORE_PRIVACY_LABELS.md`.
8. **Update STARTUP_REQUIREMENTS statuses:**
   - 30 (registered / waiting on Oura);
   - 31 (checked);
   - 75 (submitted);
   - 67 (WHOOP revoke now possible; Oura pending).
9. **Before the native submission:** item 115 (native OAuth) or hide the
   panels (D7). Never advertise either integration in a store listing until
   it is approved for everyone.
10. **After approval:** remove the allow-list, watch the morning
    `whoop-cron` "not reached" counts and the 429s, and redo C13 if usage
    grows.

---

## Sources (search excerpts, 2026-10-20; pages not directly readable from the drafting environment)

- WHOOP App Approval: https://developer.whoop.com/docs/developing/app-approval/ [official]
- WHOOP Rate Limiting: https://developer.whoop.com/docs/developing/rate-limiting [official]
- WHOOP API Terms of Use (effective 2026-10-06): https://developer.whoop.com/api-terms-of-use/ [official]
- WHOOP OAuth 2.0 (revoke on disable): https://developer.whoop.com/docs/developing/oauth/ and API reference https://developer.whoop.com/api/ [official]
- WHOOP Brand & Design Guidelines: https://developer.whoop.com/docs/developing/design-guidelines/ and the linked PDF [official]
- WHOOP step count post: https://www.community.whoop.com/t/step-count-now-available-in-the-whoop-developer-api/16424 [official, community site]
- WHOOP approval waits and tiers: community.whoop.com threads 16470, 15892, 15723, 15635, 15246, 12638, 16372 [community]
- Terra, WHOOP API in 2026: https://tryterra.co/blog/whoop-api-data-access-permissions-limitations-2026 [secondary]
- Terra help centre, WHOOP approval: https://docs.tryterra.co/help-center/help-topics/connecting/getting-a-provider-developer-app-approved/whoop-approval-slow-no-expedite [secondary]
- whoop-mcp (DELETE /v2/user/access): https://github.com/vicens-aniol/whoop-mcp [secondary]
- Oura API v2 docs: https://cloud.ouraring.com/v2/docs and https://cloud.ouraring.com/docs/ [official]
- Oura API and MCP Agreement (effective 2026-06-08): https://cloud.ouraring.com/legal/api-agreement [official]
- Oura API and membership: https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API [official]
- Terra, Oura API for AI apps: https://tryterra.co/blog/oura-api-ai-apps-access-permissions-commercial-restrictions [secondary]
- Nango, Oura rate limit: https://nango.dev/docs/integrations/all/oura [secondary]
- Oura authentication page: https://api.ouraring.com/docs/authentication [official]

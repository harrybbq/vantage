# Store submission pack: App Store and Google Play

Draft, 2026-10-20. Covers STARTUP_REQUIREMENTS item **73** (reviewer kit) and
the parts of item **74** not already drafted elsewhere: the Apple age rating,
Play content rating and target audience, export compliance, the Play
declarations (financial features, ads, news, permissions, account deletion), the
store listing and the order to submit in.

**Out of scope here, see `docs/STORE_PRIVACY_LABELS.md`:** Apple App Privacy
labels, Play Data safety, and the detailed Play **Health apps declaration**
(its §3.2). This pack only points to them.

Everything below describes the **native build only**: `npm run cap:*` sets
`VITE_NATIVE_BUILD=true` (`package.json` scripts `cap:sync` / `cap:android` /
`cap:ios`). With that flag set, these are compiled out
(`src/lib/native/ownerSurfaces.js`, `src/App.jsx:66-69`):

- the Upgrade section: Career, Diet, Rotation, Review/Books, Lifts, and the Security console with its moderation queue
- the admin rating and coin editor (`AdminEditModal`)
- the Lifts mini-bar
- the Apple Health import and Shortcut panel (`src/components/SettingsSection.jsx:26-28,1000-1008`)
- rotation shifts on the calendar (`src/components/TrackSection.jsx:478-479`)
- the trading widget (`src/lib/trading/enabled.js`)
- the owner check: `useIsOwner` always returns false inside the shell (`src/hooks/useIsOwner.js:78`)

So **Apple Health does not ship in the native app.** The iOS Shortcut that
posts to `netlify/functions/health-sync` is owner-only, it is web-only, and it
is not HealthKit (there is no HealthKit plugin in `package.json`). In the store
build, vitals come from WHOOP, from Oura, or from manual entry.

**Sources.** Apple's App Review Guidelines and its age-rating definitions page were
fetched on 2026-10-20 and are quoted where it matters. Google's Play Console
help pages could not be reached from this session (support.google.com failed DNS
lookup). Google answers are therefore written from knowledge as of mid-2026.
**Check each one against the form's actual wording in Play Console** before
submitting. Apple's export-compliance page was also only partly readable; see §4.1.

Placeholders in `[square brackets]` need filling in by the owner. Never commit
the real values. This repo is public.

---

## Contents

1. [Reviewer kit](#1-reviewer-kit)
2. [Apple age rating answers](#2-apple-age-rating-answers)
3. [Google Play content rating (IARC), target audience, Families](#3-google-play-content-rating-iarc-target-audience-families)
4. [Declarations](#4-declarations)
5. [Store listing drafts](#5-store-listing-drafts)
6. [Pre-submission checklist](#6-pre-submission-checklist)
7. [Rejection risks](#7-rejection-risks)
8. [Gaps found while writing this pack](#8-gaps-found-while-writing-this-pack)

---

## 1. Reviewer kit

### 1.1 Demo accounts

Apple 2.1(a): *"include demo account info (and turn on your back-end service!)
if your app includes a login."* Play asks for the same under **App content →
App access**. Vantage needs a login for everything, so both stores need
credentials.

Create **four** fictional accounts, all on a company mailbox (blocked on the
domain, item 72). They must never belong to a real person:

| Account | Purpose | Tier | Seed |
|---|---|---|---|
| **A: Pro demo** `[reviewer-pro@company-domain]` | The account reviewers explore: every screen populated | Lifetime grant (complimentary) | Full seed (§1.2) |
| **B: Free demo** `[reviewer-free@company-domain]` | Test the purchase with a sandbox Apple ID or a Play licence tester | Free | Five active habits, so adding a sixth opens the paywall (free cap is 5, `src/hooks/useTierLimits.js:16`) |
| **C, D: demo friends** `[demo-friend-1@…]`, `[demo-friend-2@…]` | Give A friends, messages and a group, so a reviewer can report or block **without touching a real user** | Free | Light seed, plus fictional names and photos |

**Granting Pro to A.** `tier` is server-owned. The only route is
`supabase/lifetime_grants.sql`, run in the Supabase SQL editor (as service role):

1. Sign in to A once, so the `auth.users` and `profiles` rows exist. The file
   says an account that has never signed in matches zero rows.
2. In the SQL editor (not in the repo), add A's email to the `grantees` list,
   run the update, then check that the verify query shows `tier = 'lifetime'`.
3. Don't commit the edited file. The committed version only holds placeholders.
4. After review, decide whether to keep A for later updates (recommended) or
   revoke it with the file's own revoke block.

Why a grant and not a sandbox subscription: sandbox subscriptions expire within
minutes, and `netlify/functions/revenuecat-webhook.js:150-152` ignores sandbox
events. A sandbox-bought Pro would therefore never reach `profiles.tier`, which
is what the AI functions check (see §8, gap P2).

**Account-age caps matter.** Ratings count only real ISO day keys, and day
counts are capped by account age (item 44). Back-dated history does not raise
the rating card on a new account. **Create A, C and D at least 4–6 weeks before
submitting** and use them a little each week, so the rating, streaks and
league history look lived-in.

**Keep the demo accounts off the public board.** Leave `leaderboard_optin` and
handle search **off** for A–D (Settings → Privacy). New accounts already default
to off (`supabase/audit_schema_2026_10.sql`, item 68). Fake accounts with seeded
data must not rank against real users. A, C and D compete only in their own
invite-only group.

### 1.2 What to seed in Account A, screen by screen

Seed by hand through the app's own UI, signed in to A on the web build. That way
the data has exactly the shape the code expects, and it uses no SQL against
`user_data`. CLAUDE.md treats `user_data` rewrites as off-limits, and that rule
applies to demo rows too. If a seed script is ever wanted, it must be reviewed
by the owner before it runs. It must resolve one user id from A's email, refuse
to run if that row's state is already meaningful (`vb_state_meaningful`), insert
`nutrition_log` rows only, and never touch any other row. That script is not
written here.

| Screen (how to reach it) | Seed | Why |
|---|---|---|
| **Hub** (tab 1) | Widgets: Vitals, Macros, Calories Burned, Goals, Body Goal (Pro), Market (5 tickers), News. Prime cards: Achievements, Habits, Holidays, Savings. Pick the **Dark OS** theme for screenshots. | First screen a reviewer sees; shows Pro widgets |
| **Track** (tab 2) | Five trackers, ticked on most days for 6+ weeks (multi-select days on the calendar). Food log: 14 days of meals via search and barcode, so `nutrition_log` has rows. Vitals: weight, sleep and resting HR entered by hand for 6+ weeks. Body: a weight goal. | Food, vitals and calendar screens |
| **Holiday** (tab 3) | One upcoming trip (destination, dates, budget, packing), two past trips, a few visited countries | The climate and FX panel needs a real place (`netlify/functions/destination-brief.js`) |
| **Habits** (tab 4) | Four habits: two build habits, one break habit with a streak, one cut-down plan. Use neutral names, e.g. "Late-night snacks" rather than alcohol or tobacco (see §2, row "Alcohol…") | Shows streaks and relapse handling |
| **More → Achievements** | Eight goals with milestones, three completed, so some Visions/Honours unlock | Goal map, visions catalogue |
| **More → Shopping** | Ten wish-list items with coin costs, two bought | Coin loop |
| **More → Friends** | C and D as accepted friends. A short, friendly DM thread with each (five or six messages). | Lets reviewers test DMs, report and block |
| **More → Leaderboard → My Group / Division** | A group of A, C and D, created by A, with a fictional group name and crest | Group board and report flag |
| **Hub → coach** | Leave AI consent **ungranted**, so the reviewer sees the consent ask before the first AI call (`src/hooks/useDailyBrief.js:59`) | Shows the consent flow (5.1.1(ii)) |
| **Settings → Account** | Fictional name, photo (screened before others see it, `src/lib/friends/avatarScreen.js`), handle | Profile, export, delete |

Do **not** connect WHOOP or Oura to any demo account. That would put a real
person's health data into a shared account (§1.4).

### 1.3 Sandbox and licence testers

**Apple**
- App Store Connect → Users and Access → **Sandbox** → add 2–3 sandbox Apple IDs
  for the owner's own TestFlight testing. App Review uses its own sandbox
  accounts, so give reviewers none, only demo account B.
- Create the subscription group "Vantage Pro" with **Pro Monthly** and
  **Pro Yearly**. Give each a display name, description, prices and a **review
  screenshot** of the paywall. Submit both **with the first binary**: a first
  in-app purchase has to be reviewed together with an app version.
- Do not create a lifetime product. It is never sold, and the client filters it
  out anyway (`UNSELLABLE`, `src/components/PaywallModal.jsx:54`).
- RevenueCat: offerings `$rc_monthly` and `$rc_annual` in the current offering
  (`PaywallModal.jsx:43`), entitlement id `pro` (`src/lib/billing/revenuecat.js:186-197`).

**Google**
- Play Console → Settings → **License testing** → add the owner's test Google
  accounts. Their purchases are free test purchases, and subscriptions renew
  on an accelerated schedule.
- Upload to the **Internal testing** track first. As an organisation account,
  Vantage is exempt from the 12-testers-for-14-days rule (item 6).
- Same products in Play: subscription "Vantage Pro" with monthly and yearly base plans.

**Before either store sees a build**
- Set `config.pro_live` to `'true'`. The seed in `supabase/paywall_schema.sql:46`
  is `'false'`, and while it is false the paywall shows **"Join the waitlist"**
  instead of the store products (`src/hooks/useSubscription.js:73`,
  `PaywallModal.jsx:164,304-309`). Item 101 removes the waitlist itself.
- Do a real-device purchase on both platforms (item 17).
- Decide how a reviewer's **sandbox** purchase unlocks server-checked Pro
  features (gap P2, §8).

### 1.4 Features that need hardware: how to let reviewers see them

WHOOP and Oura (Settings → Tools → Health & sync,
`src/components/VitalsHistoryCard.jsx:211,399`) need the user's own band or ring
and account. Reviewers will not have one.

1. **Make sure they work in the native shell first** (gap P1, §8). As written,
   the connect flow probably cannot complete inside the app. Oura also answers
   "Oura is not set up on this site yet." until item 30 is done
   (`netlify/functions/oura-connect.js:37`). If either is still broken at
   submission, hide that panel in the native build rather than shipping a button
   that fails (2.1).
2. **Record a screen video** on a physical phone running the release build. Use
   a throwaway test account (not A–D). Show: Settings → Tools → Connect WHOOP →
   health consent sheet → WHOOP sign-in → back in Vantage → Sync → Vitals history
   filled. Repeat for Oura. Then disconnect and delete the throwaway account.
   Crop or blur the numbers if the owner would rather not show their own health
   data.
3. Attach the video in **App Review Information → Attachment** (Apple). For Play,
   put an unlisted link in the App access instructions.
4. Account A's vitals are entered by hand, so the Vitals screens are populated
   without a device. WHOOP-only rows (HRV, recovery, strain) are deliberately
   hidden for accounts that have never connected
   (`VitalsHistoryCard.jsx:30-37`). Say so in the notes, so their absence does
   not read as a bug.

### 1.5 App Review Information (Apple)

| Field | Value |
|---|---|
| Sign-in required | Yes |
| User name / Password | Account A `[reviewer-pro@company-domain]` / `[password]` |
| Contact | `[First] [Last]`, `[phone with country code]`, `[support@company-domain]` (the owner, using the company mailbox) |
| Notes | Text below. Stay under the field's limit (about 4,000 characters). Put account B in the notes. |
| Attachment | WHOOP/Oura video (§1.4) |

**Review notes (Apple), ready to paste once the placeholders are filled:**

```
WHAT VANTAGE IS
Vantage is a personal dashboard for habits, goals, food, sleep and vitals,
savings and trips. People earn in-app coins for completing their own trackers.
Coins have no cash value and cannot be bought. Social features are optional:
friends, direct messages between accepted friends, private invite-only groups
with a weekly league, and an opt-in leaderboard.

DEMO ACCOUNTS (both fictional, as are their friends and group)
1) Pro, populated with sample data: [email] / [password]
2) Free, to test buying Pro with your sandbox Apple ID: [email] / [password]
Sign in with email and password on the first screen.

WHERE THINGS ARE (bottom tabs: Hub, Track, Holiday, Habits, More)
- Settings: tap the "V" logo at the top left, or open the left drawer and
  tap "Profile & settings".
- Delete account: Settings > Account > bottom of the page > Delete account.
  After two confirmations, it deletes the login and all data at once.
- Report and block: More > Friends > a friend's card > "..." > Report or Block.
  In a conversation: "..." > Report abuse / Block user. On boards: More >
  Leaderboard > the flag icon on any row. Reports go to a moderation queue that
  we review within 24 hours. A blocked user cannot message or send friend
  requests to the person who blocked them.
- Filtering: display names, handles and group names pass a word filter. Profile
  photos and group pictures are screened before other people see them.
- Restore purchases: at the bottom of the Pro screen, and in Settings > Tools >
  Subscription.

IN-APP PURCHASE
Vantage Pro, an auto-renewing subscription, monthly or yearly (one group). To
test it, sign in with the Free account and tap More > Go Pro, or add a sixth
habit on the Habits tab. The Pro demo account holds a complimentary grant for
review. It is not a product, and nothing in the app unlocks Pro except the
App Store purchase.

FEATURES THAT NEED HARDWARE
WHOOP and Oura sync (Settings > Tools > Health & sync) need the user's own WHOOP
band or Oura ring and account. The attached video shows the whole connect-and-
sync flow on a device. Everything else works without them. The Pro account's
vitals were entered by hand. Rows that only WHOOP supplies (HRV, recovery,
strain) stay hidden until a WHOOP is connected.
Vantage does not use HealthKit and does not read Apple Health.

AI FEATURES
The AI daily brief (Pro, on the Hub) and identifying a meal from a photo (Track,
food log, camera; 3 free scans a week). Each asks for consent before any data is
sent. Every brief is labelled "AI-generated - not medical advice". The coach is
instructed never to diagnose, and never to give treatment, medication or
calorie advice.

PERMISSIONS
Camera: scanning food barcodes, and an optional meal photo. Notifications:
asked only after the person opts in on our own screen first.

OTHER
- Sign in with Apple appears next to Google at every screen width, iPad
  included.
- This build has no hidden, server-unlocked or developer-only features.
  Everything is reachable from the tabs above.
- Minimum age 13, confirmed at sign-up. No ads. No tracking.
```

### 1.6 App access instructions (Google Play)

Play Console → App content → **App access** → "All or some functionality is
restricted" → add one set of instructions per account:

- **Name:** "Pro demo (sample data)". **Username / password:** account A.
  **Other information:** *"Fictional account with complimentary Pro. Settings:
  tap the V logo at top left. Delete account: Settings > Account > bottom.
  Report/block: More > Friends > friend card > '...', or the flag icon on
  Leaderboard rows. WHOOP/Oura sync needs the user's own device; video:
  [unlisted link]."*
- **Name:** "Free demo (test purchase)". **Username / password:** account B.
  **Other information:** *"Use a licence-test Google account to buy Pro: More >
  Go Pro, or add a sixth habit. Restore: Settings > Tools > Subscription."*

Play's field limits are shorter than Apple's. Trim if the form refuses the text.

---

## 2. Apple age rating answers

App Store Connect → App Information → **Age Ratings**. This is the 2025+
questionnaire with the 4+ / 9+ / 13+ / 16+ / 18+ categories. The definitions
and thresholds quoted here are from Apple's "Age ratings values and definitions"
page, fetched 2026-10-20.

| Group | Item | Proposed answer | Reason from code | Rating effect |
|---|---|---|---|---|
| In-App Controls | Parental Controls | **No** | No parent or guardian tools exist | none |
| | Age Assurance | **No** | 13+ is a self-declared checkbox (`src/components/AuthScreen.jsx:386-395`, `src/components/TermsAcceptanceSheet.jsx:93-105`). Apple counts as age assurance only things like the Declared Age Range API, age estimation or ID checks, and Vantage uses none of them. | none |
| Capabilities | Unrestricted Web Access | **No** | No embedded browser. The in-app browser view (`@capacitor/browser`) opens only for sign-in (`src/lib/native/deepLinks.js:134`) and subscription management (`src/lib/billing/revenuecat.js:302`). News and link widgets open the publisher's page outside the app (`netlify/functions/news-today.js:1-12`). | Yes would make it 16+ |
| | User-Generated Content | **Yes** | Display names, handles, profile photos, group names and crests are shown to other users. DMs too. | 4+ |
| | Messaging and Chat | **Yes** | Direct messages between **accepted friends only**, with blocks respected (`messages_insert` policy in `supabase/security_hotfix_2026_09_30.sql:72-83`; `src/lib/friends/messages.js:175`) | 4+ |
| | Social Media | **No** (owner to confirm) | No feed that "visibly spreads content to many users". The global board shows name, avatar and rating only, and is opt-in. Groups are invite-only (`src/components/groups/GroupSetup.jsx`). Trending was removed (item 90). | Yes would make it 13+, and **16+ in Australia** |
| | Advertising | **No** | No ad SDK in `package.json`, and no ad network found in `src/`, `netlify/` or `index.html` | none |
| Mature Themes | Profanity or Crude Humor | **None** | None | — |
| | Horror/Fear Themes | **None** | None | — |
| | Alcohol, Tobacco, or Drug Use or References | **Infrequent** (or **None** after a copy change) | The break-a-habit form's placeholder reads "e.g. Alcohol, Fast Food, Smoking..." (`src/components/Modals.jsx:1442`), and the cut-down plan is written around drinking days (`src/lib/habits/cutdown.js:5-6`). These are references in a quitting context. Either keep **Infrequent**, which costs nothing because the result is 13+ anyway, or change the placeholder to neutral examples and answer **None**. | Infrequent makes it 13+ |
| Medical or Wellness | Medical or Treatment Information | **None** | No diagnosis, medication or treatment content. The coach is told never to diagnose or give treatment, dose or calorie advice, and to refer people to a GP when the data looks concerning (`netlify/functions/ai-coach-daily.js:84-89`). Briefs are labelled "AI-generated · not medical advice" (`src/components/CoachBriefPanel.jsx:128`). The Terms have a health disclaimer (`src/components/LegalPage.jsx:283-290`). | Infrequent would make it 13+ |
| | Health or Wellness Topics | **Yes** | Calorie and macro tracking, weight goal, sleep, resting HR, exercise | 9+ |
| Sexuality or Nudity | Mature or Suggestive Themes / Sexual Content or Nudity / Graphic Sexual Content and Nudity | **None / None / None** | None in the app's own content. User photos are screened (`netlify/functions/avatar-check.js`; crests in `netlify/functions/groups.js:315-318` via `netlify/lib/imageModeration.js`). | — |
| Violence | Cartoon or Fantasy / Realistic / Prolonged Graphic or Sadistic / Guns or Other Weapons | **None** ×4 | None | — |
| Chance-Based Activities | Gambling | **No** | Coins "cannot be purchased, sold, transferred or redeemed for cash" (`LegalPage.jsx:280`) | — |
| | Simulated Gambling | **None** | No spins, draws or random rewards (searched `src/`) | — |
| | Contests | **Frequent** | Weekly group leagues and divisions with coin rewards (`src/components/LeaderboardSection.jsx:22-26`, `netlify/functions/settle-leagues.js`), plus a ranked rating leaderboard (`docs/RANKING_SYSTEM.md`). This is a core loop, not an occasional event. | 13+ |
| | Loot Boxes | **No** | No randomised paid items | — |

**Calculated rating: 13+** (driven by Contests: Frequent, plus the alcohol
references if those are kept).

**Age Categories and Override:** choose **Not Applicable** if Apple calculates
13+. If any answer above is softened and Apple calculates 9+, choose **Override
to Higher Age Rating → 13+**. Apple's help page says: *"If your app has a EULA
with minimum age requirements above the calculated rating, you must override to
a rating that meets them."* The Terms say *"You must be at least 13 years old"*
(`src/components/LegalPage.jsx:257`), and sign-up enforces it on email and on
OAuth (`AuthScreen.jsx:136,238`).

**Made for Kids:** No. **Age Suitability URL (optional):**
`https://vantagevision.netlify.app/terms` until a company domain exists.

Devices on an OS older than 26 show the legacy scale. Expect **12+** there.

**Check at submission time:** US state app-store age laws and Apple's Declared
Age Range API. Vantage does not call that API. Whether a 13+ app with messaging
must call it depends on rules that were still changing at the time of writing.
Confirm in App Store Connect when submitting.

---

## 3. Google Play content rating (IARC), target audience, Families

### 3.1 IARC questionnaire

Play Console → App content → **Content rating**. Use the company email for the
IARC certificate. Answers are written from knowledge; match them to the form's
wording.

| Question area | Answer | Reason |
|---|---|---|
| Category | **"All Other App Types"** (the utility / productivity / communication option, not Game, not Social Networking) | Vantage's main purpose is personal tracking. Social features are secondary and opt-in. If the form's wording puts friend messaging under "Social", picking that category changes the questions, not the outcome, because user interaction is declared below anyway. |
| Violence, blood, fear | **No** | — |
| Sexuality, nudity | **No** | — |
| Language (profanity, crude humour) | **No** | Developer content has none. User text is not rated, but it is filtered (§7, 1.2). |
| Controlled substances (alcohol, tobacco, drugs) | **No** if the habit placeholder is changed (§2). Otherwise answer **Yes: references only, in the context of quitting** and accept what IARC assigns. | Keep this consistent with the Apple answer |
| Gambling (real or simulated) | **No** | Coins have no cash value and cannot be bought |
| Users can interact or exchange content (text, images) | **Yes** | DMs between friends; names, photos and group crests visible to others |
| Shares the user's current physical location with other users | **No** | Weather uses an IP lookup on the server and is never shown to others (`netlify/functions/weather.js`). Holiday destinations are typed by the user and not shared. |
| Allows purchase of digital goods | **Yes** | Pro subscription |
| Unrestricted internet access (browser or search engine) | **No** | As in §2 |
| Is the app a news or educational product | **No** | News is one optional hub widget |

**Expected outcome:** the lowest age band in most regions (ESRB Everyone, PEGI 3,
USK 0, or close to it), with the interactive elements **"Users Interact"** and
**"In-App Purchases"**. A content rating says nothing about minimum age. That is
set by the Terms and the target audience below.

### 3.2 Target audience and content

Play Console → App content → **Target audience and content**.

- **Age groups:** the recommendation is **13–15, 16–17 and 18+**. That matches
  the Terms and the in-app 13+ gate. Selecting **18+ only** is the narrower
  alternative (owner decision, also `docs/STORE_PRIVACY_LABELS.md` §5 Q6). The
  teen bands bring Play's teen expectations and the UK Children's Code into
  scope (DPIA, item 8). Teen defaults are already private: search and
  leaderboard off, streak sharing opt-in (item 68).
- **Never select an under-13 band.** Doing so pulls the app into the
  **Families policy**. That means Families-certified SDKs only, the Teacher
  Approved / Designed for Families rules, child-directed privacy terms, and
  restrictions on precise location and on social features for children. Vantage
  meets none of those by design.
- **"Could the app unintentionally appeal to children?"** **No.** No cartoon
  mascots, child-directed themes or games. The coin and rating mechanics are
  adult-styled (Dark OS console, financial and fitness tracking).
- **Store presence:** not enrolled in Designed for Families.

---

## 4. Declarations

### 4.1 Export compliance (encryption)

**What crypto the app uses** (searched `src/` and `netlify/`):

| Use | Where | Who implements it |
|---|---|---|
| HTTPS/TLS for every network call (Supabase, Netlify functions, RevenueCat, food APIs) | `fetch` / supabase-js | The OS and WebView networking stack |
| **Passphrase-encrypted data export**: PBKDF2-SHA256 (600,000 iterations), then AES-256-GCM | `src/lib/data/exportCrypto.js:10-12,28-30,58-66,80-82`, used by `src/components/settings/DataExportCard.jsx:77` | The browser's **WebCrypto** (`crypto.subtle`). On iOS that is WebKit, backed by Apple's own crypto libraries. On Android it is the system WebView (Chromium/BoringSSL). The code says *"Nothing here is bespoke... no dependency, no hand-rolled crypto"*. |
| SHA-256 hash of the profile photo (deduplicates screening) | `src/lib/friends/avatarScreen.js:20` | WebCrypto. Hashing is not encryption for export purposes. |
| Supabase auth tokens, OAuth PKCE | supabase-js | Standard libraries, authentication only |

No proprietary or non-standard algorithm. No crypto library is bundled
(`package.json` has none). The app does not implement any algorithm itself.

**What the encrypted export means for the exemption.** Encrypting user data
(rather than only authenticating) is the part that needs a deliberate answer.
Vantage does not implement the cipher. It calls the platform's standard
WebCrypto API, the same way an app calls CryptoKit or URLSession. The use is
mass-market consumer software with standard algorithms (AES-GCM, PBKDF2). Under
the US EAR that is the usual 5D992 mass-market position (License Exception ENC
§740.17(b)(1)). As this pack understands the 2021 BIS rule change, a mass-market
end-user app no longer needs an annual self-classification report.

**Proposed App Store Connect answers** (the per-build encryption questions, or
set once in Info.plist):

1. *Does your app use encryption?* **Yes** (HTTPS and the encrypted export).
2. *What type of encryption algorithms does your app implement?* **"None of the
   algorithms mentioned above"**: the app only accesses encryption provided by
   Apple's operating system (WebKit's WebCrypto and the networking stack). It
   does not implement standard or proprietary algorithms itself.
3. Add to `ios/App/App/Info.plist` once the iOS project exists (item 13):
   ```xml
   <key>ITSAppUsesNonExemptEncryption</key>
   <false/>
   ```
   No documentation upload is expected with that answer.

**Owner decision.** Apple's help page lists *"Crypto functionality within
Apple's operating system"* among things that need a determination. It also says
*"you're responsible for all liabilities associated with misinterpretation of
export regulations or claiming exemption inaccurately."* The page could not be
fully read here. The conservative alternative is to answer **"Standard
encryption algorithms instead of, or in addition to, using or accessing the
encryption within Apple's operating system"**, claim the mass-market exemption,
and answer the France question. France controls "Secure Storage" apps, and a
passphrase-encrypted export file is arguably close to that. That path can
require an ANSSI declaration before distributing in France. **Recommendation:**
take answer 2 above, and ask the solicitor reviewing the DPIA (item 8) to
confirm it in one line.

**Google Play** has no encryption form. Export compliance is covered by the
Developer Distribution Agreement. Nothing to file.

### 4.2 Health apps declaration (Play)

Drafted in full in `docs/STORE_PRIVACY_LABELS.md` §3.2: tick Activity and
fitness, Nutrition and weight management, and Sleep management. No medical
features. Health Connect is not used. One addition from this pack: the
declaration and the listing must not mention Apple Health or HealthKit, because
neither ships (see the top of this file).

### 4.3 Financial features declaration (Play)

**Answer: "My app doesn't provide any financial features."**

- Savings pots, cash flow, income and expenses, and subscriptions are
  **manual notes the user types in**. There is no bank link, no Open Banking, no
  payments, transfers, loans, credit, insurance, crypto or trading
  (`src/components/savings/`, `src/lib/savings/derive.js`,
  `src/lib/money/recurring.js`). Subscriptions roll their own renewal dates
  forward (CLAUDE.md: "derive rather than sense").
- `supabase/bank_connections_schema.sql` is an unused foundation. No client or
  function reads it (`docs/STORE_PRIVACY_LABELS.md` Appendix A). Open Banking is
  back-burnered and owner-only (CLAUDE.md).
- The **Market** widget shows delayed public quotes for a watchlist. It has *"no
  account, no positions, no orders, nothing shared with the trading widget or a
  broker"* (`src/components/widgets/MarketWidget.jsx:7-10`). The trading widget
  is compiled out (`src/lib/trading/enabled.js`).
- The Pro subscription is store billing, which is not a financial feature.

If the form turns out to list a **"personal finance management / budgeting"**
option alongside the regulated services, it is the owner's call whether manual
savings tracking counts. Recommendation: still "none". Those options exist for
apps that hold or move money or connect to accounts.

### 4.4 Ads

- **Contains ads: No.** No ad SDK in `package.json` dependencies, and no ad,
  analytics or attribution SDK found in `src/`, `netlify/` or `index.html`.
- **Advertising ID: No**, after checking the **merged** Android manifest for
  `com.google.android.gms.permission.AD_ID` (item 102). Firebase Messaging comes
  in with `@capacitor/push-notifications`. If AD_ID appears, remove it with
  `tools:node="remove"` in `android/app/src/main/AndroidManifest.xml`.
- Apple: no App Tracking Transparency prompt is needed. Nothing tracks
  (`docs/STORE_PRIVACY_LABELS.md` §1.3).

### 4.5 Other Play App content items

| Item | Answer |
|---|---|
| News apps | **Not a news app.** News is one optional hub widget showing licensed headlines and links (`netlify/functions/news-today.js:1-12`). |
| Government apps | No |
| COVID-19 contact tracing / status | No |
| Data safety | `docs/STORE_PRIVACY_LABELS.md` §2 |
| Health apps declaration | §4.2 above |
| Photo and video permissions | **Not applicable.** No `READ_MEDIA_*` permission. Photo choosing uses `<input type="file">`, i.e. the system picker (`src/components/Modals.jsx:74,715`, `src/components/settings/AccountPanel.jsx:148`, `src/components/groups/GroupCrest.jsx:84`). |

### 4.6 Permissions and their justification text

What the app actually requests:

| Permission | Why (code) | Android | iOS |
|---|---|---|---|
| **Camera** | Barcode scanning and the optional AI meal photo: `navigator.mediaDevices.getUserMedia({ facingMode: environment })` (`src/components/CameraScanner.jsx:157`), used by `src/components/FoodSearch.jsx` and `src/components/diet/LogFoodPanel.jsx`. Also "Take Photo" from the file pickers (profile photo, background, group crest). | `android.permission.CAMERA` is **missing** from `android/app/src/main/AndroidManifest.xml`, which only has `INTERNET`. Add `<uses-permission android:name="android.permission.CAMERA" />` and `<uses-feature android:name="android.hardware.camera" android:required="false" />`. Until then the scanner cannot work natively (items 14, 102). No Play Console form is needed for CAMERA. | `NSCameraUsageDescription` (item 14). A missing string is an automatic rejection. |
| **Photo library** (system picker) | Choosing a profile photo, background or crest | None needed (system picker) | Add `NSPhotoLibraryUsageDescription` defensively. The WebView file picker uses PHPicker, which normally needs no permission, but some iOS paths still read the string. |
| **Notifications** | Push for streaks and coach nudges, asked only after Vantage's own pre-prompt (`src/components/NotificationPermissionPrompt.jsx`, `src/hooks/useCapacitor.js:168`) | `POST_NOTIFICATIONS` is requested at runtime by the push plugin (`node_modules/@capacitor/push-notifications/.../PushNotificationsPlugin.java:28`) and comes in through Firebase Messaging's manifest. No Play form. | No purpose string. Enable the Push Notifications capability and the `aps-environment` entitlement (item 15). |
| **Vibrate** | Haptics | Merged from `@capacitor/haptics` (`node_modules/@capacitor/haptics/android/src/main/AndroidManifest.xml`). Normal permission, no disclosure. | n/a |
| **Internet** | Everything | Declared | n/a |
| **Billing** | Store subscriptions | Merged from the Play Billing library via RevenueCat | StoreKit, no string |

Not requested, and should stay that way: location (weather uses a server-side
IP lookup), microphone, contacts, Health Connect, HealthKit. `capacitor.config.ts`
configures `LocalNotifications`, but that plugin is not installed, so no exact-alarm
or scheduling permission is involved.

**Proposed iOS purpose strings** (Info.plist, item 14):

- `NSCameraUsageDescription`: *"Vantage uses the camera to scan food barcodes
  and, if you choose, to photograph a meal so it can be identified. Meal photos
  are analysed and not kept. You can also take a photo for your profile or
  background."*
  - Check the second sentence against the privacy policy, which says the frame
    is not stored (`src/components/LegalPage.jsx:144`).
- `NSPhotoLibraryUsageDescription`: *"Choose a photo from your library for your
  profile picture, hub background or group picture."*

**Android in-app rationale:** show a one-line explanation before the first
camera request. The AI path already asks for AI consent first
(`CameraScanner.jsx:350`). The barcode path should say *"Camera is used only to
read the barcode"*.

### 4.7 Account deletion

- **In app:** Settings → Account → **Delete account**, at the bottom
  (`src/components/SettingsSection.jsx:655-678`). Two confirmations
  (`SettingsSection.jsx:556-557`) call `netlify/functions/delete-account.js`.
  That deletes the auth user, and the user tables cascade from it. The copy warns
  that store subscriptions must be cancelled in the store and says how (item 61).
- **Web URL (Play requires one; Apple accepts it as supporting info):**
  **`https://vantagevision.netlify.app/delete-account`**, planned. It must work
  **before sign-in**, routed like `/privacy` (`src/App.jsx:1080-1083`). It must
  explain how to delete in the app, offer a way to request deletion without the
  app, and say what is deleted, what is kept and for how long. The content is
  already drafted in `docs/STORE_PRIVACY_LABELS.md` §2.5.
- **Gap:** Sign in with Apple tokens are not revoked on deletion (gap P8, §8).

---

## 5. Store listing drafts

**Name and trademark are provisional.** The trademark check on "Vantage" is part
of item 75. "Vantage" alone is likely taken on both stores. Store titles must be
unique on Apple, and Play rejects confusing titles. Draft with a descriptor, and
confirm before buying any assets.

### 5.1 Names

| Field | Limit | Draft (provisional) | Alternatives |
|---|---|---|---|
| App Store name | 30 | **Vantage: Habits & Health** (24) | "Vantage — Life Dashboard" (24) · "Vantage: Daily Tracker" (22) |
| App Store subtitle | 30 | **Habits, food, sleep & goals** (27) | "Your whole week, at a glance" (28) |
| Play title | 30 | Same as the App Store name | — |
| Play short description | 80 | **Track habits, food, sleep, goals and savings in one daily dashboard.** (68) | — |

### 5.2 Promotional text (Apple, 170, can change without review)

> Track habits, food, sleep, goals and savings in one place, earn coins for
> showing up, and see your whole week at a glance. Both themes are free.

### 5.3 Keywords (Apple, 100 characters)

```
tracker,streak,calorie,macro,nutrition,barcode,sleep,weight,savings,planner,routine,dashboard,coach
```

That is 99 characters. It leaves out words already in the name and subtitle
(Apple indexes those), and it leaves out **WHOOP, Oura, Apple Health and any
other app's name**: third-party trademarks in keywords are a common rejection
under 2.3.7.

### 5.4 Full description (Play; reuse as the Apple description)

Keep under 4,000 characters. Text only for WHOOP and Oura, no logos. No Apple
Health. No medical claims.

```
Vantage puts the parts of your life you're trying to improve on one screen:
habits, food, sleep and vitals, goals, savings and trips. Tick things off, earn
coins, and watch the week add up.

TRACK THE DAY
- Daily trackers with streaks and weekly coin goals
- Food log: search foods, scan a barcode, or photograph a plate and let AI
  suggest what's on it (3 free a week; unlimited with Pro)
- Macros and calories against goals you set
- Vitals history: weight, sleep, resting heart rate. Connect a WHOOP band or
  Oura ring to add recovery, HRV, strain and daily burn (requires your own
  device and account)
- Body goal: weight trend and a plain-English projection

HABITS
- Build good habits and break bad ones, with streaks, relapse handling and
  cut-down plans that allow some days a week

GOALS AND REWARDS
- A goal map with milestones, and visions that unlock as you go
- Earn coins for showing up and spend them on your own wish list. Coins have no
  cash value and can't be bought.

MONEY AND TRIPS
- Savings pots, monthly cash flow and the subscriptions you pay for, all typed
  in by you. No bank connection.
- Trip planner with budgets, countdowns, climate for the month you're going and
  live currency rates

FRIENDS, OPTIONAL
- Add friends by invite or handle, message them, and compare progress
- Private groups with a weekly league
- Report and block anyone, from any place you see them

THEMES
Two full themes, Cream and Dark OS, both free.

VANTAGE PRO
Pro lifts the free limits (habits, trackers, goals, trips, friends, widgets,
wish-list items and AI food scans), adds accent colours and your full history,
and unlocks the AI coach: a short daily brief and a weekly review. Pro is an
auto-renewing subscription, monthly or yearly, at the price shown in the app
before you buy. It renews unless cancelled at least 24 hours before the end of
the period. Manage or cancel it in your App Store / Google Play account
settings.

NOT MEDICAL ADVICE
Vantage is a wellness and habits app, not a medical device. AI-generated content
can be wrong. Talk to a qualified professional before changing your diet,
exercise or health routine.

Privacy Policy: https://vantagevision.netlify.app/privacy
Terms of Use: https://vantagevision.netlify.app/terms
```

The Terms line matters on Apple. 3.1.2 needs a functional link to the Terms of
Use (EULA) in the metadata as well as in the app. Alternatively, paste the Terms
into App Store Connect's custom EULA field.

Before using the claims above, check each against the code at submission time.
The free caps are in `src/hooks/useTierLimits.js:15-23` and
`src/lib/friends/queries.js:24`. The AI scan allowance is in
`netlify/lib/freeAllowance.js`. The renewal wording comes from
`src/lib/billing/renewalWording.js`.

### 5.5 Categories

| Store | Primary | Secondary | Reason |
|---|---|---|---|
| Apple | **Health & Fitness** | **Productivity** | The densest daily use is food, vitals, habits and body. Health & Fitness invites closer reading under 1.4.1 and 5.1.3, and this pack pre-empts both (§7). If the owner wants the lower-scrutiny route, swap them: Productivity primary, Health & Fitness secondary. |
| Google | **Health & Fitness** | (Play has one category; add tags: Habit tracker, Calorie counter, Productivity) | Same reason |

Avoid **Finance** (it invites financial-services questions; see the CLAUDE.md
notes on Open Banking and trading) and **Social Networking** (it changes the age
rating and the review lens).

### 5.6 URLs and copyright

| Field | Value |
|---|---|
| Support URL (both, required) | `https://vantagevision.netlify.app/support`, **being built**. It must carry a contact email (Apple 1.2 asks for *"published contact information"*), the in-app "Report a problem" route (`src/components/settings/SupportCard.jsx`), and deletion help. Item 72. |
| Marketing URL (Apple, optional) | `[https://company-domain]`, or leave empty until the domain exists |
| Privacy Policy URL (both, required) | `https://vantagevision.netlify.app/privacy` (pre-auth, item 9). The controller identity is still a placeholder (item 64). |
| Account deletion URL (Play) | `https://vantagevision.netlify.app/delete-account` (planned, §4.7) |
| Copyright (Apple) | `© 2026 [Company name] Ltd`, blocked on item 1 |
| Developer name shown | The company's legal name. Organisation enrolment (items 5, 6). |

Every one of these URLs must be live when the build is submitted. Apple 2.1(a)
says *"fully functional URLs... empty websites... should be scrubbed."*

### 5.7 Screenshot shot list

**Rules for every shot:** taken from the release build on device or simulator,
signed in to demo account A (or B for the paywall). **No real user's name, photo
or rating anywhere.** Use the group and division boards (A, C, D only), never
the global individual board. Dark OS theme for the hero shots, with one Cream
shot to show both are free. No WHOOP or Oura logos. Captions in plain text are
fine. On the vitals shot, say "with a compatible wearable".

| # | Screen | Data on screen | Caption idea |
|---|---|---|---|
| 1 | **Hub**, Dark OS | Vitals, Macros, Goals and Savings cards populated, coin chip, the daily brief card with its "AI-generated · not medical advice" label visible | "Your whole day on one screen" |
| 2 | **Track**: trackers and calendar | Six weeks of ticks, streak counts | "Tick it off, keep the streak" |
| 3 | **Track**: food log | A day of meals, macro rings, the barcode button visible | "Log food in seconds: search or scan" |
| 4 | **Track**: Vitals and body | Weight trend, sleep and resting HR, body goal projection | "See the trend, not just today" |
| 5 | **Habits** | A streak, a cut-down plan, a relapse handled | "Build habits. Break the others." |
| 6 | **More → Achievements** | Goal map with milestones, a vision unlocked | "Goals you can actually see" |
| 7 | **Hub → Savings** | Three pots, monthly flow, subscriptions with renewal dates | "Savings and subscriptions, by you" |
| 8 | **Holiday** | Upcoming trip: countdown, budget, climate, FX | "Plan the trip you're saving for" |
| 9 | **More → Leaderboard → My Group** | A, C and D in a weekly league | "Friends and private leagues, optional" |
| 10 | **Hub**, Cream theme | Same as shot 1 | "Two themes, both free" |

Do not screenshot the paywall for the listing. A paywall screenshot is needed
only as each in-app purchase's **review screenshot** in App Store Connect.

**Sizes**

| Store | Device | Size | Count |
|---|---|---|---|
| Apple | iPhone 6.9" | 1320 × 2868 portrait (App Store Connect scales down to smaller iPhones) | 3–10 (use the 10 above) |
| Apple | iPad 13" | 2064 × 2752 portrait | **Required only if iPad is a supported device** (see below) |
| Google | Phone | 9:16, at least 1080 px on the short side | 4–8 (shots 1–8) |
| Google | 7" and 10" tablet | Landscape or portrait, at least 1080 px | Recommended: 4 each, using the desktop hub layout |
| Google | Feature graphic | 1024 × 500 | 1, required |
| Google | Icon | 512 × 512 PNG | 1, required (`npm run cap:icons` makes the native set) |

**iPad decision (owner).** A new Capacitor iOS project targets iPhone and iPad.
Keeping iPad means 13" iPad screenshots and an iPad-quality layout. The desktop
hub appears above 768 px, and Sign in with Apple already shows at every width
(item 42). Going iPhone-only avoids the screenshots, but Apple still runs iPhone
apps on iPad and reviewers do test there, so the layout has to hold either way.
Recommendation: keep iPad and add the 13" set.

---

## 6. Pre-submission checklist

In order. **[CO]** = blocked on the company existing. **[MAC]** = blocked on the
Mac decision (item 12). **[DOM]** = blocked on a company domain and mailbox.
**[P#]** = a gap found by this pack (§8). It is not yet in
STARTUP_REQUIREMENTS, so add it there if the owner agrees.

**A. Entity and accounts**
1. `[ ]` Company registered, IP assigned, bank account (items 1, 2b, 3) **[CO]**
2. `[ ]` D-U-N-S number (item 4) **[CO]**
3. `[ ]` Apple Developer organisation enrolment (item 5) **[CO]**
4. `[ ]` Play Console organisation account (item 6) **[CO]**
5. `[ ]` ICO fee (item 7) **[CO]**
6. `[ ]` Company domain and mailboxes: support@, security@, the reviewer accounts (items 72, 76) **[DOM]**

**B. Legal and policy**
7. `[ ]` DPIA signed off. Ask the solicitor the export-compliance one-liner too (§4.1) (item 8)
8. `[ ]` Privacy policy: controller identity and contact (item 64) **[CO]**. Mismatches fixed (item 100).
9. `[ ]` Waitlist removed (item 101)
10. `[ ]` Online Safety Act risk and children's access assessments (item 71)
11. `[ ]` DPAs; WHOOP production approval; **trademark check on the name**, which unblocks §5.1 (item 75)

**C. Public pages (none needs the company except where marked)**
12. `[ ]` `/support` live with a contact email (item 72) **[DOM]** for the email
13. `[ ]` `/delete-account` live before sign-in (§4.7)
14. `[ ]` `/.well-known/security.txt` placeholder filled (item 76) **[DOM]**

**D. Native build**
15. `[ ]` Firebase project, `com.vantage.app` registered, FCM env vars set (items 11, 15)
16. `[ ]` iOS project: `npx cap add ios`, `npx cap sync`, add a `PrivacyInfo.xcprivacy` for the app target (items 12, 13) **[MAC]**
17. `[ ]` Permission strings and the Android `CAMERA` permission (§4.6) (items 14, 102) **[MAC]** for iOS
18. `[ ]` `ITSAppUsesNonExemptEncryption = false` (§4.1) **[MAC]**
19. `[ ]` APNs key and the iOS push route decision (item 15; labels doc §5 Q5) **[CO][MAC]**
20. `[ ]` Supabase redirect allow-list has `com.vantage.app://auth-callback` (items 28, 42)
21. `[ ]` On-device pass of the API base, sign-in (Google + Apple), deep links and the SW-off check (items 16, 40, 42, 43)
22. `[ ]` Merged-manifest check for AD_ID (item 102; §4.4)

**E. Review-path fixes (things a reviewer will touch)**
23. `[ ]` WHOOP/Oura connect works in the shell, or their panels are hidden natively [P1]. Oura keys set (item 30). WHOOP redirect registered (item 31).
24. `[ ]` Sandbox purchase unlocks server-checked Pro, or another decision is made [P2]
25. `[ ]` "Upgrade to Pro" button on the coach banner actually opens the paywall [P4]
26. `[ ]` "Recent Mail · Coming soon" stub removed from the native widget picker [P5]
27. `[ ]` Hard-coded "from £3.99/mo" and "Unlimited everything" copy fixed [P6]
28. `[ ]` Export download works in the WebView (item 67) [P7]
29. `[ ]` Sign in with Apple token revoked on deletion [P8]
30. `[ ]` Word filter on DM text and the shared streak-habit name [P9] (item 63)
31. `[ ]` Native copy no longer promises Apple Health or Trending [P10] (item 100)
32. `[ ]` "Our Apps" FloorplanStudio preset dropped from the native build [P11]
33. `[ ]` Custom SMTP, so reviewer sign-ups and resets get their email (item 94)
34. `[ ]` An alert reaches the owner when a report is filed, or a daily queue check during review (item 79)
35. `[ ]` AI coach tested with eating-disorder, self-harm and relapse-style inputs (item 105)

**F. Money**
36. `[ ]` Products in App Store Connect and Play, each with a review screenshot; RevenueCat offerings and the `pro` entitlement (§1.3) **[CO]**
37. `[ ]` `REVENUECAT_SECRET_API_KEY` set, so deletion removes the subscriber (item 52; labels doc §2.5)
38. `[ ]` `config.pro_live = 'true'` (§1.3)
39. `[ ]` Real-device purchase, restore and cancel on both stores (item 17) **[CO][MAC]**

**G. Reviewer kit: this pack, item 73**
40. `[ ]` Accounts A–D created **4–6 weeks early**; A granted lifetime in the SQL editor (§1.1)
41. `[ ]` A seeded through the UI (§1.2); demo accounts kept off the public board
42. `[ ]` WHOOP/Oura video recorded on a throwaway account (§1.4)
43. `[ ]` Review notes and App access text filled in (§1.5, §1.6)

**H. Store forms: item 74**
44. `[ ]` Apple age rating (§2); Play IARC (§3.1); target audience (§3.2)
45. `[ ]` Privacy labels and Data safety (item 10; `docs/STORE_PRIVACY_LABELS.md`)
46. `[ ]` Play: Health apps (§4.2), Financial features (§4.3), Ads (§4.4), News and the rest (§4.5), account deletion URL (§4.7)
47. `[ ]` Export compliance (§4.1)

**I. Listing**
48. `[ ]` Name, subtitle, descriptions, keywords, categories (§5); copyright line **[CO]**
49. `[ ]` Screenshots per §5.7 from the release build
50. `[ ]` Every URL in §5.6 returns a real page

**J. Submit**
51. `[ ]` TestFlight build and Play internal test with the owner and a few testers; fix crashes
52. `[ ]` Submit the iOS build with both in-app purchases attached; promote Play internal → production (no 12-tester rule for organisations)
53. `[ ]` During review: watch the moderation queue and the support inbox daily; answer App Review messages the same day

---

## 7. Rejection risks

The most likely reasons this app could be rejected, in rough order, and what
pre-empts each.

| # | Risk | Guideline | Why it is likely for Vantage | Pre-emption |
|---|---|---|---|---|
| 1 | **Hardware features can't be reviewed, or don't work** | 2.1(a), 2.1 "crashes or obvious technical problems" | WHOOP and Oura need devices. The connect flow probably fails in the native shell (P1). Oura reports "not set up" until item 30. | Fix or hide (P1, item 30); video attachment; manually seeded vitals; explain the hidden WHOOP-only rows (§1.4) |
| 2 | **The in-app purchase can't be found or doesn't unlock** | 2.1(b), 3.1.1 | `pro_live=false` shows a waitlist. Sandbox purchases never reach `profiles.tier`, so the AI coach answers 403 "The AI coach is part of Pro." (`netlify/functions/ai-coach-daily.js:217-221`) right after a "Welcome to Pro" toast (`PaywallModal.jsx:111-112`). The coach banner's "Upgrade to Pro" button does nothing (P4). | §1.3; P2; P4; account B; both products submitted with the build |
| 3 | **UGC safeguards judged incomplete** | 1.2 (filter, report, block, contact) | DMs, names, photos and groups. Report and block exist everywhere UGC appears (`src/components/friends/FriendCard.jsx:125-142`, `src/components/friends/MessagesModal.jsx:676-680`, `src/components/FriendRatingsModal.jsx:110`, `src/components/groups/GroupBoard.jsx:223`). Names and images are filtered. **DM text is not** (P9). The moderation queue is web-only (Security console); that is fine, but reports must get a *"timely response"* and nothing alerts the owner yet (item 79). | P9; daily queue checks; Terms §7/7a describe moderation (`LegalPage.jsx:294-316`); support URL with email (item 72); review notes describe where everything is |
| 4 | **Account deletion** | 5.1.1(v); Play account deletion policy | In-app deletion exists and is complete (item 20). Missing: the Sign in with Apple token revocation Apple expects for apps that offer SIWA (P8), and the public web URL Play requires. | P8; `/delete-account` (§4.7); review notes give the exact path |
| 5 | **Subscription disclosure** | 3.1.2(c), Schedule 2 | The paywall reads price and renewal terms from the store product and links Terms, Privacy and Restore (`PaywallModal.jsx:284-339`, item 65). But the More drawer hard-codes **"Unlimited everything · from £3.99/mo"** (`src/components/mobile/MoreDrawer.jsx:186`), and the paywall's "Unlimited everything" (`PaywallModal.jsx:252`) overstates things: AI calls still have daily caps (item 45). The metadata also needs a Terms/EULA link. | P6; Terms link in the description (§5.4); Restore in two places (§1.5) |
| 6 | **Hidden or misleading features** | 2.3.1, 2.1 placeholder content | Owner surfaces are **compiled out**, not hidden (`src/lib/native/ownerSurfaces.js`), which is the right shape. Still shipping: a **"Coming soon"** Recent Mail widget naming Gmail/Outlook (`src/components/mobile/AddMobileWidgetModal.jsx:64`, `src/components/mobile/MobileWidget.jsx:183-188,593-598`); tutorial and Track help promising **Apple Health** and **Trending**, neither of which exists natively (`src/components/TutorialOverlay.jsx:66,72,96,138,144,168`, `src/components/TrackSection.jsx:898`); the waitlist (item 101). | P5, P10, item 101; the "no hidden features" line in the notes |
| 7 | **Health claims / AI read as medical advice** | 1.4.1, 5.1.3, 2.3.1 | Food, weight, sleep and HR data plus an AI coach. Good already: the system prompt bans diagnosis, treatment and dose/calorie prescriptions and refers people to a GP (`ai-coach-daily.js:84-89`); the brief panel says "AI-generated · not medical advice" (`CoachBriefPanel.jsx:128`); the Terms disclaimer (`LegalPage.jsx:283-290`); the body goal states its own caveat (`src/components/widgets/GoalsWidget.jsx:216`); explicit health and AI consent (item 66). Weak spots: the hub banner is labelled **"AI Coach"** although its insights come from on-device rules (`src/components/AiCoachWidget.jsx:84-87`, `src/lib/coach/heuristics`), and it carries no disclaimer. Untested on sensitive inputs (item 105). | Relabel the banner "Coach" (or add the same disclaimer); item 105; listing copy §5.4 makes no outcome claims; "not a medical device" in the description |
| 8 | **Sign in with Apple** | 4.8 | Google is offered, so an equivalent option is required. Apple now shows at every width (`src/components/AuthScreen.jsx:102`, item 42). It runs through the system browser view, not the native Apple sheet; that is acceptable, but test it on device. | On-device test (item 42); notes mention iPad |
| 9 | **Web wrapper / minimum functionality** | 4.2 | It is a Capacitor-bundled SPA | It works offline from the bundle, has native push, haptics, camera scanning, store billing and deep-link sign-in; the review notes list the native permissions |
| 10 | **Privacy policy doesn't match the app** | 5.1.1(i) | Known mismatches (item 100), and the controller identity is a placeholder (item 64) | Items 64 and 100 before submitting; labels from `docs/STORE_PRIVACY_LABELS.md` |
| 11 | **Can't sign up** | 2.1 | Supabase's built-in mailer allows a few emails an hour (item 94); a reviewer making a fresh account may never get the confirmation | Item 94; the demo accounts are already confirmed |
| 12 | **Trademarks and other apps' names** | 2.3.7, 5.2.1, 5.2.5 | WHOOP, Oura, Apple Health and Gmail appear in copy | Text-only mentions of WHOOP and Oura with "requires your own device"; no Apple Health anywhere native (P10); no third-party names in keywords (§5.3); drop the Gmail/Outlook stub (P5) |
| 13 | **Real users in screenshots** | 5.1.1, 2.3.3 (accurate screenshots) | The global leaderboard shows real names and photos | Shot list uses demo accounts and group boards only (§5.7) |
| 14 | **Broken feature on Android** | Play "broken functionality" | No `CAMERA` permission, so barcode and AI scans fail natively (item 102); export download is a no-op in the WebView (P7) | §4.6; P7 |

---

## 8. Gaps found while writing this pack

None of these are in STARTUP_REQUIREMENTS yet, unless an item number is given.
Each one blocks a smooth review.

- **P1. WHOOP and Oura connect almost certainly fail inside the native app.**
  Item 42 fixed sign-in; the wearable half is not done. The panel sends the
  WebView to the provider with `window.location.href = body.url`
  (`src/components/VitalsHistoryCard.jsx:300,459`). Capacitor opens hosts outside
  the app in the system browser, and the callback sends the user to the
  website's root (`netlify/lib/redirectUri.js:51-53`), not back into the app.
  Worse, the OAuth `state` is bound to an HttpOnly cookie set on the response to
  `whoop-connect` / `oura-connect` (`netlify/lib/oauthState.js:29-41,94`). That
  cookie lives in the WebView's cookie store (if a cross-site fetch can set it
  at all), and the callback arrives in the external browser without it, so
  `verifyState` refuses. Needs: open the authorize URL with `Browser.open`, bind
  state without a cookie for native (e.g. a signed nonce the app stores), and
  have the callback redirect to `com.vantage.app://…` for native starts. Then
  verify on a device.
- **P2. Sandbox purchases don't unlock server-checked Pro.** The webhook drops
  sandbox events unless `REVENUECAT_ALLOW_SANDBOX=true`
  (`netlify/functions/revenuecat-webhook.js:150-152`). The client upgrades only
  in memory (`src/hooks/useSubscription.js:90-99`). `ai-coach-daily` and the
  AI food allowance read `profiles.tier` (`netlify/functions/ai-coach-daily.js:176-187`,
  `netlify/lib/freeAllowance.js:100-111`). A reviewer who buys Pro therefore gets
  a 403 from the coach. **Owner decision.** Either (a) turn on
  `REVENUECAT_ALLOW_SANDBOX` for the review window (sandbox purchases are
  possible only from TestFlight, dev builds and App Review, and sandbox
  subscriptions expire within minutes, so the exposure is small), or (b) have
  the server check RevenueCat's subscriber API with sandbox accepted for
  specific allow-listed reviewer user ids. Recommendation: (a), switched off
  after approval.
- **P3.** `config.pro_live` must be `'true'` before submission
  (`supabase/paywall_schema.sql:46`, `src/hooks/useSubscription.js:73`).
  Pairs with item 101.
- **P4. Dead button.** *(Fixed 2026-10-20 in e28f549 — the banner opens the paywall; the waitlist it also mentions is removed, item 101.)* `AiCoachUpgradeBanner`'s "Upgrade to Pro" has no
  `onClick` (`src/components/AiCoachWidget.jsx:56-79`). Free users see it once
  `pro_live` is true.
- **P5. Placeholder widget.** "Recent Mail" is offered in the mobile picker
  (`src/components/mobile/AddMobileWidgetModal.jsx:64`) and renders "Coming
  soon · Gmail / Outlook OAuth — deferred (separate vertical)"
  (`src/components/mobile/MobileWidget.jsx:183-188,593-598`). Remove it from
  the picker (keep the META entry for existing stacks).
- **P6. Price and claim copy.** `src/components/mobile/MoreDrawer.jsx:186`
  hard-codes "from £3.99/mo". It will be wrong in other currencies and the day
  the price changes. Read it from the store product the way `SubscriptionPanel`
  now does (`src/components/SubscriptionPanel.jsx:43-48`). Also soften
  "Unlimited everything" (`MoreDrawer.jsx:186`, `PaywallModal.jsx:252`) to
  "No caps on habits, goals, widgets and more".
- **P7. Export does nothing natively.** `download()` uses `a.download`
  (`src/components/settings/DataExportCard.jsx:25-29`), which is a no-op in a
  WebView. Item 67 noted this; its status doesn't say it is fixed. Use the
  share sheet (`navigator.share` with a File, or `@capacitor/share` +
  `@capacitor/filesystem`).
- **P8. Sign in with Apple revocation.** `netlify/functions/delete-account.js`
  removes Storage and the RevenueCat subscriber (`:39-52,124-136`) but does not
  call Apple's token revocation endpoint. Apple expects SIWA apps to revoke the
  user's tokens on account deletion. Supabase's web flow doesn't keep the Apple
  refresh token by default, so this needs either the native SIWA flow
  (which yields an authorization code to exchange and revoke) or capturing the
  provider token at sign-in.
- **P9. DM text isn't filtered.** `sendMessage` inserts the body as typed
  (`src/lib/friends/messages.js:175-180`). Apple 1.2's first bullet asks for *"a
  method for filtering objectionable material from being posted"*. Reuse
  `checkPublicText` from `src/lib/moderation/nameFilter.js:93` on send, and
  ideally mirror it server-side. The same applies to the opt-in shared streak
  habit name (`src/lib/friends/usePublishProfile.js:96-103`).
- **P10. Copy for absent features.** Item 100 covers Apple Health. Add
  **Trending**: it was removed (item 90), but the tutorial still describes the
  Trending board and its toggle (`src/components/TutorialOverlay.jsx:72,96,144,168`).
  Also `TrackSection.jsx:898` ("Syncs from WHOOP, Oura or Apple Health").
- **P11. "Our Apps" preset.** A Pro-locked widget that links to the owner's
  separate FloorplanStudio web app (`src/data/appPresets.js:36-44`). In a store
  build it reads as a paid link to an external site, and its URL carries a
  personal account name. Drop it from the native build.
- **P12. Hub coach label.** Rename the free/Pro hub banner from "AI Coach" to
  "Coach", or add the disclaimer. Its insights are rule-based
  (`src/components/AiCoachWidget.jsx:13-24`), so the "AI" label is inaccurate
  and carries no "not medical advice" line (§7 row 7).

**What the pack depends on that doesn't exist yet:** the company and its domain
and mailboxes; the `/support` and `/delete-account` pages; a working native
WHOOP/Oura flow (P1) and Oura keys (item 30); the in-app purchase products and
`pro_live`; the iOS project, purpose strings and Android `CAMERA` permission;
custom SMTP; the demo accounts themselves, created weeks ahead.

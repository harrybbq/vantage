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
19. `[x]` **Spending endpoints gated.** The AI endpoints were open to
    anyone and spent `ANTHROPIC_API_KEY`. Six functions now require a
    JWT and rate-limit per account.
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
23. `[ ]` **Move `level`, `prestige` and `ratings*` writes server-side.**
    They are still client-writable because `updateOwnProfile` and
    `AdminEditModal` write them directly. They are leaderboard inputs, so
    they are forgeable by anyone calling PostgREST. Do this before the
    leaderboard means anything competitively.
24. `[ ]` **Move the health-sync token out of the URL query string** into
    a header, and drop its weak RNG fallback.

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

## Wearables — two things before Oura works for anyone

The code shipped and is open to every signed-in account, but the Oura
integration is inert until both of these are done. Until then the panel
says "Oura env missing" rather than failing quietly. WHOOP needs
neither — it is already configured.

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

Standing rules for both wearables, so a third one doesn't relearn them:

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

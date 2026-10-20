# Record of processing activities (UK GDPR Art. 30) — Vantage

> **DRAFT v0.1, 2026-10-20, for the owner to keep up to date and the
> solicitor to check.** Not legal advice. STARTUP_REQUIREMENTS item 106
> (DPIA gaps G5, G25). Built from `docs/DPIA_DRAFT.md` §2 (data inventory,
> rows 1–27), the privacy policy in `src/components/LegalPage.jsx` (§2, §4,
> §8, §10, §11, revised 20 Oct 2026) and the retention job in
> `supabase/retention_2026_10b.sql`. When one of those changes, change this
> in the same commit.
>
> Public repository: no names, emails or addresses here. Placeholders in
> `<angle brackets>` are filled in the private copy.

---

## 0. Sources and what could not be opened

Checked 2026-10-20. The drafting environment could not open
`docs.netlify.com`, `www.netlify.com`, `answers.netlify.com`,
`ico.org.uk`, `legislation.gov.uk` or `supabase.com` directly (DNS refused
by the sandbox), so the points below come from web-search result text and
from one first-party file on GitHub. **Check each against the live page
before relying on it.**

| Point | Source | How seen |
|---|---|---|
| A small organisation (under 250 staff) must still keep records of processing that is not occasional, may risk people's rights, **or involves special category data** | ICO, [Who needs to document their processing activities?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/documentation/who-needs-to-document-their-processing-activities/) | Search extract (primary source, page not opened) |
| Netlify functions default region for new sites is `cmh` (US East, Ohio); older sites may differ; change it in the UI and **redeploy** | Netlify docs, [Configuration for functions](https://docs.netlify.com/build/functions/configuration/) and [Private Connectivity](https://docs.netlify.com/manage/security/private-connectivity/) | Search extracts (primary, page not opened) |
| Self-serve regions `cmh, dub, fra, gru, iad, lhr, nrt, pdx, sfo, sin, syd, yul`; `cdg, mxp` support-assisted; "Region selection needs Pro/Enterprise"; function-level region beats the site setting | Netlify's own repo, [netlify/context-and-tools `skills/netlify-functions/SKILL.md`](https://github.com/netlify/context-and-tools/blob/main/skills/netlify-functions/SKILL.md) | **Opened** (first-party, but a guide for AI agents, not the docs page) |
| Pro needed to move functions region; Netlify moved a Pro customer to `eu-central-1` on request | Netlify support forum threads ([1](https://answers.netlify.com/t/changing-deployment-region/25265), [2](https://answers.netlify.com/t/can-i-set-my-netlify-server-location/41835)) | Search extracts; dated, secondary |
| Netlify's DPA (Nov 2023 version) incorporates the EU SCCs (Decision 2021/914) and the UK Addendum issued under DPA 2018 s.119A (in force 21 Mar 2022) | [Netlify DPA PDF](https://www.netlify.com/pdf/netlify-dpa.pdf) | Search extract only. **Get the current DPA and read it** |
| Netlify's Data Privacy Framework / UK Extension status | Not found | **Owner to check** at [dataprivacyframework.gov](https://www.dataprivacyframework.gov/list) |
| Data (Use and Access) Act 2025: new Art. 6(1)(ea) "recognised legitimate interests" (Annex 1, incl. safeguarding vulnerable individuals and crime) in force 5 Feb 2026 (SI 2026/82) | [Bratby Law](https://bratby.law/recognised-legitimate-interests-duaa-uk-eu-divergence/), [governancedocs](https://governancedocs.com/data-use-and-access-act-2025/) | Search extracts; secondary. Whether Art. 30 itself changed was **not** confirmed |

---

## 1. The controller

| | |
|---|---|
| Controller | `<Company name, company number, registered office>` — on incorporation (item 1). **Until then, probably `<owner name>` personally** (DPIA solicitor question 6) |
| Contact | `<support email>` (`src/lib/support.js` `SUPPORT_EMAIL`, item 72) |
| Representative in the EU (Art. 27 EU GDPR) | `<solicitor: needed if the app is offered to people in the EEA? The policy is written for the UK and EEA>` |
| Data protection officer | None appointed. Solicitor to confirm a DPO is not required (DPIA Q8) |
| ICO registration (fee) | `<ICO registration number>` — item 7, not yet paid |
| Joint controllers | None |
| Record owner | `<owner name>`, reviewed `<date>` |

---

## 2. Where the server code runs: the Netlify function region (item 106a)

**Finding.** `netlify.toml` sets no region, and all 44 functions are
classic `exports.handler` functions with no per-function `config` (checked
2026-10-20: `grep -l "exports.handler" netlify/functions/*.js` = 44; none
use `export const config`). So every function, including the scheduled
ones, runs in **the site-level Functions region**. For a site created after
4 October 2023 that defaults to **`cmh`, US East (Ohio, AWS us-east-2)**;
an older site may be on another default (old forum posts say us-east-1).
The repo's first commit is dated 2026-08-18, but the Netlify site may be
older — **read the actual value in the dashboard, don't infer it.**

**Can it be EU? Yes, on Pro (which the owner has).** Frankfurt (`fra`),
London (`lhr`) and Dublin (`dub`) are listed as self-serve regions, and
region selection needs Pro or Enterprise.

**Steps (owner, ~5 minutes):**

1. Supabase dashboard → Project Settings → General (or the project URL
   page): note the project's **exact region** (e.g. `eu-west-2` London,
   `eu-central-1` Frankfurt, `eu-west-1` Ireland). The DPIA still has this
   as "to be confirmed".
2. Netlify → the Vantage site → **Project configuration → Build & deploy →
   Continuous deployment → Functions region** (older UI), or **Cloud
   compute → Functions → Region** (newer UI). Note the current value
   in the private records.
3. Pick the region **nearest the Supabase region**: London Supabase →
   `lhr`; Frankfurt → `fra`; Ireland → `dub`. Same city also cuts
   function-to-database latency, which every sync and the leaderboard
   pay for.
4. Save, then **trigger a new production deploy** (Deploys → Trigger
   deploy → Deploy site). Old deploys keep the region they were built
   with.
5. Check: Netlify → Logs → Functions shows the region on invocations; or
   open a function's details. Confirm a **scheduled** function (e.g.
   `security-sweep`, `whoop-cron`) also shows the new region — no source
   seen says scheduled functions differ, but none confirms they follow
   either. If unsure, ask Netlify support.
6. Record the change with `select public.ops_mark('note', 'Netlify
   functions region set to <code>');` and update DPIA §2.1 / §4.7 and
   policy §8 / §10 (they say "Netlify ... functions"; add the region).
7. If Netlify's UI refuses or only offers US regions, ask Netlify support
   to move the site to `fra` or `lhr` (the forum shows they have done this
   for Pro sites).

**What it means for the transfer analysis.**

- **With an EU/UK region:** the function code, and the health data in its
  requests (wearable syncs, AI calls, moderation reads), is processed in
  the EU/UK. That removes the *location* transfer for the bulk of the
  processing. It does **not** remove all transfers: Netlify, Inc. is a US
  company; its support and operations staff, its logging, and its global
  CDN (which serves the static app and sees every visitor's IP address)
  can involve access from the US. That is still a **restricted transfer**
  for UK GDPR purposes, covered by Netlify's DPA.
- **If it stays in the US:** every function call carrying health data,
  messages or AI payloads is processed in the US. Then the transfer
  mechanism matters more and a **transfer risk assessment** (ICO TRA tool)
  is expected if relying on the IDTA or UK Addendum.
- **Mechanism, either way:** Netlify's DPA (Nov 2023 version) refers to the
  EU SCCs plus the **UK Addendum** (the ICO's International Data Transfer
  Addendum to the EU SCCs). If Netlify is certified to the EU–US Data
  Privacy Framework **with the UK Extension**, the UK–US "data bridge" can
  be relied on instead; that could not be confirmed (search the DPF list).
  **Solicitor:** confirm which mechanism applies, whether a TRA is needed,
  and that the privacy policy §10 wording matches (DPIA Q7).

Supabase is already in the EU (`LegalPage.jsx` §8); its US parent and
sub-processors need the same mechanism check (DPA, item 75).

---

## 3. Processing activities

Lawful bases are **proposed**, from the privacy policy §4 and the DPIA §4.1;
the solicitor confirms them. "SB" = Supabase, "NF" = Netlify functions,
"S" = the per-user state document `user_data.state`. Retention detail is in
section 6.

| # | Activity (purpose) | Data subjects | Personal data | Special category? | Art. 6 basis (proposed) | Art. 9 condition | Recipients | Retention |
|---|---|---|---|---|---|---|---|---|
| A1 | **Accounts and sign-in** | Users (13+) | Email, password hash, auth ids, sessions; Google/Apple name, picture, id | No | 6(1)(b) contract | — | SB Auth; Google, Apple (sign-in providers) | Life of account |
| A2 | **Core app: store and sync what the user enters** (habits, trackers, goals, visions, holidays, calendar, notes, wish list, money entries, preferences) | Users | S contents; device localStorage copy; history snapshots | Habit names can reveal health (e.g. quitting drinking) | 6(1)(b) | — (unless health: see A3) | SB; NF for ratings/prestige/push prefs | Life of account; 14 snapshots rolling; 7-day backups |
| A3 | **Health and fitness features** (vitals, body, sleep, burn, lifts, food diary) incl. WHOOP and Oura sync | Users | `vitalsLog`, `burnLog`, `bodyLog`, `nutrition_log` tables, wearable OAuth tokens | **Yes, health** | 6(1)(b) or 6(1)(a) | **9(2)(a) explicit consent** for connected sources (`consent_events`); **manual entries: open** (DPIA Q1) | SB; NF (crons, sync); WHOOP, Oura as sources | Life of account; tokens until Disconnect |
| A4 | **AI features** (daily coach brief, food-photo scan, recipe-from-video owner-only) | Users | Coach snapshot (first name, habits, trackers, holidays, wish-list counts); one camera frame | Possibly (habits, food) | 6(1)(a) consent | 9(2)(a) where health is included | NF → **Anthropic** (US) | Not stored by us; Anthropic's limited API retention (confirm, DPIA G6); result in S |
| A5 | **Social features** (profile, friends, DMs, groups, leaderboard, ratings/OVR, invites, shared foods) | Users; people they message | Handle, display name, avatar, level, ratings, presence, messages, friendships, group membership, shared foods | Fitness rating partly derived from health logging (DPIA Q3) | 6(1)(b) (features the user turns on) | Open: DPIA Q3 | Other users as described in policy §6; SB Realtime | Life of account; messages until unsent/deleted |
| A6 | **Safety and moderation** (reports, blocks, suspensions, resets, safety notices, image screening of avatars and crests) | Reporters, reported users | Report reason/text, snapshot incl. up to 10 DMs, `moderation_actions`, `safety_notices`, avatar/crest images | Can be, incidentally | 6(1)(f) legitimate interests — **LIA needed** (L2, L3); possibly 6(1)(c) for Online Safety Act duties; possibly 6(1)(ea) recognised LI (safeguarding, crime) | — unless content reveals it | Owner (moderation queue); **Anthropic** (image screening); NCA / police when required (`docs/ABUSE_HANDLING.md`) | Closed reports 12 months; held reports while referred; `moderation_actions` proposed 3 years (`docs/ADMIN_ACCESS_POLICY.md`) |
| A7 | **Online Safety Act reporting** (CSEA reports to the NCA) | Reported users | What SI 2026/268 requires in a report | Possibly criminal-offence data (Art. 10) | 6(1)(c) legal obligation (OSA s.66) | Art. 10 / DPA 2018 Sch. 1 condition — **solicitor** | **NCA** | NCA reference 5 years; reported content ≥ 1 year (to verify: `docs/ABUSE_HANDLING.md`) |
| A8 | **Security, reliability and recovery** (crash reports, security sweep and tickets, problem reports, history snapshots, backups, rate caps, web vitals) | Users; visitors | `client_errors` (user id, stack, UA), `security_tickets`, `user_data_history`, backups, `ingest_caps`; anonymous `web_vitals` | Snapshots contain health data | 6(1)(f) — **LIA needed** (L1) | Snapshots: same condition as A3 covers them? (DPIA §4.1) | Owner; SB | Crash 30 d; vitals 90 d; snapshots 14 rolling; backups 7 d; tickets until dealt with |
| A9 | **Subscriptions (Pro)** | Paying users | RevenueCat app user id (= Supabase id), plan, renewal history, `profiles.tier` | No | 6(1)(b) | — | **RevenueCat** (US); Apple, Google (stores, independent controllers for billing) | RevenueCat record deleted on account deletion (if `REVENUECAT_SECRET_API_KEY` set) |
| A10 | **Push notifications** (not live: item 15) | Users who opt in | Push token, queued title/body, coach nudges | Coach nudges could be health-related (item 104) | 6(1)(a) consent / PECR | — | Firebase Cloud Messaging (Google, US) → APNs | Sent queue 30 d; nudges 60 d; tokens life of account |
| A11 | **Consent records** | Users | `consent_events` (kind, granted/withdrawn, time, copy version) | Reveals use of health features | 6(1)(c) (Art. 7(1) proof) | — | SB | Life of account (cascade). **Solicitor:** keep proof of consent after deletion? |
| A12 | **Weather and location lookups** | Users | Netlify's per-request geo (city / ~11 km), not stored | No | 6(1)(f) | — | Netlify (derives it); Open-Meteo gets a city or rounded point only | Not stored |
| A13 | **Support and rights requests** | Users, non-users | Ticket text, email correspondence, identity checks | Possibly | 6(1)(c) for rights requests; 6(1)(f) for support | — | Owner | `<solicitor: e.g. 2 years after closing>` |
| A14 | **Data export** (user's own) | Users | The whole account, encrypted by default | Yes | 6(1)(b) / Art. 15 & 20 | — | The user | User decides |

Activities **not** carried out: advertising, analytics trackers, selling
data, bank connections, purchase history from banks, precise location.
(The trading widget and Open Banking are parked, owner-only, and need a new
entry here before any build: `CLAUDE.md`.)

---

## 4. Recipients: processors and other parties

| Party | Role (proposed) | Activities | Data | Location | Contract / transfer mechanism | Status |
|---|---|---|---|---|---|---|
| **Supabase** | Processor | All server-side storage, auth, realtime | Everything server-side | EU (exact region `<from dashboard>`); US parent and sub-processors | Supabase DPA (incl. SCCs / UK Addendum: check) | DPA not recorded (item 75) |
| **Netlify** | Processor | Hosting, CDN, all functions | IP addresses; all function traffic incl. health data in transit; function logs | Functions: `<region from dashboard>` (default US East); company in US | Netlify DPA (SCCs + UK Addendum per Nov 2023 version); DPF status unknown | DPA not recorded (item 75); region: section 2 |
| **Anthropic** | Processor | A4, A6 (image screening) | Coach snapshots, food photos, avatar and crest images, recipe text | US | Anthropic commercial terms + DPA (check transfer mechanism, retention, zero-retention option) | DPA not recorded (item 75; DPIA G6) |
| **RevenueCat** | Processor | A9 | User id, subscription events | US | RevenueCat DPA | DPA not recorded (item 75) |
| **Google — Firebase Cloud Messaging** | Processor | A10 | Push tokens, notification text | US | Google DPA terms | Not live (item 15); add to item 75 |
| **Apple** | Independent controller (store billing, Sign in with Apple); processor for APNs | A1, A9, A10 | Sign-in identity, purchases, push | US | Apple developer terms | Confirm roles (DPIA §4.7) |
| **Google** (Play billing, Google sign-in) | Independent controller | A1, A9 | Sign-in identity, purchases | US | Google developer terms | Confirm roles |
| **WHOOP** | Source; independent controller | A3 | OAuth-authorised health data (to us) | US | WHOOP API terms; production approval (item 75) | Open |
| **Oura** | Source; independent controller | A3 | OAuth-authorised health data (to us) | Finland | Oura API terms (multi-user terms, item 30) | Open |
| **NCA** | Recipient (law enforcement) | A7 | CSEA reports | UK | OSA s.66 / SI 2026/268 | Registration open (item 113) |
| **Police / courts / Ofcom** | Recipients when lawfully required | A6, A13 | As requested | UK | Legal request (`docs/ADMIN_ACCESS_POLICY.md` P4) | — |
| **Open-Meteo** | Not a processor (no personal data as sent) | A12, holidays | City name or ~11 km point | `<check>` | n/a | — |
| Open Food Facts, USDA FDC, FatSecret, GNews, Finnhub, Frankfurter, shop websites | Not processors (search text, barcode, ticker, currency, product URL; no account details) | A2, A3 | Request content only | FR, US, various | n/a | Confirm (DPIA §4.7) |
| Google Fonts, Google favicon service, GitHub API (widget only) | Contacted by the **device**; receive the IP address | — | IP; GitHub username if entered | US | n/a | Self-host fonts (item 108, G16) |

**Not a recipient any more:** ipwho.is (weather now uses Netlify's own geo
header, item 95).

---

## 5. Transfers outside the UK

| Recipient | Country | Mechanism to confirm (solicitor) | Notes |
|---|---|---|---|
| Netlify | US (company, CDN, ops access); functions US unless moved (section 2) | UK Addendum to SCCs in the DPA; or UK Extension to the DPF if certified | Moving functions to `lhr`/`fra` narrows it |
| Anthropic | US | DPA mechanism; DPF + UK Extension if certified | Health-adjacent data (coach, food photo) |
| RevenueCat | US | as above | Pseudonymous id + purchases |
| Google (FCM, sign-in, Play) | US | Google's terms; DPF | FCM not live |
| Apple | US | Apple's terms | — |
| Supabase (parent, sub-processors) | US / various | Supabase DPA | Data hosted in the EU |
| WHOOP | US (source, we receive) | Not a transfer *from* us | User-authorised pull |
| Oura | Finland (EEA) | UK adequacy regulations for the EEA | — |
| EEA processing generally | EU | UK adequacy regulations (EEA) | Supabase, possibly Netlify functions |

---

## 6. Retention schedule (as built, 2026-10-20)

| Data | Period | Enforced by |
|---|---|---|
| Account, S, nutrition, messages, social graph, tokens, push tokens, consent events, AI usage, coach nudges (≤ 60 d) | Life of the account; deleted immediately on account deletion | `delete-account.js` + `on delete cascade` |
| History snapshots of S | Newest 14 per user | `user_data_history` trigger |
| Database backups | 7 days (no PITR today; item 27 plans PITR — update this when bought) | Supabase |
| Crash reports `client_errors` | 30 days | `retention_prune` (weekly, Sun 04:47 UTC) |
| `web_vitals` (anonymous) | 90 days | `retention_prune` |
| `rating_snapshots` | 90 days | `retention_prune` |
| `notifications_queue` | Sent/dead: 30 days | `retention_prune` |
| `coach_nudges` | 60 days | `retention_prune` |
| Closed `reports` (with evidence snapshot) | 12 months after closing; never while open or `retention_hold = true` | `retention_prune` |
| `moderation_actions` | **No limit today** — proposed 3 years | Not enforced (`docs/ADMIN_ACCESS_POLICY.md` §5) |
| `security_tickets` | Until dealt with — proposed 12 months after | Not enforced |
| `safety_notices` | Life of the account | Cascade (ABUSE_HANDLING suggests read ones > 12 months can go: not enforced) |
| `ai_usage` counters | Life of the account | Cascade; not pruned (consider 90 days) |
| `ops_log` | Indefinite; no personal data | Append-only by design |
| `recovery_bundles` | Delete within 30 days of a recovery | Manual (`recovery_2026_10b.sql`) |
| NCA report records | URN 5 years; reported content ≥ 1 year (to verify) | Manual (`docs/ABUSE_HANDLING.md`) |
| Online Safety Act records | See `docs/OSA_GOVERNANCE.md` | Manual |
| Device localStorage copy | Until explicit sign-out or deletion | `clearLocal.js` |
| Provider logs (Netlify, Supabase) | Provider's retention | Provider |

**Mismatch to fix:** `docs/ABUSE_HANDLING.md` says `moderation_actions`
rows go with the report after 12 months. Nothing deletes them, and this
draft argues they shouldn't (sticky resets, appeal evidence). Decide with
the solicitor and make the two documents agree.

---

## 7. Security measures (Art. 32, general description)

Detail and evidence: DPIA Step 6 (R1, R2, R10, R15) and
`docs/INCIDENT_RUNBOOK.md`.

- **In transit:** TLS everywhere; HSTS (`netlify.toml`).
- **Access control:** row-level security on every table; column-level
  grants on `profiles` (seven public columns); service-role-only tables
  for tokens, moderation, ops and recovery; server-side owner checks
  (`netlify/lib/owner.js`); secrets only in Netlify env.
- **Integrity:** compare-and-set server writes; anti-wipe checks; 14
  history snapshots; daily backups; append-only `ops_log` and
  `consent_events`; a restore runbook with one-user recovery.
- **Minimisation:** AI snapshot capped at 8 KB and stripped of wearable
  data on device and server; food photos and snapshots not stored;
  anonymous web vitals; retention job (section 6).
- **Monitoring:** hourly security sweep raising tickets and paging the
  owner; Supabase advisors; incident runbook with the ICO 72-hour step and
  a breach log.
- **People:** one admin; written admin access policy
  (`docs/ADMIN_ACCESS_POLICY.md`); 2FA on every service **still open**
  (item 80).
- **Open items that affect this record:** CSP enforcement (21, 60), Netlify
  rate-limit rule (86), new Supabase keys (85), private repo and 2FA (80).

---

## 8. Legitimate interests assessments (LIAs) — for the solicitor

An LIA is a short three-part test (purpose, necessity, balancing) the ICO
expects to be written down when relying on Art. 6(1)(f). Since 5 Feb 2026
some purposes may instead fall under **Art. 6(1)(ea) recognised legitimate
interests** (Annex 1, e.g. safeguarding vulnerable individuals, detecting
or preventing crime), which needs no balancing test. Whether any of
Vantage's purposes qualify is **for the solicitor**, not assumed here.

| LIA | Activity | Questions for the solicitor |
|---|---|---|
| **L1** | Crash reports with user id and device type (A8); security sweep; history snapshots | Is 30 days with the user id necessary, or should the id be dropped/hashed? Do the 14 snapshots (which hold health data) need an Art. 9 condition beyond A3's consent? |
| **L2** | **Image screening** of avatars and crests by Anthropic (A6) | Proportionate with no opt-out except not uploading? Recognised LI (safeguarding) or 6(1)(f)? Any biometric/special-category issue? (DPIA Q12) |
| **L3** | **Moderation**: keeping reports and 10 DMs for 12 months after closing, incl. after both accounts are deleted (A6) | 6(1)(f), 6(1)(c) (OSA) or 6(1)(ea)? How to answer an erasure request that touches a report? (DPIA Q9) |
| **L4** | `moderation_actions` for 3 years (A6) | As Q-A1 in `docs/ADMIN_ACCESS_POLICY.md` |
| **L5** | Weather from Netlify geo (A12) | Is a written LIA needed for data never stored? |
| **L6** | Ratings/OVR shown to others (A5) | 6(1)(b) or 6(1)(f)? With health-derived input, is an Art. 9 condition needed? (DPIA Q3, item 103) |
| **L7** | Support handling (A13) | Basis for looking at a user's data in support (ADMIN_ACCESS_POLICY Q-A3) |

**Also for the solicitor:**

- **R-1.** Confirm this record meets Art. 30(1) as a controller record, and
  whether a processor record (Art. 30(2)) is ever needed (it shouldn't be:
  Vantage processes for no one else).
- **R-2.** Criminal-offence data (Art. 10): does holding CSEA reports or
  reports of threats count, and which DPA 2018 Sch. 1 condition applies?
- **R-3.** Transfers: the mechanism per recipient and whether TRAs are
  needed (section 5; DPIA Q7).
- **R-4.** Does the DUAA 2025 change anything else relied on here?

---

## 9. Keeping this record

Update it **in the same change** as: a new processor or external host
(the policy §8 rule already says this), a new table holding personal data,
a new retention window, the Netlify region change, PITR, HealthKit /
Health Connect, push going live, or anything on the DPIA's review-trigger
list. Review it with the DPIA at least yearly. The ICO can ask to see it
(Art. 30(4)).

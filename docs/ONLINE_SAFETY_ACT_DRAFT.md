# Online Safety Act 2023: draft assessments for Vantage

> **DRAFT for review by the owner and a solicitor. This is not a statement
> of compliance.** It is a first attempt at the written records the Online
> Safety Act 2023 ("the Act") and Ofcom's guidance expect. It was put
> together from the code in this repository and from Ofcom's published
> framework. Every claim about the app cites a file. Where this draft says
> a measure is "in place", it means the code exists. It does not mean the
> measure meets Ofcom's standard. That is a judgement for the owner and
> the solicitor to make.
>
> Prepared 2026-10-20 for STARTUP_REQUIREMENTS.md item 71. The repository
> is public, so this file holds no personal names, emails or user data.

---

## 0. Sources, versions, and what could not be checked

**Ofcom's website could not be reached from the environment this was
written in.** `ofcom.org.uk` was refused by the network proxy, and so were
the mirror hosts. So the framework below comes from two places:

1. what the author already knew of Ofcom's documents, which is reliable up
   to about mid-2026; and
2. web-search result snippets from 2026-10-20 about later changes. Those
   snippets are secondary sources and have not been read in full.

**The solicitor or owner should check every Ofcom reference against the
current documents** on Ofcom's "Online safety regulatory documents" page
before relying on it. That applies especially to the measure numbers
(ICU/PCU codes) and to who each measure applies to.

| Document / event | Version or date used | How it was obtained |
|---|---|---|
| Statement: Protecting people from illegal harms online. Includes the Risk Assessment Guidance and Risk Profiles, the Register of Risks, the Illegal Content Judgements Guidance, and the Illegal Content Codes of Practice for user-to-user services | Published 16 Dec 2024. Risk assessments were due by 16 Mar 2025. The Codes came into force 17 Mar 2025. | Author's knowledge |
| Record-keeping and review guidance | Published 16 Dec 2024 and updated 24 Apr 2025. Search results say Ofcom now lists the April 2025 version as superseded, so a newer one exists. | Author's knowledge + search snippet |
| Children's access assessment guidance | Published Jan 2025. Assessments were due by 16 Apr 2025. | Author's knowledge |
| Statement: Protecting children from harms online. Includes the Children's Risk Assessment Guidance, the Children's Register of Risks, and the Protection of Children Codes | Published 24 Apr 2025. Children's risk assessments were due by 24 Jul 2025. The Codes came into force 25 Jul 2025. | Author's knowledge |
| Statement: New priority offences, serious self-harm and cyberflashing | 25 Jun 2026. It merges "encouraging or assisting suicide" with the new serious self-harm offence into one kind of harm, **"suicide and self-harm"**. It adds **cyberflashing** as a new, separate kind. Providers must update their risk assessments to cover both. | Search snippets (Ofcom page title, law-firm briefings) |
| Amendments to the illegal content Codes (user-to-user) | Reported as issued 9 Sep 2026 and in force 30 Sep 2026. They include hash-matching for intimate image abuse (reported as ICU C14: services at high risk of intimate image abuse, or with more than 700,000 monthly UK users). One tracker also links them to the self-harm and cyberflashing measures. | Search snippets. **Confirm the scope.** |
| Crisis-response amendments to both sets of Codes | Reported as adopted 12 Oct 2026 and in force 2 Nov 2026. Aimed at large services. | Secondary tracker only |
| Proposal to extend blocking and muting (ICU J1) and disabling comments (ICU J2) to some smaller services likely to be accessed by children | Consulted on in 2025. **Whether it became final could not be confirmed.** | Search snippet |
| Duty to report CSEA content to the National Crime Agency (NCA) | In force for user-to-user services from **7 Apr 2026**: SI 2026/262 (commencement) and SI 2026/268 (CSEA Content Reporting Regulations: NCA registration, report format and timing). | Search snippets (Ofcom guidance page, legislation.gov.uk) |

Ofcom's maximum penalty is £18 million or 10% of qualifying worldwide
revenue, whichever is greater. The record-keeping duties are enforceable
in their own right.

---

## 1. Summary

- **Scope.** Vantage appears to be a **regulated user-to-user service**.
  Users can send each other direct messages. They also publish display
  names, handles, profile pictures, group names and group pictures that
  other users see. The owner is in the UK and the service is aimed at UK
  users. No exemption in Schedule 1 seems to fit. Vantage is a **small**
  service, far below Ofcom's "large" threshold of 7 million monthly UK
  users, and nowhere near the categorisation thresholds.
- **The duties may already apply.** The social features are live on the
  public web app today (Netlify deploys `master`), not only after the
  store launch. The assessments should be finished and recorded as soon
  as possible.
- **Illegal content risk.** This draft rates two kinds of illegal harm
  **medium**:
  1. **grooming (CSEA)**: 13–17-year-olds are allowed, the app does not
     know which users are children, it has 1:1 DMs, and a stranger can
     send a friend request from the global leaderboard;
  2. **harassment, stalking, threats and abuse**: DMs, rankings, and
     friends being shown when someone is online.

  Everything else is rated **low**. Two or more medium ratings make
  Vantage **"multi-risk"** in Ofcom's terms, which brings in more Codes
  measures than a single-risk service needs.
- **Children.** The 13+ age limit means children can and do access the
  service. The child user condition is very likely met, so the
  **protection of children duties apply**. A children's risk assessment
  is outlined in section 6. Bullying, self-harm and eating-disorder
  content are rated **medium**.
- **Main gaps:**
  - No named accountable person has been recorded.
  - No written content policies or targets for moderators.
  - Nothing alerts an owner when a report arrives.
  - The report reasons do not cover child safety, threats, self-harm,
    sexual content or scams.
  - Names and avatars are only filtered for honest clients (item 84).
  - No complaints route outside the app, and no appeals process.
  - The Terms lack some wording the Act requires.
  - No process for registering with and reporting to the NCA.
  - No age signal at all, so child-specific safety defaults cannot be
    applied.

---

## 2. Scope

### 2.1 Is Vantage a user-to-user service?

The Act (s.3) defines a user-to-user service as an internet service where
content that one user generates, uploads or shares can be **encountered
by another user**. On Vantage, that content includes:

| User-generated content that other users can encounter | Who can see it | Evidence |
|---|---|---|
| Direct messages: text up to 2,000 characters, replies, six fixed emoji reactions | The two people in the conversation | `supabase/messages_schema.sql` (table, 1–2000 character check, friends-only insert policy); `supabase/dm_upgrade_2026_10.sql` §1–2 |
| Display name (up to 40 characters), @handle (3–20 characters, `[A-Za-z0-9_]`), profile picture | Friends; handle search (opt-in); global leaderboard (opt-in); group boards | `supabase/social_schema.sql` (handle constraint, read policy); `supabase/audit_schema_2026_10.sql` §63; `netlify/functions/get-leaderboard.js` |
| Profile card extras: level, habit streak with the habit's name, 91-day activity heatmap, recent wins, online status | Friends only, one toggle each | `src/components/SettingsSection.jsx` (`SHARE_TOGGLES`); `src/lib/friends/usePublishProfile.js`; `src/lib/friends/privacy.js` |
| Group name (2–32 characters) and group picture ("crest") | Group members, and other groups on the division board | `supabase/groups_schema.sql`; `supabase/group_crest_schema.sql`; `netlify/functions/groups.js` |
| User-contributed foods: name, brand, nutrition | Other users who switch on "Show user additions". The contributor's identity is never shown. | `supabase/food_contributions_schema.sql` |
| Invite links and QR codes. The inviter's public card is shown to anyone holding the link, even when signed out. | Anyone the user gives the link to | `supabase/dm_upgrade_2026_10.sql` §4 (`preview_friend_invite` is executable by `anon`); `src/components/friends/InviteLanding.jsx`; `src/components/friends/InviteLinkSection.jsx` |

Global "Shop trending" put user text and URLs on every user's Shop page.
It was **removed** in #225 (STARTUP_REQUIREMENTS.md item 90). If it ever
comes back, it changes this assessment (see section 9).

### 2.2 Links with the UK

The owner is in the UK and a UK company is being formed (item 1). The
service is aimed at UK users: the Terms are governed by English law
(`src/components/LegalPage.jsx`, Terms §17), prices are in sterling, and
there is a UK supermarket price table. **The service has links with the
UK (s.4).**

### 2.3 Exemptions considered (Schedule 1)

- **Email, SMS/MMS, or one-to-one live aural communications only.** Does
  not apply. The DMs are in-app text messages, and the service also has
  other user-to-user content.
- **Limited-functionality services**, where the only user content is
  comments or reviews on the provider's own content. Does not apply.
  Users talk to each other directly.
- **Internal business services.** Does not apply.

**Conclusion (for the solicitor to confirm):** regulated. The solicitor
should also say whether the user-contributed foods count as
"user-generated content" for these purposes. This draft assumes they do.

### 2.4 Size and category

| Question | Answer |
|---|---|
| Ofcom "large service" (more than 7 million average monthly active UK users) | **No.** User numbers are small. *Owner to record the actual figure from Supabase Auth, and the number of UK users if known, in the evidence log (section 9).* |
| Category 1 / 2A / 2B (register of categorised services) | **No.** The thresholds are far higher. |
| Fees regime (qualifying worldwide revenue of £250m or more) | **No.** |
| Ofcom risk profile: single-risk or multi-risk? | **Multi-risk** on this draft's ratings: two kinds of illegal harm at medium (section 4). Medium or high for at least two kinds makes a service multi-risk. |

### 2.5 Duties that apply (Part 3, user-to-user)

| Duty | Section of the Act | Applies? |
|---|---|---|
| Illegal content risk assessment | s.9 | Yes |
| Illegal content safety duties (proportionate measures; minimise how long illegal content is present; swift takedown) | s.10 | Yes |
| Children's access assessment | ss.35–37 | Yes |
| Children's risk assessment | s.11 | Yes, if the child user condition is met. This draft concludes it is (section 5). |
| Children's safety duties | s.12 | Yes, as above |
| Content reporting | s.20 | Yes |
| Complaints procedures | s.21 | Yes |
| Freedom of expression and privacy | s.22 | Yes |
| Record-keeping and review | s.23 | Yes |
| Reporting CSEA content to the NCA | s.66 + SI 2026/268 | Yes, in force since 7 Apr 2026 |
| Category 1/2A/2B duties (user empowerment, transparency reports, and so on) | various | No |
| Part 5 (providers publishing pornographic content) | Part 5 | No. Vantage publishes none. |

### 2.6 Timing

The social features are live in the web app now. Friends, DMs, groups
and the leaderboard are all on `master`, which Netlify deploys. So the
duties are probably **already** live for this service, and do not just
start at the App Store or Google Play launch.

The Act also requires a **fresh risk assessment before a "significant
change"** to the service. The October 2026 DM upgrade (#226: live
delivery, replies, reactions, invite links and QR codes) is arguably one.

This is solicitor question Q1.

---

## 3. Feature and safeguard inventory (evidence base)

### 3.1 How strangers can reach a user

This matters most for grooming and harassment. It sets out every route by
which someone who is not yet a friend can reach a user.

| Route | Default | Gate | Evidence |
|---|---|---|---|
| **Handle search** (prefix match, 10 results, excludes suspended and blocked users) | **Off** for accounts created after the audit SQL. Older accounts keep the old default of **on**. | Needs a claimed handle and `is_searchable = true` | `supabase/audit_schema_2026_10.sql` (`search_profiles_by_handle`; §68 defaults); `supabase/social_schema.sql` (original default `true`) |
| **Global leaderboard**, with a **"+ Add" friend-request button on each row** | **Off** for new accounts. Older accounts keep the old default of **on**. | `leaderboard_optin = true`; suspended users filtered out | `netlify/functions/get-leaderboard.js` (opt-in filter, suspended filter); `src/components/LeaderboardPanel.jsx` (`sendFriendRequest` from rows); `supabase/leaderboard_schema.sql` (original default `true`) |
| **Invite link / QR code** | Made on demand | Expires after 30 days or 50 uses. 20 new links a day. A new link revokes the old one. Accepting only sends a **pending** request, which the inviter must approve. Suspended users cannot make links. | `supabase/dm_upgrade_2026_10.sql` §4 |
| **Group invite code** | Groups are invite-only. 20 seats. One group per person. | The leader can rotate the code and remove members. The code is hidden from direct reads. | `supabase/groups_schema.sql`; `supabase/group_crest_schema.sql` §2; `netlify/functions/groups.js` (`rotateCode`, `kick`) |
| **Friend request to a known user id** | n/a | Any signed-in user can insert a pending request to any user id they know, unless one has blocked the other. 20 requests an hour per requester. | `supabase/security_hotfix_2026_09_30.sql` (policy "friendships: insert as requester"); `supabase/audit_schema_2026_10.sql` (`throttle_friend_requests`) |
| **Direct message** | n/a | **Accepted friends only**, and neither has blocked the other. 30 messages a minute. | `supabase/messages_schema.sql`; `supabase/security_hotfix_2026_09_30.sql` (`messages_insert` with `is_blocked_either`); `supabase/audit_schema_2026_10.sql` (`throttle_messages`) |

Other relevant facts:

- **No friend suggestions, "people you may know" or mutual-friend lists**
  were found in `src/components/friends` or `src/lib/friends`.
- **No location sharing.**
- **No public posting feed, comments, livestreaming, group chat, image or
  video DMs, or end-to-end encryption.** Messages are stored readable on
  the server (`src/components/LegalPage.jsx`, Privacy §2 says this), so a
  report can carry the messages as evidence.
- **Free accounts are capped at 5 accepted friends**; Pro is unlimited
  (`supabase/social_schema.sql`, `check_friend_cap`).
- **The "social" rating rewards friend count up to 20 friends**
  (`docs/RANKING_SYSTEM.md`, socialPoints). That is a mild incentive to
  accept requests from strangers, which is a risk factor for grooming.
- **No code found in `src/components/friends/MessagesModal.jsx` or
  `src/lib/friends/dmView.js` turns URLs in a message into clickable
  links.** URLs show as plain text. The one exception is group invites,
  which are parsed into a join card (`src/lib/friends/clanInvite.js`).

### 3.2 Safeguards that exist in code

| Safeguard | What it does | Binding (server) or advisory (client)? | Evidence |
|---|---|---|---|
| **13+ age declaration** | Sign-up checkbox: "I am 13 years of age or older and I agree to the Terms…". Google/Apple sign-up is blocked until it is ticked. **No date of birth is collected.** | Self-declaration only | `src/components/AuthScreen.jsx` (`ageConfirmed`, `oauthBlocked`, checkbox text); Terms §2 and Privacy §15 in `src/components/LegalPage.jsx` |
| **Privacy defaults for new accounts** | Handle search off, leaderboard off, habit-streak sharing off (the streak shows the habit's name, e.g. a quit-drinking streak). These apply to **every** new account, because the app does not know who is under 18. | Database defaults (binding for new rows) plus client logic | `supabase/audit_schema_2026_10.sql` §68; `src/lib/friends/privacy.js`; `src/data/initialState.js` (`shareStreak` absent); `src/components/SettingsSection.jsx` |
| Other friend-card sharing | Profile photo, heatmap, recent wins and **online status default on** (shown to friends only) | Client | `src/data/initialState.js` (`shareAvatar`, `shareHeatmap`, `sharePresence: true`) |
| **Blocking** | Removes the friendship and stops messages, reactions, friend requests and handle search, in both directions | Binding (RLS with definer helpers) | `supabase/security_hotfix_2026_09_30.sql` (`is_blocked_either`, item 34); `supabase/dm_upgrade_2026_10.sql` (`dm_blocked_by`); `src/lib/friends/queries.js` (`blockUser`); `src/components/friends/MessagesModal.jsx` (`handleBlock`) |
| **Reporting** | From a friend card, a DM (⋯ menu), a leaderboard row and a group-board row. Reasons: harassment or bullying, inappropriate name, spam, impersonation, something else, plus free text. | Binding: clients may insert a report but never set its outcome | `src/components/friends/ReportFriendModal.jsx` (`REASONS`); `src/components/friends/ReportBlockButton.jsx`; `src/components/FriendRatingsModal.jsx`; `src/components/groups/GroupBoard.jsx`; `supabase/audit_schema_2026_10.sql` §63 (column grants) |
| **Evidence kept** | The report snapshot keeps the handle and name. A DM report copies the reported person's recent messages. A trigger copies the **last 10 DMs between the pair** when the report is made, so unsending cannot erase them. The report survives either account being deleted (`ON DELETE SET NULL`). | Binding | `supabase/audit_schema_2026_10.sql` §63; `supabase/dm_upgrade_2026_10.sql` (reports evidence trigger); `netlify/lib/moderationCore.js` (`snapshotMessages`) |
| **Owner moderation queue** | Lists open reports with both handles, the reason, the text and the messages. Options: dismiss, action, action plus suspend, unsuspend. Owner-only, checked on the server. Web only. | Binding (server-side owner check) | `netlify/functions/moderation.js` (`isOwnerEmail`); `netlify/lib/moderationCore.js`; `src/components/moderation/ModerationQueue.jsx`; `netlify/functions/security-console.js` (`report.decide`, `user.suspend`, `user.ban`) |
| **Suspension** | Hides the user from the leaderboards, handle search and group boards (cached for up to 5 minutes). Stops new invite links. **Does not stop them messaging existing friends**: the client mutes those conversations, but the server's insert policy has no suspension check. | Partly binding | `netlify/lib/suspended.js`; `netlify/functions/get-leaderboard.js`; `supabase/dm_upgrade_2026_10.sql` (`create_friend_invite` suspension check); `src/lib/friends/dmView.js` (`muted`); `docs/ABUSE_HANDLING.md` |
| **Account ban** | Bans the account in Supabase Auth and sets the suspension. Blocks new sign-in and token refresh, but not a session that is already live. | Binding (server) | `netlify/functions/security-console.js` (`user.ban`; the notes say live sessions are not ended) |
| **Name filter** | A blunt whole-word filter for slurs, explicit terms, links, phone numbers and emails, including common disguises | **Binding for group names** (written by the server). **Advisory for display names and handles**: a user can still write those fields directly (item 84). **Not applied** to DMs or food contributions. | `netlify/lib/nameFilter.js` (+ test); `src/lib/moderation/nameFilter.js`; `netlify/functions/groups.js` (`checkPublicText`); `src/lib/friends/usePublishProfile.js`; `src/lib/friends/queries.js`; `src/components/settings/AccountPanel.jsx` |
| **Image screening** | An AI model (Anthropic API) screens for nudity or sexual content, graphic violence, hate symbols, harassment or impersonation, illegal goods, drugs, self-harm and shock content. **It fails closed**: if unsure or unavailable, the picture stays pending. A human can overrule it from the queue. | **Binding for group pictures** (server-written). **Advisory for avatars**: a user can still write `avatar_url` directly (item 84). Avatars published before screening existed have not been re-screened. | `netlify/lib/imageModeration.js`; `netlify/functions/groups.js` (`setCrest`); `netlify/functions/avatar-check.js` (header says it is "a gate for honest clients, not an access control"); `src/lib/friends/avatarScreen.js` |
| **Throttles** | Messages 30/min; reactions 60/min; friend requests 20/hour; invite links 20/day | Binding (triggers) | `supabase/audit_schema_2026_10.sql`; `supabase/dm_upgrade_2026_10.sql` |
| **Database shape limits** | Message 1–2,000 characters; display name 40 or fewer; avatar must be a JPEG/PNG/WebP data URL of 300k characters or fewer; handle pattern | Binding | `supabase/messages_schema.sql`; `supabase/audit_schema_2026_10.sql` §63; `supabase/social_schema.sql` |
| **Food contributions** | Opt in to contribute and opt in to see. Hidden after three reports (one per account). The contributor is never shown. | Binding | `supabase/food_contributions_schema.sql` |
| **Stale-report sweep** | Raises a security ticket when a report has been open for more than 24 hours | Server. **Severity is "medium", while phone alerts default to "critical" only**, so it does not ping anyone unless `ALERT_MIN_SEVERITY` is lowered. | `netlify/lib/sweepRules.js` (`staleReportHours: 24`, `severity: 'medium'`); `netlify/lib/securitySweep.js`; `netlify/lib/alertNotify.js` (`ALERT_MIN_SEVERITY` default) |
| **In-app "Report a problem"** | Category "Someone is abusing the app" files a ticket in the owner's Security console | Server. **Signed-in users only.** | `src/components/settings/SupportCard.jsx`; `netlify/functions/support-ticket.js` |
| **Moderation process document** | 24-hour target, decision table, evidence and retention, escalation to the IWF, CEOP, police and counter-terrorism police | Process | `docs/ABUSE_HANDLING.md` |
| **Terms of Service moderation section** | Acceptable use (§7) and reporting, blocking and moderation (§7a), including "Disagree with a decision? Contact us…" | Published | `src/components/LegalPage.jsx` (`TermsContent`) |

**Dependency:** much of the above only works once
`supabase/audit_schema_2026_10.sql` and `supabase/dm_upgrade_2026_10.sql`
have been run in production. That covers report status, the evidence
snapshot, suspension, the throttles, the privacy defaults for new
accounts, and DM evidence. The owner should **confirm both have been run**
and record the date in the evidence log.

### 3.3 Inconsistencies found while inventorying

`docs/ABUSE_HANDLING.md` should be corrected so the moderation record is
accurate:

1. Its evidence table says a report is deleted when the **reporter**
   deletes their account ("`reporter_id` cascades").
   `supabase/audit_schema_2026_10.sql` now sets `reporter_id` to
   `ON DELETE SET NULL`, so the report survives.
2. It says DMs are lost when either account is deleted.
   `supabase/dm_upgrade_2026_10.sql` now copies the last 10 DMs into the
   report when it is made, so those survive with the report.
3. It says to "check whether [the NCA CSEA reporting] duty is in force".
   It came into force on **7 Apr 2026** (section 0).
4. The Terms (§7a, "Action") say the service may "remove or reset content
   (for example a display name, handle…)". **No owner tool to reset a
   display name or handle was found** in `netlify/lib/moderationCore.js`
   or `netlify/functions/security-console.js`. Today it would have to be
   done by hand in the database.

---

## 4. Illegal content risk assessment

This follows Ofcom's four-step method:

1. **Understand** the kinds of illegal harm.
2. **Assess** the risk of each one (likelihood and impact).
3. **Decide** on measures, put them in place, and record them.
4. **Report, review and update.**

The "core inputs" used are:

- Ofcom's Risk Profiles and Register of Risks, from the author's
  knowledge;
- the service's own data: the feature inventory in section 3;
- reports and complaints received. *The owner should add the count of
  reports, their reasons and their outcomes from the moderation queue.
  The author could not see production data.*

No "enhanced inputs" have been used yet, such as commissioned research,
product testing or user surveys. Ofcom expects those mainly from larger
or higher-risk services.

### 4.1 Step 1: risk factors from Ofcom's Risk Profiles

| Risk factor (Ofcom user-to-user profile) | Present on Vantage? | Notes |
|---|---|---|
| Service type: social media | Partly | Has profiles, connections and a leaderboard, but no feed or posting. Mainly a personal tracker. |
| Service type: private messaging | Partly | Has 1:1 DMs, but messaging is not what the service is mainly for |
| Service type: gaming, dating, marketplace, forum, file-sharing, adult | No | It has game-like features (coins, leagues), but no in-game chat with strangers |
| User base includes **children** | **Yes** | 13+ allowed; no age signal |
| User base size | Small | Lowers how far things spread. Does not lower the risk to an individual. |
| **User profiles** (name, photo) | **Yes** | |
| Anonymous or fake profiles possible | **Yes** | Email or Google/Apple sign-up; no identity checks |
| **User connections** (friends) | **Yes** | |
| **User search** for people | Yes, opt-in | Handle prefix search |
| Network expansion prompts / suggestions | No | None found |
| User groups | Yes | Invite-only league groups with **no chat** |
| **Direct messaging** | **Yes** | Text only, friends only |
| Encrypted (E2E) messaging | No | Helps moderation |
| Group messaging | No | |
| Posting images or video | Limited | Avatar and group picture only, both screened |
| Livestreaming | No | |
| Commenting, reacting | Reactions only | Six fixed emoji on DMs |
| Hyperlinks | Plain text in DMs | Not clickable. The name filter rejects links in names. |
| Posting or sharing location | No | |
| Recommender / content feed | No | |
| Leaderboard / rankings | **Yes** | Not an Ofcom-named factor, but relevant to bullying and to discovery |
| Business model | Freemium subscription | No ads. The Pro tier lifts the 5-friend cap, which widens who can be reached. |

### 4.2 Step 2: assessment of each kind of priority illegal harm

How to read the table:

- **Likelihood** means how likely the harm is to occur on this service,
  given its features.
- **Impact** means how serious it would be for a user, weighted for
  children.
- Ofcom's scale is **low, medium, high**. This draft uses
  **"negligible"** for harms the service's features make practically
  impossible. Record those as **low** for Ofcom, with the reason "the
  functionality is absent".

| # | Kind of illegal harm | Plausible here? How it could happen | Main existing controls | Likelihood | Impact | **Risk level** |
|---|---|---|---|---|---|---|
| 1 | Terrorism | Only through text DMs between friends, or extremist names or insignia in a name or picture | Name filter (group names binding; personal names advisory); image screening rejects extremist insignia; reporting | Very low | High | **Low** |
| 2a | **CSEA: grooming** | An adult finds a 13–17-year-old on the leaderboard or through an invite link, sends a request, and once it is accepted moves to DMs and tries to move off-platform | DMs are friends-only; block; report from the DM and the card; search and leaderboard off for new accounts; no suggestions; no location; no image DMs; messages readable for review; friend cap on Free | **Medium** | **Very high** | **MEDIUM** |
| 2b | CSEA: CSAM (images) | Only through an avatar or group picture, or a CSAM URL typed into a DM | Image screening (binding for group pictures; advisory for avatars); no image DMs; URLs not clickable; IWF/CEOP escalation in `docs/ABUSE_HANDLING.md` | Low | Very high | **Low** (moves up if images are ever added to DMs) |
| 3 | Hate | Slurs in display names, handles or group names; hateful DMs; hate symbols in pictures | Name filter; image screening; report reason "inappropriate handle or display name"; suspension | Low–medium | Medium | **Low** |
| 4 | **Harassment, stalking, threats and abuse** | Bullying in DMs, especially between teens who are already friends. Repeated requests after a decline. Being shown online, plus the heatmap, lets someone watch another person's activity. League rankings and removals from groups used to humiliate. | Block (binding, both directions); report with evidence; throttles; presence and heatmap toggles; suspension and ban | **Medium** | Medium–high | **MEDIUM** |
| 5 | Controlling or coercive behaviour | A partner who is a friend uses online status, the heatmap and streaks to monitor someone; pressure through DMs | Per-field sharing toggles; block | Low | High | **Low** (note: online status defaults to on) |
| 6 | Intimate image abuse | Only through an avatar or group picture | Screening rejects nudity and sexual content; no image DMs | Very low | Very high | **Low** (negligible functionality) |
| 7 | Extreme pornography | As above | As above | Very low | High | **Low** (negligible functionality) |
| 8 | Sexual exploitation of adults | Soliciting through DMs between friends | Friends-only DMs; report | Very low | High | **Low** |
| 9 | Human trafficking | No listings or marketplace | n/a | Very low | Very high | **Low** (negligible) |
| 10 | Unlawful immigration | No listings or marketplace | n/a | Very low | High | **Low** (negligible) |
| 11 | Fraud and financial services | Investment, crypto or "money flipping" pitches in DMs; impersonation (a reason that exists); invite links posted publicly to harvest friends; fake accounts are easy to make | Friends-only DMs; friend cap; throttles; report reason "spam" or "impersonation"; links not clickable; no payments between users | Low–medium | Medium | **Low** (review if any scam report arrives) |
| 12 | Proceeds of crime | No transfers of value between users. Coins are in-app only and cannot be cashed out. | n/a | Very low | Medium | **Low** (negligible) |
| 13 | Drugs and psychoactive substances | Arranging a supply in DMs between friends | Friends-only DMs; report | Low | Medium–high | **Low** |
| 14 | Firearms, knives and other weapons | As above | As above | Very low | High | **Low** |
| 15 | **Suicide and self-harm** (merged kind, Jun 2026) | Encouraging or assisting self-harm or suicide in DMs. The user base tracks weight, food and habits (some habits are private, e.g. self-harm streaks: see `src/lib/friends/privacy.js` header). | Friends-only DMs; streak sharing opt-in; report ("something else" only); image screening rejects self-harm images | Low | Very high | **Low**. The offence needs intent, which is rarer than the content in general. See the children's assessment, where the same content is rated medium. |
| 16 | Foreign interference | No public reach | n/a | Very low | Medium | **Low** (negligible) |
| 17 | Animal cruelty | Only through pictures | Screening rejects graphic violence | Very low | Medium | **Low** |
| 18 | **Cyberflashing** (new kind, Jun 2026) | Needs images of genitals to be sent. DMs carry no images. Avatars and pictures are screened. | No image DMs; screening | Very low | High | **Low** (negligible functionality) |
| – | Other (non-priority) illegal content: threatening communications, false communications, epilepsy trolling | Threats in DMs (covered by #4). Flashing images: avatars are static. The database allows WebP, which can be animated; check that the client always re-encodes to JPEG. | As #4 | Low | Medium | **Low** |

**Outcome: two medium ratings (grooming; harassment, stalking, threats
and abuse), so Vantage is multi-risk.** The owner may reasonably disagree
with one of these. If grooming were rated low, the service would be
single-risk and fewer Codes measures would apply. This draft recommends
keeping both at medium until there is evidence (for example, the
proportion of under-18s, and report history).

#### 4.2.1 Why grooming is medium (detail)

What increases the risk:

1. Children aged 13–17 are explicitly allowed (`AuthScreen.jsx`).
2. **The app has no idea which users are children.** There is no date of
   birth or age band. So it cannot apply child-specific protections.
3. 1:1 DMs exist and are private to the pair.
4. Older accounts may still be **on the global leaderboard and in handle
   search by default**. They were created before the defaults changed and
   kept the original `true` (`supabase/leaderboard_schema.sql`,
   `supabase/social_schema.sql`).
5. **Any leaderboard row has a "+ Add" button**
   (`LeaderboardPanel.jsx`), so leaderboard visibility directly enables
   friend requests from strangers.
6. The social rating rewards having up to 20 friends.
7. Invite links can be posted publicly, for example on social media.
8. Incoming friend requests show only **Accept / Decline**. There is
   **no block or report on a request** (`PendingRequestsList.jsx`). A
   declined requester can send again, within the 20-an-hour throttle.

What reduces the risk:

1. DMs need an *accepted* friendship (`messages_insert` policy).
2. There are no friend suggestions, no location, and no image DMs.
3. Messages are not end-to-end encrypted, so reported conversations can
   be reviewed.
4. Defaults for new accounts are off for search, leaderboard and streak.
5. The free tier is capped at 5 friends.
6. Blocking is binding.
7. Reports carry the last 10 messages as evidence.

The impact would be very high. Overall: **medium**.

#### 4.2.2 Why harassment is medium (detail)

DMs, ranked leaderboards and leagues, and groups where the leader can
remove members together create the classic conditions for peer bullying,
especially between teenagers who already know each other. Being shown
online and the 91-day heatmap are on by default for friends
(`initialState.js`), which helps with monitoring or stalking within a
friendship.

Blocking, reporting with evidence, and the throttles are good controls.
Suspension does not stop DMs to existing friends. Nothing alerts an owner
when a report arrives (`docs/ABUSE_HANDLING.md`; the stale-report ticket
is severity medium and does not ping). Overall: **medium**.

### 4.3 Step 3: measures to add

These follow from the risk levels. The Codes checklist in section 7 maps
each one to Ofcom's measures.

**Grooming:**

- **G1.** Add an **age signal**. At minimum, ask for the year of birth at
  sign-up, or an under-18 / 18+ choice. Treat "under 18" and "not
  answered" as a child.
- **G2.** Child safety defaults for under-18s (and for unknown ages
  wherever practical):
  - not shown on the global leaderboard and no "+ Add" from it;
  - not in handle search;
  - friend requests only from invite links or handle search the child
    turned on;
  - online status and heatmap off by default.
- **G3.** **Prompt existing accounts** whose search or leaderboard
  setting was never chosen ("You're visible on the global leaderboard,
  keep it?"). Do not rewrite their stored values: under the CLAUDE.md
  data-safety rule, the change must be additive.
- **G4.** **Block and report on an incoming friend request.**
- **G5.** **Supportive information for child users** at key moments: when
  accepting a request from someone who is not a mutual friend, when
  blocking, and when reporting (who to talk to; Childline).
- **G6.** Add a report reason **"Child safety / sexual messages"** that
  is prioritised in the queue, and route those reports to CEOP or the NCA
  process.
- **G7.** Consider removing the friend-count element from the social
  rating, or capping it at accepted *mutual* invites, so the app does not
  reward accepting strangers.

**Harassment:**

- **H1.** Make **suspension binding for DMs**: add `suspended_at is null`
  for the sender to the `messages_insert` policy, as an additive SQL file
  for the owner to run.
- **H2.** **Owner alert when a report is inserted.** Either queue a push
  through `push-dispatch`, or raise the stale-report ticket's severity or
  lower `ALERT_MIN_SEVERITY` (item 79).
- **H3.** Add report reasons for **threats / violence**, **hate**,
  **sexual content**, **self-harm / suicide risk**, and **scam / fraud**.
- **H4.** A **mute** option for DMs, short of blocking.
- **H5.** Make display name, handle and avatar writes **server-side**,
  so the filter and the screening are binding (item 84).
- **H6.** An owner tool to **reset a display name, handle or avatar**,
  which the Terms already promise.

**General:**

- **X1.** Name the **accountable individual** and write the content
  policies and moderation targets (section 7).
- **X2.** Register with the **NCA** and write a CSEA reporting procedure
  that matches SI 2026/268 (section 7, CSEA reporting).
- **X3.** A complaints and appeals route that works **without an
  account** (support email and URL, item 72), with acknowledgements and
  target times.
- **X4.** Re-screen avatars that were published before screening
  existed: a one-off, read-only job that flags them to the queue.

### 4.4 Step 4: report, review, update

- The accountable individual (section 7, A) signs off this assessment and
  keeps it with the records listed in section 9.
- Review it **at least every 12 months**. Also review it **before** any
  change listed in section 9.2, and after any serious incident.
- Keep track of report volumes and reasons from the moderation queue
  every month. That is the main evidence of whether these ratings are
  right.

---

## 5. Children's access assessment

The Act (ss.35–37) asks two questions.

**Stage 1: is it possible for children to access the service?**
**Yes.** The only way to answer "no" is to use highly effective age
assurance that actually keeps under-18s out. Vantage *invites* 13–17s:
the Terms say "You must be at least 13…. If you are under 18, you confirm
you have permission from a parent or guardian"
(`src/components/LegalPage.jsx`, Terms §2). The age check is a
self-declared checkbox (`src/components/AuthScreen.jsx`).

**Stage 2: is the child user condition met?** It is met if:

- (a) there is a significant number of children among the service's
  users; **or**
- (b) the service is of a kind likely to attract a significant number of
  children.

"Significant" can be a small number in absolute terms, and it is judged
against the size of the service.

- (a) Unknown, because no age data is collected. *The owner should record
  any evidence they have, such as users known to be at school.*
- (b) **Likely yes.** The service openly admits 13+. It has game-style
  features (coins, streaks, levels, leagues, divisions, achievements) and
  social comparison. Its fitness, study and habit tracking appeals to
  teenagers.

**Conclusion (draft):** the child user condition is **met**. Vantage is
"likely to be accessed by children". So the children's risk assessment
duty (s.11) and the children's safety duties (s.12) apply.

The record of this assessment should hold:

- the date;
- who carried it out;
- the evidence considered (above);
- the conclusion.

Ofcom expects the children's risk assessment to follow within about three
months of a "likely to be accessed" conclusion. The solicitor should
confirm the timing for a service that is already live.

---

## 6. Children's risk assessment (outline)

This uses the same four steps, applied to content that is harmful to
children. As in section 4, the risk comes from user-to-user content,
which on Vantage means **DMs** above all, then names, pictures and
streak names. **Health or diet content the app itself provides is not
user-to-user content**, so it is outside these duties. It is worth noting
as a product-safety matter, though: calorie targets, weight trends, and a
fitness rating shown to a 13-year-old.

### 6.1 Primary priority content (PPC): children should be prevented from encountering it

| Kind of PPC | Route on Vantage | Controls | Draft level |
|---|---|---|---|
| Pornography | Text DMs (sexualised text); pictures (screened) | Friends-only DMs; image screening; Terms prohibit sexually explicit content | **Low** |
| Content encouraging, promoting or giving instructions for **suicide** | DMs | Friends-only DMs; report | **Low** |
| Content encouraging, promoting or giving instructions for **self-harm** | DMs between friends; streak names are opt-in, and a private habit name such as "self-harm" is only shown to friends if the user chooses | Streak opt-in (`privacy.js`); report (no specific reason); screening rejects self-harm images | **Medium** |
| Content encouraging, promoting or giving instructions for an **eating disorder** | DMs between friends who share diet and weight goals ("accountability buddies"). The app's user base tracks food, weight and body measurements. | Friends-only DMs; nutrition and weight data are private and not on the profile card (`supabase/food_contributions_schema.sql` header: "what somebody eats is not a thing to publish next to their name") | **Medium** |

### 6.2 Priority content (PC): children should be protected, in an age-appropriate way

| Kind of PC | Route | Draft level |
|---|---|---|
| **Bullying** | DMs; rankings; group removals; names | **Medium** |
| Abuse and hate (targeting protected characteristics) | Names; DMs; pictures | **Low** |
| Violent content (encouraging, or realistic depiction) | DMs; pictures (screened) | **Low** |
| Harmful substances (encouraging people to take them) | DMs | **Low** |
| Dangerous stunts and challenges | DMs. The app's own challenges are not user-to-user content. | **Low** |

### 6.3 Non-designated content (NDC)

Ofcom has named **body-stigma content** and **depression content** as
examples of non-designated content harmful to children. Both are relevant
to a wellness app.

On Vantage, user-to-user exposure is limited to DMs and the fitness
rating on the leaderboard. Body measurements are not published. Draft
level: **Low**. Revisit if any body or physique content becomes shareable.

### 6.4 Current teen protections (checked in code)

| Protection | Status | Evidence |
|---|---|---|
| Handle search off by default | **Yes for new accounts (all ages).** Older accounts keep the original "on" default. | `supabase/audit_schema_2026_10.sql` §68; `supabase/social_schema.sql` |
| Global leaderboard off by default | **Yes for new accounts (all ages).** Older accounts keep the original "on" default. | `supabase/audit_schema_2026_10.sql` §68; `supabase/leaderboard_schema.sql` |
| Habit-streak sharing (shows the habit's name) opt-in | **Yes** (all accounts; a stored `true` that was never chosen is read as off) | `src/lib/friends/privacy.js`; `src/components/SettingsSection.jsx` |
| DMs only from accepted friends | **Yes** (all accounts) | `supabase/messages_schema.sql`; `supabase/security_hotfix_2026_09_30.sql` |
| No friend suggestions; no location | **Yes** | Section 3.1 |
| Online status and heatmap off for teens | **No.** On by default for friends. | `src/data/initialState.js` |
| Child-specific defaults of any kind | **Not possible today.** No age signal. | `src/components/AuthScreen.jsx` |
| Age-appropriate support information when blocking or reporting | **No** | `src/components/friends/ReportFriendModal.jsx` |
| Highly effective age assurance | **No** | n/a |

STARTUP_REQUIREMENTS.md item 68 is marked `[~]`. In practice the
protections it lists apply to **every new account**, because the app
cannot tell which users are teenagers. That protects children more than
it would if the protections applied only to known teenagers. Older
accounts are not covered, and nothing is tailored to under-18s.

### 6.5 Measures to add (children)

- **C1.** All of G1–G7 and H1–H4 in section 4.3.
- **C2.** A **"self-harm or suicide risk"** report reason that shows
  crisis signposting straight away (Samaritans 116 123; Childline
  0800 1111; 999 in an emergency), and goes to the top of the owner's
  queue.
- **C3.** Default **online status and heatmap off** for under-18s.
- **C4.** **Highly effective age assurance: solicitor question.** Under
  the Protection of Children Codes, services that do not prohibit PPC, or
  that are at medium or high risk of a kind of PPC, may be expected to use
  it. Vantage's Terms prohibit sexually explicit content, but say nothing
  explicit about suicide, self-harm or eating-disorder content. Add that
  prohibition (section 8). Then ask whether, with prohibition plus
  reporting plus moderation, a text-only, friends-only DM channel needs
  age assurance (Q6).
- **C5.** Children's Terms: a plain-English summary aimed at 13–17s.

---

## 7. Codes of Practice: measures checklist

**Caveat:** the measure labels (ICU = illegal content, user-to-user;
PCU = protection of children, user-to-user) and who each measure applies
to are **from memory of the Dec 2024 / Apr 2025 Codes**, with later
changes noted from search results. Ofcom has amended the Codes since
then. **Check each row against the current consolidated Codes.**

Key to "Applies to":

- **All** means every user-to-user service.
- **MR** means multi-risk or large services (Vantage counts on this
  draft's ratings).
- **L** means large services only (not Vantage).
- **Risk** means services at a specific level of risk for a specific harm.

### 7.1 Illegal content Codes (user-to-user)

| Area | Measure (Ofcom ref, to verify) | Applies to | Vantage status | Gap / action |
|---|---|---|---|---|
| Governance | Senior body reviews risk management every year (ICU A1) | L | n/a | Still do a yearly review (section 9) |
| Governance | **Named individual accountable** for the illegal content safety duties and the reporting and complaints duties (ICU A2) | **All** | **Missing** | Record the owner (and, once it exists, the company director) as accountable, in writing, with the date. `docs/ABUSE_HANDLING.md` names no one. |
| Governance | Written statements of responsibilities (ICU A3) | MR | **Missing** | One paragraph per owner: who moderates, who reviews, who handles complaints, who reports to the NCA |
| Governance | Internal monitoring and assurance (ICU A4) | L and MR | n/a | |
| Governance | Track evidence of new and increasing illegal harm (ICU A5) | MR | **Partly** | The queue holds reports. Add a monthly count by reason (section 9). |
| Governance | Code of conduct for staff (ICU A6) | L and MR | n/a | |
| Governance | Compliance training (ICU A7) | MR (verify) | **Missing** | A short written briefing for anyone who moderates |
| Moderation | **Content moderation function to review and assess suspected illegal content** (ICU C1) | **All** | **Partly** | Owner queue exists (`netlify/functions/moderation.js`, `src/components/moderation/ModerationQueue.jsx`). Depends on the audit SQL being run. Nothing alerts an owner when a report arrives. |
| Moderation | **Swift takedown of illegal content** (ICU C2) | **All** | **Partly** | Suspension and Auth ban exist (`security-console.js`). Gaps: suspension does not stop DMs; no tool to reset a name, handle or avatar; the owner cannot delete a specific message. Reported messages stay in the report snapshot only. |
| Moderation | Internal content policies (ICU C3) | MR | **Partly** | `docs/ABUSE_HANDLING.md` has a decision table. Add definitions per kind of harm, with examples, linked to Ofcom's Illegal Content Judgements Guidance. |
| Moderation | Performance targets (ICU C4) | MR | **Partly** | A 24-hour target is written down (`docs/ABUSE_HANDLING.md`). Nothing measures it. The stale-report sweep could (`netlify/lib/sweepRules.js`). |
| Moderation | Prioritisation (ICU C5) | MR | **Missing** | Queue is ordered newest first. Put child-safety, threats and self-harm reports first (needs H3/G6). |
| Moderation | Resourcing (ICU C6) | MR | **Partly** | Two owners. Write down the cover arrangement (holidays, illness). |
| Moderation | Training and materials for moderators (ICU C7) | MR | **Partly** | `docs/ABUSE_HANDLING.md` escalation table. Add a CSEA handling note: never open, download or forward; report to the NCA. |
| Moderation | Hash-matching / URL detection for CSAM (ICU C9/C10); intimate-image hash-matching (reported ICU C14, Sep 2026) | Risk / size | **n/a (verify)** | Applies to services at high risk of those harms, or above size thresholds (reported as 700k monthly UK users for C14). Vantage is low risk for image harms and far below the thresholds. **Revisit if image DMs are ever added.** |
| Reporting and complaints | **Users can report illegal content and complain** (ICU D1) | **All** | **Partly** | Reporting exists from four places. **Reasons do not cover illegal-content categories** (`ReportFriendModal.jsx`). There is no general complaint route for non-users. |
| Reporting and complaints | **Easy to find, access and use** (ICU D2) | **All** | **Partly** | The report option sits in ⋯ menus. No report on an incoming friend request. Check accessibility (screen reader labels, contrast). |
| Reporting and complaints | Acknowledge complaints, give an expected time, tell people the outcome (ICU D-series; some parts MR) | All / MR | **Missing** | Neither the reporter nor the reported user is told anything. Add an in-app "We've received your report" message and an outcome notice. |
| Reporting and complaints | **Appeals**: a user can challenge a decision that their content was illegal, or a restriction on their account, and wrong decisions are reversed (ICU D-series) | **All** | **Partly** | The Terms say "contact us via the support address". There is no support address yet (item 72) and no written process. Unsuspend exists (`moderation.js` `unsuspend`). |
| Reporting and complaints | Dedicated fraud-reporting channel for trusted flaggers | L / Risk | n/a | |
| Terms of service | **Terms explain how users are protected from illegal content, including any proactive technology, and how complaints are handled** (ICU G1) | **All** | **Partly** | Terms §7/§7a cover a lot. Missing: a list of illegal content, the proactive technology (AI image screening) described *in the Terms* (it is only in the Privacy policy), complaints and appeals steps and timings, and child-harm content. Section 8 has draft wording. |
| Terms of service | **Terms are clear and accessible** (ICU G3) | **All** | **Partly** | Terms are reachable before sign-in at `/terms` (`src/components/LegalPage.jsx`). Add a plain summary, and a teen-readable one. |
| Child safety defaults | **Safety defaults for child users**: not shown in network expansion prompts; connection lists hidden; **non-connections cannot DM**; location hidden (ICU F1) | Services at high risk of grooming; large services at medium risk (verify) | **Partly** | Not strictly recommended for a small service at medium risk, but **strongly advisable**. Non-connections cannot DM. No suggestions. No location. **Leaderboard and search are not off for older accounts. No age signal.** (G1–G3) |
| Child safety defaults | **Supportive information for child users** (ICU F2) | As F1 | **Missing** | G5 |
| User controls | **Block and mute** (ICU J1) | L with relevant risks. **A 2025 proposal would extend it to smaller services likely accessed by children; status unconfirmed.** | **Partly** | Block is binding. **No mute.** (H4) |
| User controls | Disable comments (ICU J2); labels for notable users (ICU J3) | L | n/a | No comments |
| User access | Remove accounts of proscribed organisations (ICU H1) | Verify (all, or risk-based) | **Partly** | Ban exists. Add to the content policy. |
| Recommender systems | Safety testing of recommender systems | Risk / L | n/a | No feed |
| **CSEA reporting (not a Codes measure, a legal duty)** | Register with the NCA and report detected, unreported CSEA content in the prescribed form and time (s.66; SI 2026/268) | **All UK user-to-user services** | **Missing** | X2. Update `docs/ABUSE_HANDLING.md`. Today it sends CSAM to the IWF and grooming to CEOP. The solicitor should confirm how those routes relate to the NCA duty. |

### 7.2 Protection of Children Codes (user-to-user)

| Area | Measure (to verify) | Vantage status | Gap / action |
|---|---|---|---|
| Governance | Named person accountable for the children's safety duties; and, if MR, written responsibilities, tracking of new harms, and training | **Missing** | Same person and records as 7.1 |
| Moderation | Moderation function that reviews content harmful to children and acts swiftly; for MR, internal policies, targets, prioritisation and training | **Partly** | As 7.1. Add PPC/PC kinds to the content policy. |
| Age assurance | Highly effective age assurance where PPC is not prohibited, or where there is medium or high risk of PPC (the conditions differ by measure) | **Missing** | Q6. At minimum, prohibit all PPC in the Terms. |
| Reporting and complaints | As for illegal content, plus complaints about wrong age assessments (only if age assurance is used) | **Partly** | As 7.1 |
| Terms | Terms explain how children are protected, by kind of harm; any age assurance; proactive technology | **Missing** | Section 8 |
| User support | Children can block and mute; children can decline group invitations; support information when restricting or reporting | **Partly** | Block yes. Mute no. Groups are joined only by the child's own action with a code. Support information missing. |
| Feeds | Filter PPC/PC out of children's recommender feeds | n/a | No feed |

---

## 8. Terms of service: proposed wording

Draft text for `src/components/LegalPage.jsx` (`TermsContent`). Plain
English, and **for the solicitor to edit**. The new text adds to the
existing §7 and §7a rather than replacing them. Square-bracketed items
are placeholders.

### 8.1 Replace §7's bullet list opening with

> **7. Keeping Vantage safe — what isn't allowed**
>
> Vantage has friends, direct messages, groups and leaderboards. Anything
> other people can see — your display name, @handle, profile picture,
> messages, group name and group picture — must follow these rules.
>
> You must not use Vantage to share, send, or arrange anything illegal.
> That includes, but is not limited to:
>
> - anything that sexually exploits or abuses a child, or tries to
>   contact a child for sexual purposes ("grooming");
> - threats, harassment, stalking, or controlling someone's behaviour;
> - hate based on race, religion, sex, sexual orientation, disability or
>   gender identity;
> - encouraging or helping someone to take their own life or seriously
>   harm themselves;
> - sending sexual images without consent, including unsolicited images
>   of genitals;
> - fraud, scams, or impersonating someone;
> - selling or arranging drugs, weapons or other illegal goods;
> - terrorist content.
>
> Because people aged 13–17 use Vantage, you must also not send or post:
>
> - pornography or sexual content of any kind;
> - content that promotes or gives instructions for suicide, self-harm or
>   eating disorders;
> - bullying, or content that is violent, abusive or encourages dangerous
>   stunts or taking harmful substances.
>
> [Keep the existing bullets about account access, reverse-engineering
> and leaderboard manipulation.]

### 8.2 Add to §7a (Reporting, Blocking & Moderation)

> - **How we check content.** We do not read your messages as a matter of
>   course. We look at messages only when someone in the conversation
>   reports them; the report includes recent messages so we can judge
>   it. Group pictures and profile pictures are checked automatically
>   by an AI system before other people see them, and a person reviews
>   anything the system is unsure about. Display names, handles and group
>   names go through a word filter.
> - **What happens to a report.** You'll see a confirmation when your
>   report is sent. We aim to look at every report within 24 hours and
>   reports about a child's safety, threats or self-harm first. We'll let
>   you know when we've dealt with it. We don't tell the reported person
>   who reported them.
> - **Illegal content.** If we find content that is likely to be illegal
>   we remove or restrict it as quickly as we can and may suspend or close
>   the account. We report child sexual abuse content to the National Crime
>   Agency as the law requires, and may report other crimes to the police.
> - **If you're in danger.** If you or someone else is at immediate risk,
>   call 999. You can talk to Samaritans any time on 116 123, or if you're
>   under 19, Childline on 0800 1111.

### 8.3 New section: Complaints and appeals

> **7b. Complaints and appeals**
>
> You can complain to us if:
>
> - you've seen content on Vantage you think is illegal or harmful to
>   children;
> - you think we've got a moderation decision wrong — for example we
>   removed your name or picture, hid you from the leaderboard, or
>   suspended or closed your account;
> - you think we're not doing what the law (including the Online Safety
>   Act 2023) or these terms say we will.
>
> You don't need an account to complain. Use Settings → Report a problem
> in the app, or email [support@domain]. We'll confirm we've received your
> complaint within [2 working days] and aim to give you an answer within
> [14 days]. If you're appealing a decision about your own account or
> content, a different person from the one who made the decision will look
> at it where possible. If we got it wrong, we'll reverse it and restore
> what we can.
>
> If you're not happy with our answer, you can tell Ofcom, the UK's online
> safety regulator, though Ofcom doesn't resolve individual complaints.
> [Solicitor: confirm wording and whether to include.]

### 8.4 Replace §15 (Termination) second sentence with

> We may restrict, suspend or close an account that breaks these terms or
> the law. Usually we'll tell you why and how to appeal (section 7b). We may
> not give notice where that would put someone at risk or hinder a police
> investigation. A suspended account is hidden from the leaderboard,
> handle search and group boards, and may be unable to send messages.

*(The last clause becomes true only when measure H1 is built.)*

### 8.5 Add a young-users summary

A short box at the top of the Terms, for 13–17s:

> **If you're under 18:** you need a parent or guardian's OK to use Vantage.
> Only people you accept as friends can message you. You're hidden from
> search and the global leaderboard unless you switch them on. If anyone
> makes you uncomfortable, block them and report them — we'll look at it.
> Never share personal details or meet someone you only know from an app.

---

## 9. Record-keeping and review

### 9.1 What to keep

This follows s.23 and Ofcom's Record-keeping and review guidance (check
the current version). Keep it in a private, access-controlled place both
owners can reach. **Not this public repository, and not chat.**

| Record | Contents |
|---|---|
| **Illegal content risk assessment** | This document once finalised: date, who did it, the evidence (core inputs), the risk factors, the level for each kind of harm with reasons, and the measures chosen. Keep each version. |
| **Children's access assessment** | Date, evidence, conclusion (section 5) |
| **Children's risk assessment** | As for the illegal content assessment (section 6) |
| **Codes measures** | For each Codes measure: adopted (where, when) or not adopted. Where an **alternative measure** is used, explain how it meets the duty. Section 7 is the starting point. |
| **Accountable person and responsibilities** | Names held privately; date of appointment |
| **Moderation log** | The `reports` table: reason, status, `note`, `actioned_by`, `actioned_at`. A monthly summary of counts by reason and time to decision. |
| **NCA reports** | Date, NCA reference, what was reported. Content only as the regulations require: never store CSAM. |
| **Complaints and appeals log** | Received, acknowledged, outcome, dates |
| **Evidence log** | User numbers (total and UK if known), the date each relevant SQL file was run in production, and incidents |
| **Compliance reviews** | Date, who reviewed, what changed |

Retention: the author recalls Ofcom's guidance expecting records to be
kept for **at least five years** and updated when the assessment changes.
**Verify.** `docs/ABUSE_HANDLING.md` keeps closed reports for 12 months.
That is a different record (personal data about individuals), and the
solicitor should reconcile the two (Q9).

### 9.2 Review triggers

Redo the relevant assessment **before** launching any of these, and
record the result:

- **Images, video, voice or files in DMs.** This changes CSAM, intimate
  image abuse, cyberflashing and grooming, and may bring in hash-matching
  measures.
- **Group chat**, or any messaging with non-friends ("message requests").
- **Any public feed, posts, comments, or the return of Shop trending.**
- **Friend suggestions**, "people you may know", contact-book import, or
  location features.
- Livestreaming or voice.
- **Raising the friend cap** or removing it for free users; any reward
  for adding friends.
- **Lowering the minimum age**, or marketing aimed at teenagers or
  schools.
- New ways of finding people (public profiles, web profile pages).
- The trading or Open Banking features (CLAUDE.md). These do not change
  user-to-user risk, but do change fraud exposure if anything becomes
  shareable.
- **The native store launch** (new audience, new reach).
- Ofcom amending a Code or the Risk Profiles, or adding a new priority
  offence. 2026 saw two such changes.
- A serious incident, or a jump in reports of one kind.

Otherwise, **review every 12 months**. Suggested date: the anniversary of
sign-off.

---

## 10. Gaps before launch, mapped to STARTUP_REQUIREMENTS.md

| Gap | Why it matters (Act / Codes) | Checklist item |
|---|---|---|
| Finalise, sign and store the illegal content risk assessment, children's access assessment and children's risk assessment; name the accountable person | ss.9, 11, 23, 35; ICU/PCU A-series | **71** |
| Name and avatar writes moved server-side, so the filter and screening are binding; re-screen older avatars | ICU C1/C2; Apple 1.2 | **84**, **63** |
| Owner alert when a report arrives; measured 24-hour target; prioritised queue; suspension that also stops DMs | ICU C1/C2/C4/C5 | **79**, **63** |
| Report reasons for illegal and child-harm categories; report and block on incoming friend requests; acknowledgement and outcome notices | ICU D1/D2; s.20 | **63**, **79** |
| An age signal at sign-up; child safety defaults; a prompt for older accounts still on the leaderboard or in search; online status and heatmap off for under-18s | ICU F1/F2; s.12 | **68** |
| Support email and URL usable without an account; written complaints and appeals process | s.21; ICU D-series | **72** |
| Terms wording (section 8); controller identity once the company exists | s.10(5)–(7), s.12; ICU G1/G3 | **9**, **64** |
| NCA registration and a CSEA reporting procedure | s.66; SI 2026/268 | **71**, **79** (and `docs/ABUSE_HANDLING.md`) |
| Store age-rating answers consistent with this assessment (user-to-user messaging; 13+; moderation) | Apple and Google questionnaires | **74** |
| A reviewer kit explaining moderation, report and block | Apple 1.2 | **73** |
| 2FA on every admin account. Moderation runs through the owner email check, so a takeover of that email is a takeover of moderation. | Integrity of the moderation function | **80** |
| Confirm `audit_schema_2026_10.sql` and `dm_upgrade_2026_10.sql` are applied in production | Most of the safeguards in section 3.2 depend on them | **63**, **79** |
| A column-level read lockdown on `profiles`. Today any signed-in user can read every column of a searchable profile, including `last_active_at`. | Stalking (section 4, #4) | **83** |
| Fix the inaccuracies in `docs/ABUSE_HANDLING.md` (section 3.3) | Records must be accurate | **79** |
| DPA with Anthropic covering image screening | Proactive technology processes users' images | **75** |

---

## 11. Questions for the solicitor

1. **Timing and provider.** The social features are already live on the
   web. Are the illegal content and children's duties already owed? By
   whom: the owner as an individual now, and the company after
   incorporation (item 1)? How should the assessments pass to the company?
2. **Significant change.** Was the October 2026 DM upgrade (#226: replies,
   reactions, live delivery, invite links and QR codes) a "significant
   change" that needed a new risk assessment **beforehand**? What should
   be recorded now?
3. **Multi-risk.** Do you agree with medium for grooming and for
   harassment? If grooming were assessed as low, the service would be
   single-risk with fewer measures. Is that a defensible position for a
   service that allows 13–17s and has 1:1 DMs?
4. **Food contributions.** Is the opt-in, anonymous food database
   user-generated content in scope, and does it need its own line in the
   assessment?
5. **Child safety defaults.** As a small service at medium grooming risk,
   ICU F1/F2 may not strictly apply. Would Ofcom expect them anyway, given
   that Vantage *invites* 13–17s? Is a self-declared birth year enough to
   apply them, or is highly effective age assurance expected?
6. **Age assurance under the children's Codes.** If the Terms prohibit
   all primary priority content and the only channel is text DMs between
   accepted friends, does Vantage need highly effective age assurance
   under the Protection of Children Codes? Or are prohibition, reporting
   and moderation proportionate?
7. **NCA CSEA reporting.** What exactly must a service this size do under
   SI 2026/268 (registration, triggers, timing, what to keep)? How should
   the existing IWF and CEOP routes in `docs/ABUSE_HANDLING.md` fit
   alongside it?
8. **Proactive technology.** Screening avatars and group pictures with a
   third-party AI model: does this count as "proactive technology" that
   must be described in the Terms (s.10)? Are there conditions on using
   it (accuracy, human review, appeals)? Are the lawful basis (legitimate
   interests) and the Anthropic data-processing terms (item 75) adequate?
9. **Retention.** How long should Online Safety Act records be kept,
   compared with the 12-month retention of report personal data in
   `docs/ABUSE_HANDLING.md` and the Privacy policy?
10. **Reading messages.** Reports include recent messages from the pair,
    copied at report time, including the reporter's side. Is that
    consistent with the s.22 privacy duty and UK GDPR, and is the Privacy
    policy wording (§2 and §6 in `src/components/LegalPage.jsx`) enough?
11. **Complaints to Ofcom.** Should the Terms point users to Ofcom, given
    that Ofcom does not handle individual complaints? Is there a
    preferred form of words?
12. **Parental consent wording.** The Terms ask under-18s to confirm they
    have a parent or guardian's permission. Is that useful, harmful (does
    it suggest verification that isn't happening), or needed for consumer
    contract purposes?
13. **Store launch.** Does launching on the App Store and Google Play
    change anything under the Act (reach, categorisation), or is it only
    a review trigger?
14. **Owner-only features.** The owner-only surfaces (Career, Diet,
    Rotation, the trading widget) are compiled out of the native build
    and have no user-to-user features. Confirm they are out of scope.

---

## Appendix: file index used as evidence

**Database:**

- `supabase/social_schema.sql`
- `supabase/messages_schema.sql`
- `supabase/security_hotfix_2026_09_30.sql`
- `supabase/audit_schema_2026_10.sql`
- `supabase/dm_upgrade_2026_10.sql`
- `supabase/groups_schema.sql`
- `supabase/group_crest_schema.sql`
- `supabase/leaderboard_schema.sql`
- `supabase/food_contributions_schema.sql`

**Server:**

- `netlify/functions/moderation.js`
- `netlify/functions/security-console.js`
- `netlify/functions/groups.js`
- `netlify/functions/avatar-check.js`
- `netlify/functions/get-leaderboard.js`
- `netlify/functions/support-ticket.js`
- `netlify/functions/delete-account.js`
- `netlify/lib/moderationCore.js`
- `netlify/lib/nameFilter.js`
- `netlify/lib/imageModeration.js`
- `netlify/lib/suspended.js`
- `netlify/lib/sweepRules.js`
- `netlify/lib/securitySweep.js`
- `netlify/lib/alertNotify.js`

**Client:**

- `src/components/AuthScreen.jsx`
- `src/components/LegalPage.jsx`
- `src/components/SettingsSection.jsx`
- `src/components/LeaderboardPanel.jsx`
- `src/components/FriendRatingsModal.jsx`
- `src/components/groups/GroupBoard.jsx`
- `src/components/friends/MessagesModal.jsx`
- `src/components/friends/ReportFriendModal.jsx`
- `src/components/friends/ReportBlockButton.jsx`
- `src/components/friends/FriendCard.jsx`
- `src/components/friends/PendingRequestsList.jsx`
- `src/components/friends/InviteLanding.jsx`
- `src/components/friends/InviteLinkSection.jsx`
- `src/components/moderation/ModerationQueue.jsx`
- `src/components/settings/SupportCard.jsx`
- `src/lib/friends/privacy.js`
- `src/lib/friends/queries.js`
- `src/lib/friends/messages.js`
- `src/lib/friends/dmView.js`
- `src/lib/friends/clanInvite.js`
- `src/lib/friends/avatarScreen.js`
- `src/lib/friends/usePublishProfile.js`
- `src/lib/moderation/nameFilter.js`
- `src/data/initialState.js`

**Docs:**

- `docs/ABUSE_HANDLING.md`
- `docs/RANKING_SYSTEM.md`
- `STARTUP_REQUIREMENTS.md` (items 1, 9, 63, 64, 68, 71–75, 79, 80, 83, 84, 90)

# Abuse handling

What happens when someone reports another user, how fast we act, and
what to do when it's more than a moderation problem.

(STARTUP_REQUIREMENTS items 79, 63, 71, 110–114 and 118.)

**Target: every report looked at and decided within 24 hours — reports
about a child's safety, threats or self-harm first.** Apple expects
"timely" action on user-generated content (guideline 1.2); 24 hours is
the working number, and the proposed Terms promise the priority order.

---

## Where reports come from

Users can report from:

- a **friend card** and the **leaderboard** (`FriendRatingsModal` → `ReportBlockButton`);
- a **group board** row (`GroupBoard` → `ReportBlockButton`);
- a **DM** (⋯ menu in `MessagesModal`);
- an **incoming friend request** (`PendingRequestsList` → `ReportBlockButton`) — Report and Block sit on the request itself.

Reasons offered (`src/lib/moderation/reasons.js`), plus free text:

| Reason | Priority | Shown to the reporter straight away |
|---|---|---|
| Child safety | **Urgent** | 999 if a child is in immediate danger; CEOP |
| Threats or violence | **Urgent** | 999 / 101 |
| Self-harm or suicide risk | **Urgent** | 999; Samaritans 116 123; Childline 0800 1111 |
| Harassment or bullying · Hate or slurs · Sexual content · Scam or fraud | Serious | — |
| Spam · Impersonation · Inappropriate handle or display name · Something else | Normal | — |

`reports.reason` stores the label as written, so reports filed before
the new reasons still read the same; anything unrecognised reads as
"Something else". Urgent reports carry a **Priority** tag and sit at the
top of the queue, however old.

Each report is a row in `public.reports` with `reported_snapshot` — the
handle, name and where it was seen — so the report still makes sense if
the reported account is later deleted. **At report time the database
copies the last 10 DMs between the two people into
`reported_snapshot.messages`** (`reports_snapshot_messages`,
`supabase/dm_upgrade_2026_10.sql`), so an unsend can't erase the
evidence; a client-supplied copy is discarded. A DM report also appends
a few recent messages to `context` (the reporter's view).

Two other queues, same page:

- **Group pictures (crests)** — uploads are screened automatically; anything not clearly fine waits for the owner.
- **Profile pictures** — "Re-screen profile pictures" runs pictures published before screening existed (or changed without it) through the same screen, four per press, capped per day. A rejection only **flags** the picture; you keep or remove it.
- **Food contributions** — hide themselves after three reports (`food_contribution_reports`). No action needed unless it's illegal content.

## The reporting loop — who is told what

Needs `supabase/safety_2026_10b.sql`. Until it's run, none of these are
sent and nothing else changes. All are in-app notices
(`safety_notices`), shown at the top of Friends; none is a push or an
email, so nothing lands on a lock screen.

| When | Who | What they see |
|---|---|---|
| A report is filed | Reporter | The sheet confirms it, and a notice: "We got your report" — looked at within 24 hours (sooner for the urgent reasons), the outcome will follow here, the other person won't be told who reported. (Written by a database trigger, at most 20 an hour per reporter.) |
| You **Dismiss** | Reporter | "We reviewed your report" — didn't break our rules this time; block them if it continues. |
| You **Resolve**, **Suspend** or **Ban** | Reporter | "We acted on your report" — not what was done. |
| You **Suspend** or **Ban** | Reported user | "Your account is suspended" — what is paused, that their data is untouched, how to appeal. **Never who reported, never the reporter's words.** |
| You **Reset** a name, handle or picture | Reported user | "We reset part of your profile" — which field, choose another, how to appeal. |
| You **Lift** a suspension | That user | "Your suspension has been lifted". |

**Child-safety reports never notify the reported person** — not on
suspend (the moderation function refuses to, whatever the client asks)
and not on ban (the queue sends `notify: false` to the ban; a ban sent
to the Security console's `user.ban` any other way notifies unless it
carries `notify: false`, so ban child-safety cases from the report row). Telling a suspected groomer would tip them off
before a referral (proposed Terms §15: "We may not give notice where
that would put someone at risk or hinder a police investigation"). Any
other report: the queue can hold a notice back by sending
`notify: false` if telling them would put the reporter at risk.

## How reports reach an owner

**The queue:** Upgrade → **Security → Moderation** in the web app, owner
accounts only. It reads through `/.netlify/functions/moderation`, which
checks the session and the owner email on the server (`OWNER_EMAIL`).

**The alert:** the hourly security sweep (`security-sweep`, at :23 past
every hour, `netlify/lib/securitySweep.js`) counts reports filed in the
last 65 minutes. If there are any, it raises a ticket and pings the
owner's phone through the existing alert pipeline
(`netlify/lib/alertNotify.js`): ntfy when `ALERT_NTFY_TOPIC` is set, the
`ALERT_WEBHOOK_URL` webhook otherwise (both if both are set). The ping
reads **"N new report(s) — open the moderation queue"** and tapping it
opens Upgrade → Security → Moderation. It always goes out, whatever
`ALERT_MIN_SEVERITY` says.

- **Latency:** a report reaches a phone **within about an hour** (worst
  case ~65 minutes: filed just after a sweep, picked up by the next).
  That leaves ~23 hours of the 24-hour target to decide it.
- **No repeats:** the ticket is keyed by the newest report it saw, so the
  same reports never ping twice; a newer report always pings again.
  Resolve the ticket once the queue is clear.
- **Lock-screen safe:** the ping carries a count and a link — never the
  reason, the reporter's words, a handle or a user id.
- **Needs:** `ALERT_NTFY_TOPIC` (or `ALERT_WEBHOOK_URL`) set on Netlify,
  and `supabase/security_console_2026_10.sql` run (tickets are what
  stop the repeats — without the ticket table, nothing pings). Check
  with "Send test alert" in Upgrade → Security → Tickets.
- **Not covered:** if the sweep itself is not running (a failed deploy,
  Netlify outage), nothing pings. The stale-reports ticket (open > 24 h)
  is the backstop, and a weekly look at the queue costs nothing.

If neither alert channel is set up, the target still depends on an
owner opening the queue every day — set one up.

**Before any of this works:** `supabase/audit_schema_2026_10.sql` must
have been run (recorded as applied live 2026-10-02). Without it the
queue shows "not installed" (the function answers 501) and suspension
does nothing. `supabase/safety_2026_10b.sql` adds the notices, the
binding suspension of DMs, the DM filter, the audit trail and the
re-screen; until it's run those tools say so.

The moderation page is compiled out of the native app. Moderate from the web.

---

## Deciding a report

Open the report. You see both handles, the reason (and Priority if
urgent), the reporter's text, the snapshot, and the DMs copied at report
time ("Show evidence"). Reports filed before the DM snapshot existed
fall back to a live read of the last ten DMs.

| Decision | When | What it does |
|---|---|---|
| **Dismiss** | Nothing wrong, or not enough to act on. | Closes the report (`status = 'dismissed'`). Reporter told. |
| **Resolve** | The report was right and you've dealt with it without suspending (e.g. you reset their name). | Closes it (`status = 'actioned'`). Reporter told. |
| **Reset…** | A name, handle or picture breaks the rules. | Clears the chosen fields from what others see (`profiles`). Their own copy in the app is untouched. The removed value is hashed into `moderation_actions`, and the database refuses the **same** value coming back from the app (a different one goes through). User told. Doesn't close the report — Resolve or Suspend after. |
| **Suspend** | Serious, or a repeat. | Sets `profiles.suspended_at` and closes the report as actioned. User and reporter told. |
| **Ban sign-in** | Serious and you want them out now. | Suspend **and** an Auth ban (no new sign-in or token refresh; a live session can last up to an hour). |

Always write a note. It's the record if the decision is questioned
later. Every suspend, unsuspend, reset and re-screen flag is also logged
in `moderation_actions` (who, when, which report, the note).

### What suspension does

- Hides the user from the global and friends leaderboards, handle search, and group boards. Functions cache the suspended list for up to **5 minutes**.
- **Stops them sending messages, reactions and friend requests, accepting requests, and unsending** — enforced by RLS on `messages`, `message_reactions` and `friendships` (`supabase/safety_2026_10b.sql`), with a plain "Your account is suspended" message rather than a bare refusal. Their app shows a calm suspended banner and read-only conversations.
- **Hides the messages and reactions they already sent from the other person** while the suspension lasts. They are **not deleted**: the rows stay, the report snapshot stays, the queue still reads them, and lifting the suspension shows them again. (Decision: hide rather than keep visible — the reason to suspend is that their content may be harmful — and never delete, because it is evidence.)
- Does **not** delete anything of theirs or sign them out.

Their existing friends can also block them — blocking works independently of us.

### Unsuspending

Upgrade → Security → Moderation → **Suspended & banned** → **Lift**
(lifting a ban lifts both). The user is told. Record why in the note.
A suspension should always be reversible by the person who made it.

---

## Evidence and retention

What survives, and for how long:

| Thing | Survives the reported user deleting their account? | Survives the reporter deleting theirs? |
|---|---|---|
| The report row | Yes — `reported_id` becomes null, `reported_snapshot` keeps who it was | **Yes** — `reporter_id` becomes null; the report stays for the queue (`audit_schema_2026_10.sql`) |
| The 10 DMs copied into `reported_snapshot.messages` at report time | Yes | Yes |
| DMs between them (live table) | **No** — `messages` cascades on both sides | **No** |
| Messages hidden by a suspension | Yes while the account exists — never deleted | — |
| `moderation_actions` (the audit trail) | Yes — `target_id` becomes null | Yes |
| `safety_notices` | No — they belong to the account and cascade with it | No |

So: **the snapshot is the evidence.** For anything serious (threats,
anything illegal), also copy what you need — the queue entry and the
snapshot — into a private, access-controlled document both owners can
see. **Not** this repo, not chat. **Never** copy or screenshot a child
sexual abuse image (below).

Retention: closed reports and their notes are deleted **12 months after
closing** by the weekly `retention-prune` job (Sun 04:47 UTC,
`supabase/retention_2026_10b.sql`, applied 2026-10-20). Open reports are
never pruned. **Anything referred to the NCA, police or the IWF: set
`retention_hold = true` on the report straight away** (SQL editor:
`update public.reports set retention_hold = true where id = '<report id>';`)
and the job leaves it alone until you clear it.

`moderation_actions` rows are **not** pruned (nothing deletes them), and
they shouldn't go with the report: the sticky-reset guard needs their
value hashes, and they are the record of how a complaint or appeal was
handled. Proposed: keep 3 years — see `docs/ADMIN_ACCESS_POLICY.md` §5
(solicitor to confirm). Read safety notices older than 12 months could go
too; nothing deletes them yet.

---

## Illegal content — escalate, don't just moderate

Suspending an account is not enough on its own for these.

| What | Do this |
|---|---|
| **Child sexual abuse material** (any image or link) | **Do not open, download, copy, screenshot or forward it** — possessing or sharing it is an offence even for a moderator. Follow the **NCA procedure below** — a legal duty since 7 Apr 2026, and **the only route that discharges it**. Suspend and ban the account; set `retention_hold`. If the report contains a **link to CSAM on another website**, also give the IWF that URL (their online form) so it can be taken down there — that is in addition to the NCA report, not instead of it. |
| **A child at risk** (grooming, sexual messages to a minor) | Grooming messages are CSEA content too (text, not only images): **NCA procedure below**. If a child is in **immediate danger, 999 first**, then the NCA report. CEOP *is* the NCA's child protection command; its public form (ceop.police.uk) is for children and parents — as a service provider, our route is the NCA's industry portal (CSEA-IRP). |
| **Someone at imminent risk** — threats to kill, self-harm or suicide risk | **999** (police / ambulance) if there is immediate danger and you know enough to help. Otherwise **101**. |
| **Terrorist content** | Report to counter-terrorism police through their online reporting route. Suspend. |
| **Threats, stalking, harassment** that looks criminal | Tell the reporter they can report it to the police (101), and keep the evidence for them. |

After any referral: log it in the breach log if personal data was
involved (`docs/INCIDENT_RUNBOOK.md` §8), and keep a note of the
reference number.

### NCA child sexual exploitation and abuse (CSEA) reporting — procedure

**Checked 2026-10-20.** Legislation.gov.uk, the NCA's and Ofcom's sites
could not be opened from the drafting environment; the points below come
from search-result extracts of those primary pages plus law-firm notes.
Each line says which. **The solicitor confirms against the text of
SI 2026/268 before this is relied on** (OSA draft Q7). Blanks marked
`[ ]` / `<…>` are the owner's.

#### The law, in short

| Point | Position | Source (checked 2026-10-20) |
|---|---|---|
| The duty | Online Safety Act 2023 **s.66**: a UK provider of a regulated user-to-user service must report **detected and unreported CSEA content** on its service to the **National Crime Agency**, in the way regulations set. **s.69** makes it an offence to knowingly or recklessly give false information in a report | Act annotations on [legislation.gov.uk/ukpga/2023/50](https://www.legislation.gov.uk/ukpga/2023/50) (search extract) |
| In force | **7 April 2026** for user-to-user services: s.66(1), (2), (7)–(10) and s.69, by the **Online Safety Act 2023 (Commencement No. 7) Regulations 2026, SI 2026/262** (reg. 2). Search services later | [SI 2026/262](https://www.legislation.gov.uk/uksi/2026/262/made) (search extract) — **verified** |
| The regulations | **Online Safety (CSEA Content Reporting by Regulated User-to-User Service Providers) Regulations 2026, SI 2026/268**, made 9 Mar 2026, in force 7 Apr 2026: registration with the NCA before reporting (reg. 4), report contents, urgency-based time frames, data retention | [SI 2026/268](https://www.legislation.gov.uk/uksi/2026/268/made) and its [explanatory note](https://www.legislation.gov.uk/uksi/2026/268/note/made) (search extracts) — **verified that it exists and its dates; contents not read** |
| Don't use the 2025 version | An earlier **SI 2025/368** (same title) was **revoked before it commenced** by SI 2025/1066 (Oct 2025). Guidance written for it is out of date | [House of Lords SLSC report](https://publications.parliament.uk/pa/ld5901/ldselect/ldsecleg/282/282.pdf), [legislation.gov.uk 2025/368](https://www.legislation.gov.uk/uksi/2025/368) (search extracts) |
| Who | UK-based providers report **all** detected, unreported CSEA content; non-UK providers only UK-linked content. Vantage is UK-based | [ZwillGen](https://www.zwillgen.com/eu-uk/new-uk-csea-reporting-rule-takes-effect-user-to-user-services/), [LexisNexis](https://www.lexisnexis.com/en-gb/legal/news/nca-launches-csea-reporting-portal-under-online-safety-act-regulations) (secondary, search extracts) |
| "Detected" | Includes **user reports**, reports from child-protection bodies, hash matching, or other proactive means | Same (secondary) |
| "Unreported" | Content already reported to the NCA, or to a qualifying foreign body such as the US NCMEC (and the NCA told), is not "unreported". **The IWF is not such a body** — reporting to the IWF alone does not discharge the duty | Same (secondary); IWF point is this draft's reading — **solicitor** |
| What "CSEA content" covers | Content amounting to a CSEA offence listed in **Schedule 6** to the Act. That includes indecent images of children **and grooming offences such as sexual communication with a child** — so a DM thread can be CSEA content without any image | Act Sch. 6 (from knowledge; **solicitor to confirm** for text-only grooming) |
| Time limits | The 2026 regulations require the provider to **assess the urgency** of each report and send it within time frames that depend on that assessment (explanatory note). The revoked 2025 text said: priority level 1 (current or imminent risk to a person) **"as soon as possible"**; otherwise **"as soon as practicable"** after judging the content to be CSEA. **The 2026 time frames were not read** — `[ ] solicitor: confirm the 2026 wording]` | Explanatory note (search extract); 2025 wording via search extract of the revoked SI — **unverified for 2026** |
| Keeping records | After a report the NCA issues a **Unique Reference Number (URN): keep it 5 years**. Keep the **reported content and relevant associated information for at least 1 year** | [ODDA member update](https://theodda.org/whats-happening/member-update-new-csea-reporting-regulations-now-in-force/) (secondary, single source) — **verify against the SI** |
| Registration | Through the NCA's **Child Sexual Exploitation & Abuse Industry Reporting Portal (CSEA-IRP)**: (1) register the organisation; (2) the NCA's Child Sexual Exploitation Referral Bureau reviews it **Mon–Fri 07:00–17:00** (not weekends or bank holidays); (3) once approved, the **Organisation Administrator** (and any Deputy) registers individual users who can file. NCA guides: "How to register your organisation" and "How to register individual users" | [NCA CSEA-IRP page](https://www.nationalcrimeagency.gov.uk/what-we-do/crime-threats/child-sexual-abuse-and-exploitation/the-child-sexual-exploitation-abuse-industry-reporting-portal), [registration guide (PDF)](https://www.nationalcrimeagency.gov.uk/who-we-are/publications/803-how-to-register-your-organisation-for-the-child-sexual-exploitation-and-abuse-industry-reporting-portal/file) (search extracts) |
| Not registered yet + imminent risk | **Dial 999** to report the risk to police first, then register and submit the full report through the portal once accepted | NCA registration guide (search extract) |
| Ofcom | Ofcom advises in-scope services to register now so they are ready to report; it enforces the duty (penalty up to £18m or 10% of qualifying worldwide revenue) | [Ofcom: Duty to report CSEA content](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/duty-to-report-child-sexual-exploitation-and-abuse-csea-content-know-the-rules-and-how-to-comply) (search extract) |

#### 1. Register (before launch — the duty is live on the web today)

- [ ] Read the NCA's three CSEA-IRP guides (links above), in order.
- [ ] Register the organisation on the CSEA-IRP. **Who registers while the
      company doesn't exist?** The duty is already owed (social features
      are live on the web, OSA draft §2.6). `[ ] solicitor / NCA: register
      now as <owner name> trading as Vantage and update on incorporation,
      or wait?]` Don't let company formation (item 1) delay this — ask
      the NCA if unsure.
- [ ] Organisation Administrator: `<owner name>`. Deputy Organisation
      Administrator: `<name, or "none — single owner">`.
- [ ] Register the individual user(s) who will file: `<owner name>`
      (and the deputy, if any).
- [ ] Record in the private records (not this repo): date registered,
      registration reference, administrator, users. Registration reference:
      `<kept privately>`.
- [ ] Set a reminder to keep the registration current (new administrator,
      new company name on incorporation, a person leaving).

#### 2. Who files

Named reporter: `<owner name>`. Deputy: `<name, or "none — single owner">`.
Only these people open **Child safety** reports. Neither ever opens an image.
Their NCA portal access is personal: never share a login.

#### 3. When the duty is triggered (working rule until the solicitor confirms)

Treat it as triggered — and start step 4 at once — when, **on reading the
text evidence** (never by opening an image):

- a report (any reason, usually **Child safety**) describes, quotes or
  links content that appears to be an indecent image of a child, or
  sexual communication with someone who appears to be under 18, or an
  attempt to arrange to meet a child for sexual purposes; or
- the avatar/crest screen rejects a picture as sexual and the account or
  context suggests a child may be involved; or
- the police, the NCA, CEOP, the IWF or a child-protection body tells us
  of CSEA content on Vantage.

`[ ] solicitor: confirm this trigger, and what "detected" means for a
service that only reads messages when reported.]`

#### 4. Preserve, don't spread — in this order

1. **Suspend and ban** the account from the queue (child-safety reports
   send the reported person nothing). Do **not** delete the account or any
   content: the cascade would destroy the messages and the profile picture
   the NCA may need, and the regulations expect the content to be kept
   (≥ 1 year, to verify).
2. **Set `retention_hold = true`** on the report (SQL above, under
   "Evidence and retention") so the weekly prune never takes it.
3. **Do not** open, download, copy or screenshot any image. Text evidence
   is already preserved in `reported_snapshot.messages` (copied at report
   time; survives both accounts being deleted).
4. **Leave pictures where they are** (`profiles.avatar_url`, group
   crests). The suspension hides the account from every public board;
   a **Reset avatar** would clear the picture from `profiles` and keep only
   a hash, so **don't reset an avatar on a CSEA case** until the NCA says
   what it needs. `[ ] solicitor: confirm preservation comes before
   removal here.]`
5. Write the private record (step 6 fields), describing the content in
   words, never reproducing it.

**Known gap — deletion by the reported user.** A ban blocks sign-in, but
a session already open lasts up to an hour, and a merely *suspended* user
can still sign in. Either can press Delete account, and `delete-account`
does not check suspension: messages (both sides) and the avatar go with
the cascade. The report snapshot keeps the handle, name and 10 DMs as
text, but not the picture. See "Open product gaps" G-3 below.

#### 5. File the report

- Log in to the CSEA-IRP and file **within the time frame for its urgency**
  (`[ ] the 2026 time frames — solicitor]`). Working rule meanwhile:
  - **current or imminent risk to a child** (e.g. arranging to meet,
    threats, a child in danger now): **999 first**, then file **the same
    day, as soon as possible**;
  - **everything else**: file **as soon as practicable, and within
    `<N, e.g. 24>` hours** of judging the content to be CSEA.
- Include only what the portal and the regulations ask for. Do **not**
  attach images: the portal will say how content is supplied if it needs
  it. `[ ] solicitor/NCA: how a service that must not copy images supplies
  the "content" the regulations require.]`
- Never notify the reported user. Never tell the reporter more than
  "We acted on your report" (the existing notice).

#### 6. Record (private records, OSA s.23)

| Field | |
|---|---|
| Report id (and `retention_hold` set: yes/no) | |
| Account id prefix(es) involved | |
| Detected how, and when (date/time) | |
| Judged CSEA by whom, when, urgency assessed as | |
| What it appears to be (in words, never reproduced) | |
| Actions taken (suspend/ban time; `moderation_actions` reference) | |
| Filed to the NCA: date/time, by whom | |
| **NCA URN** (keep **5 years**) | |
| Other referrals (999 incident number, IWF reference for external URLs) | |
| NCA instructions received, and when the hold was lifted | |

Keep the report row, its snapshot and the account as they are for **at
least 1 year** after filing (to verify) or as long as the NCA asks,
whichever is longer; keep the URN record **5 years**. This sits outside
the 12-month report retention and is why `retention_hold` exists.

#### 7. After

Keep the account suspended and banned until the NCA or police say
otherwise. Never tell the reported user why. Clear `retention_hold` only
when the hold period and any NCA request have both ended, and note that in
the record.

`[ ]` Rehearse steps 4–6 once before launch on a test report (record it in
`docs/OSA_GOVERNANCE.md` §5).

---

## Open product gaps (item 113) — small specs for the owner to approve

Not built. Each is additive (new keys or new tables only, per `CLAUDE.md`).

### G-1. Mute (user control)

**Why.** Ofcom's user-controls measure is block **and** mute. Today it
applies to large services; a 2025 proposal would extend it to smaller
services likely to be accessed by children, and Ofcom's statement on it
was still pending on 2026-10-20 (`docs/OSA_GOVERNANCE.md` §0). Block is
built and binding; mute isn't. Mute lets someone go quiet on a friend
without the social cost of blocking.

**Spec.**

- **Where:** ⋯ menu in a DM and on the friend card — "Mute" / "Unmute",
  next to Report and Block.
- **What it does (for the muter only):** that friend's messages still
  arrive and are kept (so they can still be reported), but they **don't
  count towards the unread badge** (`useUnreadTotal`), the
  conversation sorts below the others under a "Muted" label, and it shows
  no unread highlight. Their friend card updates (heatmap, wins)
  are hidden from the muter's Friends rail.
- **The muted person is never told** and sees no difference.
- **Storage:** an additive state key `S.mutedUsers = { [userId]: isoDate }`
  (private to the muter, syncs across their devices, no RLS work). A table
  is not needed: nobody else reads it, and no server function acts on it.
- **Name clash to avoid:** `dmView.js` already uses `muted` for a greyed,
  read-only row (ex-friend, blocked, suspended). Call the new flag
  `silenced` in code, or rename the existing one, so the two never mix.
- **Copy:** "Mute — you won't be notified about their messages. They
  won't know. You can still report them."
- **Tests:** a muted friend's messages don't change the unread total; a
  muted, then blocked friend still reads "Blocked"; unmute restores counts.

### G-2. Supportive information for child users

**Why.** ICU F2 / the children's Codes expect supportive information for
child users (e.g. when they get a request from someone new, or when they
block or report). There is **no age signal yet** (item 114), so the app
can't tell who is a child. Until it can, show it to **everyone** — it
costs adults nothing.

**Spec.**

1. **"Staying safe" sheet**, reachable from Friends (a small "Staying
   safe" link) and from the pre-auth `/support` page. Plain words, five
   short points:
   - Only accept people you know. You can remove or block anyone, any
     time; they aren't told.
   - Never share where you live, your school, or pictures you wouldn't
     want everyone to see — and never send nudes, even to someone you
     trust. If one of you has been shared, **Childline and the IWF's
     Report Remove** can help get it taken down (childline.org.uk).
   - If someone asks you to keep secrets, move to another app, or meet up,
     that's a warning sign. Tell an adult you trust and report them.
   - Childline **0800 1111** (free, any time, under 19); Samaritans
     **116 123**; CEOP (ceop.police.uk) to report someone who's making you
     feel unsafe; **999** if you're in danger now.
   - How to report and block in Vantage (two lines, with where the
     buttons are).
2. **On an incoming friend request** (`PendingRequestsList`): one line
   under the request — "Only accept people you know. Not sure? Ignore it,
   or report it." — with the "Staying safe" link.
3. **After Block or Report** (`ReportFriendModal`, `ReportBlockButton`):
   the confirmation adds "You did the right thing" and the Childline /
   Samaritans lines (the report sheet's `signpost` text already does this
   for the urgent reasons; extend it to every reason's confirmation).
4. **Once item 114 lands** (an age signal): show the sheet proactively to
   13–17s on their first friend request accepted, and use the OSA draft
   §8.5 young-users box at the top of the Terms.

**Copy owner:** text above is a starting point for the solicitor/owner to
edit; keep it at a 12-year-old reading level.

### G-3. Keep CSEA evidence when the reported user deletes their account

**Why.** Step 4 above: a suspended (or just-banned) user can delete their
account and cascade away the picture and live messages before the NCA
report is filed or the 1-year retention is met.

**Options (pick one with the solicitor — UK GDPR Art. 17(3)(b) legal
obligation / (e) legal claims may allow refusing erasure for this):**

- **(a) Refuse deletion while held.** `delete-account` returns 409 "Your
  account can't be deleted right now — contact support" when the user is
  the reported party on a report with `retention_hold = true` (one indexed
  read). Smallest change; reveals nothing about why.
- **(b) Quarantine copy.** A "Preserve evidence" button on a child-safety
  report copies the avatar data and the pair's recent messages into a new
  service-role-only `evidence_holds` table (RLS on, no policies, never in
  exports or the moderation UI), with its own retention. Deletion then
  proceeds normally. More work; keeps the content without a human ever
  viewing it.

Recommendation: (a) now, (b) only if the solicitor says refusal is not
acceptable.

---

## Online Safety Act 2023 (item 71)

DMs, groups and the public leaderboard make Vantage a **user-to-user
service** under the Act. The drafts are in
`docs/ONLINE_SAFETY_ACT_DRAFT.md`. Before launch:

- [ ] **Illegal content risk assessment** — drafted (OSA draft §4); finalise and sign off.
- [ ] **Children's access assessment** and **children's risk assessment** — drafted (OSA draft §5–6).
- [ ] **Terms of service** describe how moderation works: what's not allowed, how to report, what happens next, how to complain about a decision (OSA draft §8).
- [ ] A way for users to **complain** about a moderation decision without an account (support address, item 72). In-app, every suspension and reset notice already points at Settings → Report a problem.
- [ ] NCA registration (CSEA-IRP) done and the procedure above filled in and rehearsed (item 113).
- [ ] Accountable person named, responsibilities written, monthly log and yearly review set up (`docs/OSA_GOVERNANCE.md`, item 109).
- [ ] Who may read reports and how reads are recorded (`docs/ADMIN_ACCESS_POLICY.md`, item 106).
- [ ] Keep written records of the assessments and review them when features change (e.g. new public surfaces).

DMs also run through a word filter (item 118): slurs and a few
unambiguous explicit terms are refused on send, in the app and again in
the database (`messages_safety_guard`). It deliberately lets through
ordinary swearing, links, and words people need to ask for help
("rape", "paedo", "nudes") — reporting is the tool for those
conversations.

This file is the start of the "how we moderate" record the Act expects.
Update it when the process changes.

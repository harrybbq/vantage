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

Retention: keep closed reports, their notes and the matching
`moderation_actions` rows for **12 months**, then delete them. Keep
anything referred to the police, CEOP/NCA or the IWF for as long as they
ask. Read notices older than 12 months can go too. Nothing deletes these
automatically yet (item 100) — until it does, run it by hand monthly.

---

## Illegal content — escalate, don't just moderate

Suspending an account is not enough on its own for these.

| What | Do this |
|---|---|
| **Child sexual abuse material** (any image or link) | **Do not open, download, copy, screenshot or forward it** — possessing or sharing it is an offence even for a moderator. Follow the **NCA procedure below** (a legal duty since 7 Apr 2026), and report to the **IWF** through their online form, with the location only. Suspend and ban the account. Keep the report row. |
| **A child at risk** (grooming, sexual messages to a minor) | NCA procedure below; report to **CEOP** (the National Crime Agency's child protection command). If a child is in immediate danger, **999**. |
| **Someone at imminent risk** — threats to kill, self-harm or suicide risk | **999** (police / ambulance) if there is immediate danger and you know enough to help. Otherwise **101**. |
| **Terrorist content** | Report to counter-terrorism police through their online reporting route. Suspend. |
| **Threats, stalking, harassment** that looks criminal | Tell the reporter they can report it to the police (101), and keep the evidence for them. |

After any referral: log it in the breach log if personal data was
involved (`docs/INCIDENT_RUNBOOK.md` §8), and keep a note of the
reference number.

### NCA child sexual exploitation and abuse (CSEA) reporting — procedure skeleton

**The duty is in force.** Section 66 of the Online Safety Act 2023
(reporting CSEA content to the National Crime Agency) applies to UK
user-to-user services from **7 April 2026** (SI 2026/262, commencement;
SI 2026/268, the CSEA Content Reporting Regulations: registration,
report format and timing). Vantage is in scope while DMs, groups and the
leaderboard are live (`docs/ONLINE_SAFETY_ACT_DRAFT.md`). This is a
skeleton: **every `[ ]` is for the owner to complete, and the solicitor
to confirm against SI 2026/268 (OSA draft, solicitor question 7)**. The
details below were not checked against the regulations' text.

1. **Register.** `[ ]` Register Vantage with the NCA's reporting
   service before launch — how: `[owner: from the NCA / Ofcom guidance]`.
   Registration reference: `[kept in the private records, not here]`.
2. **Who files.** Named reporter: `[owner name]`. Deputy if they are
   unavailable: `[name, or "none — single owner"]`. Only these people
   open child-safety reports. Neither ever opens an image.
3. **When the duty is triggered.** `[solicitor: what counts as
   "detected and unreported" CSEA content for us — e.g. a report with the
   "Child safety" reason that, on reading the text evidence, describes
   or links CSEA content; an avatar or crest the screen rejects as
   sexual where a child may be involved.]`
4. **Preserve, don't spread** — in this order, the moment a report looks
   like CSEA:
   - **Suspend and ban** the account from the queue (child-safety reports
     send the reported person nothing). Do **not** delete the account or
     any content: deletion destroys evidence the NCA may need.
   - **Do not** open, download, copy or screenshot any image. Text
     evidence is already preserved in the report's
     `reported_snapshot.messages` (copied at report time; survives both
     accounts being deleted).
   - Write down, in the private records (not this repo, not chat): the
     report id, both account ids, when it was filed and reviewed, what
     kind of content it appears to be (described, never reproduced), and
     the decision. `moderation_actions` already logs the suspension.
   - Leave pictures where they are (`profiles.avatar_url`, group crests):
     the suspension hides the account; removing the picture can wait for
     the NCA's instruction. `[solicitor: confirm whether removal or
     preservation comes first.]`
5. **File the report** to the NCA in the prescribed form within
   `[the time SI 2026/268 sets — owner/solicitor to fill in]` of the
   content being detected. Include only what the regulations require.
6. **Record** the NCA reference, date and time filed, and what was
   reported (described) — Online Safety Act record-keeping, kept with the
   records in OSA draft §9.1, for `[retention period — solicitor]`.
7. **After.** Keep the account suspended and banned until the NCA or
   police say otherwise. Never tell the reported user why. Keep the
   report and its snapshot beyond the 12-month retention while a
   referral is open.

`[ ]` Agree how the IWF and CEOP routes in the table above fit alongside
the NCA duty (solicitor), and rehearse steps 4–6 once before launch.

---

## Online Safety Act 2023 (item 71)

DMs, groups and the public leaderboard make Vantage a **user-to-user
service** under the Act. The drafts are in
`docs/ONLINE_SAFETY_ACT_DRAFT.md`. Before launch:

- [ ] **Illegal content risk assessment** — drafted (OSA draft §4); finalise and sign off.
- [ ] **Children's access assessment** and **children's risk assessment** — drafted (OSA draft §5–6).
- [ ] **Terms of service** describe how moderation works: what's not allowed, how to report, what happens next, how to complain about a decision (OSA draft §8).
- [ ] A way for users to **complain** about a moderation decision without an account (support address, item 72). In-app, every suspension and reset notice already points at Settings → Report a problem.
- [ ] NCA registration and the procedure above completed (item 113).
- [ ] Keep written records of the assessments and review them when features change (e.g. new public surfaces).

DMs also run through a word filter (item 118): slurs and a few
unambiguous explicit terms are refused on send, in the app and again in
the database (`messages_safety_guard`). It deliberately lets through
ordinary swearing, links, and words people need to ask for help
("rape", "paedo", "nudes") — reporting is the tool for those
conversations.

This file is the start of the "how we moderate" record the Act expects.
Update it when the process changes.

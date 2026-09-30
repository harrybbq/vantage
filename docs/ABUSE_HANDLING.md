# Abuse handling

What happens when someone reports another user, how fast we act, and
what to do when it's more than a moderation problem.

(STARTUP_REQUIREMENTS items 79, 63 and 71.)

**Target: every report looked at and decided within 24 hours.** Apple
expects "timely" action on user-generated content (guideline 1.2); 24
hours is the working number.

---

## Where reports come from

Users can report from:

- a **friend card** and the **leaderboard** (`FriendRatingsModal` → `ReportBlockButton`);
- a **group board** row (`GroupBoard` → `ReportBlockButton`);
- a **DM** (⋯ menu in `MessagesModal`).

Reasons offered: harassment or bullying, inappropriate handle or display
name, spam, impersonation, something else — plus free text.

Each report is a row in `public.reports`. With the audit SQL run, it
also carries `reported_snapshot` — the handle, name and where it was
seen — so the report still makes sense if the reported account is later
deleted. A DM report also copies up to five of the reported person's
recent messages into `context`.

Two other queues, same page:

- **Group pictures (crests)** — uploads are screened automatically; anything not clearly fine waits for the owner.
- **Food contributions** — hide themselves after three reports (`food_contribution_reports`). No action needed unless it's illegal content.

## How reports reach an owner

**The queue:** Upgrade → **Review** in the web app, owner accounts only.
It reads through `/.netlify/functions/moderation`, which checks the
session and the owner email on the server (`OWNER_EMAIL`).

**Nothing pushes or emails an owner when a report arrives. Today the
24-hour target depends on an owner opening the queue every day.**

- [ ] Put a daily reminder in both owners' calendars until an alert exists.
- [ ] Follow-up to build: a notification on insert into `reports` (e.g. a row in `notifications_queue` for each owner, which `push-dispatch` already sends, or an email from a function). Not built yet.

**Before any of this works:** `supabase/audit_schema_2026_10.sql` must
have been run. Until then the queue shows "not installed" (the function
answers 501), suspension does nothing, and reports lose the reported
user when that account is deleted.

The Review page is compiled out of the native app. Moderate from the web.

---

## Deciding a report

Open the report. You see both handles, the reason, the reporter's text,
the snapshot, and the last ten DMs between the two people (read live,
so they are only there if neither account has deleted them).

| Decision | When | What it does |
|---|---|---|
| **Dismiss** | Nothing wrong, or not enough to act on. | Closes the report (`status = 'dismissed'`). |
| **Action** | The report was right. | Closes the report (`status = 'actioned'`). Add a note saying what you did. |
| **Action + suspend** | Serious, or a repeat. | Also sets `profiles.suspended_at`. |

Always write a note. It's the record if the decision is questioned later.

### What suspension does

- Hides the user from the global and friends leaderboards, handle search, trending, and group boards. Functions cache the suspended list for up to **5 minutes**.
- Does **not** delete anything of theirs, sign them out, or stop them messaging existing friends.

To stop them entirely: Supabase → Authentication → Users → ban the user
(or the Auth admin API's `ban_duration`). Their existing friends can
also block them — blocking works independently of us.

### Unsuspending

There is no button yet. Either:

- the function: `POST /.netlify/functions/moderation` with `{ "action": "unsuspend", "userId": "<uuid>", "note": "…" }` as an owner; or
- the SQL editor: `update public.profiles set suspended_at = null where id = '<uuid>';`

A suspension should always be reversible by the person who made it.
Record why it was lifted.

---

## Evidence and retention

What survives, and for how long:

| Thing | Survives the reported user deleting their account? | Survives the reporter deleting theirs? |
|---|---|---|
| The report row | Yes — `reported_id` becomes null, `reported_snapshot` keeps who it was | **No** — `reporter_id` cascades, the report goes with it |
| DMs between them | **No** — `messages` cascades on both sides | **No** |
| The five messages copied into a DM report's `context` | Yes | No (goes with the report) |
| Suspension | Moot — the account is gone | — |

So: **act before evidence disappears.** If a report is serious (threats,
anything illegal), copy what you need before deciding:

- screenshot the queue entry, or
- copy the report row and the DMs into a private, access-controlled document both owners can see. **Not** this repo, not chat.

Retention: keep closed reports and their notes for **12 months**, then
delete them. Keep anything referred to the police or the IWF for as long
as they ask. The privacy policy must say the same thing — check it does
before launch.

---

## Illegal content — escalate, don't just moderate

Suspending an account is not enough on its own for these.

| What | Do this |
|---|---|
| **Child sexual abuse material** (any image or link) | **Do not open, download, copy or forward it** — possessing or sharing it is an offence even for a moderator. Report it to the **IWF** (Internet Watch Foundation) through their online reporting form, with the location only. Suspend and ban the account. Keep the report row. |
| **A child at risk** (grooming, sexual messages to a minor) | Report to **CEOP** (the National Crime Agency's child protection command). If a child is in immediate danger, **999**. |
| **Someone at imminent risk** — threats to kill, self-harm or suicide risk | **999** (police / ambulance) if there is immediate danger and you know enough to help. Otherwise **101**. |
| **Terrorist content** | Report to counter-terrorism police through their online reporting route. Suspend. |
| **Threats, stalking, harassment** that looks criminal | Tell the reporter they can report it to the police (101), and keep the evidence for them. |

After any referral: log it in the breach log if personal data was
involved (`docs/INCIDENT_RUNBOOK.md` §8), and keep a note of the
reference number.

The Online Safety Act includes a duty for UK services to report detected
child sexual exploitation and abuse content to the **NCA**. Check
whether that duty is in force at launch and how to register.

---

## Online Safety Act 2023 (item 71)

DMs, groups and the public leaderboard make Vantage a **user-to-user
service** under the Act. Before launch:

- [ ] **Illegal content risk assessment** — what illegal harms could happen on Vantage (harassment, grooming via DMs, fraud links in trending) and what stops them. Ofcom publishes the guidance and a template.
- [ ] **Children's access assessment** — the app is 13+, so children can use it. Expect to need a **children's risk assessment** too.
- [ ] **Terms of service** describe how moderation works: what's not allowed, how to report, what happens next, how to complain about a decision.
- [ ] A way for users to **complain** about a moderation decision (the security@ / support address is enough to start).
- [ ] Keep written records of the assessments and review them when features change (e.g. new public surfaces).

This file is the start of the "how we moderate" record the Act expects.
Update it when the process changes.

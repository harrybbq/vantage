# Online Safety Act governance — Vantage

> **DRAFT, 2026-10-20, for the owner to fill in and sign, and the solicitor
> to check.** Not legal advice. STARTUP_REQUIREMENTS item 109.
>
> This is the "who is responsible, for what, and how we check" layer that
> Ofcom's Codes expect on top of the assessments. It does **not** repeat
> them. The assessments, the Codes checklist, the Terms wording and the
> record list are in `docs/ONLINE_SAFETY_ACT_DRAFT.md` (§4–6, §7, §8, §9);
> the day-to-day moderation process is `docs/ABUSE_HANDLING.md`.
>
> Public repository: roles only. Names go in the private copy
> (`<placeholders>`).

---

## 0. Sources and their limits

Checked 2026-10-20. `ofcom.org.uk` and `legislation.gov.uk` could not be
opened from the drafting environment (the sandbox refused them), as when
the OSA draft was written. What follows rests on search-result extracts
from Ofcom's own documents plus the OSA draft's §0 table. **Check each
measure reference against Ofcom's current consolidated Codes** (Ofcom →
Online safety → regulatory documents) before signing.

| Point | Source | Confidence |
|---|---|---|
| ICU A2 — name an individual accountable to the most senior governance body for the illegal content safety duties and the reporting and complaints duties — applies to **all** user-to-user services | Ofcom, [Illegal content Codes of Practice for user-to-user services](https://www.ofcom.org.uk/siteassets/resources/documents/online-safety/information-for-industry/illegal-harms/illegal-content-codes-of-practice-for-user-to-user-services.pdf) | Search extract of the primary document |
| ICU A3 — written statements of responsibilities for senior managers — applies to **large or multi-risk** services | Same | Search extract of the primary document |
| A5 (tracking new harms), A6 (code of conduct), A7 (compliance training), C3–C7 (content policies, targets, prioritisation, resourcing, moderator training) apply to multi-risk services | OSA draft §7.1, from memory of the Dec 2024 Codes | **Verify** |
| "Multi-risk" = medium or high risk for at least two kinds of illegal harm | OSA draft §2.4 | **Verify** the current definition |
| Protection of Children Codes mirror the governance measures for the children's duties | OSA draft §7.2 | **Verify** |
| 2026 changes needing a risk-assessment update: "suicide and self-harm" merged harm and **cyberflashing** (statement 25 Jun 2026); intimate-image hash-matching measure (2026); crisis-response measures, aimed at large services (**sources conflict on dates**: a statement dated 9 Jun 2026 in one, "adopted 12 Oct 2026, in force 2 Nov 2026" in the OSA draft's tracker — check both) | OSA draft §0; [Ofcom crisis response statement](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/statement-crisis-response-protocol); [Reed Smith tracker](https://www.reedsmith.com/topics/uk-online-safety-act-2023/) | Search extracts |
| Ofcom's main "additional safety measures" statement (from the June 2025 consultation, incl. extending block/mute to smaller services) was expected in **autumn 2026**; no final statement found by 2026-10-20 | [Ofcom roadmap](https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/roadmap-to-regulation); [Wiggin](https://www.wiggin.co.uk/insight/ofcoms-online-safety-update-for-2026-2027/) | Search extracts; **watch for it** |

---

## 1. What the Codes expect, scaled to a one- or two-person company

Ofcom's governance measures were written with boards and compliance teams
in mind. For Vantage, each one becomes a short written record and a
habit. On the OSA draft's ratings Vantage is **small and multi-risk**
(grooming and harassment both medium), so the multi-risk measures apply.

| Codes expectation | What it means here | Where it lives |
|---|---|---|
| **Named accountable person** (ICU A2; PCU equivalent) — all services | One person, named in writing with a date, accountable for the illegal content duties, the children's duties, reporting, complaints and the NCA duty. At launch: the sole director | §2 below (signed private copy) |
| **Written statements of responsibilities** (ICU A3) — multi-risk | One paragraph per person: what they decide, what they do, who covers when they're away | §3 below |
| **Track new and increasing harm** (ICU A5) — multi-risk | A monthly count of reports by reason and time-to-decision, and a note of anything new | §6 monthly log |
| **Code of conduct** (ICU A6) | Five lines anyone moderating signs | §4 below |
| **Compliance training** (ICU A7) and **moderator training** (ICU C7) | Before anyone moderates: read `docs/ABUSE_HANDLING.md`, this file, `docs/ADMIN_ACCESS_POLICY.md`; walk through one dummy report end to end; rehearse the NCA steps once. Record the date | §5 training record |
| **Content policies** (ICU C3) | What isn't allowed, with examples, linked to Ofcom's Illegal Content Judgements Guidance. Start from the Terms wording in OSA draft §8.1 | `docs/ABUSE_HANDLING.md` "Deciding a report"; Terms §7 |
| **Performance targets** (ICU C4) | Every report decided within 24 h; urgent ones first. Measure monthly (§6) | `docs/ABUSE_HANDLING.md` |
| **Prioritisation** (ICU C5) | Child safety, threats, self-harm first (built: urgent reasons top the queue) | `src/lib/moderation/reasons.js` |
| **Resourcing** (ICU C6) | A written cover arrangement for holidays and illness (§3) | §3 below |
| **Reporting and complaints** (ICU D-series, s.20–21) | In-app reporting (built); a complaints and appeals route that works **without an account**; acknowledgement, expected time, outcome | §7 below |
| **Terms** (ICU G1/G3, s.10, s.12) | The OSA draft §8 wording, solicitor-edited, in `LegalPage.jsx` | Item 9/64 |
| **Risk assessment records and review** (s.9, s.11, s.23) | The OSA draft assessments, signed, versioned, reviewed on triggers and yearly | §8 below; OSA draft §9 |

---

## 2. Appointment of the accountable person (fill in, sign, keep privately)

> **Vantage — Online Safety Act accountable person**
>
> Provider: `<Company name, company number>` (until incorporation:
> `<owner name>` as an individual — solicitor to confirm who the provider
> is today, OSA draft Q1).
>
> With effect from `<date>`, `<owner name>`, `<role: sole director>`, is
> the person accountable for Vantage's compliance with:
>
> - the illegal content risk assessment and safety duties (OSA ss.9–10);
> - the children's risk assessment and safety duties (ss.11–12) and the
>   children's access assessment (ss.35–37);
> - the content reporting and complaints duties (ss.20–21);
> - freedom of expression and privacy (s.22);
> - record-keeping and review (s.23);
> - reporting CSEA content to the National Crime Agency (s.66,
>   SI 2026/268; procedure in `docs/ABUSE_HANDLING.md`).
>
> They report on these to `<the board / "the sole director: themselves">`
> at least once a year (§8).
>
> Signed: `<name>` Date: `<date>`

When a second person joins, record whether accountability moves or is
shared, and re-sign. Accountability stays with **one** named person even
when tasks are split.

---

## 3. Written responsibilities and cover (fill in)

| Responsibility | Who | Deputy / cover | Notes |
|---|---|---|---|
| Accountable person (§2) | `<owner name>` | `<name or "none">` | |
| Reviews the moderation queue daily; decides reports within 24 h | `<owner name>` | `<name or "none">` | Alerts: `ALERT_NTFY_TOPIC` / webhook (`docs/ABUSE_HANDLING.md`) |
| Opens child-safety reports; files NCA reports; holds the NCA portal account (Organisation Administrator) | `<owner name>` | `<Deputy Organisation Administrator, or "none">` | Never opens an image |
| Handles complaints and appeals (§7) | `<owner name>` | `<name>` | Appeals: a different person from the original decision where possible; with one person, re-review after 24 h with fresh eyes and note it |
| Keeps the risk assessments and records current (§8) | `<owner name>` | | |
| Admin access to user data | per `docs/ADMIN_ACCESS_POLICY.md` | | |

**Cover arrangement (single owner).** When the owner is away for more than
24 hours `<choose one and write it down>`:

- (a) a named, trained deputy covers the queue (needs `OWNER_EMAIL` access
  and the conditions in `docs/ADMIN_ACCESS_POLICY.md` §2); or
- (b) the owner checks the queue on their phone once a day while away
  (the ntfy ping still arrives); or
- (c) for longer absences with no cover, accept that the 24-hour target
  will slip, say so in the monthly log, and check on return first thing.
  Note `VANTAGE_PAUSE=social` stops the leaderboard and groups functions
  but **not** DMs or friend requests (they go straight to Supabase;
  `docs/INCIDENT_RUNBOOK.md` §3). Stopping those means revoking a grant
  in the SQL editor — an incident step, not a holiday plan.

Record which was used, and any target missed, in the monthly log.

---

## 4. Code of conduct for anyone who moderates (sign before first use)

1. I look only at what a report or a written purpose needs
   (`docs/ADMIN_ACCESS_POLICY.md`).
2. I never open, download, copy, screenshot or forward an image that may
   be child sexual abuse material. I follow the NCA procedure.
3. I never tell a reported person who reported them, and I never notify
   the reported person on a child-safety report.
4. I write a note on every decision, and I don't decide a case I'm
   personally involved in.
5. I keep everything I see confidential, during and after my role.

Signed: `<name>` Date: `<date>`

---

## 5. Training record (fill in)

| Date | Person | What | Notes |
|---|---|---|---|
| `<date>` | `<owner name>` | Read ABUSE_HANDLING, this file, ADMIN_ACCESS_POLICY; dummy report end to end on a test account | |
| `<date>` | `<owner name>` | NCA procedure rehearsal (ABUSE_HANDLING steps 4–6) without filing | |
| `<date>` | `<owner name>` | Read Ofcom's Illegal Content Judgements Guidance sections on grooming, harassment, suicide and self-harm, cyberflashing | |

Repeat the dummy report and the NCA rehearsal at each yearly review, and
before a new person moderates.

---

## 6. Monthly evidence log (5 minutes, first working day of the month)

Keep in the private records. Counts only, no personal data.

| Month | Users (Supabase Auth total; UK if known) | Reports by reason | Median / worst time to decision | Over 24 h? Why | Suspensions / bans / resets | NCA reports | Complaints / appeals (received / upheld) | New kinds of harm or features? |
|---|---|---|---|---|---|---|---|---|
| `<YYYY-MM>` | | | | | | | | |

A query to start from (SQL editor, counts only):

```sql
select reason, count(*) as n,
       percentile_cont(0.5) within group (order by actioned_at - created_at) as median_time,
       max(actioned_at - created_at) as worst_time
from public.reports
where created_at >= date_trunc('month', now()) - interval '1 month'
  and created_at <  date_trunc('month', now())
group by reason order by n desc;
```

---

## 7. Complaints and appeals (s.21) — the procedure

Matches the proposed Terms §7b (OSA draft §8.3). Fill the timings in both
places at once.

| Step | What | Target |
|---|---|---|
| Ways in | In app: Settings → Report a problem. **Without an account:** `<support email>` and the public `/support` page (built; needs the address, item 72) | — |
| Acknowledge | Reply saying it was received and when to expect an answer | `<N working days, e.g. 2>` |
| Decide | Complaint about content: treat as a report. Appeal against a decision on the person's own account or content: re-review (different person where possible); reverse and restore if wrong (Lift, undo reset) | `<N days, e.g. 14>` |
| Tell them | Outcome and reason, in plain words; for appeals, what was restored | Same |
| Record | Date in, acknowledged, decided, outcome, who, in the complaints log | — |
| Escalation | Not satisfied: they may tell Ofcom (which doesn't resolve individual complaints) — wording for the solicitor (OSA draft Q11) | — |

Complaints log (private): `ref | date in | channel | about (content / own account / our compliance) | acknowledged | decided | outcome | who`.

---

## 8. Risk assessment records and review

**Records:** as OSA draft §9.1 (assessments, Codes measures adopted or
alternatives, accountable person, moderation log, NCA reports, complaints
log, evidence log, reviews). Kept privately, every version kept.
Retention: OSA draft §9.1 recalls Ofcom expecting **at least five years**
— verify against Ofcom's current Record-keeping and review guidance, and
reconcile with the 12-month report retention (OSA draft Q9).

**Review triggers:** OSA draft §9.2 (images or voice in DMs, group chat,
feeds, suggestions, friend-cap changes, lower age, store launch, Code
amendments, incidents). Before any of these ships, re-run the relevant
assessment and record it.

### Yearly review checklist (on the anniversary of sign-off: `<date>`)

- [ ] Ofcom → regulatory documents: any **new or amended Codes**, Risk
      Profiles, Register of Risks or new priority offences since last
      review? (2026 alone: suicide/self-harm merge, cyberflashing,
      intimate-image hash-matching, crisis response; the additional
      safety measures statement was pending.) Note each and its effect.
- [ ] Re-read the illegal content risk assessment (OSA draft §4) with the
      year's monthly logs. Still medium for grooming and harassment?
      Still multi-risk? Record the answer even if nothing changed.
- [ ] Children's access assessment and children's risk assessment (§5–6):
      still accurate? Age signal decision (item 114) made?
- [ ] Codes checklist (OSA draft §7): each measure adopted, or an
      alternative recorded with reasons.
- [ ] Accountable person and responsibilities (§2–3): still right?
      Re-signed if anything changed.
- [ ] Training (§5): dummy report and NCA rehearsal repeated.
- [ ] Moderation targets met? Look at the monthly log: reports over 24 h,
      why, and what changed.
- [ ] Complaints and appeals: count, outcomes, any pattern.
- [ ] NCA: registration still active; administrator and deputy correct;
      URNs and records kept for the required periods.
- [ ] Terms (`LegalPage.jsx`) still describe what the app does.
- [ ] Admin access (`docs/ADMIN_ACCESS_POLICY.md`): who has access,
      2FA on, access log reviewed.
- [ ] User numbers: still far from the 7 million "large service" line and
      the categorisation thresholds.
- [ ] Sign and date the review; file it with the records.

---

## 9. Owner actions, in order

1. Fill in and sign §2 (accountable person) and §3 (responsibilities,
   cover arrangement); sign §4.
2. Do the §5 training entries (an hour).
3. Set a recurring reminder: monthly log (§6) and yearly review (§8).
4. Fill the complaints timings (§7) here and in the Terms; get the support
   address live (item 72).
5. Finalise and sign the OSA draft assessments (item 71) and note the
   sign-off date as the review anniversary.
6. Ask the solicitor: OSA draft Q1 (who the provider is before
   incorporation), Q3 (multi-risk), Q9 (retention), Q11 (Ofcom wording).

# Admin access policy: who may look at user data, why, and how it's recorded

> **DRAFT, 2026-10-20, for the owner to adopt and the solicitor to check.**
> Not legal advice. STARTUP_REQUIREMENTS item 106 (DPIA gaps G18, R15).
> The repository is public, so this file names roles, not people. Real
> names go in the private records (see "Where the private records live").

This is the internal rule for **owner and admin access** to what users have
put into Vantage. UK GDPR asks a controller to keep personal data secure
against unauthorised access (Art. 5(1)(f), Art. 32) and to be able to show
it does (Art. 5(2), accountability). For a one-person company that mostly
means: a short written rule, a habit of writing down when you look, and the
same rule for anyone who joins later.

---

## 1. The short version

1. **Default: don't look.** The app runs without anyone reading user data.
   Every look needs one of the five purposes in section 3.
2. **Look through the narrowest tool.** The moderation queue before the
   Security console; the Security console before the SQL editor; the SQL
   editor before a backup restore.
3. **Read only.** Change nothing while you look (INCIDENT_RUNBOOK §5).
4. **Write it down.** Moderation actions log themselves. Anything else gets
   one line in `ops_log` before you start (section 6).
5. **Never copy personal data out** into chat, email, issues, this repo or
   screenshots. Refer to users by the first 8 characters of their id.
6. **Never open, download, copy or forward a suspected child sexual abuse
   image**, even to "check" it. `docs/ABUSE_HANDLING.md` has the procedure.

---

## 2. Who may access user data

| Role | Who (private records hold the name) | What access | Conditions |
|---|---|---|---|
| **Owner / sole director** | `<owner name>` | Everything: Supabase dashboard and SQL editor (service role), Netlify, the Security console and moderation queue (gated server-side by `OWNER_EMAIL`, `netlify/lib/owner.js`), RevenueCat, Anthropic console | 2FA on every service (item 80, **still open**); a password manager; the purposes in section 3 only |
| **Second admin** (if one joins: item 2) | `<name, or "none">` | Only what their job needs. Note: there is no "moderator-only" role in code. Adding an email to `OWNER_EMAIL` (a comma-separated list, `netlify/lib/owner.js`) gives the whole Security console, not just the queue, and owner-only app surfaces. Add them only once all conditions are met; a narrower role is a code change to approve first | **Before any access:** a signed confidentiality agreement (`<solicitor to draft>`); 2FA on every service; read this policy and `docs/ABUSE_HANDLING.md`; recorded in the private records with the date. Access removed the day they stop |
| **Processors' staff** (Supabase, Netlify, Anthropic, RevenueCat) | n/a | As their DPA allows (support, operations) | Covered by the DPAs (item 75, **open**) and recorded in `docs/ROPA.md` |
| **Anyone else** (friends, family, contractors, AI assistants) | — | **None.** Do not paste user data into an AI chat or share a screen showing it | — |

Code and deploy access (GitHub, Netlify deploys) is not data access in
itself, but a deploy can read data. Treat it the same: 2FA, named people,
removed when they leave (`docs/ACCOUNT_SECURITY.md`).

---

## 3. The five purposes (and nothing else)

| # | Purpose | Trigger | What you may look at | What you may not do |
|---|---|---|---|---|
| P1 | **Support** | The user asked: Settings → Report a problem (`security_tickets`), or the support email | Only what the request needs, e.g. their own `user_data` row to see why a sync failed. Ask for, or rely on, the user's request as the consent to look | Browse other data "while you're there". Look at another user's data to answer this one |
| P2 | **Moderation** | A report (`reports`), a flagged avatar or crest, or the security sweep's report ticket | The report, its `reported_snapshot` (incl. the 10 DMs copied at report time), the profile fields others see. The queue shows nothing else, by design | Read a wider message history, or a reporter's or reported user's private data (health, food, money) |
| P3 | **Security incident** | A security ticket, a suspected breach, or a SEV1/SEV2 (`docs/INCIDENT_RUNBOOK.md`) | What answers "what data, whose, since when": logs, counts, the affected rows | Fix or tidy rows while assessing. Copy data to chat |
| P4 | **Legal request** | A **written** request from the police, the NCA, a court or Ofcom, or a subject access / erasure request from the user | Exactly what the request covers, after checking it is genuine (call the force back on a number you find yourself, not one in the email) | Answer a phone or email request without checking. Hand over more than asked. **Ask the solicitor before the first one** (DPA 2018 Sch. 2 para. 2 crime exemption; what to disclose) |
| P5 | **Recovery** | A user's data was lost or corrupted (`docs/RESTORE_RUNBOOK.md`) | The user's `user_data_history` snapshots and a restored copy | Overwrite current state (the runbook's guarded restore only) |

Building and debugging the app uses **your own test accounts**, never real
users' data. Aggregate checks (row counts, sizes, `owner_db_stats()`) are
fine without a purpose, because they show no one's data.

---

## 4. What is logged today (checked in code, 2026-10-20)

| Action | Logged? | Where | Evidence |
|---|---|---|---|
| Suspend / unsuspend (queue or Security console) | **Yes** | `moderation_actions` (`suspend`, `unsuspend`): who, when, which report, note ≤ 500 chars | `netlify/lib/moderationCore.js` `setSuspended` → `logAction`; `supabase/safety_2026_10b.sql` |
| **Ban** (Auth-level) | **Partly** | Recorded only as a `suspend` row; the ban itself is a `console.info` line in Netlify's function log (short retention). Nothing says "banned" in the database | `netlify/functions/security-console.js` `userAction` |
| Reset name / handle / avatar | **Yes** | `moderation_actions` (`reset_*`), with a SHA-256 of the removed value, never the value | `moderationCore.js` `resetProfile`; `safety_2026_10b.sql` |
| Avatar re-screen flag / keep | **Yes** | `moderation_actions` (`avatar_flagged`, `avatar_kept`) | `netlify/lib/avatarRescreen.js` |
| Dismiss / resolve a report | **Yes** | On the `reports` row: `status`, `actioned_by`, `actioned_at`, `note` (not in `moderation_actions`) | `moderationCore.js` |
| Ticket changes | **Yes** | `security_tickets` row status | `security-console.js` |
| Owner-run SQL files, restore steps, web-access changes | **Yes** | `ops_log` (append-only; update/delete/truncate refused by trigger) via `ops_mark()` | `supabase/recovery_2026_10b.sql`, `web_access_2026_10b.sql`, `docs/RESTORE_RUNBOOK.md` |
| **Opening the moderation queue / "Show evidence"** (reads the 10 DMs) | **No** | — | DPIA G18 |
| **Security console panels** that show user ids (client errors, suspended list) | **No** | — | — |
| **SQL editor reads** of any table | **No** (not by us) | Supabase may keep Postgres/API logs for a short, plan-dependent time. Supabase's *platform* audit log (dashboard actions) is documented as Team/Enterprise only in one version of its docs; we are on Pro, so assume it is not available ([Supabase docs](https://supabase.com/docs/guides/security/platform-audit-logs), checked 2026-10-20 via search, page not opened) | — |
| Supabase **Auth** events (sign-in, refresh) | Yes, by Supabase | `auth.audit_log_entries` | INCIDENT_RUNBOOK §5 |
| Netlify function calls | Yes, by Netlify, short retention | Netlify → Logs → Functions | — |

**So today:** what an owner *does* is mostly recorded; what an owner
*reads* is not. That is the gap this policy closes, first by habit
(section 6), then by code (section 8).

---

## 5. Retention of the access records

| Record | Keep for | Status today | Note |
|---|---|---|---|
| `moderation_actions` | **Proposed: 3 years** after the row is written, longer if the linked report has `retention_hold` | **Nothing deletes these.** `retention_prune` prunes closed `reports` (12 months) but not `moderation_actions` (`supabase/retention_2026_10b.sql`) | `docs/ABUSE_HANDLING.md` says these go after 12 months with the report. **They should not**, for two reasons: the sticky-reset guard needs the `value_hash` rows to refuse a reset name coming back, and the rows are the evidence of how a complaint or appeal was handled. The rows hold ids, an action, a hash and a note (no content). Solicitor to confirm the period (Q-A1 below); then add `moderation_actions` to `retention_prune` |
| `reports` (with `actioned_by`, `note`) | 12 months after closing; held ones until released | `retention_prune` weekly, since 2026-10-20 | Already in the privacy policy §11 |
| `ops_log` | **Indefinitely** (append-only by design; it holds no personal data) | As designed | Marks must never contain a name, email or full user id (section 6) |
| Access log entries (section 6 marks with `kind = 'access'`) | As `ops_log` | — | Contains a purpose, a ticket/report reference and an 8-char id prefix only |
| `security_tickets` | Until dealt with, then **proposed 12 months** | Nothing deletes them | Add to `retention_prune` once agreed |
| Netlify / Supabase platform logs | Provider's retention (short) | — | Copy out what an incident needs, early |
| Online Safety Act records (assessments, NCA reports) | See `docs/OSA_GOVERNANCE.md` | — | Different record; longer |

---

## 6. How to log an access today (no code change needed)

Before any look under P1, P3, P4 or P5 that is not through the moderation
queue, write one mark in the SQL editor:

```sql
select public.ops_mark(
  'access',                                   -- kind
  'P1 support: sync failure, user 3f2a9c1e',  -- purpose + 8-char id prefix
  '{"ticket": "S-12", "tables": ["user_data"], "by": "owner"}'
);
```

Rules for the mark:

- **Purpose first** (P1–P5), then a few words.
- **8-character id prefix only.** Never a name, email, handle or full id.
  `ops_log` is append-only and never deleted, so whatever goes in stays.
  (The recovery marks use a one-way `user_ref` for the same reason.)
- Put the ticket, report id or request reference in `details`.
- For moderation through the queue, no mark is needed: the decision and
  note on the report and `moderation_actions` are the record. **But** if
  you open a report and walk away without deciding, nothing records that
  you read it. Until section 8's code lands, decide or note every report
  you open.

`ops_mark` is callable from the SQL editor and with the service role only;
app users can't call it or read `ops_log` (`recovery_2026_10b.sql`).

---

## 7. Record template (private records, one row per access or request)

Keep this in the private, access-controlled place (not this repo, not
chat). The `ops_log` mark is the tamper-evident timestamp; this row is the
fuller note.

| Field | Example |
|---|---|
| Date and time | 2026-11-03 09:14 |
| Who accessed | `<owner name>` |
| Purpose | P1 support / P2 moderation / P3 incident / P4 legal / P5 recovery |
| Trigger reference | Ticket S-12 / report id prefix / police reference / SAR date |
| User(s) concerned | id prefix(es) only |
| What was looked at | e.g. `user_data.state->'vitalsLog'` dates only; `reports` row |
| Tool used | Moderation queue / Security console / SQL editor / restored copy |
| Changed anything? | No / Yes: what, and the `moderation_actions` or `ops_log` reference |
| Disclosed to anyone? | No / Yes: to whom, what, under what request (P4 only) |
| `ops_log` mark time | 2026-11-03 09:14:07+00 |

---

## 8. Product gaps (for the owner to approve; not built)

| # | Gap | Small spec | Why |
|---|---|---|---|
| A1 | Moderation **reads** are not logged | `moderation.js` / `security-console.js`: when the queue returns a report's evidence (the "Show evidence" path) or the suspended list, write one `moderation_actions` row `action = 'evidence_viewed'` (needs the CHECK constraint widened in a new, additive SQL file) or one `ops_log` mark `kind = 'access'` with the report id. At most one row per report per owner per hour | DPIA G18 / R15; makes "who read these DMs" answerable |
| A2 | **Ban** has no row of its own | Log `ban` / `unban` in `moderation_actions` alongside the `suspend` row (same widened CHECK) | A ban is the strongest action; it should be visible in the audit trail, not only in a short-lived function log |
| A3 | `moderation_actions` and `security_tickets` have no retention | Add both to `retention_prune` with the periods the solicitor confirms (section 5), keeping rows linked to a held report | Storage limitation (Art. 5(1)(e)) |
| A4 | Owner reads in the SQL editor can't be logged by the app | Habit (section 6) now; review Supabase platform audit logs if the plan ever moves to Team | Supabase-side |

---

## 9. Where the private records live

`<owner: name the place, e.g. an encrypted folder in the company's
password manager or a private document both admins can reach>`. It holds:
the names behind the roles in section 2, confidentiality agreements, the
access record (section 7), NCA references (`docs/ABUSE_HANDLING.md`), and
the Online Safety Act records (`docs/OSA_GOVERNANCE.md`).

---

## 10. Questions for the solicitor

- **Q-A1.** How long should `moderation_actions` (ids, action, value hash,
  note) be kept? This draft proposes 3 years, because it evidences how
  complaints and appeals were handled and keeps reset names from
  returning.
- **Q-A2.** Legal requests (P4): what checks before disclosing to police?
  When does DPA 2018 Sch. 2 para. 2 (crime and taxation) apply, and what
  record must be kept?
- **Q-A3.** Is a user's support request enough to look at their own data
  (P1), or should the support flow ask explicitly ("May we look at your
  account to fix this?")?
- **Q-A4.** What should the confidentiality agreement for a second admin
  cover (and does it need to survive them leaving)?

Review this policy when a second person gets access, when a new admin tool
is added, and at least yearly with the OSA review (`docs/OSA_GOVERNANCE.md`).

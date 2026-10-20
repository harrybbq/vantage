# Domain day: email

Mailboxes, custom SMTP for Supabase Auth (STARTUP item 94), and the DNS
records that make both deliverable. Placeholders: `[your-domain]`,
`<project-ref>`. Prices were checked by web search on **2026-10-20**.
Vendor pricing pages couldn't be fetched from this environment, so the
figures come from search results and third-party summaries. **Re-check
them on the vendor's page before paying.**

---

## 1. Addresses

| Address | Kind | Who reads it | Why |
|---|---|---|---|
| `support@[your-domain]` | **real mailbox** | owner | Store support contact (both stores require one), `/support` and `/delete-account` (`src/lib/support.js:21`), subject-access and deletion requests (item 72) |
| `security@[your-domain]` | alias or group → every owner | both owners (item 76) | `SECURITY.md`, `/.well-known/security.txt`, `src/lib/support.js:25`, `src/components/LegalPage.jsx:91,231` |
| `no-reply@[your-domain]` | **send-only**, no mailbox | — | Sender of Supabase Auth email (confirm, reset, magic link, email change) |
| `dmarc@[your-domain]` | alias → owner (or a DMARC report service) | owner | `rua=` target for aggregate reports (§4) |
| `postmaster@`, `abuse@` | aliases → support | owner | RFC 2142 conventional addresses; some blocklist operators and providers expect them |
| `privacy@` | optional alias → support | owner | Only if the privacy policy names one. Today it points at the support email (`LegalPage.jsx:91`) |
| reviewer accounts, e.g. `review-apple@`, `review-google@` | aliases → support | owner | Demo accounts must confirm their sign-up email (item 73/122; `docs/STORE_SUBMISSION_PACK.md:727`) |

Keep it to **one paid seat** (support@) with everything else as free
aliases or groups. `security@` must deliver to every owner, not just
the seat holder: use a group or a forward to two addresses.

The support inbox will hold personal data (deletion requests, SARs,
screenshots). Its provider is a **processor**, so it belongs in the
privacy policy's processor list and the DPA list (items 64, 75, 100).
Prefer an EU/UK data region where offered.

### Mailbox options

| Option | Cost (search, 2026-10-20) | Notes |
|---|---|---|
| **Zoho Mail Lite** | about $1–1.25 per user per month; a region-limited free plan without IMAP also exists | Cheapest real mailbox. EU data centre (`zoho.eu`) selectable at sign-up. Aliases and groups included **[GBP price unverified]** |
| Google Workspace Business Starter | not checked | Familiar; groups for security@. Data-region controls only on higher tiers **[unverified]** |
| Microsoft 365 Business Basic | not checked | Fits if the owner already lives in Outlook **[unverified]** |
| Forwarding only (Cloudflare Email Routing, ImprovMX, registrar forwarding) | free tiers exist **[unverified]** | Receives fine. Replying *as* support@ then needs SMTP "send as", which is awkward and is a common source of SPF failures. OK for a week, not for launch |

**Recommendation:** Zoho Mail Lite (EU region) for `support@`, with the
rest as aliases. Revisit if the team grows.

## 2. Custom SMTP for Supabase Auth (item 94)

The built-in Supabase mailer is for testing. It allows only a few auth
emails per hour (sources disagree: 2–4 per hour, project-wide), so
sign-ups and password resets start failing silently at a few dozen
users. Custom SMTP is a **launch** item.

### Provider comparison

| | **Resend** | **Postmark** | **Amazon SES** |
|---|---|---|---|
| Free | 3,000 emails/month, **capped at 100/day**, 1 domain | 100 emails/month (developer tier, no overage) | 3,000/month for the first 12 months (new AWS accounts) |
| First paid | Pro $20/month for 50,000 | Basic $15/month for 10,000 (Pro $16.50, Platform $18; differ by overage) | about $0.10 per 1,000, pay as you go |
| Setup effort | low: verify domain, API key as SMTP password | low | **higher**: IAM SMTP credentials, and a **sandbox** that only sends to verified addresses until you request production access (approval can take a day or more) |
| Where data sits | sends from `eu-west-1` (Ireland) if you pick the EU region at domain creation, but **account data, logs and metadata are stored in the US** (Resend's regions docs) | US **[unverified]** | the region you choose, e.g. **`eu-west-2` London** |
| Deliverability reputation | good | **best-known for transactional**; separates transactional and broadcast streams | good, but your reputation is yours to manage |
| Click/open tracking | per-domain toggles: turn **off** | per-stream: leave **off** | off unless a configuration set enables it |

Volume sense-check: auth email is about 1–2 per new user (confirm, then
the occasional reset). 1,000 sign-ups a month is about 1,500 emails,
which fits every tier above except Postmark's free one. **Resend's
100-a-day cap is the trap**: a launch day with more than ~70 sign-ups
blocks confirmations once it hits.

**Recommendation:** **Resend**. It is free until launch, has the least
setup, and the EU sending region suits a UK/EU product. **Upgrade to Pro
($20) before any launch push or press**, because of the daily cap. Two
caveats go to the solicitor alongside the DPIA (`docs/DPIA_DRAFT.md`):
Resend stores metadata in the US (a transfer, though auth email carries
only the address and a link, never health data), and it needs a DPA
(item 75). If the solicitor prefers UK residency, use **SES in
`eu-west-2`**, which costs more effort but is cheapest at scale. Choose
Postmark if deliverability ever becomes the problem.

### Supabase settings

Dashboard → **Authentication → Emails → SMTP Settings** → *Enable
custom SMTP* (older dashboards: Project Settings → Auth → SMTP). Field
labels as last seen **[unverified: labels move between dashboard
versions]**:

| Supabase field | Resend | Postmark | Amazon SES (London) |
|---|---|---|---|
| Sender email | `no-reply@[your-domain]` | `no-reply@[your-domain]` | `no-reply@[your-domain]` |
| Sender name | `Vantage` | `Vantage` | `Vantage` |
| Host | `smtp.resend.com` | `smtp.postmarkapp.com` | `email-smtp.eu-west-2.amazonaws.com` |
| Port | `465` (implicit TLS) or `587` (STARTTLS) | `587` | `587` |
| Username | `resend` | the **Server API token** | SES **SMTP** username (SES console → SMTP settings → Create credentials; *not* an AWS access key) |
| Password | a Resend API key with **sending access to this domain only** | the same Server API token | SES SMTP password |
| Minimum interval between emails (per user) | keep the default (60 s) | same | same |

SMTP credentials are secrets. They live only in the Supabase dashboard
and the shared password manager (item 80), **never** in this repo or a
`VITE_*` var. Add them to the rotation list in
`docs/INCIDENT_RUNBOOK.md` (§ secrets inventory).

**Then raise the rate limit.** Authentication → **Rate Limits** →
"Rate limit for sending emails". Supabase keeps its own per-hour cap
separate from your provider's, and it stays low unless you set it.
Set it below the provider's ceiling: on Resend free, ~30/hour keeps you
under 100/day in a normal day. On a paid plan, 100–200/hour.

**Templates** (Authentication → Emails → Templates): keep
`{{ .ConfirmationURL }}` as the link, and use `{{ .SiteURL }}` (which
becomes `https://[your-domain]` at CHECKLIST step 5) rather than a
hard-coded host. Add a plain footer such as "Questions? support@[your-domain]
(this address doesn't take replies)". Turn **click tracking off** at the
provider: it rewrites the confirmation link through a tracking host,
which leaks the token to the tracker and can break the link (and
`netlify.toml:106` HSTS `includeSubDomains` means a tracking subdomain
on `[your-domain]` would have to serve HTTPS anyway).

## 3. DNS records (templates)

Exact values come from each provider's dashboard after you add the
domain. **Copy them from there, don't retype these.** The shapes:

### Mailbox (example: Zoho EU)
```
[your-domain].            MX   10 mx.zoho.eu.
[your-domain].            MX   20 mx2.zoho.eu.
[your-domain].            MX   50 mx3.zoho.eu.
zmail._domainkey.[your-domain].  TXT  "v=DKIM1; k=rsa; p=<from Zoho>"
```

### SPF: one record on the apex, never two
```
[your-domain].  TXT  "v=spf1 include:zoho.eu ~all"
```
- Add one `include:` per service that sends **with an envelope sender
  on the apex** (the mailbox provider). Resend, Postmark and SES with a
  custom MAIL FROM use their **own** bounce subdomain for SPF (below), so
  they usually don't go in the apex record.
- Two `v=spf1` records = SPF permerror = fail. Merge them.
- Stay under 10 DNS lookups.
- Start with `~all` (softfail). Moving to `-all` gains little once DMARC
  is enforcing.

### Transactional provider
Resend (EU region; names as Resend shows them **[verify in dashboard]**):
```
resend._domainkey.[your-domain].  TXT  "p=<from Resend>"
send.[your-domain].               MX   10 feedback-smtp.eu-west-1.amazonses.com.
send.[your-domain].               TXT  "v=spf1 include:amazonses.com ~all"
```
Postmark:
```
<selector>pm._domainkey.[your-domain].  TXT    "k=rsa; p=<from Postmark>"
pm-bounces.[your-domain].               CNAME  pm.mtasv.net.
```
Amazon SES (eu-west-2, Easy DKIM + custom MAIL FROM `mail.[your-domain]`):
```
<token1>._domainkey.[your-domain].  CNAME  <token1>.dkim.amazonses.com.
<token2>._domainkey.[your-domain].  CNAME  <token2>.dkim.amazonses.com.
<token3>._domainkey.[your-domain].  CNAME  <token3>.dkim.amazonses.com.
mail.[your-domain].                 MX     10 feedback-smtp.eu-west-2.amazonses.com.
mail.[your-domain].                 TXT    "v=spf1 include:amazonses.com ~all"
```

### DMARC: start at `p=none`, ramp up
```
_dmarc.[your-domain].  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@[your-domain]; fo=1; adkim=r; aspf=r"
```
| When | Policy |
|---|---|
| Day 0 | `p=none`: monitor only. Read the aggregate reports (`rua`) for 2–4 weeks |
| Reports show only your own senders passing (Zoho + Resend/Postmark/SES, aligned by DKIM) | `p=quarantine; pct=25` |
| One clean week later | `p=quarantine` (pct 100) |
| Optional, months later | `p=reject` |

Relaxed alignment (`adkim=r; aspf=r`) is right here: the transactional
provider's bounce subdomain (`send.`, `pm-bounces.`, `mail.`) aligns
with the apex under relaxed SPF, and its DKIM signs as
`d=[your-domain]`. DMARC reports are machine XML. A free report viewer
helps (Postmark's own DMARC digest is free; the hosted monitoring tier
is ~$14/month per domain per search **[unverified]**).

Optional later: MTA-STS + TLS-RPT (forces TLS for inbound mail), and BIMI
(needs `p=quarantine` or stricter, plus a logo).

## 4. Testing deliverability

1. **DNS:** `dig +short TXT [your-domain]` (exactly one `v=spf1`),
   `dig +short TXT _dmarc.[your-domain]`,
   `dig +short TXT resend._domainkey.[your-domain]` (or your
   provider's), `dig +short MX [your-domain]`. The provider dashboard
   must show the domain **verified** before Supabase can send.
2. **Supabase end to end:** with custom SMTP on, sign up a throwaway
   account at `https://[your-domain]` and request a password reset.
   Check Supabase → Logs → Auth for send errors, and the provider's
   activity log for "delivered".
3. **Headers:** open the received confirm email in Gmail ("Show
   original"), Outlook and iCloud. You want `spf=pass`, `dkim=pass
   header.d=[your-domain]` and `dmarc=pass`. It should land in the
   inbox, not spam.
4. **Score:** send one message to a mail-tester.com address (aim for
   9/10 or better). Run the domain through an SPF/DKIM/DMARC checker
   (e.g. MXToolbox).
5. **Monitor:** add the domain to Google Postmaster Tools (DNS TXT
   verification). Read the first DMARC reports a few days in.
6. **Inbound:** send to `support@`, `security@` (it should arrive at
   *every* owner), `dmarc@` and a reviewer alias from an outside
   account.

## 5. Sign in with Apple: private relay addresses

Users who pick "Hide My Email" have `…@privaterelay.appleid.com`
addresses. Apple's relay only accepts mail from **registered** sources
that pass SPF. Without this, their confirm/reset emails (and any reply
from support@) bounce.

Apple Developer → Certificates, Identifiers & Profiles → **Services →
Sign in with Apple for Email Communication → Configure** → *Email
Sources*: add `[your-domain]` **and the envelope domain your
transactional provider uses** (`send.[your-domain]` for Resend,
`pm-bounces.[your-domain]` for Postmark, `mail.[your-domain]` for SES),
plus `no-reply@[your-domain]` / `support@[your-domain]` as individual
addresses if you prefer. Apple checks SPF on the **envelope** domain,
and the table shows pass/fail per source. This depends on the Apple
Developer organisation account (item 5).

## 6. Order relative to the web switch

Independent of CHECKLIST steps 2–6, and can run the day before:

1. Mailbox provider: add the domain, then MX + SPF + DKIM.
2. Transactional provider: add the domain (pick the EU region on
   Resend), then DKIM + bounce subdomain records.
3. DMARC `p=none`.
4. Wait for both dashboards to show verified.
5. Supabase SMTP settings, then the rate limit, then templates.
6. Test (§4). Fill `SUPPORT_EMAIL` / `SECURITY_EMAIL` in the CHECKLIST
   step 6 PR **only after** the inboxes receive, because `/support`
   starts showing a live `mailto:` the moment the placeholder is gone.
7. Apple relay registration (§5) once the Apple account exists.

Rollback for SMTP: toggle custom SMTP off in Supabase (it falls back to
the built-in mailer and its low limit). Nothing else changes.

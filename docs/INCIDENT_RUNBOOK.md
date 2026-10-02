# Incident runbook

For both owners. Print it or keep it offline — during an incident the
thing that is broken may be the thing you would read it on.

(STARTUP_REQUIREMENTS item 78.)

The order is always: **contain → rotate → assess → notify → review.**
Contain first, even before you understand it. You can always turn
something back on.

---

## 1. Severity

| Level | What it looks like | Response |
|---|---|---|
| **SEV1** | Personal data exposed or likely exposed (health, meals, money, messages, emails). A secret leaked (service role key, JWT secret). User data being wiped or overwritten. | Drop everything. Both owners. The 72-hour ICO clock may already be running. |
| **SEV2** | A security hole found but no sign it was used. AI spend running away. Abuse on the social surfaces (DMs, groups, leaderboard). App down for everyone. | Same day. One owner leads, the other is told. |
| **SEV3** | Degraded feature, a single user's problem, a report of a low-risk bug. | Normal work. Log it. |

If you are unsure between two levels, pick the higher one. Downgrade later.

---

## 2. First hour checklist

- [ ] Write down the time you became aware. **This starts the 72-hour clock** (section 6).
- [ ] Start a breach log entry (section 8), even if it turns out to be nothing.
- [ ] Tell the other owner. One person leads; the other checks their work.
- [ ] Contain (section 3). Don't wait to understand the cause.
- [ ] If a secret may be out, rotate it (section 4).
- [ ] Take copies of the evidence before it expires (section 5 — Netlify and Supabase logs are short-lived).
- [ ] Don't delete anything. Not rows, not logs, not Storage objects. Deleting evidence is worse than the incident.
- [ ] Don't discuss it in public channels, GitHub issues or commit messages until it's fixed.

---

## 3. CONTAIN

### Roll back the site (fastest, ~1 minute)

Netlify → the site → **Deploys** → pick the last good deploy → **Publish deploy**.

- That swaps the static site AND the functions back to that deploy. No build, no credits.
- Then stop the next merge from undoing it: on the Deploys page, **stop auto publishing** (the lock on the published deploy). Otherwise merging to `master` is a deploy.
- Environment variables are **not** rolled back. They are whatever is set now.
- If the bad change was a service worker (`public/sw.js`), clients may keep the bad build until a new `CACHE_VERSION` ships. Rolling back the deploy is still the first step.

### Switch one function off

**There is no kill-switch env var today.** Item 78 asks for one; it isn't built.
The real options, fastest first:

1. **Remove the env var the function needs, then redeploy.** Every one of these fails closed without its key (checked in code):

   | Remove | What stops | How it fails |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | `ai-coach-daily`, `ai-food-detect`, `recipe-from-video` | 503 "not configured". Group crest uploads stop being auto-screened and wait in the owner's review queue instead. |
   | `WHOOP_CLIENT_SECRET` | `whoop-cron`, `whoop-sync`, `whoop-connect`, `whoop-callback` | cron returns early; others refuse |
   | `OURA_CLIENT_SECRET` | `oura-cron`, `oura-sync`, `oura-connect`, `oura-callback` | same |
   | `REVENUECAT_WEBHOOK_AUTH` | `revenuecat-webhook` (tier changes) | 500 "not configured". RevenueCat retries, so events are not lost. |
   | `TRADING_REPORT_TOKEN` | `trading-summary` | setup hint, no fetch |
   | `OWNER_EMAIL` (and `VITE_OWNER_EMAIL`) | every owner-only function: `moderation`, `admin-set-rating`, `trading-summary`, crest review | 403 for everyone |
   | `SUPABASE_SERVICE_ROLE_KEY` | nearly every function (anything that writes or reads across users) | 500. The app itself still loads and saves — the client talks to Supabase directly with the anon key. |

   ⚠️ Netlify applies env var changes **only on the next deploy.** After changing one: Deploys → **Trigger deploy → Deploy site** (redeploys the current commit, ~15 credits, a few minutes).
   Remember to put the value back afterwards.

2. **Rotate the Supabase service role key** (section 4). Every function that uses it stops at once, with no deploy. Heavy-handed, but instant.

3. **Revoke a grant or drop a policy in Supabase** when the hole is in the database, not a function. SQL editor, e.g. `revoke select on public.<table> from anon;`. Write the SQL to a file first so the fix is recorded.

4. **Pause the whole Supabase project** (Project Settings → General, if your plan offers it). The whole app goes down. Last resort — only for an active SEV1 you can't stop any other way.

A redirect in `netlify.toml` over `/.netlify/functions/<name>` is **not** a documented or tested way to disable a function. Don't rely on it during an incident.

### Scheduled functions

`push-dispatch` (every minute), `snapshot-ratings` (03:00), `whoop-cron` (06:00), `oura-cron` (06:30), `settle-leagues` (Mon 00:05) — all UTC, in `netlify.toml`.
To stop a cron that is damaging data: remove its env var as above (whoop/oura), or roll back the deploy. Removing the `schedule` line from `netlify.toml` also works but needs a merge and a build.

### One user's account

- **Lock them out:** Supabase → Authentication → Users → the user. Ban them there if the option is shown; otherwise the Auth admin API's `updateUserById` with `ban_duration` does it. Rotating the JWT secret signs out *everyone*, not one user.
- **Hide them from public boards:** the moderation suspend flag (see `docs/ABUSE_HANDLING.md`).

---

## 4. ROTATE

Secrets live in **Netlify → Site configuration → Environment variables**, and nowhere else. Never in the repo, never in chat. The shared password manager holds a copy (see `docs/ACCOUNT_SECURITY.md`).

After rotating any of these: set the new value in Netlify, **then redeploy** (env changes apply only on deploy), then update the password manager.

| Secret (env var) | Protects | Rotate at | What breaks while rotating |
|---|---|---|---|
| Supabase **JWT secret / signing key** | Every user session. Anyone with it can mint a token as any user. | Supabase → Project Settings → JWT Keys (or API → JWT settings on older projects). | **Signs everyone out.** This is the "kill all sessions" lever. With legacy keys it also invalidates the old `anon` and `service_role` keys — update `VITE_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in the same sitting, then redeploy. |
| `SUPABASE_SERVICE_ROLE_KEY` | Full database access, bypasses RLS. Used by almost every function. | Supabase → Project Settings → API Keys. With the new-style keys, create a new secret key, deploy it, then delete the old one. With legacy keys, it only changes by rotating the JWT secret (row above). | Functions fail until the redeploy lands. Users stay signed in (new-style keys). |
| `VITE_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` | Nothing secret — it is public and RLS-gated. Rotate only if forced by the JWT rotation. | As above. | App can't reach Supabase until the new build is live. Old clients (cached builds, native app) break until they update. |
| `ANTHROPIC_API_KEY` | AI spend. | Anthropic console → API keys. Create new, deploy, then disable the old one. | AI features answer 503 during the gap. Also check the spend limit is still set. |
| `WHOOP_CLIENT_SECRET` (+ `WHOOP_CLIENT_ID`) | Exchanging and refreshing users' WHOOP tokens. | WHOOP developer dashboard → the app. | Sync and connect fail until redeployed. **Does not revoke users' existing grants** — tokens in `whoop_tokens` stay valid at WHOOP. Also the fallback OAuth-state key (see `OAUTH_STATE_SECRET`). |
| `OURA_CLIENT_SECRET` (+ `OURA_CLIENT_ID`) | Same for Oura (`oura_tokens`). | Oura developer portal → the application. | Same as WHOOP. |
| `OAUTH_STATE_SECRET` | Signs the OAuth `state` for WHOOP/Oura linking (`netlify/lib/oauthState.js`). When unset, the provider's client secret is used instead. | Generate a new random string (≥ 32 bytes). | A connect flow that is mid-way (10-minute window) fails; the user just tries again. |
| `REVENUECAT_WEBHOOK_AUTH` | Stops anyone posting fake purchase events to `revenuecat-webhook` and granting themselves Pro. | Generate a new random string. Set it in Netlify **and** RevenueCat → Integrations → Webhooks → Authorization header, at the same time. | Webhooks rejected in between. RevenueCat retries, so set both and redeploy promptly. |
| `REVENUECAT_SECRET_API_KEY` | Server reads of subscriber status; deleting the subscriber on account deletion. | RevenueCat → Project Settings → API Keys. | Webhook falls back to ordering events by their own timestamp; account deletion skips removing the RevenueCat subscriber. |
| `CRON_SECRET` | Manual HTTP triggering of `whoop-cron`, `oura-cron`, `snapshot-ratings`, `settle-leagues` (`netlify/lib/cronAuth.js`). | Generate a new random string. | Nothing — scheduled runs don't use it. |
| `PUSH_DISPATCH_SECRET` | Manual triggering of `push-dispatch`. | Generate a new random string. | Nothing — scheduled runs don't use it. |
| `FCM_SERVICE_ACCOUNT_JSON` (+ `FCM_PROJECT_ID`) | Sending push notifications as the app. | Google Cloud console → IAM → Service accounts → the FCM account → Keys. Add a new key, deploy, delete the old key. | Pushes are skipped (logged, not failed) until redeployed. |
| `TRADING_REPORT_TOKEN` (+ `TRADING_REPORT_URL`) | Read-only pull from the trading app. | The trading app's side, then Netlify. | Owner's trading widget shows the setup hint. |
| `FATSECRET_CLIENT_ID` / `FATSECRET_CLIENT_SECRET` | Food search quota. | FatSecret platform account. | That food source contributes nothing; search still works. |
| `FDC_API_KEY` | USDA food search quota. | api.data.gov key signup. | Same. |
| `GNEWS_API_KEY` | News widget quota. | GNews dashboard. | News widget empty. |
| `FINNHUB_API_KEY` | Market widget quota. | Finnhub dashboard. | Market widget empty. |
| `YOUTUBE_API_KEY` | Optional recipe-from-video lookups. | Google Cloud console → Credentials. | Falls back to page scraping. |

Not secrets, but related:

- `OWNER_EMAIL`, `VITE_OWNER_EMAIL` — who counts as owner. Not a credential, but changing it changes who can moderate.
- `OAUTH_REDIRECT_BASE`, `URL` — fixed redirect origin. Must match what WHOOP/Oura have registered.
- `VITE_REVENUECAT_API_KEY_IOS` / `_ANDROID` — public SDK keys.

Secrets that are **not** env vars:

- **Per-user health-sync token** (`state.healthToken`). The user rotates it themselves: Apple Health panel → **New URL**. If tokens may have leaked in bulk, tell affected users to do that.
- **WHOOP / Oura refresh tokens** in `whoop_tokens` / `oura_tokens`. If the service role key leaked, assume these leaked too. Rotating the client secret does not revoke them. Users can revoke at the provider or disconnect in the app (`wearable-disconnect` deletes our copy).
- **Supabase dashboard, Netlify, GitHub logins** — see `docs/ACCOUNT_SECURITY.md`.

---

## 5. ASSESS

Answer three questions: **what data, whose, since when.** Write the answers in the breach log.

Where to look:

- **Netlify function logs** — Netlify → Logs → Functions → pick the function. Retention is short. Copy anything relevant out straight away.
- **Netlify deploy log** — which commit went live, and when.
- **Supabase logs** — Dashboard → Logs: API (PostgREST requests, including which key), Postgres, Auth. Limited retention on the current plan. Export early.
- **Supabase auth audit** — `auth.audit_log_entries` (sign-ins, token refreshes) via the SQL editor.
- **`public.client_errors`** — the app's own crash reports (`netlify/functions/client-error.js`). Service role only. Once `supabase/audit_schema_2026_10.sql` has been run.
  ```sql
  select occurred_at, kind, message, url, release
  from public.client_errors
  where occurred_at > now() - interval '24 hours'
  order by occurred_at desc limit 200;
  ```
- **`public.user_data_history`** — if data was wiped, the pre-wipe snapshots are here. See `docs/RESTORE_RUNBOOK.md`.
- **GitHub** — commit history, and Security → Secret scanning alerts if a key was pushed.
- **Anthropic console** — usage by day, for runaway AI spend.
- **Supabase security advisors** — Dashboard → Advisors. Run after any SQL fix.

Rules while assessing:

- Read only. Don't "tidy up" rows while you look.
- Don't copy personal data into chat tools or issues. Refer to users by id prefix, not name or email.

---

## 6. NOTIFY

UK GDPR applies. Vantage holds **special-category data** (health: weight, sleep, heart rate, meals, mood). That changes the answer to "is this risky?" to almost always yes.

### The ICO — Article 33

- Report a personal-data breach to the ICO **within 72 hours of becoming aware of it**.
- Exception: the breach is **unlikely to result in a risk** to people's rights and freedoms. With health data exposed, assume it is not unlikely.
- If you don't have every fact within 72 hours, report what you know and add to it later. Late reports must say why they are late.
- Route: the **ICO personal data breach report** (the ICO's online breach reporting form, found on the ICO website). Have ready: what happened, when, when you found out, categories and rough number of people and records, likely consequences, what you've done, a contact.
- The ICO data protection fee must be paid (STARTUP_REQUIREMENTS item 7).

### Users — Article 34

- If the breach is likely to result in a **high risk** to people, tell the affected users **without undue delay**.
- Plain language: what happened, what data, what we've done, what they should do (e.g. tap **New URL** for health sync, change a reused password), and how to contact us.
- Send by email from the owner address, and an in-app notice if the app still works.

### Always — Article 33(5)

- Record **every** personal-data breach in the breach log (section 8), **including ones you decide not to report**, with the reason. The ICO can ask to see it.

### Others

- **Apple / Google** — if the app itself was the vector (a malicious build, a compromised signing key, a store listing issue), contact them through App Store Connect / Play Console.
- **Processors** — if the breach started at Supabase, Netlify, Anthropic or RevenueCat, they must tell you; if it started with you and involves their systems, tell them.
- **Police / Action Fraud** — for criminal attacks (extortion, account takeover used for fraud).

---

## 7. REVIEW

Within a week of closing the incident. Short is fine. Keep it in the breach log entry or next to it.

```
## Post-mortem: <one-line title>
Date of incident:        Date found:        Date closed:
Severity:                Lead:              Reviewed by:

### What happened
<Timeline in UTC. Facts, not blame.>

### Impact
Data: <categories>    People: <count>    Duration: <from–to>
Reported to ICO: yes/no (why)    Users told: yes/no (why)

### Why it happened
<The root cause, and why nothing caught it.>

### What fixed it
<Commits / PRs / SQL files.>

### What stops it happening again
- [ ] A test or check script (`scripts/check-*` or a `*.test.mjs`) that fails if it comes back
- [ ] A line in `.github/pull_request_template.md` if it's a class of mistake
- [ ] A CLAUDE.md / STARTUP_REQUIREMENTS note if it's a standing rule
```

The model to copy is what happened after the 2026-05-03 wipe (commit `f6a7a50`): a guard in code, a guard in the database (`user_data_history`), and a rule written down.

---

## 8. Breach log

Keep this as a private document both owners can edit (not in this repo — it will hold personal data). One row per incident, reported or not.

| # | Found (UTC) | Occurred (UTC) | What happened | Data categories | People affected (approx.) | Risk (none / risk / high) | ICO reported? When? Ref | Users told? When? | Reason if not reported | Actions taken | Closed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | |

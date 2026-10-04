# Security triage agents

Scheduled Claude agents (the owner's routines) can triage and fix **low and
medium** Security tickets. They reach the ticket queue through one narrow
endpoint, `/.netlify/functions/security-agent`, and nothing else.
High and critical tickets are the owner's. They go to the owner's phone
(`netlify/lib/alertNotify.js`), not to an agent.

## What the endpoint allows

| Request | What it does |
|---|---|
| `GET ?view=queue` | Open and acknowledged tickets with severity `low` or `medium`, newest first, up to 100. Each has `id, kind, severity, status, source, title, headline, detail, count, firstSeen, lastSeen, note`. |
| `GET ?view=errors&window=1h\|24h` | The top client-error groups: message, first stack frame, count, first and last seen, sample URL, build (`release`). |
| `POST {"action":"note","id","note"}` | Adds `[agent] <UTC time> note: …` to the ticket's note. |
| `POST {"action":"ack","id","note"?}` | Sets status `ack` (from `open`) and adds the note line. |
| `POST {"action":"resolve","id","note","pr"?}` | Sets status `resolved` and adds the note line, plus `· PR: <url>` when `pr` is a `https://github.com/<owner>/<repo>/pull/<n>` link. A note is required. |

Limits:
- A note is at most 2,000 characters. The whole note column is capped at 8,000, and the oldest text is trimmed first.
- An action on a high or critical ticket returns **403**. The PATCH repeats the `severity in (low, medium)` filter, so it cannot change a high or critical ticket even if the severity changed after the agent read it.
- A resolved auto ticket re-opens by itself if the hourly sweep sees the problem again. "Resolved" therefore means the agent believes the problem is fixed. The sweep checks that.

### What an agent never sees
No user ids, reporter ids, handles, names, emails, IP addresses or user agents.
`netlify/lib/agentShape.js` drops those fields by key. It also masks any email
address or UUID left in free text (`[email]`, `[id]`). A user ticket still shows
the person's own description of the problem, because that is the bug report.

### What an agent can never do
- Ban, suspend, delete, or decide a moderation report. These routes do not exist on this endpoint.
- Read or change user data (`user_data`, `nutrition_log`, Storage), or run SQL.
- Act on a high or critical ticket.

## Guardrails for the routine

1. **Open PRs. Never merge, never deploy.** An agent may branch, commit and open a pull request against `master`. It may then `resolve` the ticket with the PR link. Merging and deploying happen only when the owner says "deploy".
2. **Data safety comes first (CLAUDE.md).** No change may overwrite or reset `user_data.state`, delete Storage objects, or run a destructive migration. SQL goes in `supabase/*.sql` for the owner to run.
3. **Stay in scope.** Fix the ticket's problem. Nothing else.
4. **Say what you did.** Every `ack` or `resolve` carries a note. If the agent cannot fix a ticket, it adds a `note` saying what it found and leaves the ticket open.
5. **Escalate rather than guess.** If a low or medium ticket looks like a security problem (data exposure, an auth bypass), the agent adds a `note` that says so and does not resolve it. The owner then re-grades it in the console.

## Auth

Send the token in the `X-Agent-Token` header. The server compares it in constant time with the Netlify env var `SECURITY_AGENT_TOKEN`.

- A token in the query string is refused outright, because query strings end up in logs.
- A missing token or a wrong token gets the same `401 {"error":"unauthorized"}`.
- `SECURITY_AGENT_TOKEN` unset or shorter than 32 characters returns `503 {"error":"not_configured"}`.
- Each instance allows 60 requests a minute. After 10 failed attempts in a minute from one address, that address gets `429`.
- Every answer is sent with `Cache-Control: no-store`.

Example:

```sh
curl -sS -H "X-Agent-Token: $SECURITY_AGENT_TOKEN" \
  "https://<site>/.netlify/functions/security-agent?view=queue"

curl -sS -X POST -H "X-Agent-Token: $SECURITY_AGENT_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"resolve","id":"<ticket uuid>","note":"Null check added in MacroRing","pr":"https://github.com/<owner>/<repo>/pull/<n>"}' \
  "https://<site>/.netlify/functions/security-agent"
```

## Setting up and rotating the token

1. Generate it with `openssl rand -hex 32`, which gives 64 hex characters. Never commit it, and never put it in a `VITE_` variable.
2. Add it in Netlify → Site configuration → Environment variables as `SECURITY_AGENT_TOKEN`, scope **Functions**, then redeploy.
3. Give the same value to the routine as a secret.

To **rotate**, generate a new value, replace `SECURITY_AGENT_TOKEN` in Netlify, redeploy, and update the routine's secret. The old token stops working with that deploy.

To **cut agents off**, delete the env var and redeploy. The endpoint then answers `503 not_configured`.

Rotate the token if it ever appears in a log, a chat or a commit, and otherwise every few months.

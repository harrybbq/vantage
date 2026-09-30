# Account security

Whoever gets into one of these accounts gets every user's data, or can
ship code to every user's phone. Treat them that way.

(STARTUP_REQUIREMENTS item 80.)

---

## Rules

1. **2FA on every account below, with an authenticator app, passkey or security key. Not SMS.** SIM-swap attacks beat SMS.
2. **Each owner has their own login** wherever the service supports team members. No shared logins. It shows who did what, and one person can be removed without changing everything.
3. **Secrets live in Netlify env vars and the shared password manager.** Never in the repo, chat, email, screenshots, or issue comments. If one lands in any of those, treat it as leaked and rotate it (`docs/INCIDENT_RUNBOOK.md` §4).
4. **Recovery codes** go in the password manager, plus one offline copy (printed, somewhere safe).

---

## 2FA checklist

Tick when done for each owner.

| Service | What it controls | 2FA where | Harry | Aidan |
|---|---|---|---|---|
| **Owner email** (Outlook / Gmail) | Password resets for everything else. Protect this first. | Microsoft account / Google account security settings | [ ] | [ ] |
| **GitHub** | The code. Merging to `master` deploys. | Settings → Password and authentication | [ ] | [ ] |
| **Netlify** | Deploys, rollbacks, all server secrets. | User settings → Security | [ ] | [ ] |
| **Supabase** | The database: every user's data. | Account preferences → Security (MFA). Consider requiring MFA for the whole organisation. | [ ] | [ ] |
| **Apple Developer / App Store Connect** | iOS releases. | Apple Account 2FA (required) | [ ] | [ ] |
| **Google Play Console** (+ Firebase / Google Cloud for FCM) | Android releases, push service account. | Google account → 2-Step Verification, passkey or authenticator | [ ] | [ ] |
| **RevenueCat** | Subscriptions, webhook secret. | Account settings → Security | [ ] | [ ] |
| **Anthropic console** | AI key and spend. | Account settings | [ ] | [ ] |
| **Domain registrar** | The domain, DNS, and so `security@` email. A hijacked domain can take over the site and the email. | Registrar account security | [ ] | [ ] |
| **WHOOP developer / Oura developer** | OAuth client secrets for health data. | Each portal's account settings (if offered) | [ ] | [ ] |
| **Password manager** itself | Everything above. | Its own 2FA, strong master password | [ ] | [ ] |

Lower risk (API quota only — still use the password manager): FatSecret,
USDA FDC, GNews, Finnhub, YouTube Data API.

---

## Shared password manager

- One shared vault, e.g. "Vantage — production", both owners as members.
- It holds: every Netlify env var value (see the table in `docs/INCIDENT_RUNBOOK.md` §4), service logins, recovery codes, the app signing keys and keystore passwords once they exist.
- The **Android upload keystore and passwords** and the **Apple signing credentials**: losing these means you can't update the app. Keep them in the vault and one offline backup.
- When a secret is rotated, update the vault in the same sitting.
- If an owner leaves: remove them from the vault and every service, then rotate everything they could see.

---

## GitHub

### Secret scanning and push protection

Repo → **Settings → Code security** (called "Code security and analysis" on some accounts):

- [ ] **Secret scanning** → Enable.
- [ ] **Push protection** → Enable. Blocks a push that contains a recognised secret before it lands.
- [ ] Check **Security → Secret scanning** alerts now. Anything listed is already public: rotate it, then close the alert.

On a **public** repo both are free. On a **private** repo they may need a
paid GitHub plan — check before switching. If they aren't available,
add a secret scanner (e.g. gitleaks) to `.github/workflows/build.yml` so
every PR is checked.

### Branch protection

- [ ] `master`: require a pull request and the `build` check to pass before merging. Direct pushes are already blocked for agents; make it true for people too.
- [ ] No force-push to `master`.

### Access

- [ ] Review Settings → Collaborators, **Applications** and **Personal access tokens** quarterly. Remove what isn't used. Netlify's GitHub app needs read access to the repo only.
- [ ] Prefer fine-grained tokens scoped to this one repo.

### Make the repo private before launch

Recommended. Today it's public, so anyone can read every SQL file,
function and comment — including how the security works and which
holes were fixed when.

- Making it private does **not** remove what's already out: forks, clones and anything already scanned stay public. Treat anything ever committed as public.
- Git history still holds the personal emails removed from `supabase/lifetime_grants.sql` and `supabase/recomp_schema.sql`, and the Last.fm API key from the since-deleted `SpotifyBar.jsx` (item 70). Revoke that key at Last.fm. Rewriting history (`git filter-repo`) is possible but breaks every clone — the owners' call.
- The Policy link in `public/.well-known/security.txt` points at `SECURITY.md` on GitHub. Move it to a page on the site if the repo goes private.
- Check secret scanning is still on afterwards (see above).

---

## Supabase specifically

- [ ] Organisation members: only the two owners. Remove anyone else.
- [ ] Personal access tokens (Account → Access Tokens): revoke unused ones, including any made for tools or agents.
- [ ] Leaked Password Protection on (item 39).
- [ ] The service role key exists only in Netlify env vars and the vault.

## Netlify specifically

- [ ] Team members: only the two owners.
- [ ] Deploy notifications on (email) so an unexpected deploy is noticed.
- [ ] Env vars marked as secret where Netlify offers it, so they're hidden in the UI and logs.

---

## Quarterly review (10 minutes)

- [ ] Walk the 2FA table. Anyone new? Anything turned off?
- [ ] GitHub collaborators, apps, tokens.
- [ ] Supabase and Netlify members and tokens.
- [ ] Password manager: any secret older than a year that could be rotated cheaply (`CRON_SECRET`, `PUSH_DISPATCH_SECRET`, `OAUTH_STATE_SECRET`, `REVENUECAT_WEBHOOK_AUTH`)?
- [ ] `public/.well-known/security.txt` — `Expires` still in the future?

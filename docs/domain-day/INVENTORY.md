# Domain day: inventory

Every place in the repo that names the current origin
(`vantagevision.netlify.app`, any `*.netlify.app`) or a placeholder
domain/address, plus the values that follow the origin on their own.
Grepped **2026-10-20** (HEAD `ef73250` plus other sessions' uncommitted
work), excluding `node_modules/`, `dist/`, `.git/`, `.claude/worktrees/`
and `android/app/build/`:

```bash
grep -rnI --exclude-dir={node_modules,dist,.git,.claude,build} \
  -E 'netlify\.app|example\.(com|org)|\[your-domain\]|your-domain|vantage\.app[^:]|vantage\.example|support@|security@|privacy@|no-?reply|\[domain' .
grep -rnI -E 'process\.env\.(URL|APP_URL|OAUTH_REDIRECT_BASE|SITE_NAME)|window\.location\.origin|webOrigin|VITE_API_BASE' src netlify
```
Line numbers drift, because other sessions are editing these files.
Re-run the grep on the day. Markdown docs are cited by line as of the
grep, and STARTUP_REQUIREMENTS by item number.

---

## A. Must change by hand

### A1. Code and served files (one PR: CHECKLIST step 6)

| File:line | Today | Change to |
|---|---|---|
| `src/lib/support.js:21` | `SUPPORT_EMAIL = 'support@[your-domain]'` | `support@[your-domain]` (real). Read by `src/components/support/SupportPages.jsx:242,256,444` |
| `src/lib/support.js:25` | `SECURITY_EMAIL = 'security@[your-domain]'` | real address. Read by `SupportPages.jsx:391`. The comment at :23-24 says change it together with SECURITY.md and security.txt |
| `SECURITY.md:9-10` | `security@[your-domain]` + "(placeholder — …)" | real address; remove the note |
| `public/.well-known/security.txt:3-4` | `# PLACEHOLDER: replace [your-domain] …` | remove |
| `public/.well-known/security.txt:9` | `Contact: mailto:security@[your-domain]` | real address; add `Canonical: https://[your-domain]/.well-known/security.txt` |
| `public/.well-known/security.txt:11` | `Policy: https://github.com/…/SECURITY.md` | keep while the repo is public; point at `https://[your-domain]/support` if it goes private (the file's own comment, :6-7) |
| `src/components/LegalPage.jsx:91` | `<Todo>security@[domain — to be confirmed]</Todo>` | real address; better, import `SECURITY_EMAIL` (today it is hard-coded, so `support.js` isn't the single source its comment claims) |
| `src/components/LegalPage.jsx:231` | same `<Todo>` | same |
| `src/components/LegalPage.jsx:90` | `<Todo>[Company name, registered address …]</Todo>` | company (item 64). Not the domain, but usually the same week |
| `index.html:16` | `og:url` `https://vantagevision.netlify.app/` | `https://[your-domain]/` |
| `index.html:17` | `og:image` `…netlify.app/og-image.png` | `https://[your-domain]/og-image.png` |
| `index.html:24` | `twitter:image` `…netlify.app/og-image.png` | same |
| `netlify.toml:155` | CSP `connect-src … https://vantagevision.netlify.app` | **add** `https://[your-domain]`, **keep** the old one (Report-Only; native base) |
| `src/lib/native/apiUrl.js:20` | `DEFAULT_API_BASE = 'https://vantagevision.netlify.app'` | `https://[your-domain]` **before the first store binary** (or set `VITE_API_BASE` in the native build env). Also named in the `netlify.toml` secrets-scan comment |
| `netlify/lib/foodSources.js:28` | UA `Vantage/1.0 (https://vantagevision.netlify.app)` | new domain |
| `netlify/functions/food-search.js:31` | same UA | new domain |

### A2. Outside the repo (CHECKLIST steps 2, 5, 7)

| Where | Today (from repo docs) | Change | Verified? |
|---|---|---|---|
| Supabase Auth → Site URL | `https://vantagevision.netlify.app` (STARTUP item 28) | `https://[your-domain]` (after step 4) | dashboard not visible |
| Supabase Auth → Redirect URLs | `https://vantagevision.netlify.app/**`, `http://localhost:5173/**`, deploy previews (item 28); `com.vantage.app://auth-callback` asked for in item 42 | **add** `https://[your-domain]/**`, `https://www.[your-domain]/**` | not visible |
| Supabase Auth → SMTP + Rate Limits | built-in mailer (item 94) | custom SMTP (EMAIL.md) | not visible |
| WHOOP app → redirect URLs | `https://vantagevision.netlify.app/.netlify/functions/whoop-callback` (item 31, still `[ ]`) | **add** `https://[your-domain]/.netlify/functions/whoop-callback` | not visible |
| Oura app → redirect URI | not registered yet (item 30) | register both hosts | — |
| Google Cloud OAuth client / consent screen | unknown whether configured (`src/components/AuthScreen.jsx:164-178`) | JS origin + branding links + authorized domain | not visible |
| Apple Services ID (SIWA) | Supabase callback | unchanged; add the email relay sources (EMAIL.md §5) | — |
| RevenueCat webhook URL | `https://<site>/.netlify/functions/revenuecat-webhook` (template at `netlify/functions/revenuecat-webhook.js:16`) | new host, later | not visible |
| Uptime monitor (item 77) | `/.netlify/functions/health` on the current host, if set up | add the new host; keep the old | not visible |
| Security agent routine | `https://<site>/…` (`docs/SECURITY_AGENT.md:57,61,86`) | new host | — |
| Apple Health Shortcut (owner) | `…/.netlify/functions/health-sync?token=…` built from `webOrigin()` (`src/components/VitalsHistoryCard.jsx:93`; `docs/FEATURES.md:79`) | regenerate on the new origin | — |
| App Store Connect / Play Console listings | not created yet | URLs per CHECKLIST §7 | — |
| Google Search Console | — | add the domain property | — |

### A3. Docs that quote the old URL or a placeholder address

| File:line | What |
|---|---|
| `docs/STORE_SUBMISSION_PACK.md:193` | `[support@company-domain]` (Play contact) |
| `docs/STORE_SUBMISSION_PACK.md:320` | Age Suitability URL `…netlify.app/terms` |
| `docs/STORE_SUBMISSION_PACK.md:532` | `…netlify.app/delete-account` |
| `docs/STORE_SUBMISSION_PACK.md:630-631` | Privacy / Terms URLs in listing copy |
| `docs/STORE_SUBMISSION_PACK.md:659,661,662` | Support / Privacy / Account deletion URL table |
| `docs/STORE_SUBMISSION_PACK.md:727,737,739` | **[DOM]** checklist rows: tick them |
| `docs/STORE_PRIVACY_LABELS.md:230` | in-transit encryption row names `https://vantagevision.netlify.app` |
| `docs/STORE_PRIVACY_LABELS.md:233` | Delete account URL |
| `docs/WEARABLE_APPROVALS.md:92` | `https://vantagevision.netlify.app/.netlify/functions/<provider>-callback` |
| `docs/WEARABLE_APPROVALS.md:221` | `[OWNER: support@[domain] and security@[domain]]` contact emails |
| `docs/WEARABLE_APPROVALS.md:222-226` | privacy / terms / support / deletion / redirect URLs for the WHOOP form ("update here **the same day**") |
| `docs/WEARABLE_APPROVALS.md:411,440,443,526` | Oura form and reviewer text quoting the old host |
| `docs/ONLINE_SAFETY_ACT_DRAFT.md:746` | `[support@domain]` |
| `STARTUP_REQUIREMENTS.md` item **28** | Site URL / Redirect URLs record, plus the "Re-check this the day a custom domain is added" sub-item |
| `STARTUP_REQUIREMENTS.md` item **30** | Oura redirect URI (old host only) |
| `STARTUP_REQUIREMENTS.md` item **31** | WHOOP redirect URI, plus "Re-check on the day a custom domain is added" |
| `STARTUP_REQUIREMENTS.md` items **72**, **76**, **94** | inboxes, security.txt, SMTP |
| `STARTUP_REQUIREMENTS.md` Running costs, **Domain** row | `vantagevision.netlify.app`, £0 |

Mentions that need no edit: `docs/ABUSE_HANDLING.md:169` ("the security@
/ support address") and `docs/ACCOUNT_SECURITY.md:33` (registrar row:
fill in the 2FA ticks).

## B. Env-driven: changes by itself (check it did)

| File:line | Resolves from | Effect of the switch |
|---|---|---|
| `netlify/lib/redirectUri.js:34` (`siteBase`) | `OAUTH_REDIRECT_BASE` → Netlify `URL` → request host | WHOOP/Oura `redirect_uri` and the post-callback `appUrl` move to the new primary domain **at the next deploy**. That is why the new URI must be registered first. Logged at `netlify/functions/whoop-connect.js:45` |
| `netlify/lib/oauthState.js:83-91,128-129` | cookie on the page's host | the connect only works where page host = redirect base (CHECKLIST rule 0.4) |
| `netlify/lib/alertNotify.js:95` (`appBase`) | `APP_URL` → `OAUTH_REDIRECT_BASE` → `URL` | ntfy/webhook alert links. If `OAUTH_REDIRECT_BASE` is ever pinned to the old host, alert links follow it unless `APP_URL` is set |
| `src/components/AuthScreen.jsx:147` | `window.location.origin` | web OAuth `redirectTo`, so needs the Supabase allow-list entry |
| `src/components/AuthScreen.jsx:263,274` | `webOrigin()` | sign-up / reset email `redirectTo` (web: current origin; native: `apiBase()`) |
| `src/lib/native/platform.js:31-33` (`apiBase`) | `VITE_API_BASE` → `DEFAULT_API_BASE` | native function base. **Not** automatic: see A1 |
| `src/lib/native/platform.js:44-47` (`webOrigin`) | current origin (web) / `apiBase()` (native) | — |
| `src/lib/friends/invites.js:26` | `window.location.origin` | invite links carry whichever origin they were made on. In the native shell this is `https://localhost` / `capacitor://localhost`, a pre-existing bug: should be `webOrigin()` **[unverified on device]** |
| `src/components/VitalsHistoryCard.jsx:93,209` | `webOrigin()` | health-sync URL shown to the owner; the WHOOP callback hint "for this origin" |
| `netlify/lib/securityData.js:368,580` | `SITE_NAME` | Netlify dashboard links (site name, not the domain), unaffected |
| `public/manifest.json` | `start_url: "/"`, `scope: "/"` (relative) | fine; installed PWAs stay bound to the origin they were installed from |
| `public/sw.js:91-92` | `self.location.origin` | per-origin; the new origin starts with no SW |
| 30+ functions, e.g. `netlify/functions/health.js:27` | `Access-Control-Allow-Origin: '*'` | **no CORS origin allow-list exists**, so nothing to update |
| `netlify.toml` `[[headers]] for = "/api/*"` | `*` | same |

Netlify-provided env (`URL`, `SITE_ID`, `SITE_NAME`) is documented in
`.env.example` ("Provided by Netlify"). `OAUTH_REDIRECT_BASE` and
`APP_URL` are optional and should stay **unset** (`.env.example`).

## C. Keep as fallback or leave alone

### C1. The old origin itself: keep registered and serving
- Supabase redirect URL `https://vantagevision.netlify.app/**` (emails in
  flight; users still on the old host).
- WHOOP's old redirect URI (and Oura's, if registered).
- `https://vantagevision.netlify.app` reachable **without** a redirect
  for `/.netlify/*` (native binaries via `DEFAULT_API_BASE`, RevenueCat,
  Shortcut, uptime), `/invite/*` (links already shared) and
  `/.well-known/*`. A page-only redirect comes later (CHECKLIST step 9).
- CSP `connect-src` entry for it (`netlify.toml:155`).
- `netlify/lib/redirectUri.js:7`: a comment naming the `*.netlify.app`
  fallback. Accurate; leave it.

### C2. Custom scheme: not domain-bound, unchanged
`com.vantage.app` in `capacitor.config.ts:8`,
`android/app/build.gradle:7`,
`android/app/src/main/res/values/strings.xml:5-6`,
`android/app/src/main/AndroidManifest.xml:39` (`auth-callback`),
`src/lib/native/authCallback.js:14-15`, `README.md:52,115`. The bundle id
is permanent (STARTUP item 11).

### C3. Test fixtures and examples: leave
| File:line | Value |
|---|---|
| `src/lib/native/authCallback.test.mjs:6` | `https://vantagevision.netlify.app/?code=x` (asserts that a web URL is *not* an auth callback) |
| `netlify/lib/securityShape.test.mjs:110,121` | Netlify API response fixture |
| `netlify/lib/efficiency.test.mjs:430,433` | client-error URL fixture |
| `src/lib/telemetry/shape.test.mjs:24,28` | `https://vantage.app` origin fixture (a real third-party TLD+name, used only as a string) |
| `src/lib/legalRoutes.test.mjs:39-46` | `support@[your-domain]`, `vantage.example`. These pin `isPlaceholderEmail`, which keeps working after the real address goes in (line 45-46 only checks the `support@`/`security@` prefix) |
| `src/lib/friends/dm.test.mjs:217`, `netlify/lib/alertNotify.test.mjs:51` | `vantage.example` |
| `netlify/lib/ssrfGuard.test.mjs:61-79`, `netlify/lib/nameFilter.test.mjs:25`, `src/lib/moderation/nameFilter.test.mjs:60`, `src/lib/state/clearLocal.test.mjs:16,24`, `src/lib/career/problems.js:316` | `example.com` hosts |
| `netlify/lib/aiFoodAllowance.test.mjs:18-77`, `netlify/lib/sbKeys.test.mjs:86,110`, `netlify/lib/securityAgent.test.mjs:36`, `src/lib/telemetry/shape.test.mjs:19`, `netlify/lib/securityShape.test.mjs:34` | `owner@example.com`, `someone@example.com`, `db.example.com` |
| `src/components/AuthScreen.jsx:339` | input placeholder `you@example.com` (UI hint) |
| `supabase/recomp_schema.sql:240` | `you@example.com` in an example comment (item 70 replaced the personal emails) |

### C4. History: leave
- `STARTUP_REQUIREMENTS.md`, "Auth — the email confirmation link (FIXED)":
  `…phoenix-b512b8.netlify.app`, the record of the rename incident.

## D. Not found (searched, absent)

- No `robots.txt`, `sitemap.xml` or `<link rel="canonical">` in `public/` or
  `index.html`. Optional on domain day: a canonical to `[your-domain]`
  while both hosts serve the same SPA.
- No `ios/` project, so no `Info.plist` URL types or entitlements yet
  (`src/lib/native/authCallback.js:9-10`).
- No `apple-app-site-association` or `assetlinks.json` (see APP_LINKS.md).
- No Supabase email templates in the repo (they live in the dashboard).
- No CORS origin allow-list in any function.
- No hard-coded custom-domain value anywhere: the only real origin
  literals are `apiUrl.js:20`, `index.html:16,17,24`, `netlify.toml:155`
  and the two User-Agent strings.

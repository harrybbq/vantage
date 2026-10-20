# Domain day — the checklist

What to do, in order, on the day Vantage gets its own domain. Written
2026-10-20 against the code at `ef73250`. Placeholders: `[your-domain]`
is the domain you buy (e.g. `example.com`), `<project-ref>` is the
Supabase project ref, `<site>` is the Netlify site name (today
`vantagevision`).

Companion files in this folder:

- [`INVENTORY.md`](INVENTORY.md): every file and line that mentions the
  current origin or a placeholder address.
- [`EMAIL.md`](EMAIL.md): mailboxes, custom SMTP for Supabase Auth
  (item 94), SPF/DKIM/DMARC.
- [`APP_LINKS.md`](APP_LINKS.md) and [`templates/`](templates/):
  universal links / Android App Links, for when the native builds exist.

Status markers used below: **[verified]** = checked in this repo;
**[unverified]** = depends on a dashboard or vendor behaviour this pack
could not see. Check those on the day.

---

## 0. The rules this order follows

1. **Add first, switch second, remove never (or much later).** Every
   allow-list (Supabase redirect URLs, WHOOP, Oura, Google) gets the new
   origin added **before** the primary domain changes. Removing the old
   origin is not part of domain day. That is the failure behind item 28
   (the `phoenix-b512b8` rename) and item 31 (WHOOP `invalid_request`):
   an origin changed and an allow-list didn't.
2. **Keep `https://<site>.netlify.app` working, and don't redirect it on
   day one.** Things outside the browser call it by name and will not
   follow a redirect:
   - Native builds: `DEFAULT_API_BASE` in `src/lib/native/apiUrl.js:20`
     is `https://vantagevision.netlify.app`. A cross-origin `fetch`
     with an `Authorization` header sends a CORS preflight, and browsers
     do not follow redirects on a preflight. A 301 on that host would
     break every function call from any binary built with that base.
   - The RevenueCat webhook (POST), the uptime monitor, the security
     agent routine (`docs/SECURITY_AGENT.md:57-61`) and the owner's Apple
     Health Shortcut (POST to `health-sync`, URL built at
     `src/components/VitalsHistoryCard.jsx:93`). A 301 turns a POST into a
     GET, and `health-sync` answers 405 to anything but POST
     (`netlify/functions/health-sync.js:99`).
   - WHOOP/Oura redirect URIs already registered on that host.
   - Supabase confirm/reset emails already in people's inboxes, whose
     `redirect_to` names that host.
   - `/invite/<code>` links people have already shared. Invite URLs are
     built from `window.location.origin` (`src/lib/friends/invites.js:26`),
     so links made on the old origin keep its name.
   Netlify does not redirect the `*.netlify.app` name by itself: it
   stays reachable unless you add a redirect rule **[unverified: from
   Netlify docs and forum via search, 2026-10-20; check with `curl -sI`
   in step 4.5]**. Page-only redirects come later (step 9) and must
   exclude `/.netlify/*` and `/.well-known/*`.
3. **Data safety (CLAUDE.md rule #1).** Nothing on domain day writes to
   `user_data`. But **localStorage belongs to one origin**, and three
   things live there (`src/hooks/useVisionBoardState.js`):
   `vb4_pending:<uid>` (unsaved edits stashed on page hide and merged on
   the next load), `vb4_seen_user:<uid>` (the breadcrumb that refuses to
   seed defaults over a user it has seen before) and the local backup.
   A user's first visit to the new origin is the "new device" path:
   empty localStorage, hydrate from the cloud. That path already exists
   and is guarded (item 54; the server keeps a `pre-wipe` snapshot in
   `user_data_history` when meaningful state would be replaced by
   non-meaningful state, `supabase/user_data_history_schema.sql:78-85`).
   But a **forced** redirect sends every user down that path at once,
   and strands any `vb4_pending` edit left on the old origin. That is
   another reason not to force-redirect on day one. Step 4.6 tests the
   path with a heavy real account before anyone is sent there.
4. **The cookie rule for WHOOP/Oura.** The OAuth `state` nonce cookie is
   set by `whoop-connect` / `oura-connect` on whatever host the page is
   on (same-origin `fetch`, `src/components/VitalsHistoryCard.jsx:292,458`).
   The callback refuses a state without that cookie
   (`netlify/lib/oauthState.js:128-129`). So **a connect only works when
   the registered redirect base is the same host the user is on.**
   Pinning `OAUTH_REDIRECT_BASE` to the old origin while users browse
   the new one breaks connect for them. The redirect base has to move
   with the primary domain, so the new callback URL must be registered
   with WHOOP (and Oura) **before** the switch. Users who stay on
   `*.netlify.app` can't connect a wearable after the switch until step
   9 sends pages to the new domain. Existing connections and the crons
   are not affected, because tokens are server-side.
5. **`URL` changes on deploy.** Netlify sets `URL` to the primary domain.
   Functions read env at deploy time, so treat the flip as happening
   at the **next deploy** after the primary domain changes. The
   runbook already says env changes apply on deploy (STARTUP item 78).
   **[unverified: whether a primary-domain change alone updates running
   functions]** Verify with the logged value (step 6.3).

---

## 1. Before the day (any time after the company exists)

- [ ] **Order.** Buy the domain right after the company is registered
      (item 1) and before Apple organisation enrolment (item 5). Apple's
      organisation enrolment asks for a public website on a domain
      associated with the organisation, and the reviewer demo accounts
      (item 122, created 4–6 weeks before submission) need a mailbox that
      can receive the confirmation email **[unverified: Apple's current
      enrolment wording]**.
- [ ] **Trademark check** on the name before buying (item 75).
- [ ] **Registrar choice.** Any registrar with authenticator-app 2FA and
      registrar lock. Turn on **auto-renew** and buy 2+ years. Once the
      domain is in the native binary, Supabase, OAuth consoles and store
      listings, an expired domain takes sign-in, email, support and app
      links down together. Add the registrar to
      `docs/ACCOUNT_SECURITY.md:33` (2FA, both owners).
- [ ] **DNS host choice.**
      - **Netlify DNS (recommended):** move the nameservers to Netlify.
        You get an apex primary domain (flattened ALIAS) and automatic
        TLS. Email records (MX/TXT/CNAME) are then added in Netlify →
        Domains → DNS records.
      - **External DNS** (registrar or Cloudflare): make **`www`** the
        primary, which is Netlify's recommendation for external DNS. Use
        `www CNAME <site>.netlify.app` and an apex `A` record to Netlify's
        load balancer, taking the IP Netlify's UI shows (historically
        `75.2.60.5`) **[unverified: confirm in the Netlify UI]**. On
        Cloudflare keep the records **DNS only** (grey cloud), because
        proxying interferes with Netlify's certificate issuance.
      - If you add a `CAA` record, include `0 issue "letsencrypt.org"`
        (Netlify's issuer).
- [ ] Decide **apex vs www** as primary. This pack assumes the apex,
      `https://[your-domain]`, with `www` redirecting to it. If you
      choose `www`, replace every `https://[your-domain]` below with
      `https://www.[your-domain]`.
- [ ] Mailbox provider chosen and email DNS ready (EMAIL.md §1–2). Email
      can go live a day before or after the web switch, since the two
      are independent.

## 2. Register the new origin everywhere (T−0, before touching Netlify)

These are plain strings, so they can be entered before DNS resolves.
**Add, don't replace.**

### 2.1 Supabase Auth: URL configuration
Dashboard → Authentication → URL Configuration
(`supabase.com/dashboard/project/<project-ref>/auth/url-configuration`).

| Field | Action | Value |
|---|---|---|
| Redirect URLs | **add** | `https://[your-domain]/**` |
| Redirect URLs | **add** | `https://www.[your-domain]/**` (harmless; covers a visit before the www→apex redirect) |
| Redirect URLs | **keep** | `https://<site>.netlify.app/**` |
| Redirect URLs | **keep** | `http://localhost:5173/**`, `https://deploy-preview-*--<site>.netlify.app/**` |
| Redirect URLs | **confirm present** | `com.vantage.app://auth-callback` (item 42; `src/lib/native/authCallback.js:14-15`) |
| Site URL | **leave for now** | changes in step 5 |

Why: the client names the origin explicitly. OAuth uses
`window.location.origin` (`src/components/AuthScreen.jsx:147`); sign-up
and reset use `webOrigin()` (`AuthScreen.jsx:263,274`). Supabase
**silently** falls back to the Site URL when that origin isn't
allow-listed (STARTUP item 28).
Verify: the list shows the new entries. Rollback: delete them.

### 2.2 WHOOP developer dashboard
Add a second redirect URL to the existing app, keeping the first:

```
https://[your-domain]/.netlify/functions/whoop-callback      ← add
https://<site>.netlify.app/.netlify/functions/whoop-callback ← keep
```
Built by `netlify/lib/redirectUri.js:41-43` from `OAUTH_REDIRECT_BASE`,
then `URL`. Check that it is registered on **the same WHOOP app** whose
client id is in Netlify (`whoop-connect.js` echoes `clientId` for this
reason). **[unverified: WHOOP dashboard state; item 31 still open]**

### 2.3 Oura (item 30, not registered yet)
If the Oura app gets created on or after domain day, register **both**
redirect URIs at creation:
```
https://[your-domain]/.netlify/functions/oura-callback
https://<site>.netlify.app/.netlify/functions/oura-callback
```
**[unverified: whether Oura accepts more than one redirect URI. If it
takes only one, register the new domain and accept that connect works
only there, per rule 0.4.]**

### 2.4 Google Cloud console (Sign in with Google via Supabase)
**[unverified: whether the Google provider is configured yet. See the
prerequisites in `src/components/AuthScreen.jsx:164-178`]**
- **Authorized redirect URI:** `https://<project-ref>.supabase.co/auth/v1/callback`.
  **Unchanged.** Google redirects to Supabase, not to the site.
- **Authorized JavaScript origins:** add `https://[your-domain]` (keep
  the old one). Only client-side Google libraries need it, and it costs
  nothing.
- **OAuth consent screen / Branding:** move the home page, privacy policy
  and terms links to `https://[your-domain]/`, `/privacy` and `/terms`,
  and add `[your-domain]` under **Authorized domains**. Google first
  makes you prove ownership in Google Search Console (DNS TXT record).
  Changing branding on a published app can trigger brand
  re-verification, so do this in a quiet week, not mid-launch.

### 2.5 Apple (Sign in with Apple via Supabase)
- Services ID → Domains and Subdomains `<project-ref>.supabase.co`,
  Return URL `https://<project-ref>.supabase.co/auth/v1/callback`.
  **Unchanged.**
- **Sign in with Apple for Email Communication:** register the sending
  domain so email reaches `@privaterelay.appleid.com` users. See
  EMAIL.md §5. This needs SPF and only works once email DNS exists.

## 3. Netlify: custom domain + HTTPS (≈10 min plus DNS time)

1. Netlify → site → **Domain management → Add a domain** →
   `[your-domain]`. Netlify offers to add `www.[your-domain]` too; accept.
   **Treat this as the switch.** The first custom domain added usually
   becomes primary straight away **[unverified]**, and `URL` follows
   it (rule 0.5). That is why step 2 comes first.
2. Netlify DNS: add the zone and copy the 4 nameservers to the
   registrar. External DNS: create the records from §1.
3. **HTTPS:** Domain management → HTTPS → *Verify DNS configuration* →
   *Provision certificate* (Let's Encrypt, automatic once DNS resolves;
   can take minutes to hours after a nameserver change).
4. **Primary domain:** make sure `[your-domain]` is primary. With apex
   primary, `www` redirects to it automatically (and the other way round
   for a www primary) **[from Netlify docs via search]**.
5. Leave `*.netlify.app` alone (rule 0.2).

Verify:
```bash
dig +short [your-domain]; dig +short www.[your-domain]
curl -sI https://[your-domain]/ | head -5            # 200, strict-transport-security present
curl -sI https://www.[your-domain]/ | grep -i location   # 301 → https://[your-domain]/
curl -sI https://<site>.netlify.app/ | head -3        # still 200, NOT a 301 (rule 0.2)
curl -s  https://[your-domain]/.netlify/functions/health   # {"db":"ok",...}
curl -s  https://[your-domain]/.well-known/security.txt    # served (still placeholder until step 6)
```
Rollback: Domain management → remove the custom domain → redeploy
(`URL` goes back to `*.netlify.app`). Every allow-list kept the old
origin, so nothing else needs undoing.

### 3.1 HSTS
`netlify.toml:106` sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
on every response, and from now on on the apex too. Browsers that see
it will refuse plain HTTP on **every subdomain** of `[your-domain]` for
two years. Any future subdomain (status page, email click-tracking
domain) must therefore serve HTTPS. **Do not submit to hstspreload.org**
unless you decide to deliberately, because removal takes months. The
`preload` token does nothing until someone submits.

## 4. Verify the new origin before sending anyone to it

*Web gate (STARTUP_REQUIREMENTS item 131):* if the web is already
invite-only, the throwaway account in step 3 lands on the "Vantage is on
iPhone and Android" page after confirming — expected, and the
confirmation link check still holds. The heavy account in step 6 must be
on the allow-list (the owner always is). Public pages stay open.

1. Open `https://[your-domain]/privacy`, `/terms`, `/support` and
   `/delete-account` signed out. All four render (pre-auth routes,
   `src/lib/support.js:42`).
2. Sign in with email on `https://[your-domain]` in a **fresh browser
   profile**.
3. Sign up a throwaway account on the new origin. The confirmation link
   must return to `https://[your-domain]`, not the netlify.app Site URL.
   If it lands on the old host, step 2.1 didn't take.
4. Password reset from the new origin, same check.
5. `curl -sI https://<site>.netlify.app/` is still a 200 (rule 0.2).
6. **Data-safety check (required).** In a fresh profile on the new
   origin, sign in to a **heavy, real** account (the owner's, or a copy;
   CLAUDE.md asks for realistic heavy data). Wait for hydration. Confirm
   that habits, savings, vitalsLog, backgrounds and the profile photo are
   all present, and that no save of defaults happened (the account's
   `user_data.updated_at` should only move when you edit something).
   Then make one small edit and confirm it round-trips to the old origin
   in another tab. If anything looks empty, **stop**, don't proceed to
   step 5, and read `docs/RESTORE_RUNBOOK.md`.

## 5. Supabase Site URL

Dashboard → Authentication → URL Configuration → **Site URL** →
`https://[your-domain]`.

Why now and not earlier: the Site URL is the fallback for any redirect
that doesn't match the allow-list, and `{{ .SiteURL }}` in email
templates. Switch it only once the new origin is proven (step 4).
Verify: repeat 4.3. Rollback: set it back to `https://<site>.netlify.app`.

## 6. Code and config placeholders (one PR, one deploy)

Normal deploy flow (CLAUDE.md): `claude/*` branch → PR → merge. That
merge **is** the deploy that flips `URL` in functions (rule 0.5).

| File | Change |
|---|---|
| `src/lib/support.js:21` | `SUPPORT_EMAIL = 'support@[your-domain]'` |
| `src/lib/support.js:25` | `SECURITY_EMAIL = 'security@[your-domain]'` |
| `SECURITY.md:9-10` | `security@[your-domain]`; drop the "placeholder" note |
| `public/.well-known/security.txt:3-4,9` | `Contact: mailto:security@[your-domain]`; remove the PLACEHOLDER comment; add `Canonical: https://[your-domain]/.well-known/security.txt` (RFC 9116). `Policy:` (line 11) may stay on GitHub while the repo is public, or move to `https://[your-domain]/support`. Keep `Expires` in the future |
| `src/components/LegalPage.jsx:91,231` | `security@[domain — to be confirmed]` → the real address. Better: import `SECURITY_EMAIL` from `src/lib/support.js` so there's one source (today it is hard-coded in a `<Todo>`). Line 91 could also name `SUPPORT_EMAIL` instead of "the support email shown on the App's store listing". Line 90 (controller identity) is item 64, waiting on the company, not the domain |
| `index.html:16,17,24` | `og:url`, `og:image`, `twitter:image` → `https://[your-domain]/…` |
| `netlify.toml:155` (CSP) | add `https://[your-domain]` to `connect-src`, **keep** `https://vantagevision.netlify.app`. The entry exists for the native shell's `apiUrl()` base. On the web `'self'` already covers it, and the policy is Report-Only (item 60), so this can't break anything. No `frame-src` change: nothing is framed |
| `netlify/lib/foodSources.js:28`, `netlify/functions/food-search.js:31` | User-Agent contact URL → `https://[your-domain]` (Open Food Facts etiquette) |
| `src/lib/native/apiUrl.js:20` | `DEFAULT_API_BASE = 'https://[your-domain]'`, **before the first store binary is built**. Alternatively set `VITE_API_BASE=https://[your-domain]` in the native build env (`.env.example` documents it; it is already in `SECRETS_SCAN_OMIT_KEYS`). Binaries already in testers' hands keep calling netlify.app, which is why that host stays un-redirected |

Also, not domain-specific but found on the way:
`src/lib/friends/invites.js:26` builds invite URLs from
`window.location.origin`. Inside the Capacitor shell that is
`https://localhost` / `capacitor://localhost` (see the comment at
`src/lib/native/platform.js:36-43`), so invite links made in the app
would point nowhere. It should use `webOrigin()` from
`src/lib/native/platform.js:44`. **[unverified on a device]**

Optional: bump `CACHE_VERSION` in `public/sw.js:35` as usual. The new
origin has no service worker yet anyway.

Verify after the deploy:
1. `curl -s https://[your-domain]/.well-known/security.txt` shows the real address.
2. `/support` shows a working `mailto:` (`isPlaceholderEmail` now false).
3. **WHOOP:** Track → Vitals → WHOOP → Connect on `https://[your-domain]`.
   The panel and the function log line
   `whoop-connect: redirect_uri https://[your-domain]/.netlify/functions/whoop-callback`
   (`netlify/functions/whoop-connect.js:45`) must show the **new** host,
   and the round trip must finish with `?whoop=connected`. If WHOOP says
   `invalid_request`, step 2.2 is missing. The panel has a Copy button
   for the exact string (STARTUP item 31).
4. Security console alert links: `appBase()` uses `APP_URL`, then
   `OAUTH_REDIRECT_BASE`, then `URL` (`netlify/lib/alertNotify.js:95`).
   Press "Send test alert" and check that the ntfy link opens
   `https://[your-domain]/?upgrade=security`.

Rollback: revert the PR (Netlify → publish previous deploy is instant).

## 7. Outside services that hold a URL

| Where | Field | Value | When |
|---|---|---|---|
| Uptime monitor (item 77; service not named in repo) | check URL | **add** `https://[your-domain]/.netlify/functions/health`; **keep** a second check on `https://<site>.netlify.app/.netlify/functions/health` while anything still uses it | day 0 |
| RevenueCat → Integrations → Webhooks | URL | `https://[your-domain]/.netlify/functions/revenuecat-webhook` (comment template at `netlify/functions/revenuecat-webhook.js:16`). Same `REVENUECAT_WEBHOOK_AUTH` header. Send a test event and confirm a 200 in the function log | day 0–14; old host keeps working meanwhile |
| Security agent routine (`docs/SECURITY_AGENT.md:57-61,86`) | base URL | `https://[your-domain]` | when convenient |
| Apple Health Shortcut (owner-only) | URL | regenerate with **New URL** on the new origin (`VitalsHistoryCard.jsx:93`) and paste it into the Shortcut. The old URL keeps working until then | when convenient |
| App Store Connect | Support URL / Marketing URL / Privacy Policy URL | `https://[your-domain]/support` · `https://[your-domain]/` · `https://[your-domain]/privacy` | before submission |
| Google Play Console | Website / Email / Privacy policy / Account deletion URL | `https://[your-domain]` · `support@[your-domain]` · `/privacy` · `https://[your-domain]/delete-account` | before submission |
| Apple age-rating "Age Suitability URL" | | `https://[your-domain]/terms` (`docs/STORE_SUBMISSION_PACK.md:320`) | before submission |
| Firebase (item 15) | nothing | FCM has no domain setting; Firebase Auth/Hosting and the retired Dynamic Links aren't used | — |
| Netlify env | `APP_URL`, `OAUTH_REDIRECT_BASE` | leave **unset** so both follow `URL`. Set `OAUTH_REDIRECT_BASE` only if WHOOP refuses to take the new URI, and remember rule 0.4 | — |
| Google Search Console | property | add `[your-domain]` (also needed for 2.4) | day 0 |

## 8. Update the records (same PR as step 6, or right after)

Find these by item number. Other sessions edit the file, so line
numbers drift.
- `STARTUP_REQUIREMENTS.md`: tick the "Re-check this the day a custom
  domain is added" sub-item under **28** and "Re-check on the day a custom
  domain is added" under **31**. Change the Oura redirect URI in **30**
  and the WHOOP one in **31** to list both URIs. Change the Running costs
  table's **Domain** row (`vantagevision.netlify.app`, £0) to the
  registrar and price. Mark **72** and **76** done once the inboxes
  exist (EMAIL.md), and note **94** (SMTP).
- `docs/STORE_SUBMISSION_PACK.md`, `docs/STORE_PRIVACY_LABELS.md` and
  `docs/WEARABLE_APPROVALS.md`: replace the netlify.app URLs and
  `[domain]` placeholders listed in `INVENTORY.md` §A3.
  `WEARABLE_APPROVALS.md` asks for the privacy URL in the WHOOP/Oura
  forms to be updated "the same day".
- `docs/ONLINE_SAFETY_ACT_DRAFT.md:746`: `[support@domain]`.

## 9. Later (2+ weeks after, once nothing calls the old host by name)

Only when: every native build in testers' hands uses the new base, the
RevenueCat webhook and uptime monitor have moved, the Shortcut has been
regenerated, and WHOOP has the new URI. Then add a **page-only**
redirect from the old host. As a snippet for `netlify.toml`, placed
**before** the SPA catch-all at `netlify.toml:62-65`:

```toml
# Old host: keep functions and well-known files where they are; send
# people (pages) to the custom domain.
[[redirects]]
  from = "https://vantagevision.netlify.app/.netlify/*"
  to   = "/.netlify/:splat"
  status = 200
  force  = true      # [unverified] confirm this self-rewrite doesn't loop; test on a deploy preview
[[redirects]]
  from = "https://vantagevision.netlify.app/.well-known/*"
  to   = "/.well-known/:splat"
  status = 200
  force  = true
[[redirects]]
  from = "https://vantagevision.netlify.app/*"
  to   = "https://[your-domain]/:splat"
  status = 301
  force  = true
```
`public/_redirects` holds the same SPA fallback (`/* /index.html 200`),
and the two files must agree. Netlify redirect matching with
host-qualified `from` and the function-path passthrough are
**[unverified]**: test on a branch deploy first, with
`curl -sI -X POST https://vantagevision.netlify.app/.netlify/functions/health`.

Before this redirect goes live:
- Do step 4.6 again.
- Accept that installed home-screen PWAs (`public/manifest.json`
  `start_url: "/"`) stay bound to the old origin. On iOS a standalone
  PWA that navigates off-origin shows a browser bar. Tell users to
  re-add Vantage from the new address.
- Any `vb4_pending` edit still sitting on the old origin is lost
  (rule 0.3). It is a small window (edits from the last ~1.5 s before
  a tab was closed), but it is user data, so announce the move in-app a
  few days ahead so users open the app normally (which flushes the
  pending edit) before the redirect lands.

Don't remove `https://<site>.netlify.app/**` from Supabase, or the old
WHOOP/Oura URI, for months, and only after logs show no traffic.

---

## The 30-minute run sheet

| # | Step | Min |
|---|---|---|
| 1 | Supabase redirect URLs: add new origin (2.1) | 3 |
| 2 | WHOOP: add new redirect URI (2.2); Oura if registering (2.3) | 4 |
| 3 | Google origins + consent links (2.4), if the provider is live | 4 |
| 4 | Netlify: add domain, DNS, HTTPS (3) | 5 (+ DNS wait) |
| 5 | curl checks; fresh-profile sign-in/sign-up/reset; heavy-account check (3, 4) | 6 |
| 6 | Supabase Site URL (5) | 1 |
| 7 | Merge the placeholders PR (6); verify WHOOP, security.txt, alerts | 5 |
| 8 | Uptime monitor; RevenueCat webhook (7) | 2 |

If DNS or the certificate is slow, stop after row 3. Rows 1–3 are
harmless on their own, and the rest can wait until `dig` and the cert
are green.

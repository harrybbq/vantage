## What and why

<!-- One paragraph: what this changes and what it's for. -->

## Pre-merge checklist

Tick what applies, delete what doesn't. Anything unticked needs a reason.
(STARTUP_REQUIREMENTS item 81.)

### Data safety — always
- [ ] State writes are **additive** — new keys only; nothing replaces or clears the whole `state`.
- [ ] No load path can seed defaults over real data. Nothing wipes or resets state on a new client build.
- [ ] New store in `S`? It counts as meaningful: `src/lib/state/meaningful.js` (`hasMeaningfulData` / `MEANINGFUL_IGNORE`) **and** `vb_state_meaningful` in SQL agree. Seeded/derived keys go on both ignore lists.
- [ ] Server-side state writes go through `netlify/lib/stateWrite.js` (compare-and-set on `updated_at`), never a blind PATCH.

### SQL (`supabase/*.sql`)
- [ ] New table → `enable row level security` + policies, and `references auth.users(id) on delete cascade` on every user-scoped column (or `on delete set null` where the row must outlive the account, with the reason in a comment).
- [ ] New table/column → explicit grants. Server-owned columns (tier, ratings, prestige, `suspended_at`…) are **not** granted to `authenticated`.
- [ ] New view → `with (security_invoker = true)`.
- [ ] New `security definer` function → `set search_path = ''` (or `public`), and `revoke execute … from public, anon` (plus `authenticated` unless it's meant to be called by clients).
- [ ] Additive only: no `drop`, no `update`/`delete` of existing rows, no destructive migration. Re-runnable (`if not exists`, `drop … if exists` before `create`).
- [ ] Client code fails soft until the owner has run the SQL (a 400/404 behaves exactly like today).
- [ ] After the owner runs it: **Supabase → Advisors** (security + performance) checked and clean.

### Netlify functions (`netlify/functions/*`)
- [ ] Per-user endpoint → `requireUser` (`netlify/lib/requireUser.js`); owner-only → `isOwnerEmail(auth.email)` (`netlify/lib/owner.js`), never a client claim.
- [ ] Rate limit: `underLimit`/`tooMany`; anything that spends money (AI) → `withinDailyAiCap` (`netlify/lib/aiQuota.js`).
- [ ] Error bodies are generic. No DB error text, stack, or env var names in responses.
- [ ] No `Cache-Control: public` on anything user-specific.
- [ ] Fetches a user-supplied URL → `assertPublicUrl` (`netlify/lib/ssrfGuard.js`).
- [ ] Any new secret is a Netlify env var (never `VITE_*`), and is added to the rotate table in `docs/INCIDENT_RUNBOOK.md`.
- [ ] Scheduled/cross-user function → `requireScheduler` (`netlify/lib/cronAuth.js`).

### Client
- [ ] Every function call goes through `authFetch(path)` or `fetch(apiUrl(path))` from `src/lib/authFetch.js` — never a bare `fetch('/.netlify/functions/…')` (it works on the web and 404s in the native app).
- [ ] No user text in `innerHTML`/`outerHTML` without escaping (`escapeHtml` / `safeUrl` in `src/components/HubSection.jsx`). Prefer JSX.
- [ ] Owner-only surface? Compiled out of the native build, and checked server-side.
- [ ] User-generated text shown to strangers is filtered (`checkPublicText`, `netlify/lib/nameFilter.js`) and reportable.

### UI
- [ ] Verified in a Playwright harness with **realistic heavy data**, at 360px and desktop. No horizontal overflow; sheets scroll inside and the backdrop stays tappable.
- [ ] Harness files (`harness.html`, `src/harness-main.jsx`) deleted.

### Deploy
- [ ] `npm run build` passes (lint + every `check:*` + vite).
- [ ] `public/sw.js` changed, or clients must move to this build → `CACHE_VERSION` bumped.
- [ ] SQL the owner must run is named here, with the order.

## SQL to run (if any)

<!-- e.g. supabase/foo.sql — run BEFORE merging / after merging -->

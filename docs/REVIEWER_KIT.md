# Reviewer kit: demo accounts, Pro for reviewers, and the pre-submission check

STARTUP_REQUIREMENTS items 116 and 122, and the operational half of item 73.
Written 2026-10-20. The *why* behind each account and screen is in
`docs/STORE_SUBMISSION_PACK.md` §1. This page lists the steps.

**Never put a demo password, a service key or a real address in the
repo.** Demo credentials go only in App Store Connect → App Review
Information and Play Console → App content → App access.

## The accounts

| | Role | Pro how | Seed |
|---|---|---|---|
| **A** `reviewer-pro@…` | The account reviewers explore | `reviewer_access_add(…, grant_pro => true)` makes it **lifetime**, which a webhook can never demote | Full: 8 weeks of trackers, 4 habits, vitals, savings, trips, wish list, 14 days of food, friends, DMs, a group |
| **B** `reviewer-free@…` | Tests buying Pro with a sandbox account | **Buys it.** On the reviewer list, so its sandbox purchase reaches `profiles.tier` | Light, with exactly **five habits** (the free cap), so a sixth opens the paywall |
| **C, D** `demo-friend-1@…`, `-2@…` | Friends for A, so a reviewer can DM, report and block without touching a real user | Free | Light |

All four must be fictional people on a company mailbox (item 72's domain).

## Order of operations

**4–6 weeks before submitting.** Ratings count history only from the day
the account was created (item 44). Seeded history older than that exists
in the account but does not lift the rating card.

1. **Run the SQL once** (Supabase SQL editor), in this order, with each
   file's VERIFY block after it:
   1. `supabase/reviewer_access_2026_10.sql`: the reviewer list, the
      webhook check, `review_preflight()`
   2. `supabase/apple_revocation_2026_10.sql` (item 117, independent of
      the rest; see `docs/SIGN_IN_WITH_APPLE.md`)
2. **Create and seed the accounts**, from a terminal with the repo checked
   out. Do a dry run first (no `--write`):

   ```sh
   export SUPABASE_URL='https://<project>.supabase.co'
   export SUPABASE_SECRET_KEY='<service key>'   # this shell only — never in a file
   export DEMO_ACCOUNT_PASSWORD='<strong password>'   # only needed with --create

   node scripts/reviewer-demo/seed.mjs \
     --allow reviewer-pro@co,reviewer-free@co,demo-friend-1@co,demo-friend-2@co \
     --pro reviewer-pro@co --free reviewer-free@co \
     --friend demo-friend-1@co --friend demo-friend-2@co \
     --create            # prints the plan, writes nothing

   # …then the same command with --write
   ```

   What it will and won't do:
   - It touches **only** addresses in `--allow`, and refuses owner
     addresses (`OWNER_EMAIL`).
   - It reads every account's `user_data` first. If any row holds data
     the seeder did not write itself, the run **stops before writing
     anything**. A fresh row, an empty row, a row with only first-sign-in
     defaults, or the seeder's own earlier row (`demoSeed`) can be written.
   - The state write is compare-and-set. Food log, friendships, messages
     and the group are added only where none exist. It never deletes
     anything and never sets `tier`.
   - The weekly-goal coin flags are seeded to match the history, so
     ticking a past day doesn't pay out a week that was already met.
   - **Use `--create`.** It makes confirmed accounts that all share
     `DEMO_ACCOUNT_PASSWORD`, so the seeder is the first thing to write
     their data. Without `--create` the accounts must already exist. But an
     account that has already been signed into in the app has usually saved
     its own first state (a name, consent answers, widgets), and the seeder
     will then **refuse it**, by design: it can't tell a demo account from
     a real one by its data. If that happens with a demo account you made
     minutes ago, delete it in Supabase → Authentication → Users and run
     again with `--create`. Never do this to an account you didn't just
     create.
   - Sign in to the accounts only **after** seeding. If a browser had
     signed in before, clear its site data first: a browser holding an older
     local copy of the account goes through the app's merge on its next save.
3. **Give access** (SQL editor):

   ```sql
   select public.reviewer_access_add('reviewer-pro@co',  90, true,  'A: Pro demo');
   select public.reviewer_access_add('reviewer-free@co', 90, false, 'B: buys Pro in sandbox');
   select * from public.reviewer_access_list();
   ```

   A row stops honouring sandbox purchases when it expires (90 days at
   most; run `add` again to extend). Expiry does **not** remove A's
   lifetime grant. `reviewer_access_remove('…')` does, and puts back the
   tier the account had before.
4. **Use the accounts a little each week** until submission: tick a
   tracker, log a meal. Leave AI consent unasked on A (store pack §1.2).
   Don't connect WHOOP or Oura to any demo account.

## Before every submission

1. `select * from public.review_preflight();` in the SQL editor, or
   `node scripts/reviewer-demo/preflight.mjs` with the two env vars above.
   Every row should say `ok = true`. It checks:
   - `config.pro_live` is `'true'` (P3). It prints the exact `update` to run if not.
   - The reviewer list has active rows, each valid for 7+ more days.
   - Each account exists, is confirmed, is 28+ days old, has the expected
     tier (A lifetime), is off the leaderboard and handle search, and has
     seeded data.
   - The Apple revocation table exists.
2. **Netlify env** (Site configuration → Environment variables, Functions
   scope). The preflight can't read these, so check them by hand:
   - `REVENUECAT_WEBHOOK_AUTH` is set (the webhook refuses everything without it).
   - `REVENUECAT_SECRET_API_KEY` is set (item 123).
   - `REVENUECAT_ALLOW_SANDBOX` is **unset**. It is the old global switch:
     it honours every sandbox purchase with no end date. The reviewer list
     replaces it.
   - Optional: `REVIEW_WINDOW_UNTIL` = an ISO date **no more than 30 days
     ahead**, for example `2026-12-15`. Until then, sandbox purchases count
     for **any** account. That covers a reviewer who signs in with their
     own Apple ID instead of account B. It closes by itself. A date further
     than 30 days out is treated as a mistake and ignored. Set it when you
     press Submit, and leave it to lapse.
   - `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`,
     `APPLE_SERVICES_ID`, `APPLE_TOKEN_SECRET` (item 117).
3. Fill in the review notes (store pack §1.5) with A's and B's
   credentials, in the store consoles only.

## How a reviewer's purchase unlocks Pro (item 116)

`netlify/functions/revenuecat-webhook.js` → `netlify/lib/reviewSandbox.js`:

| Event | Honoured when |
|---|---|
| Production | Always, as before |
| Sandbox | The account is on the active reviewer list, with a confirmed email (one service-role RPC, `reviewer_sandbox_allowed`, called only for sandbox events) |
| Sandbox | **or** `REVIEW_WINDOW_UNTIL` is in the future and at most 30 days ahead |
| Sandbox | **or** `REVENUECAT_ALLOW_SANDBOX=true` (legacy; logs a warning every time it is used) |
| Sandbox | Otherwise skipped (200 `skipped: sandbox`), as before |

Failures close the gate rather than open it: if the reviewer SQL hasn't
been run, or the RPC errors, sandbox events are skipped. With
`REVENUECAT_SECRET_API_KEY` set, sandbox-backed entitlements are also left
out of the subscriber read unless sandbox is honoured for that event, so a
TestFlight purchase can't decide a production tier.

Sandbox subscriptions renew on a fast clock and stop after a few renewals.
The `EXPIRATION` that follows puts B back to free, which is correct. A is
lifetime, so nothing a reviewer buys on A can demote it.

## After approval

- Leave the accounts as they are for the next review (recommended), or
  `reviewer_access_remove(...)` each one.
- Unset `REVIEW_WINDOW_UNTIL` if it is still in the future.

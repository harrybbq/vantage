# Restore runbook

How to get user data back, from the smallest tool to the biggest, and
how to practise it. (STARTUP_REQUIREMENTS items 27 and 82.)

A backup that has never been restored is a hope, not a backup.

Never paste a user's email, id, state or bundle into chat, a ticket or
an issue.

---

## Pick the path

```
What is wrong?
│
├─ ONE user, and only their saved state (user_data.state) is wrong,
│  and the damage is newer than their oldest history snapshot
│     → PATH 1: in-place restore from user_data_history          (minutes, nobody else affected)
│
├─ ONE or a FEW users, and it's other tables (food diary, DMs,
│  measurements, workouts…), their backgrounds/photo, or older than
│  their 14 history snapshots
│     → PATH 2: restore a COPY of the database + one-user recovery
│       (daily backup today: up to a day old · with PITR: any second)
│                                                                 (an hour or two, nobody else affected)
│
└─ MANY users, or the database itself is corrupted (a migration or
   bulk job went wrong for everyone)
      → PATH 3: whole-project restore                             (LAST RESORT: everyone loses
        (daily backup or PITR)                                     everything after the target time)
```

Rules that hold on every path:

- **Production is never overwritten from a backup to fix one person.** Paths 1 and 2 only write to the affected user's rows. Path 3 is the only thing that rolls everyone back, so both owners decide it together.
- **Read the marks first.** `public.ops_log` says what ran and when, which tells you where to restore to (see "Restore markers" below).
- **Storage is never in a database backup** (Supabase's docs: *"Database backups do not include objects you store via the Storage API"*). Files in the `cv`, `recipes`, `avatars` and backgrounds buckets come back on no path. Restoring an old backup doesn't bring back files deleted since.
- If it came from an incident, it goes in the breach log (`docs/INCIDENT_RUNBOOK.md` §8). Losing personal data, even with nobody else seeing it, can be a reportable breach (§6, the ICO's 72 hours).

---

## Restore markers (`ops_log`)

`supabase/recovery_2026_10b.sql` adds `public.ops_log`: an append-only
list of operations. RLS is on with no client policies. Nobody can update
or delete a mark: the grants are revoked and a trigger refuses it even
for the table owner. Marks are written with
`public.ops_mark(kind, label, details)`, which returns the mark's time.

**Why:** PITR can restore to any second, but only if you know *which*
second. The answer is "just before X started". `ops_log` is where X's
start time is written down.

### The convention: every owner-run SQL file marks its start and end

Every new file in `supabase/` begins with this, after its header comment
and `begin;`:

```sql
do $$ begin
  perform public.ops_mark('sql', '<filename>.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;
```

and ends with the same block saying `'<filename>.sql — done'`, just
before `commit;`. The `exception` clause makes it fail soft: a file still
runs on a database where `recovery_2026_10b.sql` hasn't been applied.
`recovery_2026_10b.sql` itself is the example. Marks use
`clock_timestamp()`, so the start and done of one transaction get
different times. A file that fails and rolls back leaves no marks,
because nothing happened.

### Mark by hand

```sql
select public.ops_mark('restore', 'PITR enabled, 7 days');
select public.ops_mark('note', 'about to bulk-fix ratings for 40 users', '{"ticket": "S-12"}');
```

Kinds in use: `sql`, `migration`, `job`, `recovery`, `restore`,
`drill`, `note`. Never put a raw user id, an email or any user content in
a label or in `details`: the log outlives account deletion. Recovery
marks carry a one-way `user_ref`
(`select public.recovery_user_ref('<uuid>')` to check one).

### From functions

`netlify/lib/opsMark.js`:
`await opsMark('migration', 'state-size I4 batch 3 — start', { users: 200 })`.
It uses the service key through `sbKeys`, times out after 2.5 s, and
**never throws**. Before the SQL is applied it logs one line and returns
null. It isn't wired into anything yet. Add a call when you next touch:

- each phase of the state-size migration (`docs/STATE_SIZE_PLAN.md`): `'<phase> — start'` before the first write, `'<phase> — done'` after. Batch number and counts go in details.
- the retention job (item 96), once per run, with row counts.
- any bulk operation that writes many users' rows (backfills, cleanups, re-scoring), before it starts.

### Read them

```sql
select id, at, kind, label, actor, details
from public.ops_log
where at > now() - interval '8 days'
order by at desc;
```

---

## Path 1 — one user's state, from `user_data_history`

Put one user's `user_data.state` back from a snapshot in
`public.user_data_history`. This is fast, touches nobody else, and
needs no backup.

### What the history table holds

`supabase/user_data_history_schema.sql` adds a `BEFORE UPDATE` trigger on
`user_data` (`vb_snapshot_user_data`). It copies the **old** state into
`public.user_data_history`:

| Column | Meaning |
|---|---|
| `id` | bigint, the snapshot's own id |
| `user_id` | the user (`auth.users.id`) |
| `state` | the state as it was **before** the update |
| `reason` | `'pre-wipe'` (the update was about to replace real data with an empty-looking state), `'daily'`, or `'bundle-restore'` (added by path 2) |
| `snapshot_at` | when it was taken |

Know its limits before you need it:

- **A snapshot is taken only when the OLD state was meaningful** (`vb_state_meaningful`), and then only if the NEW state is not meaningful (`pre-wipe`) or the last snapshot is more than 20 hours old (`daily`). Most saves take no snapshot.
- **Only the newest 14 per user are kept.** Each new snapshot deletes anything older.
- **`backgrounds` is stripped** from every trigger snapshot, and `profile.photo` is nulled. Neither can be restored from those snapshots. A `bundle-restore` snapshot from path 2 keeps backgrounds.
- **Not in state, so not here at all:** `nutrition_log` (food diary), `messages`, `profiles`, group data, `whoop_tokens`/`oura_tokens`, and Storage files. Those take path 2.
- Keys differ: `user_data.id` is the user id; in the history table it's `user_data_history.user_id`.

The profile photo lives in its own column, `user_data.photo`, and the app
saves `profile.photo` as null inside `state`. So a restore of `state`
leaves the photo exactly as it is. **Don't touch the `photo` column**
here. Path 2 has a guarded one-liner for a lost photo.

Run each step in the Supabase SQL editor (it runs as `postgres`, which bypasses RLS).
Replace `<uuid>` with the user's id and `<snap-id>` with the snapshot id.

### 0. Before anything

- [ ] Log it in the breach log if it came from an incident (`docs/INCIDENT_RUNBOOK.md` §8).
- [ ] Ask the user to **close the app on every device** (or sign out) until you say it's done. An open app holding the bad state is the most likely thing to undo your work.
- [ ] Have the other owner read each statement before you run it.

### 1. Find the user and the snapshots

```sql
-- The user id (only if you don't have it already).
select id from auth.users where lower(email) = lower('<their-email>');

-- The row as it is now. COPY updated_at_exact verbatim — step 5 needs it
-- to the microsecond, and the editor's normal display may round it.
select id, updated_at::text as updated_at_exact, pg_column_size(state) as bytes,
       public.vb_state_meaningful(state) as meaningful
from public.user_data where id = '<uuid>';

-- Their snapshots, newest first.
select id, reason, snapshot_at, pg_column_size(state) as bytes,
       public.vb_state_meaningful(state) as meaningful
from public.user_data_history
where user_id = '<uuid>'
order by snapshot_at desc;
```

Usually the right one is the newest `pre-wipe`, or the last `daily`
before the damage. After path 2, it's the `bundle-restore` row the
import reported.

### 2. Preview: compare snapshot and current, store by store

```sql
with snap as (select state from public.user_data_history where id = <snap-id> and user_id = '<uuid>'),
     cur  as (select state from public.user_data where id = '<uuid>'),
     k    as (select jsonb_object_keys(state) as key from snap
              union select jsonb_object_keys(state) from cur)
select k.key,
       case jsonb_typeof(snap.state -> k.key)
         when 'array'  then jsonb_array_length(snap.state -> k.key)::text || ' items'
         when 'object' then (select count(*) from jsonb_object_keys(snap.state -> k.key))::text || ' keys'
         else left(snap.state ->> k.key, 30) end as in_snapshot,
       case jsonb_typeof(cur.state -> k.key)
         when 'array'  then jsonb_array_length(cur.state -> k.key)::text || ' items'
         when 'object' then (select count(*) from jsonb_object_keys(cur.state -> k.key))::text || ' keys'
         else left(cur.state ->> k.key, 30) end as now
from k, snap, cur
order by k.key;
```

Look for the stores that matter (`vitalsLog`, `logs`, `habits`, `savings`,
`subscriptions`, `bodyLog`, `burnLog`, …). If "now" has entries newer
than the snapshot for some store, a straight restore loses them. See
"Partial restore" below.

### 3. Keep copies of both, outside the history table

The history table trims itself to 14 rows, and the restore's own update
may add a snapshot and trim the oldest. That could be the one you are
restoring from. So copy both sides somewhere safe first.

```sql
-- One-off holding table. RLS on, no policies: service role only.
-- Cascades with the account, so it can't outlive a deletion.
create table if not exists public.restore_holding (
  held_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source  text not null,          -- 'current' or 'snapshot:<id>'
  state   jsonb not null
);
alter table public.restore_holding enable row level security;
revoke all on public.restore_holding from anon, authenticated;

insert into public.restore_holding (user_id, source, state)
select id, 'current', state from public.user_data where id = '<uuid>';

insert into public.restore_holding (user_id, source, state)
select user_id, 'snapshot:' || id, state
from public.user_data_history where id = <snap-id> and user_id = '<uuid>';

select source, held_at, pg_column_size(state) from public.restore_holding where user_id = '<uuid>';
```

Expect two rows. Don't go on until you see them.

### 4. What the trigger will do on the restore

The restore is an UPDATE, so the trigger runs. It snapshots the current
state **only if** the current state is meaningful **and** the last
snapshot is over 20 hours old. **Don't count on it.** Step 3 is the copy
you rely on.

### 5. Restore — one UPDATE, guarded

```sql
update public.user_data u
set state = case
              when u.state ? 'backgrounds'
                then h.state || jsonb_build_object('backgrounds', u.state -> 'backgrounds')
              else h.state
            end,
    updated_at = now()
from public.user_data_history h
where u.id = '<uuid>'
  and h.id = <snap-id>
  and h.user_id = u.id
  and u.updated_at = '<updated_at_exact from step 1>'
returning u.id, u.updated_at, pg_column_size(u.state) as bytes;
```

- **Guarded by id.** `u.id` and `h.user_id = u.id` mean it can only ever touch this one user, and only with their own snapshot.
- **Guarded by `updated_at`.** If a device saved since step 1, it returns **0 rows** and changes nothing. Go back to step 1. If you're sure nothing saved and it still returns 0 rows, the pasted timestamp lost precision: re-run step 1 and paste `updated_at_exact` again.
- **`backgrounds` carried over** from the current row when it still has them. Otherwise the snapshot's are used: trigger snapshots have none, `bundle-restore` snapshots do. If neither has them, only path 2 can bring them back.
- **`updated_at = now()`.** Any device still open with the old version gets a conflict on its next save and three-way merges, instead of writing its old copy over the restore.

Expect exactly one row back.

### 6. Check, then tell the user

```sql
select updated_at, pg_column_size(state), public.vb_state_meaningful(state)
from public.user_data where id = '<uuid>';
```

- [ ] Ask the user to open the app on one device and check their data.
- [ ] Then the other devices.
- [ ] Profile photo still there (it was never touched).

### 7. Clean up

After the user has confirmed, and no later than 30 days:

```sql
delete from public.restore_holding where user_id = '<uuid>';
-- When it's empty and no restore is in progress:
-- drop table public.restore_holding;
```

Holding copies are personal data. Don't keep them longer than needed.

### Partial restore (one store only)

If only one store was damaged (say `vitalsLog`) and the rest is newer
than the snapshot, restore that one key:

```sql
update public.user_data u
set state = jsonb_set(u.state, '{vitalsLog}', h.state -> 'vitalsLog'),
    updated_at = now()
from public.user_data_history h
where u.id = '<uuid>' and h.id = <snap-id> and h.user_id = u.id
  and h.state ? 'vitalsLog'
  and u.updated_at = '<updated_at_exact from step 1>'
returning u.id, u.updated_at;
```

Use the same steps 0–3 and 6–7 around it.

---

## Path 2 — one or a few users, from a copy

Restore a **copy** of the database to a time before the damage, take
that user's rows out of the copy, and add back to production only what's
missing. Nobody else is touched.

**Full procedure: `scripts/recovery/README.md`.** In short:

1. **Create the copy:** Dashboard → Database → Backups → **Restore to a New Project**. Pick a daily backup from before the damage (today), or, with PITR, the exact second before the damage's start mark in `ops_log`.
2. **Make it safe:** unschedule any `pg_cron` jobs and disable webhooks *in the copy*. If it predates `recovery_2026_10b.sql`, run that file in the copy.
3. **Export** in the copy: `select public.export_user_bundle('<uuid>', '<which backup / PITR time>');` → `bundle.json`. Use psql for anything over about 1 MB.
4. **Dry run** in production: `select public.import_user_bundle(<bundle>);`. This reports per table what would be inserted, what conflicts with newer production rows (production always wins), and what would be skipped. It keeps nothing.
5. **Review** with the user. Anything they deleted on purpose after the backup is "missing" too.
6. **`restore_missing`** in production. It inserts missing rows by primary key and never updates or deletes. Rows that involve another person (DMs, friendships, blocks, groups) only come back when named in `p_tables`. Tokens never come back.
7. **State:** the bundle's state was added as a `bundle-restore` history snapshot, never written over the live row. Bring it back with **path 1** using that snapshot id. **Photo:** a guarded one-liner fills it only if production's is empty.
8. **Verify,** then **delete the copy** the same day. It holds every user's data, password hashes included.

What it can't do: bring back Storage files; match a user who deleted
their account and signed up again (new id); or restore a row whose
parent belongs to someone who has since deleted their account (reported
as `failed`, foreign key).

---

## Path 3 — whole-project restore (last resort)

Rolls back **the whole project** to time **T**, for everyone. Everything
any user did after T is lost. The project is **down** while it runs, and
the downtime grows with the database size. Use it only when the damage
is too wide for path 2: a migration or bulk job that hit everyone, or a
corrupted database.

### Before

- [ ] **Both owners agree** it's path 3. Write down why path 2 won't do.
- [ ] **Breach log entry and ICO clock.** Losing everyone's recent data is a personal-data breach (availability). Assess within 72 hours: `docs/INCIDENT_RUNBOOK.md` §6, and record it in §8 even if not reported.
- [ ] **With PITR on, keep the newer data first (strongly recommended):** *Restore to a New Project* at the **latest** point, and wait for it to finish. After production is rolled back, that copy still holds everything written after T. Path 2 can then bring individual users' newer rows back. With daily backups only, there is no copy of "now". Consider `pg_dump` of the affected tables if the database is still readable.
- [ ] **Pick T from the marks.** The damaging operation's `'— start'` mark gives the time; T is a moment before it:
  ```sql
  select at, kind, label, actor from public.ops_log where at > now() - interval '8 days' order by at desc;
  ```
  Daily backups only: choose the newest backup taken before T. Supabase: *"choose the closest available backup made before your desired restore point."*
- [ ] **Write down what will be lost**, using these queries (run before the restore, while the data still exists):
  ```sql
  -- SQL files run after T: they must be re-run afterwards, in this order.
  select at, label from public.ops_log where kind = 'sql' and at > '<T>' and label like '%— done' order by at;
  -- Accounts created after T: they will not exist any more. Keep the list
  -- in the breach-log store (not chat) so they can be told to sign up again.
  select count(*) from auth.users where created_at > '<T>';
  -- Wearable connections refreshed after T: those refresh tokens have
  -- rotated at WHOOP/Oura, so the restored ones are dead — these users reconnect.
  select 'whoop' as p, count(*) from public.whoop_tokens where updated_at > '<T>'
  union all select 'oura', count(*) from public.oura_tokens where updated_at > '<T>';
  -- Tier changes after T: profiles.tier rolls back; re-sync from RevenueCat.
  select id, tier, tier_updated_at from public.profiles where tier_updated_at > '<T>';
  -- Saves after T (how many users lose something).
  select count(*) from public.user_data where updated_at > '<T>';
  ```
  What else is lost or differs:
  - **Everything after T, for everyone:** state saves, food diary, DMs, friendships, reports, group changes, ratings, the moderation queue.
  - **Storage is not restored:** files uploaded after T stay, and files deleted after T stay deleted.
  - **Health-sync URLs:** anyone who tapped **New URL** after T is back on the old token. Tell those users to tap New URL again.
  - **Push tokens** registered after T are lost. The app re-registers on the next open.
  - **RevenueCat:** purchases, renewals and cancellations processed after T are gone from `profiles.tier`. There is no Stripe integration. *Unverified: whether RevenueCat can replay past webhook events. If it can't, re-apply tiers by hand from RevenueCat → Customers.*
  - **Custom role passwords** must be reset after a restore (Supabase docs). Vantage's SQL creates no custom roles; check with `select rolname from pg_roles where rolcanlogin and rolname !~ '^(postgres|supabase|authenticator|pgbouncer|pgsodium|dashboard_user|cli_login)';`.
  - **Replication:** Realtime's slot is handled automatically. Other subscriptions or slots must be dropped before and re-created after. None exist in the repo's SQL.
- [ ] **Announce and pause.** Tell users (email, social, an in-app notice if one can ship) that the app is going into maintenance, and that changes made after `<T>` will be lost. Then pause: set `VANTAGE_PAUSE=all` on Netlify and **trigger a deploy**. That's `docs/INCIDENT_RUNBOOK.md` §3 "Pause an area"; env changes only apply on deploy. `VANTAGE_PAUSE` doesn't stop the app's direct Supabase traffic (state saves, DMs). The restore makes the project unreachable anyway.
- [ ] **Open devices after the restore:** an app left open holds post-T state. On its next save, the compare-and-set check fails, because the row's `updated_at` is now older, and the app three-way merges its copy back in (`src/hooks/useVisionBoardState.js`). That recovers people's recent changes, unless the damage came *from* clients. In that case, keep users out until a fixed build is live (§3 options).

### Do it

- **Daily backup:** Dashboard → **Database → Backups → Scheduled backups** → the chosen backup → **Restore**, then confirm.
- **PITR:** Dashboard → **Database → Backups → Point in Time** → **Start a restore** → pick T (inside the earliest–latest window) → review → confirm. Or with the Management API (needs a personal access token from Account → Access Tokens):
  ```bash
  curl -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups/restore-pitr" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d '{"recovery_time_target_unix": "<T as unix seconds>"}'
  ```
- Wait for the dashboard's "restoration complete" notice.

### After

- [ ] **Mark it** (marks written during the lost window are gone too, so record it again):
  `select public.ops_mark('restore', 'whole-project restore to <T> complete', '{"lost_from": "<T>", "lost_to": "<restore start>"}');`
- [ ] **Re-run the SQL files** from the list above, in order. They're all re-runnable. Then run **Supabase → Advisors** (security and performance).
- [ ] **Checks:** `select max(updated_at) from public.user_data;` is about T. The `/.netlify/functions/health` endpoint answers. Sign in as the test account on web and phone, and confirm data loads and a save works.
- [ ] **Lift the pause:** delete `VANTAGE_PAUSE` and trigger a deploy.
- [ ] **Tell users** what window was lost. Ask wearable users from the list to reconnect WHOOP/Oura, and health-sync users who rotated after T to tap New URL. Accounts created after T need to sign up again.
- [ ] **Tiers:** re-sync the listed users with RevenueCat.
- [ ] **With the "latest" copy:** bring back individual users' post-T rows with path 2. Users who need it, or ask, first. Then delete that copy.
- [ ] **ICO decision** recorded (§6). Post-mortem (§7). Breach log (§8).

---

## What holds user data

Every table with a foreign key to `auth.users` or `profiles`, from
`supabase/*.sql` (2026-10-20), plus the two tables created in the
dashboard (`user_data`, `tracker_streaks`). The policy column is what
path 2's `restore_missing` does with it (`recovery_table_policy()` in
`supabase/recovery_2026_10b.sql`; any table added later shows up as
`review` until classified there).

| Table | Holds | Defined in | Path 2 policy |
|---|---|---|---|
| `user_data` | `state` (everything in `S`) + `photo` + `updated_at` | dashboard | state → history snapshot; photo → guarded step |
| `user_data_history` | 14 state snapshots per user | `user_data_history_schema.sql` | review |
| `nutrition_log` | food diary | `nutrition_schema.sql` | restore |
| `nutrition_macros`, `nutrition_daily_summary` | macro goals, daily totals | `nutrition_schema.sql` | restore |
| `nutrition_macro_targets`, `body_weight_log`, `body_measurements`, `training_sessions`, `training_sets`, `rota_config` | recomp tracker | `recomp_schema.sql` | restore |
| `tracker_streaks` | streaks | dashboard (FK fixed in `security_hotfix_2026_09_30.sql`) | restore |
| `rating_snapshots` | rating history | `leaderboard_schema.sql` | restore |
| `coach_nudges` | AI coach nudges | `coach_nudges_schema.sql` | restore |
| `profiles` | handle, tier, ratings, presence | `paywall_schema.sql` + `social_schema.sql` | review (server-owned tier/ratings) |
| `public_stats` | what friends see | `social_schema.sql` | review |
| `friendships`, `blocks`, `reports` | social graph, safety | `social_schema.sql` | review (involve another person) |
| `messages`, `message_reactions`, `friend_invites` | DMs, reactions, invite links | `messages_schema.sql`, `dm_upgrade_2026_10.sql` | review |
| `groups`, `group_members`, `coin_grants` | groups and league payouts | `groups_schema.sql` | review |
| `food_contributions`, `food_contribution_reports` | shared food database | `food_contributions_schema.sql` | review |
| `waitlist` | waitlist sign-ups | `paywall_schema.sql` | review |
| `whoop_tokens`, `oura_tokens` | wearable OAuth tokens | `whoop_schema.sql`, `oura_schema.sql` | never (stripped from bundles; tokens rotate, so reconnect) |
| `bank_connections` | (unused; Open Banking is on the back burner) | `bank_connections_schema.sql` | never |
| `push_tokens`, `notifications_queue` | push devices, queued pushes | `push_tokens_schema.sql`, `notifications_schema.sql` | never (re-registered; queued pushes would re-fire) |
| `ai_usage` | AI allowance counters | `audit_schema_2026_10.sql` | never |
| `client_errors`, `security_tickets` | crash reports, security tickets (user link `on delete set null`) | `audit_schema_2026_10.sql`, `security_console_2026_10.sql` | not exported |
| `recovery_bundles`, `restore_holding` | recovery working copies | `recovery_2026_10b.sql`, path 1 step 3 | not exported |
| `daily_log`, `state_archive` | per-day logs, archived keys (once item 26 lands) | `state_size_DRAFT_not_run.sql` | restore |
| `daily_log_history`, `media_ledger` | log journal, image originals ledger | `state_size_DRAFT_not_run.sql` | review |
| `client_builds`, `app_config_users`, `daily_log_backfill_runs` | migration bookkeeping | `state_size_DRAFT_not_run.sql` | never |

Not in any database backup: **Storage objects** (`cv`, `recipes`,
`avatars`, backgrounds buckets; and `media` once item 25 lands).
Owner-only tables without a user column (`books_*`, `owner_content*`,
`config`, `league_weeks`, `web_vitals`) come back only with the whole
project.

---

## When to have PITR on

**Decision (owner, 2026-10-20):** yes.

- **On for the state-size migration window.** Turn it on **before the image migration** (`docs/STATE_SIZE_PLAN.md` I4, the first phase that rewrites every user's row). Keep it on until **30 days after the last cleanup batch** (L7). This is the one stretch where a bug touches everyone's row. Daily backups would lose up to a day for everyone, and path 2 would be guessing which second to aim at.
- **Recommended permanently from public launch.** With strangers' health data and data safety as rule #1, "up to a day lost" isn't an answer to give a user. RPO with PITR is at most 2 minutes (Supabase: WAL archived every two minutes, sooner under load).
- Until then, daily backups plus paths 1 and 2 are the plan, and they work today.

What it costs and changes (Supabase docs, checked 2026-10-20 —
https://supabase.com/docs/guides/platform/backups and
https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery):

| | Daily backups (now) | PITR, 7 days |
|---|---|---|
| Price | included in Pro | **$0.137/hour ≈ $100/month**, billed per hour (a part-hour bills a full hour) |
| Spend cap | — | **not covered by the spend cap** |
| Restore points | one per day, last 7 days | any second in the last 7 days |
| Worst-case loss (RPO) | up to ~24 h | ≤ 2 min |
| Needs | Pro | Pro + at least **Small** compute (we're on Small, item 88) |
| Daily backups | yes | **stop** while PITR is on (*"If you enable PITR, we will no longer take Daily Backups"*) |
| Restore to a new project (path 2) | from a daily backup | from any PITR point |

14 days costs about $200/month and 28 days about $400/month. 7 is enough
for us. After PITR is turned off, new backups are physical only and
can't be downloaded directly. Use `pg_dump` / `supabase db dump` for a
file.

---

## Buying PITR — checklist

- [ ] **Read the current price** on the dashboard before confirming. The table above is from 2026-10-20.
- [ ] Dashboard → the project → **Project Settings → Add-ons** → **Point in Time Recovery** → choose **7 days** → confirm. The docs link it as `settings/addons?panel=pitr`.
- [ ] **Confirm what changed:** Database → Backups → **Point in Time** shows an earliest and latest recovery point (the latest can lag when nothing is happening). Daily backups have stopped, so don't expect new ones in the Scheduled tab.
- [ ] **Record it:** `select public.ops_mark('restore', 'PITR enabled — 7 days', '{"price_per_hour_usd": 0.137}');` and a line in STARTUP_REQUIREMENTS item 27.
- [ ] **Budget:** the add-on is outside the spend cap. Add ~$100/month to "Running costs" in STARTUP_REQUIREMENTS and set a billing alert.
- [ ] **Privacy wording:** update `docs/DPIA_DRAFT.md` row 23 (backups) and the erasure note (deleted data stays in PITR history for up to 7 days, the same window as daily backups today). Check the privacy policy's "permanently erased within 30 days" still holds (`src/components/LegalPage.jsx` §11). It does at 7 days. Re-check if retention ever goes above 28 days. Mention it to the solicitor with DPIA question 10.
- [ ] **Run the drill** (below) with a PITR copy within the first week, so the first real use isn't the first use.
- [ ] **Turning it off** (after the migration window, if not launched): `ops_mark('restore', 'PITR disabled')`, revert the costs line, and confirm daily backups resume (Scheduled tab, the next day).

---

## Drill (item 82)

Once a quarter, both owners, about an hour. Use a **test account** you
own, never a real user. The drill uses a free daily backup, so it costs
only the copy's few hours of compute.

**Prepare (the day before)**

- [ ] Sign in as the test account on a phone and a browser. Add entries in `vitalsLog`, `habits`, `savings`, a few food diary entries, a body measurement, and set a background and a profile photo.
- [ ] Make one more edit. The first save after an account holds real data takes a `daily` snapshot. Check path 1 step 1 shows a row.
- [ ] Note a few exact values to compare later (a weight, a meal name, a habit).
- [ ] `select public.ops_mark('drill', 'drill <date> — data ready');`
- [ ] Wait for the next daily backup (Database → Backups lists it).

**Damage it on purpose**

- [ ] Delete a habit and a week of vitals (state), two food diary entries and the measurement (tables), and remove the photo.

**Recover it, with a timer running**

- [ ] **Path 1** for the state: steps 0–7, exactly as written. Try the `updated_at` guard once: run step 5 with a stale `updated_at_exact` and confirm it returns 0 rows.
- [ ] **Path 2** for the tables and photo, from the daily backup: `scripts/recovery/README.md` steps 1–9. Dry run first. Confirm it reports exactly the deleted rows as `insert` and nothing else. Then `restore_missing`, then the photo step.
- [ ] Stop the timer when the test account shows everything back on **both** devices.
- [ ] Check: background still there, photo back, nothing else lost, no other account touched (`select label, details from public.ops_log where kind = 'recovery' order by at desc limit 5;`).
- [ ] **Delete the copy project.** Delete `bundle.json`.
- [ ] `select public.ops_mark('drill', 'drill <date> — done');`
- [ ] Record below. If any step was wrong or unclear, fix this file or the README in the same week.

| Date | Who | Backup / PITR point used | Path 1 time | Path 2 time (copy created → user confirmed) | Copy cost | Problems found | Runbook fixed? |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

When PITR is on, alternate: one drill from a PITR point (pick the second
from the `— data ready` mark), the next from a daily-backup-age point.
Once the state-size migration has run, add its own drills
(`docs/STATE_SIZE_PLAN.md` §7: one picture from `media_ledger`, one day
from `daily_log_history`, one key from `state_archive`).

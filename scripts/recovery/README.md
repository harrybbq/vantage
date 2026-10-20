# One-user recovery from a backup or PITR copy

Bring back ONE person's rows from an older copy of the database without
rolling anyone else back. This is path 2 of `docs/RESTORE_RUNBOOK.md`.
Read that first to make sure this is the right path.

It uses two functions from `supabase/recovery_2026_10b.sql`:

| Function | Run it in | What it does |
|---|---|---|
| `export_user_bundle(user_id, note)` | the **copy** | Returns one JSON "bundle": every row of that user in every user-scoped table, their `user_data` row (state, photo, updated_at), and their auth id, email and created_at for matching. It never includes password hashes. OAuth and push tokens are stripped. |
| `import_user_bundle(bundle, mode, tables, allow_email_mismatch)` | **production** | `'dry_run'` (the default) reports what would happen and keeps nothing. `'restore_missing'` **inserts** rows that are missing by primary key, and does nothing else. It never updates or deletes a row. It **never overwrites `user_data.state`**: the bundle's state becomes a new `user_data_history` snapshot instead. |

Both are SQL-editor only. They're revoked from `anon`, `authenticated`
and `service_role`.

Never paste a bundle, an email or a user id into chat, a ticket or an
issue. A bundle holds someone's whole health and money history. Treat
the file like a password, and delete it at the end.

---

## Before you start

- [ ] Both owners agree this is the right path (runbook decision tree).
- [ ] Logged in the breach log if it came from an incident (`docs/INCIDENT_RUNBOOK.md` §8).
- [ ] Know the user's id. In **production**: `select id, email, created_at from auth.users where lower(email) = lower('<their-email>');`
- [ ] Know the time you want (call it **T**): just before the damage. Look in the marks: `select at, kind, label from public.ops_log where at > now() - interval '8 days' order by at desc;`
- [ ] Ask the user to **close the app on every device** until you say it's done.

---

## Step by step

### 1. Create the copy

Supabase dashboard → the **production** project → **Database → Backups**
→ the **Restore to a New Project** tab.

- **Daily backups (today):** pick the newest backup taken **before T**. Pro keeps the last 7 days.
- **PITR (once it's on):** use the date and time picker to choose **T** to the second.

Supabase creates a separate project. Per its docs (checked 2026-10-20,
https://supabase.com/docs/guides/platform/clone-project):

- **What's copied:** the database schema and data, roles and permissions, and `auth` users (including password hashes).
- **What's NOT copied:** Storage files and bucket settings, Edge Functions, Auth settings and API keys, Realtime settings, and read replicas.
- **Where:** the same region as the source, with the same compute size (Small), disk, SSL and network settings.
- **Cost:** a new project billed like any other. The dashboard shows the cost before you confirm. At Supabase's list price, Small compute is about $15/month (about $0.02 an hour), so a copy kept for a few hours costs pennies. *Unverified: whether the copy is billed for a minimum period or picks up add-ons such as PITR. Read the overview screen before confirming.*
- **Limits:** the feature is in beta. It needs physical backups on the source, which this project has. A copy can't itself be cloned.
- **How long:** depends on the database size.

While it builds, write down the backup or PITR time you chose. You'll
use it as the bundle's note.

### 2. Make the copy safe, then check the functions are there

In the **copy's** SQL editor:

```sql
-- Anything that reaches the outside world must not run from the copy.
select extname from pg_extension where extname in ('pg_net', 'pg_cron', 'wrappers');
-- If pg_cron is there, list its jobs and unschedule them in the COPY only:
--   select jobid, jobname, schedule from cron.job;
--   select cron.unschedule(<jobid>);
-- Database → Webhooks in the copy's dashboard: disable any that exist.

-- Does the copy already have the export function?
select to_regprocedure('public.export_user_bundle(uuid,text)') is not null as has_export;
```

If `has_export` is false, the copy is from before
`supabase/recovery_2026_10b.sql` was run. **Run that file in the copy**
(paste it into the copy's SQL editor). It's additive and changes no
rows.

Nothing in the app points at the copy, because it has its own URL and
keys. Don't give it to anything.

### 3. Export the user's bundle (in the copy)

Check the size first:

```sql
select b -> 'manifest' as manifest, pg_column_size(b) as bytes
from (select public.export_user_bundle('<uuid>', '<daily backup 2026-10-19 02:00 UTC | PITR 2026-10-20 14:03:00 UTC>') b) x;
```

The manifest gives a row count per table, the policy for each table, the
state size, and `copy_hints`. `copy_hints` holds the copy's newest ops
mark and newest save, so you can confirm the copy sits where you meant.

- **Under about 1 MB:** run `select public.export_user_bundle('<uuid>', '<note>');`, copy the single cell, and save it as `bundle.json` on your machine. Check the copy is whole: the file must parse as JSON (`node -e "JSON.parse(require('fs').readFileSync('bundle.json','utf8'))"`).
- **Over about 1 MB, or if the copied value won't parse:** use `psql` instead (see "Big bundles" below). *Unverified: the dashboard SQL editor's exact limit on result size. Heavy accounts carry 0.5–1 MB of state today (item 25), so assume the CLI for real users.*

### 4. Dry run in production

In the **production** SQL editor, put the whole bundle between
dollar quotes. A `$bundle$` tag is safe even if the JSON contains `'`:

```sql
select jsonb_pretty(public.import_user_bundle($bundle${ …paste bundle.json here… }$bundle$::jsonb));
```

Or with `psql` (see below). A dry run writes nothing except one
`ops_log` mark.

### 5. Review the report

- **`ok: false` / `refused`:** stop. The id isn't in production, the email differs, or the input isn't a bundle. If the user really did change their email after T, confirm who they are another way (sign-in to the app, the support thread). Then add `p_allow_email_mismatch => true`. A *re-created* account has a new id. That's not something this tool matches; do it by hand with both owners.
- **`totals`:** `insert` is how many rows would come back. `conflict_production_kept` counts rows that exist in production with different values; production is always kept. `failed` should be 0.
- **`tables.<name>`:** per table:
  - `insert`, `already_present`, `conflict_production_kept`
  - `skipped_other_unique`: missing by primary key but colliding on another unique key, e.g. a measurement logged again on the same day. It's left alone.
  - `failed` (with sqlstate and a sample primary key)
  - `not_selected`: a `review` table you didn't name
  - `not_this_user`: a row in the bundle that isn't theirs. Should be 0.
- **`user_data.status`:** whether the state differs. It reports byte sizes, `vb_state_meaningful` on both sides, and backgrounds on both sides. The `photo` line says whether the lost photo can be restored.
- **Ask the user** about anything they might have deleted on purpose after T. A meal they removed, or a DM they deleted, is "missing" too, and `restore_missing` would bring it back. If so, narrow the tables (step 6).

What each table's policy means:

| Policy | Tables | restore_missing |
|---|---|---|
| `restore` | `nutrition_log`, `nutrition_macros`, `nutrition_macro_targets`, `nutrition_daily_summary`, `body_weight_log`, `body_measurements`, `training_sessions`, `training_sets`, `rota_config`, `tracker_streaks`, `rating_snapshots`, `coach_nudges`, `daily_log`*, `state_archive`* | inserted by default |
| `review` | `profiles`, `user_data_history`, `messages`, `message_reactions`, `friendships`, `blocks`, `reports`, `friend_invites`, `groups`, `group_members`, `coin_grants`, `food_contributions`, `food_contribution_reports`, `public_stats`, `waitlist`, `media_ledger`*, `daily_log_history`*, and **any table not classified yet** | only when named in `p_tables`. These involve another person or server-owned state: re-inserting a friendship or block could undo the *other* person's choice. |
| `never` | `whoop_tokens`, `oura_tokens`, `bank_connections`, `push_tokens`, `notifications_queue`, `ai_usage`, `client_builds`*, `app_config_users`*, `daily_log_backfill_runs`* | never. Tokens have rotated, so the user reconnects. Queued pushes would re-fire. Counters reset themselves. |

\* exists only once the state-size migration's SQL has run.

The list is found from the database itself: every `public` table with a
foreign key to `auth.users` or `profiles`. A table added later appears
automatically as `review` until it's classified in
`recovery_table_policy()`.

### 6. Restore the missing rows

```sql
-- Default: the 'restore' tables only.
select jsonb_pretty(public.import_user_bundle($bundle$…$bundle$::jsonb, 'restore_missing'));

-- Or exactly the tables you name (review tables included only if named):
select jsonb_pretty(public.import_user_bundle($bundle$…$bundle$::jsonb, 'restore_missing',
                                              array['nutrition_log', 'messages']));
```

It's safe to run twice. Rows already restored count as
`already_present`, and the history snapshot isn't added again. The
report's `recovery_bundle_id` names the row in `public.recovery_bundles`
that holds the bundle and its report. You'll use it next, so you don't
have to paste the bundle again.

### 7. State and photo: deliberate, separate steps

**State.** If `user_data.status` says a snapshot was added, its
`history_snapshot_id` is a normal `user_data_history` row that holds the
bundle's full state, backgrounds included. Bring it back with
`docs/RESTORE_RUNBOOK.md` **path 1, steps 1–7**, using that snapshot id.
That's the guarded UPDATE with the `updated_at` check and the holding
copies. Step 5 there keeps the *current* backgrounds when the current
row still has them, and otherwise takes the snapshot's. Do it within a
few days: the history table keeps the newest 14 snapshots per user.
`recovery_bundles` keeps another copy until you delete it.

**Photo.** If the report says `production has none — restorable`:

```sql
update public.user_data u
   set photo = b.bundle -> 'user_data' ->> 'photo'
  from public.recovery_bundles b
 where b.id = <recovery_bundle_id>
   and u.id = b.user_id
   and u.photo is null              -- never replaces a photo they set since
returning u.id;
```

### 8. Verify

```sql
-- Counts now, for the tables the report restored:
select count(*) from public.nutrition_log where user_id = '<uuid>';
-- The marks of this recovery:
select at, label, details from public.ops_log where kind = 'recovery' order by at desc limit 5;
```

- [ ] The user opens the app on one device, checks, then the others.
- [ ] Anything in `failed` understood and dealt with by hand, or accepted.

### 9. Clean up, the same day if possible

- [ ] **Delete the copy:** copy project → **Settings → General → Delete project**. It holds every user's data, including password hashes. Billing stops when it's deleted.
- [ ] Delete `bundle.json` everywhere you saved it, including Downloads and the clipboard history.
- [ ] Once the user confirms, and within 30 days: `delete from public.recovery_bundles where id = <recovery_bundle_id>;`
- [ ] Mark it: `select public.ops_mark('recovery', 'one-user recovery closed', '{"copy_deleted": true}');`
- [ ] Write a line in the drill log (if it was a drill) or the breach log (if it was an incident).

---

## Big bundles: psql

Get each project's connection string from the dashboard (**Connect**
button → *Session pooler* or *Direct connection*, URI form). Keep them
in your shell, not in a file in the repo:

```bash
export COPY_DB_URL='postgresql://postgres.<copy-ref>:<password>@<host>:5432/postgres'
export PROD_DB_URL='postgresql://postgres.<prod-ref>:<password>@<host>:5432/postgres'
```

Export from the copy into a file, then check it:

```bash
psql "$COPY_DB_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "select public.export_user_bundle('<uuid>', 'PITR 2026-10-20 14:03:00 UTC')" > bundle.json
node -e "const b=JSON.parse(require('fs').readFileSync('bundle.json','utf8'));console.log(b.manifest)"
```

Import into production. psql reads the file itself, which works at any
size. A shell `-v bundle="$(cat …)"` argument fails above 128 kB.

```bash
cat > import.sql <<'SQL'
\set bundle `cat bundle.json`
select jsonb_pretty(public.import_user_bundle(:'bundle'::jsonb, :'mode'));
SQL
psql "$PROD_DB_URL" -X -At -v ON_ERROR_STOP=1 -v mode=dry_run -f import.sql > report-dry-run.json
# review it, then:
psql "$PROD_DB_URL" -X -At -v ON_ERROR_STOP=1 -v mode=restore_missing -f import.sql > report-restore.json
```

For named tables, change the select in `import.sql` to
`public.import_user_bundle(:'bundle'::jsonb, :'mode', array['nutrition_log','messages'])`.

`scripts/recovery/test-recovery-sql.sh` runs this exact `\set … cat`
path against a 1 MB bundle.

The reports contain row keys and error text. Delete them with the
bundle.

---

## Tests

```bash
bash scripts/recovery/test-recovery-sql.sh
```

This needs the Postgres 16 server binaries (`/usr/lib/postgresql/16/bin`,
or set `PGBIN`). It builds a throwaway cluster and runs the real
`recovery_2026_10b.sql` and `user_data_history_schema.sql` against
minimal copies of the user tables. It seeds heavy synthetic data (about a
450 kB state and 2,000 food rows), drifts a "production" clone, then
checks export → dry_run → restore_missing → re-run → refusals → grants.
It isn't in `npm run build`, because the build machine has no Postgres.
`check:opsmark` is.

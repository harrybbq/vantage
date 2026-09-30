# Restore runbook — one user's state

How to put one user's `user_data.state` back from a snapshot in
`public.user_data_history`, and how to practise it.

(STARTUP_REQUIREMENTS items 82 and 27.)

A backup that has never been restored is a hope, not a backup.

---

## What the history table holds

`supabase/user_data_history_schema.sql` adds a `BEFORE UPDATE` trigger on
`user_data` (`vb_snapshot_user_data`). It copies the **old** state into
`public.user_data_history`:

| Column | Meaning |
|---|---|
| `id` | bigint, the snapshot's own id |
| `user_id` | the user (`auth.users.id`) |
| `state` | the state as it was **before** the update |
| `reason` | `'pre-wipe'` (the update was about to replace real data with an empty-looking state) or `'daily'` |
| `snapshot_at` | when it was taken |

Know its limits before you need it:

- **A snapshot is taken only when the OLD state was meaningful** (`vb_state_meaningful`), and then only if the NEW state is not meaningful (`pre-wipe`) or the last snapshot is more than 20 hours old (`daily`). Most saves take no snapshot.
- **Only the newest 14 per user are kept.** Each new snapshot deletes anything older.
- **`backgrounds` is stripped** from every snapshot, and `profile.photo` is nulled. Neither can be restored from here.
- **Not in state, so not here at all:** `nutrition_log` (food diary), `messages`, `profiles`, group data, `whoop_tokens`/`oura_tokens`, Storage files (`cv`, `recipes` buckets). Those only come back from a Supabase backup.
- Keys differ: `user_data.id` is the user id; in the history table it's `user_data_history.user_id`.

The profile photo lives in its own column, `user_data.photo`, and the app
saves `profile.photo` as null inside `state`. So a restore of `state`
leaves the photo exactly as it is. **Don't touch the `photo` column.**

---

## Restore one user

Run each step in the Supabase SQL editor (it runs as the service role).
Replace `<uuid>` with the user's id and `<snap-id>` with the snapshot id.
Never paste the user's email or state into chat.

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

Usually the right one is the newest `pre-wipe`, or the last `daily` before the damage.

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
than the snapshot for some store, a straight restore loses them — see
"Partial restore" below.

### 3. Keep copies of both, outside the history table

The history table trims itself to 14 rows, and the restore's own update
may add a snapshot and trim the oldest — possibly the one you are
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

The restore is an UPDATE, so the trigger runs. It will snapshot the
current state **only if** the current state is meaningful **and** the
last snapshot is over 20 hours old. **Don't count on it.** Step 3 is the
copy you rely on.

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

- **Guarded by id** — `u.id` and `h.user_id = u.id` mean it can only ever touch this one user, and only with their own snapshot.
- **Guarded by `updated_at`** — if a device saved since step 1, it returns **0 rows** and changes nothing. Go back to step 1. If you're sure nothing saved and it still returns 0 rows, the pasted timestamp lost precision — re-run step 1 and paste `updated_at_exact` again.
- **`backgrounds` carried over** from the current row, because the snapshot doesn't have them. If the current row has lost them too, they're gone from here — only a Supabase backup has them.
- **`updated_at = now()`** — any device still open with the old version gets a conflict on its next save and three-way merges, instead of writing its old copy over the restore.

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

Same steps 0–3 and 6–7 around it.

---

## When history isn't enough

`backgrounds`, `nutrition_log`, messages, a user with no snapshot (brand
new, or never meaningful), or damage older than 14 snapshots. Then the
only source is a Supabase backup.

- A dashboard restore replaces the **whole database** — every user goes
  back in time. Never do that to fix one person.
- To recover one user: restore the backup into a **separate scratch
  project**, copy that one user's rows across by id, then delete the
  scratch project.

---

## PITR decision notes (item 27)

To decide deliberately, not during an incident.

**What we have now**

- `user_data_history`: per-user, up to 14 snapshots, instant to restore, but no images and nothing outside `state`.
- Supabase's daily backups on the paid plan (item 27 records 7 days of daily backups on Pro). Restore granularity: whole database, up to a day old.

**What PITR adds**

- Restore to any second within the retention window, including `nutrition_log`, `backgrounds`, messages.
- Still a whole-database restore — the same "scratch project" route for one user.

**What it costs**

- A paid add-on. Check current pricing and whether it needs a larger compute size than Micro before deciding.

**Questions to answer**

1. How much data can we afford to lose for one user? (Today: up to a day for anything outside `state`, and all `backgrounds` if both the row and history lose them.)
2. Does item 25 (images out of `state` into Storage) happen first? Storage objects aren't covered by database PITR either.
3. After the 2026-05-03 wipe and with data safety as rule #1, is a day of loss acceptable once real users arrive?

**Decision:** _(record here — date, who, what, why)_

---

## Quarterly restore drill

Once a quarter, both owners, about 30 minutes. Use a **test account**
you own, never a real user.

- [ ] Sign in as the test account on a phone and a browser. Add a few entries in `vitalsLog`, `habits`, `savings`, and set a background.
- [ ] Make one more edit after that. The first save after an account holds real data takes a `daily` snapshot when none exists yet; after that, one a day at most. Check step 1 shows a row before going on.
- [ ] Note a few exact values to compare against later.
- [ ] Damage it on purpose: delete a habit and a week of vitals in the app.
- [ ] Start a timer. Follow steps 0–7 above, exactly as written.
- [ ] Stop the timer when the test account shows the old data on **both** devices.
- [ ] Check: background still there, photo still there, nothing else lost.
- [ ] Try the `updated_at` guard once: run step 5 with a stale `updated_at_exact` and confirm it returns 0 rows.
- [ ] Record below. If any step was wrong or unclear, fix this file in the same week.

| Date | Who | Snapshot age | Time to restore | Problems found | Runbook fixed? |
|---|---|---|---|---|---|
| | | | | | |

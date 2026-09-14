-- ── Group pictures, and who is allowed to see them ───────────────────────
--
-- Run this in the Supabase SQL Editor after groups_schema.sql. Until it
-- is applied the picture controls stay hidden and everything else in the
-- Groups tab carries on working — the client treats a missing column as
-- "no picture", same as it treats a missing table as "no group".
--
-- ── What this adds ───────────────────────────────────────────────────
-- A group leader can give the group a picture. That picture is visible
-- to strangers, which is the whole problem: a division board is a public
-- surface, and the first thing an open image field on a public surface
-- attracts is the image you would least like to host.
--
-- So a picture has a STATUS, and only an approved one is public:
--
--   none      no picture set
--   pending   uploaded, not yet cleared — visible to the group's own
--             members only, so the leader can see what they uploaded
--   approved  cleared, visible to everyone
--   rejected  refused, visible to the group's own members with the
--             reason, so "why is my crest not showing" has an answer
--
-- Screening runs on upload (see netlify/functions/groups.js) and a human
-- can overturn either way from the review queue. With no screening
-- configured a picture stays `pending`, which is the fail-closed
-- direction: the cost is a leader waiting, not a stranger seeing.
--
-- ── And a hole this closes on the way ────────────────────────────────
-- groups_schema.sql grants `select` on the whole `groups` table to every
-- authenticated user. That table has an `invite_code` column, and the
-- groups are invite-ONLY — so any signed-in user could read every
-- group's code and let themselves into any of them. Row policies gate
-- rows, not columns; the fix is column grants, exactly as
-- profiles_column_lockdown.sql did for the same mistake.
--
-- Idempotent — safe to re-run.

-- ── 1. The columns ────────────────────────────────────────────────────
alter table public.groups
  -- A small data URL (the client resizes to 160px and encodes JPEG,
  -- ~10-20 KB), which is how profiles.avatar_url already works. No
  -- Storage bucket, no bucket policies, nothing new to get wrong.
  add column if not exists crest_image       text,
  add column if not exists crest_status      text not null default 'none',
  -- Why it was refused, shown to the leader. Never shown to strangers.
  add column if not exists crest_note        text,
  add column if not exists crest_updated_at  timestamptz,
  add column if not exists crest_reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_crest_status_check'
  ) then
    alter table public.groups
      add constraint groups_crest_status_check
      check (crest_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

-- The review queue is read oldest-first and is normally empty, so a
-- partial index keeps it free.
create index if not exists groups_crest_pending_idx
  on public.groups (crest_updated_at)
  where crest_status = 'pending';

-- ── 2. Column lockdown ────────────────────────────────────────────────
-- What a signed-in user may read directly. Everything else about a group
-- — its invite code, and any picture that has not been cleared — is
-- assembled by the `groups` function with the service key, which knows
-- who is asking and can decide what they are allowed to see.
--
-- crest_status stays readable so a client can render "picture pending"
-- without a round trip; it says nothing about the picture itself.
revoke select on public.groups from authenticated, anon;
grant select (
  id, name, crest_color, owner_id, division, created_at, crest_status
) on public.groups to authenticated;

-- Writes were already service-role only (no insert/update/delete policy
-- exists on purpose — see groups_schema.sql), and nothing here changes
-- that. Stated rather than assumed:
revoke insert, update, delete on public.groups from authenticated, anon;

-- ── 3. Verify ─────────────────────────────────────────────────────────
-- Expect five crest_* columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'groups'
  and column_name like 'crest%'
order by column_name;

-- Expect exactly the seven granted columns, and NOT invite_code.
select column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'groups'
  and grantee = 'authenticated' and privilege_type = 'SELECT'
order by column_name;

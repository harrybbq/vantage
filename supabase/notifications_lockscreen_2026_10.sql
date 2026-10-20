-- ============================================================
-- Lock-screen-safe push text at the source (item 104, DPIA G8)
-- Run in the Supabase SQL Editor AFTER notifications_schema.sql.
-- Idempotent — safe to re-run. OPTIONAL: push-dispatch.js already
-- replaces every queued title/body with fixed, generic text
-- (netlify/lib/lockScreenSafe.js), so pushes are safe without this.
--
-- What it changes: the two friendship triggers stop writing the other
-- person's display name and handle into notifications_queue.payload.
-- The queue row keeps only the id the app needs to open the right
-- screen. Less personal data sitting in a table for 30 days, and the
-- first writer of a new push kind copies a safe pattern.
--
-- Data safety: CREATE OR REPLACE FUNCTION only. No table, column, row
-- or policy is changed or deleted. Existing queue rows are left as
-- they are (they age out after 30 days via retention_prune).
--
-- Check afterwards:
--   select pg_get_functiondef('public.enqueue_friend_request_push'::regproc) ilike '%display_name%';  -- expect false
--   select pg_get_functiondef('public.enqueue_friend_accept_push'::regproc)  ilike '%display_name%';  -- expect false
-- ============================================================

create or replace function public.enqueue_friend_request_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into notifications_queue (user_id, kind, payload)
    values (
      new.addressee_id,
      'friend-request',
      jsonb_build_object(
        'title', 'New friend request',
        'body',  'Open Vantage to see who it is.',
        'requester_id', new.requester_id
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_friend_accept_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending'
     and new.status = 'accepted'
     and old.accepted_at is null then
    insert into notifications_queue (user_id, kind, payload)
    values (
      new.requester_id,
      'friend-accepted',
      jsonb_build_object(
        'title', 'Friend request accepted',
        'body',  'Open Vantage to see your friends.',
        'friend_id', new.addressee_id
      )
    );
  end if;
  return new;
end;
$$;

-- The triggers themselves (trg_friendships_enqueue_request / _accept)
-- already point at these functions; nothing to re-create.

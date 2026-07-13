-- ============================================================
-- Vantage — Direct Messages schema
-- Run in the Supabase SQL Editor AFTER social_schema.sql.
-- Idempotent — safe to re-run.
--
-- 1:1 messaging between ACCEPTED friends only. RLS does all the
-- authorisation: you can read a message iff you're the sender or the
-- recipient, and you can only send to someone who is an accepted
-- friend and hasn't blocked you (and whom you haven't blocked).
-- ============================================================

create table if not exists messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);

-- Thread lookups (both directions) + fast unread counts.
create index if not exists messages_sender_recipient_time_idx
  on messages (sender_id, recipient_id, created_at);
create index if not exists messages_recipient_sender_time_idx
  on messages (recipient_id, sender_id, created_at);
create index if not exists messages_recipient_unread_idx
  on messages (recipient_id) where read_at is null;

alter table messages enable row level security;

-- Read: only the two participants.
drop policy if exists messages_select on messages;
create policy messages_select on messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Insert: sender must be you; recipient must be an accepted friend;
-- neither party may have blocked the other.
drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ( (f.requester_id = auth.uid() and f.addressee_id = recipient_id)
           or (f.requester_id = recipient_id and f.addressee_id = auth.uid()) )
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = recipient_id and b.blocked_id = auth.uid())
         or (b.blocker_id = auth.uid()      and b.blocked_id = recipient_id)
    )
  );

-- Update: only the recipient, and only to mark-as-read in practice.
drop policy if exists messages_update on messages;
create policy messages_update on messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Delete: a sender can unsend their own message.
drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete
  using (auth.uid() = sender_id);

-- Optional: enable Supabase Realtime broadcasts for live threads. The
-- client also polls while a thread is open, so this is a pure
-- enhancement — uncomment if you want instant delivery.
-- alter publication supabase_realtime add table messages;

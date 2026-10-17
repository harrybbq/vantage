-- ============================================================================
-- Friends & DMs upgrade — October 2026
-- ============================================================================
-- Run in the Supabase SQL editor AFTER messages_schema.sql,
-- security_hotfix_2026_09_30.sql and audit_schema_2026_10.sql.
-- One transaction: if any statement fails, nothing changes. Re-runnable —
-- every statement is IF NOT EXISTS, CREATE OR REPLACE, or guarded.
--
-- Additive only. NO existing row is updated or deleted, and no existing
-- column is dropped or retyped. What it adds:
--
--   messages.reply_to          new nullable column (+ FK, NOT VALID, so no
--                              scan of existing rows) and a same-conversation
--                              guard on insert
--   message_reactions          new table: six fixed emoji, one row per
--                              (message, user, emoji)
--   dm_conversations()         inbox RPC — one row per conversation partner
--   friend_invites             new table + create/preview/accept RPCs
--   friendships.via_invite     new column, default false (metadata-only add)
--   Realtime                   messages + message_reactions joined to the
--                              supabase_realtime publication (guarded);
--                              RLS on realtime.messages for the private
--                              typing channel (guarded)
--   reports                    evidence trigger: the last 10 DMs between the
--                              pair are copied into reported_snapshot at
--                              report time, so an unsend can't erase them
--
-- Grants it TIGHTENS (no data touched):
--   messages     INSERT is now column-level (sender_id, recipient_id, body,
--                reply_to). Before, a client could insert its own created_at
--                (backdating messages and slipping the 30/min throttle) or a
--                pre-set read_at. The app only ever sends those four.
--   friendships  INSERT is now column-level (requester_id, addressee_id,
--                status). Same created_at throttle hole, and it stops a
--                client setting via_invite itself.
--
-- The client fails soft until this is run: the inbox falls back to a bounded
-- query, reactions/invites report 'not_configured', and live delivery falls
-- back to polling the newest rows. Running it before the deploy is also safe.
-- ============================================================================
begin;

-- ── 0. Preconditions ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.messages') is null
     or to_regclass('public.friendships') is null
     or to_regclass('public.blocks') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.reports') is null then
    raise exception 'Run social_schema.sql and messages_schema.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'reports'
                    and column_name = 'reported_snapshot')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'profiles'
                       and column_name = 'suspended_at') then
    raise exception 'Run audit_schema_2026_10.sql first (reports.reported_snapshot, profiles.suspended_at).';
  end if;
end $$;

-- ── Helper ──────────────────────────────────────────────────────────────
-- Blocks in a given direction, visible to definer only. Used by policies
-- that must see a block the CALLER can't (blocks RLS shows the blocker
-- their own rows only). Answers only about pairs that include the caller,
-- so it can't be used to map who blocks whom.
create or replace function public.dm_blocked_by(p_blocker uuid, p_blocked uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) in (p_blocker, p_blocked)
     and exists (select 1 from public.blocks
                  where blocker_id = p_blocker and blocked_id = p_blocked);
$$;
revoke all on function public.dm_blocked_by(uuid, uuid) from public, anon;
grant execute on function public.dm_blocked_by(uuid, uuid) to authenticated;

-- ── 1. Replies ──────────────────────────────────────────────────────────
-- messages.id is BIGINT (identity), so reply_to is too.
alter table public.messages add column if not exists reply_to bigint;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'messages_reply_to_fkey'
                    and conrelid = 'public.messages'::regclass) then
    -- NOT VALID: every existing row has reply_to null, so there is nothing
    -- to check, and this skips the scan. New rows are checked as usual.
    -- Unsending the quoted message nulls the pointer; the reply stays.
    alter table public.messages
      add constraint messages_reply_to_fkey
      foreign key (reply_to) references public.messages(id)
      on delete set null not valid;
  end if;
end $$;

-- ON DELETE SET NULL looks up replies on every unsend; without this it
-- would be a sequential scan of messages each time.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to) where reply_to is not null;

-- A reply must quote a message from the SAME conversation. Definer so it
-- can read the quoted row regardless of who runs the insert; the insert
-- policy still decides whether the insert is allowed at all.
create or replace function public.messages_reply_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages q
     where q.id = new.reply_to
       and ((q.sender_id = new.sender_id and q.recipient_id = new.recipient_id)
         or (q.sender_id = new.recipient_id and q.recipient_id = new.sender_id))
  ) then
    raise exception 'That reply points at a message outside this conversation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_reply_guard() from public, anon, authenticated;
drop trigger if exists messages_reply_guard on public.messages;
create trigger messages_reply_guard before insert on public.messages
  for each row execute function public.messages_reply_guard();

-- Column-level INSERT (see header). The four columns the app sends.
revoke insert on public.messages from anon, authenticated;
grant insert (sender_id, recipient_id, body, reply_to) on public.messages to authenticated;

-- ── 2. Reactions ────────────────────────────────────────────────────────
-- Surrogate `id` primary key on purpose: Realtime sends DELETE events to
-- every subscriber WITHOUT an RLS check, carrying only the primary key.
-- A (message_id, user_id, emoji) key would broadcast who un-reacted to
-- what; a bare id says nothing. The natural key is a UNIQUE constraint.
--
-- peer_id = the OTHER participant of the message's conversation, filled
-- by trigger (clients can't write it). It makes the read policy a plain
-- column comparison and gives Realtime an `eq` filter for "reactions
-- that concern me", so a reaction is not RLS-checked against every
-- connected user.
create table if not exists public.message_reactions (
  id         bigint generated always as identity primary key,
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  peer_id    uuid   references auth.users(id) on delete cascade,
  emoji      text   not null,
  created_at timestamptz not null default now(),
  constraint message_reactions_emoji_check
    check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🔥')),
  constraint message_reactions_one unique (message_id, user_id, emoji)
);
-- message_id lookups use the unique index (leading column).
create index if not exists message_reactions_user_created_idx
  on public.message_reactions (user_id, created_at desc);
create index if not exists message_reactions_peer_idx
  on public.message_reactions (peer_id);

alter table public.message_reactions enable row level security;

create or replace function public.message_reactions_fill()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  s uuid; r uuid;
begin
  select m.sender_id, m.recipient_id into s, r
    from public.messages m where m.id = new.message_id;
  if s is null then
    raise exception 'Message not found.' using errcode = '23503';
  end if;
  if new.user_id is distinct from s and new.user_id is distinct from r then
    raise exception 'You can only react in your own conversations.' using errcode = '42501';
  end if;
  new.peer_id := case when new.user_id = s then r else s end;
  -- 60 reactions a minute per user — same shape as the message throttle.
  if (select count(*) from public.message_reactions x
       where x.user_id = new.user_id
         and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'Slow down — too many reactions in a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.message_reactions_fill() from public, anon, authenticated;
drop trigger if exists message_reactions_fill on public.message_reactions;
create trigger message_reactions_fill before insert on public.message_reactions
  for each row execute function public.message_reactions_fill();

-- Read: both participants (the reactor is one; peer_id is the other).
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = peer_id);

-- Insert: as yourself, on a message in your own conversation, with an
-- accepted friend you haven't blocked (and who hasn't blocked you) —
-- the same bar as sending a message.
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
       where m.id = message_reactions.message_id
         and ((select auth.uid()) = m.sender_id or (select auth.uid()) = m.recipient_id)
    )
    and exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.requester_id = (select auth.uid()) and f.addressee_id = message_reactions.peer_id)
           or (f.requester_id = message_reactions.peer_id and f.addressee_id = (select auth.uid())))
    )
    and not public.dm_blocked_by((select auth.uid()), message_reactions.peer_id)
    and not public.dm_blocked_by(message_reactions.peer_id, (select auth.uid()))
  );

-- Delete: your own reactions only.
drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.message_reactions from anon, authenticated;
grant select, delete on public.message_reactions to authenticated;
grant insert (message_id, user_id, emoji) on public.message_reactions to authenticated;

-- ── 3. Inbox ────────────────────────────────────────────────────────────
-- SECURITY INVOKER: the caller's RLS applies to every read, so this can
-- only ever see the caller's own conversations.
--
-- Shape of the work, for one user with P partners and N messages:
--   partners  — two index-only scans of the existing (sender, recipient,
--               created_at) / (recipient, sender, created_at) indexes
--   last msg  — per partner, two LIMIT 1 backward index probes
--   unread    — one pass over the partial (recipient) where read_at is null
--               index, which only holds unread rows
-- No new index is needed and nothing is sorted beyond P rows.
create or replace function public.dm_conversations()
returns table (
  partner_id      uuid,
  last_id         bigint,
  last_body       text,
  last_sender_id  uuid,
  last_created_at timestamptz,
  unread          integer,
  blocked_by_me   boolean
)
language sql stable security invoker set search_path = ''
as $$
  with me as (select auth.uid() as id),
  partners as (
    select m.recipient_id as pid from public.messages m, me where m.sender_id = me.id
    union
    select m.sender_id from public.messages m, me where m.recipient_id = me.id
  ),
  unread as (
    select m.sender_id as pid, count(*)::integer as n
      from public.messages m, me
     where m.recipient_id = me.id and m.read_at is null
     group by m.sender_id
  )
  select p.pid,
         l.id, l.body, l.sender_id, l.created_at,
         coalesce(u.n, 0),
         exists (select 1 from public.blocks b
                  where b.blocker_id = me.id and b.blocked_id = p.pid)
    from partners p
    cross join me
    cross join lateral (
      select x.id, x.body, x.sender_id, x.created_at from (
        (select m.id, m.body, m.sender_id, m.created_at
           from public.messages m
          where m.sender_id = me.id and m.recipient_id = p.pid
          order by m.created_at desc limit 1)
        union all
        (select m.id, m.body, m.sender_id, m.created_at
           from public.messages m
          where m.sender_id = p.pid and m.recipient_id = me.id
          order by m.created_at desc limit 1)
      ) x
      order by x.created_at desc, x.id desc
      limit 1
    ) l
    left join unread u on u.pid = p.pid
   order by l.created_at desc, l.id desc
   limit 200
$$;
revoke execute on function public.dm_conversations() from public, anon;
grant execute on function public.dm_conversations() to authenticated;

-- ── 4. Invites ──────────────────────────────────────────────────────────
alter table public.friendships add column if not exists via_invite boolean not null default false;

-- Column-level INSERT (see header). The three columns the app sends.
revoke insert on public.friendships from anon, authenticated;
grant insert (requester_id, addressee_id, status) on public.friendships to authenticated;

create table if not exists public.friend_invites (
  code       text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  revoked_at timestamptz,
  uses       integer not null default 0,
  max_uses   integer not null default 50,
  constraint friend_invites_code_shape check (code ~ '^[A-Za-z0-9_-]{10,64}$')
);
create index if not exists friend_invites_user_created_idx
  on public.friend_invites (user_id, created_at desc);

alter table public.friend_invites enable row level security;
drop policy if exists friend_invites_owner_read on public.friend_invites;
create policy friend_invites_owner_read on public.friend_invites
  for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies and no write grants: only the definer
-- RPCs below write this table.
revoke all on public.friend_invites from anon, authenticated;
grant select on public.friend_invites to authenticated;

-- A new code: 22 URL-safe chars from a version-4 UUID (122 random bits
-- from the server's strong RNG). gen_random_uuid() is core Postgres, so
-- there is no dependency on where pgcrypto is installed.
create or replace function public.friend_invite_new_code()
returns text language sql volatile set search_path = ''
as $$
  select pg_catalog.rtrim(pg_catalog.translate(
           pg_catalog.encode(pg_catalog.uuid_send(pg_catalog.gen_random_uuid()), 'base64'),
           '+/', '-_'), '=');
$$;
revoke all on function public.friend_invite_new_code() from public, anon, authenticated;

-- Revokes the caller's previous active code and returns a fresh one.
create or replace function public.create_friend_invite()
returns table (code text, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c  text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if exists (select 1 from public.profiles p where p.id = me and p.suspended_at is not null) then
    raise exception 'Invites are unavailable on this account.' using errcode = '42501';
  end if;
  if (select count(*) from public.friend_invites i
       where i.user_id = me and i.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many new invite links today — try again tomorrow.' using errcode = 'P0001';
  end if;

  update public.friend_invites i set revoked_at = now()
   where i.user_id = me and i.revoked_at is null;

  loop
    c := public.friend_invite_new_code();
    begin
      insert into public.friend_invites (code, user_id) values (c, me);
      exit;
    exception when unique_violation then
      -- 122 random bits: effectively never. Loop rather than fail.
    end;
  end loop;

  return query
    select i.code, i.expires_at from public.friend_invites i where i.code = c;
end;
$$;
revoke all on function public.create_friend_invite() from public, anon;
grant execute on function public.create_friend_invite() to authenticated;

-- The inviter's public card, or why not. Callable SIGNED OUT on purpose:
-- the /invite/<code> landing shows who invited you before you have an
-- account. A code is 122 random bits that only the inviter handed out, so
-- this can't be used to enumerate profiles. Signed in, blocks in either
-- direction read as 'unavailable' (never revealing which way).
create or replace function public.preview_friend_invite(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  inv public.friend_invites%rowtype;
  pj  jsonb;
  rel text := 'none';
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{10,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into inv from public.friend_invites i where i.code = p_code;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if inv.expires_at <= now() or inv.uses >= inv.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- to_jsonb keeps this working whichever optional profile columns exist.
  select to_jsonb(p) into pj from public.profiles p where p.id = inv.user_id;
  if pj is null or (pj ->> 'suspended_at') is not null then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  if me is not null then
    if me = inv.user_id then
      rel := 'self';
    elsif exists (select 1 from public.blocks b
                   where (b.blocker_id = me and b.blocked_id = inv.user_id)
                      or (b.blocker_id = inv.user_id and b.blocked_id = me)) then
      return jsonb_build_object('ok', false, 'reason', 'unavailable');
    else
      select case
               when f.status = 'accepted' then 'friends'
               when f.requester_id = me then 'outgoing'
               else 'incoming'
             end
        into rel
        from public.friendships f
       where (f.requester_id = me and f.addressee_id = inv.user_id)
          or (f.requester_id = inv.user_id and f.addressee_id = me)
       limit 1;
      rel := coalesce(rel, 'none');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'inviter', jsonb_build_object(
      'id',           case when me is null then null else inv.user_id end,
      'display_name', pj ->> 'display_name',
      'handle',       pj ->> 'handle',
      'avatar_url',   pj ->> 'avatar_url',
      'level',        pj -> 'level',
      'ratings_ovr',  pj -> 'ratings_ovr'
    ),
    'expires_at',   inv.expires_at,
    'relationship', rel
  );
end;
$$;
revoke all on function public.preview_friend_invite(text) from public;
grant execute on function public.preview_friend_invite(text) to anon, authenticated;

-- Sends a PENDING request from the caller TO the inviter, marked
-- via_invite. The inviter still accepts with one tap (the friend cap is
-- checked then, as for any request). The existing friendships triggers
-- fire as usual: the 20/hour throttle and the friend-request push.
create or replace function public.accept_friend_invite(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  inv public.friend_invites%rowtype;
  f   public.friendships%rowtype;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9_-]{10,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into inv from public.friend_invites i where i.code = p_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if inv.expires_at <= now() or inv.uses >= inv.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if inv.user_id = me then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if exists (select 1 from public.profiles p
              where p.id in (me, inv.user_id) and p.suspended_at is not null)
     or exists (select 1 from public.blocks b
                 where (b.blocker_id = me and b.blocked_id = inv.user_id)
                    or (b.blocker_id = inv.user_id and b.blocked_id = me)) then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end if;

  select * into f from public.friendships x
   where (x.requester_id = me and x.addressee_id = inv.user_id)
      or (x.requester_id = inv.user_id and x.addressee_id = me)
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason',
      case when f.status = 'accepted' then 'already_friends'
           when f.requester_id = me then 'already_requested'
           else 'incoming_request' end);
  end if;

  begin
    insert into public.friendships (requester_id, addressee_id, status, via_invite)
    values (me, inv.user_id, 'pending', true);
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'already_requested');
    when raise_exception then
      -- throttle_friend_requests (P0001): too many requests this hour.
      return jsonb_build_object('ok', false, 'reason', 'throttled');
  end;

  update public.friend_invites i set uses = i.uses + 1 where i.code = inv.code;

  return jsonb_build_object('ok', true, 'inviter_id', inv.user_id);
end;
$$;
revoke all on function public.accept_friend_invite(text) from public, anon;
grant execute on function public.accept_friend_invite(text) to authenticated;

-- ── 5. Report evidence that survives an unsend ──────────────────────────
-- The moderation queue used to read the pair's messages LIVE at review
-- time, so a reported user could unsend the evidence before anyone looked.
-- At insert, copy the last 10 DMs between reporter and reported into
-- reported_snapshot.messages ({from, body, at}, oldest first — the shape
-- the moderation queue already renders). The server writes this key; a
-- client-supplied `messages` key is discarded so evidence can't be forged.
-- Never blocks a report: any failure leaves the row as the client sent it.
create or replace function public.reports_snapshot_messages()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  arr jsonb;
begin
  begin
    if new.reported_snapshot is not null and jsonb_typeof(new.reported_snapshot) = 'object' then
      new.reported_snapshot := new.reported_snapshot - 'messages';
    end if;
    if new.reporter_id is null or new.reported_id is null then
      return new;
    end if;
    select jsonb_agg(jsonb_build_object(
             'from', case when t.sender_id = new.reported_id then 'reported' else 'reporter' end,
             'body', pg_catalog.left(t.body, 2000),
             'at',   t.created_at,
             'id',   t.id)
           order by t.created_at, t.id)
      into arr
      from (select m.id, m.sender_id, m.body, m.created_at
              from public.messages m
             where (m.sender_id = new.reporter_id and m.recipient_id = new.reported_id)
                or (m.sender_id = new.reported_id and m.recipient_id = new.reporter_id)
             order by m.created_at desc, m.id desc
             limit 10) t;
    if arr is not null then
      new.reported_snapshot := coalesce(
          case when jsonb_typeof(new.reported_snapshot) = 'object' then new.reported_snapshot end,
          '{}'::jsonb)
        || jsonb_build_object('messages', arr, 'messages_at', now());
    end if;
  exception when others then
    null;   -- evidence is best-effort; the report itself must land
  end;
  return new;
end;
$$;
revoke execute on function public.reports_snapshot_messages() from public, anon, authenticated;
drop trigger if exists reports_snapshot_messages on public.reports;
create trigger reports_snapshot_messages before insert on public.reports
  for each row execute function public.reports_snapshot_messages();

-- ── 6. Realtime: publication ────────────────────────────────────────────
-- RLS decides which INSERT/UPDATE events each subscriber receives. DELETE
-- events are not RLS-checked and carry only the primary key (a bigint id
-- for both tables — see the surrogate key note above).
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found — skipping (the app polls instead).';
    return;
  end if;
  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publishes all tables already — nothing to add.';
    return;
  end if;
  foreach t in array array['messages', 'message_reactions'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ── 7. Realtime authorization: private typing channel ──────────────────
-- Topic: 'dm-typing:<uuid>:<uuid>' with the two participants' ids in
-- ascending text order. Only those two, while accepted friends with no
-- block either way, may join (select) or send (insert) broadcasts on it.
-- Topics are seen by the server and the two participants only.
create or replace function public.dm_typing_topic_ok(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  a  uuid;
  b  uuid;
begin
  if me is null or p_topic is null
     or p_topic !~ '^dm-typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  a := pg_catalog.split_part(p_topic, ':', 2)::uuid;
  b := pg_catalog.split_part(p_topic, ':', 3)::uuid;
  if a::text >= b::text or (me <> a and me <> b) then
    return false;
  end if;
  return exists (
           select 1 from public.friendships f
            where f.status = 'accepted'
              and ((f.requester_id = a and f.addressee_id = b)
                or (f.requester_id = b and f.addressee_id = a)))
     and not exists (
           select 1 from public.blocks x
            where (x.blocker_id = a and x.blocked_id = b)
               or (x.blocker_id = b and x.blocked_id = a));
exception when others then
  return false;
end;
$$;
revoke all on function public.dm_typing_topic_ok(text) from public, anon;
grant execute on function public.dm_typing_topic_ok(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is null
     or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages / realtime.topic() not found — typing channel policies skipped.';
    return;
  end if;
  execute 'drop policy if exists "vantage dm typing: read" on realtime.messages';
  execute $p$
    create policy "vantage dm typing: read" on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (select realtime.topic()) like 'dm-typing:%'
        and public.dm_typing_topic_ok((select realtime.topic()))
      )
  $p$;
  execute 'drop policy if exists "vantage dm typing: send" on realtime.messages';
  execute $p$
    create policy "vantage dm typing: send" on realtime.messages
      for insert to authenticated
      with check (
        realtime.messages.extension = 'broadcast'
        and (select realtime.topic()) like 'dm-typing:%'
        and public.dm_typing_topic_ok((select realtime.topic()))
      )
  $p$;
end $$;

commit;

-- ── After running, these should all return true ─────────────────────────
-- select exists (select 1 from information_schema.columns
--                 where table_name = 'messages' and column_name = 'reply_to');
-- select to_regclass('public.message_reactions') is not null,
--        to_regclass('public.friend_invites') is not null;
-- select count(*) = 2 from pg_publication_tables
--  where pubname = 'supabase_realtime' and tablename in ('messages', 'message_reactions');
-- select has_function_privilege('authenticated', 'public.dm_conversations()', 'execute'),
--        not has_function_privilege('anon', 'public.dm_conversations()', 'execute'),
--        has_function_privilege('anon', 'public.preview_friend_invite(text)', 'execute'),
--        not has_function_privilege('anon', 'public.accept_friend_invite(text)', 'execute');
-- select not has_column_privilege('authenticated', 'public.messages', 'created_at', 'insert'),
--        has_column_privilege('authenticated', 'public.messages', 'reply_to', 'insert');
-- select count(*) = 2 from pg_policies
--  where schemaname = 'realtime' and tablename = 'messages' and policyname like 'vantage dm typing%';
--
-- Dashboard → Realtime → Settings: leave "Allow public access" ON (the
-- default). The DM inbox channel is a PUBLIC channel carrying only
-- postgres_changes, whose rows are filtered by table RLS; only the typing
-- channel is private. Turning public access off would stop the inbox
-- channel joining — the app would then poll, not break.

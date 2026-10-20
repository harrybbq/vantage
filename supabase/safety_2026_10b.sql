-- ============================================================================
-- Safety & moderation — October 2026 (launch batch 2, batch B)
-- ============================================================================
-- Run in the Supabase SQL editor. One transaction: if any statement fails,
-- nothing changes. Re-runnable — every statement is IF NOT EXISTS, CREATE OR
-- REPLACE, DROP … IF EXISTS before CREATE, or guarded.
--
-- PREREQUISITES (the precondition block below refuses to run without them):
--   1. supabase/audit_schema_2026_10.sql   profiles.suspended_at,
--                                          reports.reported_snapshot / status
--      (STARTUP_REQUIREMENTS line "Both applied live and verified 2026-10-02")
--   2. supabase/dm_upgrade_2026_10.sql     message_reactions, dm_blocked_by,
--                                          dm_typing_topic_ok (confirmed run
--                                          2026-10-18)
--
-- ADDITIVE. No existing row is updated or deleted; no column is dropped or
-- retyped. What changes (numbers are STARTUP_REQUIREMENTS items):
--
--   111  Suspension stops DMs. RLS on messages, message_reactions and
--        friendships refuses a suspended account's sends, reactions,
--        friend requests and accepts, and its unsends (so it can't erase
--        evidence while suspended). Messages and reactions it sent before
--        are HIDDEN from the other person while the suspension lasts —
--        never deleted: the rows stay, the report evidence copy stays, the
--        moderation queue (service role) still reads them, and lifting the
--        suspension shows them again. A trigger gives the app a plain
--        "Your account is suspended" error instead of a bare RLS refusal.
--        my_safety_status() tells the app the account's own state.
--   118  DM text filter, in the database: a BEFORE INSERT trigger on
--        messages refuses bodies containing the DM word list (slurs and a
--        few unambiguous explicit terms — the same list as
--        src/lib/moderation/messageFilter.js; check:modqueue compares them).
--        Existing messages are never re-checked.
--   110  safety_notices: in-app notices to the reporter ("we got your
--        report", the outcome) and to the reported user (suspension,
--        restored, a reset name/picture — never who reported). A trigger
--        acknowledges every new report to its reporter. Users read and
--        mark-read their own notices; only the server writes them.
--   112  moderation_actions: the audit trail of owner actions (reset name /
--        handle / picture, suspend, unsuspend, avatar re-screen flags),
--        with a hash of each removed value so the SAME value can't be
--        re-published by the client (profiles_reset_guard — the published
--        copy only; S.profile in user_data is never touched).
--        avatar_screenings + three service-role RPCs: re-screen avatars
--        published before screening existed, in small batches.
--
-- Report reasons (110d): reports.reason is free text with no CHECK, so the
-- new reasons need no schema change and every stored value keeps working.
-- No constraint is added — a report must never fail to land.
--
-- The app and functions FAIL SOFT until this is run: no notices, no
-- suspended banner (sends from a suspended account are still refused by the
-- client), the filter runs client-side only, the reset/re-screen tools say
-- "run safety_2026_10b.sql".
--
-- New tables follow item 20/81: RLS on, user columns reference auth.users,
-- column-level grants. safety_notices and avatar_screenings cascade with
-- the account. moderation_actions uses ON DELETE SET NULL, like reports
-- (audit_schema_2026_10.sql): it is moderation evidence, kept 12 months
-- with the reports it belongs to (docs/ABUSE_HANDLING.md), not user data.
-- ============================================================================
begin;

-- ── 0. Preconditions ────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.messages') is null
     or to_regclass('public.friendships') is null
     or to_regclass('public.reports') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Run social_schema.sql and messages_schema.sql first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles'
                    and column_name = 'suspended_at')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'reports'
                       and column_name = 'reported_snapshot') then
    raise exception 'Run audit_schema_2026_10.sql first (profiles.suspended_at, reports.reported_snapshot).';
  end if;
  if to_regclass('public.message_reactions') is null
     or to_regprocedure('public.dm_blocked_by(uuid, uuid)') is null
     or to_regprocedure('public.is_blocked_either(uuid, uuid)') is null then
    raise exception 'Run security_hotfix_2026_09_30.sql and dm_upgrade_2026_10.sql first.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 111. Suspension stops DMs, reactions and friend requests
-- ════════════════════════════════════════════════════════════════════════

-- Is this account suspended? Definer: the caller's profiles RLS (and any
-- future column-level SELECT grants on profiles, item 83) must not decide
-- whether a policy sees a suspension.
create or replace function public.vb_is_suspended(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_user and p.suspended_at is not null);
$$;
revoke all on function public.vb_is_suspended(uuid) from public, anon;
grant execute on function public.vb_is_suspended(uuid) to authenticated;

-- The suspended accounts whose messages/reactions the CALLER must not see:
-- suspended users who share at least one message with the caller. One
-- call per query (policies wrap it in a scalar subquery → InitPlan), and
-- it walks only the suspended set (partial index profiles_suspended_idx)
-- with two index probes each — never the caller's whole history. Only
-- ever names people the caller already has a conversation with, so it
-- can't be used to list who is suspended.
create or replace function public.vb_dm_hidden_senders()
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}'::uuid[])
    from public.profiles p
   where p.suspended_at is not null
     and p.id is distinct from (select auth.uid())
     and (exists (select 1 from public.messages m
                   where m.sender_id = p.id and m.recipient_id = (select auth.uid()))
       or exists (select 1 from public.messages m
                   where m.sender_id = (select auth.uid()) and m.recipient_id = p.id));
$$;
revoke all on function public.vb_dm_hidden_senders() from public, anon;
grant execute on function public.vb_dm_hidden_senders() to authenticated;

-- The account's own state, for the app's calm "suspended" banner. Definer
-- so it keeps working whatever column grants profiles ends up with.
-- → {"suspended": bool, "suspended_at": timestamptz} or null (no row).
create or replace function public.my_safety_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('suspended', p.suspended_at is not null,
                            'suspended_at', p.suspended_at)
    from public.profiles p
   where p.id = (select auth.uid());
$$;
revoke all on function public.my_safety_status() from public, anon;
grant execute on function public.my_safety_status() to authenticated;

-- messages: read. Your own sends always; received ones unless the sender
-- is suspended right now (hidden, not deleted).
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    (select auth.uid()) = sender_id
    or ((select auth.uid()) = recipient_id
        and not (sender_id = any ((select public.vb_dm_hidden_senders())::uuid[])))
  );

-- messages: send. security_hotfix_2026_09_30.sql's policy + not suspended.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.requester_id = (select auth.uid()) and f.addressee_id = messages.recipient_id)
           or (f.requester_id = messages.recipient_id and f.addressee_id = (select auth.uid())))
    )
    and not public.is_blocked_either((select auth.uid()), recipient_id)
    and not public.vb_is_suspended((select auth.uid()))
  );

-- messages: unsend. Your own, and not while suspended — a suspended
-- account must not be able to erase what it sent while it's reviewed.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (
    (select auth.uid()) = sender_id
    and not public.vb_is_suspended((select auth.uid()))
  );

-- message_reactions: read. Hide a suspended reactor's reactions from the
-- other participant, like their messages.
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or ((select auth.uid()) = peer_id
        and not (user_id = any ((select public.vb_dm_hidden_senders())::uuid[])))
  );

-- message_reactions: insert. dm_upgrade_2026_10.sql's policy + not suspended.
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
    and not public.vb_is_suspended((select auth.uid()))
  );

-- friendships: request. security_hotfix's policy + the requester is not
-- suspended.
drop policy if exists "friendships: insert as requester" on public.friendships;
create policy "friendships: insert as requester" on public.friendships
  for insert
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
    and not public.is_blocked_either(requester_id, addressee_id)
    and not public.vb_is_suspended((select auth.uid()))
  );

-- friendships: accept. security_hotfix's policy + neither side suspended
-- (a suspended account can't gain friends, and a request it sent before
-- the suspension can't be accepted while it lasts).
drop policy if exists "friendships: addressee accepts" on public.friendships;
create policy "friendships: addressee accepts" on public.friendships
  for update
  using (addressee_id = (select auth.uid()) and status = 'pending')
  with check (
    addressee_id = (select auth.uid())
    and status = 'accepted'
    and not public.is_blocked_either(requester_id, addressee_id)
    and not public.vb_is_suspended(addressee_id)
    and not public.vb_is_suspended(requester_id)
  );

-- Friendly refusals. RLS can only say "row-level security"; these BEFORE
-- triggers run first and say what is actually wrong. The policies above
-- stay the binding check. HINT 'vantage:suspended' is what the app keys on.
create or replace function public.friendships_suspension_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;   -- service role / definer RPCs (accept_friend_invite checks itself)
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.profiles p
                                   where p.id = new.requester_id and p.suspended_at is not null) then
    raise exception 'Your account is suspended, so friend requests are paused.'
      using errcode = '42501', hint = 'vantage:suspended';
  end if;
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted' then
    if exists (select 1 from public.profiles p
                where p.id = new.addressee_id and p.suspended_at is not null) then
      raise exception 'Your account is suspended, so friend requests are paused.'
        using errcode = '42501', hint = 'vantage:suspended';
    end if;
    if exists (select 1 from public.profiles p
                where p.id = new.requester_id and p.suspended_at is not null) then
      raise exception 'This account is suspended, so the request can''t be accepted right now.'
        using errcode = '42501', hint = 'vantage:peer-suspended';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.friendships_suspension_guard() from public, anon, authenticated;
drop trigger if exists friendships_suspension_guard on public.friendships;
create trigger friendships_suspension_guard before insert or update of status on public.friendships
  for each row execute function public.friendships_suspension_guard();

-- Typing indicator: neither participant may be suspended. Same function as
-- dm_upgrade_2026_10.sql §7 plus the suspension check.
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
               or (x.blocker_id = b and x.blocked_id = a))
     and not exists (
           select 1 from public.profiles p
            where p.id in (a, b) and p.suspended_at is not null);
exception when others then
  return false;
end;
$$;
revoke all on function public.dm_typing_topic_ok(text) from public, anon;
grant execute on function public.dm_typing_topic_ok(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 118. DM text filter
-- ════════════════════════════════════════════════════════════════════════
-- A port of src/lib/moderation/messageFilter.js (which reads text the way
-- nameFilter.js does): NFKD + strip accents, lower-case, the same l33t
-- map, split into words on anything that isn't a–z, join runs of single
-- letters ("n i g g e r"), and try each word as written and with
-- stretched letters collapsed. Whole words only, so "Scunthorpe",
-- "assessment" and "cocktail" pass. The lists MUST match the JS file —
-- src/lib/moderation/safety.test.mjs reads both and fails the build if
-- they differ. Conservative on purpose (see the JS file's header): no
-- general swearing, no links/numbers, nothing someone needs to ask for
-- help ("rape", "paedo", "nudes").
create or replace function public.vb_message_text_blocked(p_body text)
returns boolean
language plpgsql immutable parallel safe set search_path = ''
as $$
declare
  dm_exact constant text[] := array[
    'nigger', 'nigga', 'niggas', 'niggers', 'nigg', 'faggot', 'faggots',
    'tranny', 'trannies', 'kike', 'kikes', 'paki', 'pakis', 'wetback',
    'gook', 'gooks', 'raghead', 'towelhead', 'beaner', 'gypo', 'gyppo', 'pikey',
    'blowjob', 'handjob', 'rimjob', 'jizz', 'dildo', 'dildos', 'hentai', 'milf'
  ];
  dm_stems constant text[] := array['nigger', 'faggot', 'blowjob'];
  norm  text;
  w     text;
  v     text;
  st    text;
  run   text := '';
  cands text[] := '{}';
begin
  if p_body is null or p_body = '' then
    return false;
  end if;
  begin
    norm := pg_catalog.normalize(p_body, 'NFKD');
  exception when others then
    norm := p_body;   -- not UTF-8 normalisable: read it as written
  end;
  norm := pg_catalog.regexp_replace(norm, '[̀-ͯ]', '', 'g');
  norm := pg_catalog.lower(norm);
  norm := pg_catalog.translate(norm, '01345789@$!|+', 'oieastbgasiit');

  foreach w in array pg_catalog.regexp_split_to_array(norm, '[^a-z]+') loop
    continue when w = '';
    cands := cands || w;
    if pg_catalog.length(w) = 1 then
      run := run || w;
    else
      if pg_catalog.length(run) >= 3 then cands := cands || run; end if;
      run := '';
    end if;
  end loop;
  if pg_catalog.length(run) >= 3 then cands := cands || run; end if;

  foreach w in array cands loop
    foreach v in array array[w, pg_catalog.regexp_replace(w, '(.)\1+', '\1', 'g')] loop
      if v = any (dm_exact) then
        return true;
      end if;
      foreach st in array dm_stems loop
        if pg_catalog.starts_with(v, st) then
          return true;
        end if;
      end loop;
    end loop;
  end loop;
  return false;
end;
$$;
revoke all on function public.vb_message_text_blocked(text) from public, anon;
grant execute on function public.vb_message_text_blocked(text) to authenticated, service_role;

-- One BEFORE INSERT guard for messages: suspension first (the plain
-- error for 111), then the word filter (118). Runs before the RLS check,
-- which stays the binding refusal for a suspended sender.
create or replace function public.messages_safety_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p
              where p.id = new.sender_id and p.suspended_at is not null) then
    raise exception 'Your account is suspended, so messages are paused.'
      using errcode = '42501', hint = 'vantage:suspended';
  end if;
  if public.vb_message_text_blocked(new.body) then
    raise exception 'That message includes a word we don''t allow in messages.'
      using errcode = '23514', hint = 'vantage:filtered';
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_safety_guard() from public, anon, authenticated;
drop trigger if exists messages_safety_guard on public.messages;
create trigger messages_safety_guard before insert on public.messages
  for each row execute function public.messages_safety_guard();

-- ════════════════════════════════════════════════════════════════════════
-- 110. Safety notices — the reporting loop
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.safety_notices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  meta       jsonb not null default '{}'::jsonb,
  -- Only on the REPORTER's notices (their own report). Never set on a
  -- notice to the reported user.
  report_id  uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint safety_notices_kind_check check (kind in (
    'report_received', 'report_actioned', 'report_dismissed',
    'account_suspended', 'account_restored', 'content_reset')),
  constraint safety_notices_meta_small check (pg_catalog.pg_column_size(meta) <= 2048)
);
create index if not exists safety_notices_user_created_idx
  on public.safety_notices (user_id, created_at desc);
create index if not exists safety_notices_report_idx
  on public.safety_notices (report_id) where report_id is not null;

alter table public.safety_notices enable row level security;
drop policy if exists safety_notices_own_read on public.safety_notices;
create policy safety_notices_own_read on public.safety_notices
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists safety_notices_own_mark_read on public.safety_notices;
create policy safety_notices_own_mark_read on public.safety_notices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- No insert/delete for clients: the server (service role) and the trigger
-- below write notices. Users may only stamp read_at.
revoke all on public.safety_notices from anon, authenticated;
grant select on public.safety_notices to authenticated;
grant update (read_at) on public.safety_notices to authenticated;

-- Every new report is acknowledged to its reporter. Never blocks the
-- report (own exception block), and at most 20 acknowledgements an hour
-- per reporter so a report flood can't flood notices.
create or replace function public.reports_ack_reporter()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  snap jsonb := case when jsonb_typeof(new.reported_snapshot) = 'object'
                     then new.reported_snapshot else '{}'::jsonb end;
begin
  if new.reporter_id is null then
    return null;
  end if;
  begin
    if (select count(*) from public.safety_notices n
         where n.user_id = new.reporter_id and n.kind = 'report_received'
           and n.created_at > now() - interval '1 hour') < 20 then
      insert into public.safety_notices (user_id, kind, meta, report_id)
      values (new.reporter_id, 'report_received',
              jsonb_strip_nulls(jsonb_build_object(
                'handle', pg_catalog.left(snap ->> 'handle', 64),
                'name',   pg_catalog.left(snap ->> 'display_name', 64),
                'reason', pg_catalog.left(new.reason, 80))),
              new.id);
    end if;
  exception when others then
    null;   -- the report must land even if the notice can't
  end;
  return null;
end;
$$;
revoke execute on function public.reports_ack_reporter() from public, anon, authenticated;
drop trigger if exists reports_ack_reporter on public.reports;
create trigger reports_ack_reporter after insert on public.reports
  for each row execute function public.reports_ack_reporter();

-- ════════════════════════════════════════════════════════════════════════
-- 112. Owner tools: the audit trail, sticky resets, avatar re-screening
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.moderation_actions (
  id         bigint generated always as identity primary key,
  report_id  uuid references public.reports(id) on delete set null,
  target_id  uuid references auth.users(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  -- sha256 (hex) of the value removed, normalised as profiles_reset_guard
  -- reads it. Never the value itself.
  value_hash text,
  note       text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_action_check check (action in (
    'reset_display_name', 'reset_handle', 'reset_avatar',
    'suspend', 'unsuspend', 'avatar_flagged', 'avatar_kept')),
  constraint moderation_actions_hash_shape check (value_hash is null or value_hash ~ '^[0-9a-f]{64}$'),
  constraint moderation_actions_note_len check (note is null or char_length(note) <= 500)
);
create index if not exists moderation_actions_target_idx
  on public.moderation_actions (target_id, action) where value_hash is not null;
create index if not exists moderation_actions_report_idx
  on public.moderation_actions (report_id) where report_id is not null;
create index if not exists moderation_actions_created_idx
  on public.moderation_actions (created_at desc);
alter table public.moderation_actions enable row level security;   -- no policies: service role only
revoke all on public.moderation_actions from anon, authenticated;

-- A reset sticks: if a CLIENT writes back the exact value an owner reset
-- (same name ignoring case and spacing, same handle ignoring case, same
-- picture), the write keeps the column as it was instead — silently, so
-- the rest of that update (level, presence) still lands and nothing
-- retries in a loop. A different value goes through as normal. The
-- service role (auth.uid() null) is never second-guessed. Fires only when
-- one of the three columns is in the UPDATE's SET list.
create or replace function public.vb_reset_hash(p_kind text, p_value text)
returns text
language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_kind = 'reset_display_name' then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p_value, '\s+', ' ', 'g'))), 'UTF8')), 'hex')
    when p_kind = 'reset_handle' then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.lower(p_value), 'UTF8')), 'hex')
    else pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')), 'hex')
  end;
$$;
revoke all on function public.vb_reset_hash(text, text) from public, anon, authenticated;
grant execute on function public.vb_reset_hash(text, text) to service_role;

create or replace function public.profiles_reset_guard()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.display_name is not null and new.display_name is distinct from old.display_name
     and exists (select 1 from public.moderation_actions a
                  where a.target_id = new.id and a.action = 'reset_display_name'
                    and a.value_hash = public.vb_reset_hash('reset_display_name', new.display_name)) then
    new.display_name := old.display_name;
  end if;
  if new.handle is not null and new.handle is distinct from old.handle
     and exists (select 1 from public.moderation_actions a
                  where a.target_id = new.id and a.action = 'reset_handle'
                    and a.value_hash = public.vb_reset_hash('reset_handle', new.handle::text)) then
    new.handle := old.handle;
  end if;
  if new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url
     and exists (select 1 from public.moderation_actions a
                  where a.target_id = new.id and a.action = 'reset_avatar'
                    and a.value_hash = public.vb_reset_hash('reset_avatar', new.avatar_url)) then
    new.avatar_url := old.avatar_url;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_reset_guard() from public, anon, authenticated;
drop trigger if exists profiles_reset_guard on public.profiles;
create trigger profiles_reset_guard before update of display_name, handle, avatar_url on public.profiles
  for each row execute function public.profiles_reset_guard();

-- Avatar re-screening. One row per account: the hash of the avatar_url
-- that was screened and the verdict. An avatar is "unscreened" when there
-- is no row or the hash no longer matches (the picture changed since).
create table if not exists public.avatar_screenings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  avatar_hash text not null,
  decision    text not null,
  reason      text,
  screened_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  constraint avatar_screenings_hash_shape check (avatar_hash ~ '^[0-9a-f]{64}$'),
  constraint avatar_screenings_decision_check check (decision in ('approved', 'rejected', 'kept')),
  constraint avatar_screenings_reason_len check (reason is null or char_length(reason) <= 200)
);
alter table public.avatar_screenings enable row level security;    -- no policies: service role only
revoke all on public.avatar_screenings from anon, authenticated;

-- The next few unscreened avatars (most recently active first — the ones
-- people are seeing). Hashing every avatar is a scan of profiles, run only
-- when the owner presses the button; p_limit is clamped to 1..10.
create or replace function public.avatar_screen_candidates(p_limit integer default 5)
returns table (user_id uuid, avatar_url text, avatar_hash text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.avatar_url, h.hash
    from public.profiles p
    cross join lateral (select public.vb_reset_hash('reset_avatar', p.avatar_url) as hash) h
    left join public.avatar_screenings s on s.user_id = p.id
   where p.avatar_url is not null
     and (s.user_id is null or s.avatar_hash <> h.hash)
   order by p.last_active_at desc nulls last, p.id
   limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

-- Counts for the panel: avatars never screened (or changed since), and
-- flagged ones still showing the picture that was flagged.
create or replace function public.avatar_screen_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with cur as (
    select p.id, public.vb_reset_hash('reset_avatar', p.avatar_url) as hash
      from public.profiles p
     where p.avatar_url is not null
  )
  select jsonb_build_object(
    'withAvatar', (select count(*) from cur),
    'unscreened', (select count(*) from cur left join public.avatar_screenings s on s.user_id = cur.id
                    where s.user_id is null or s.avatar_hash <> cur.hash),
    'flagged',    (select count(*) from cur join public.avatar_screenings s on s.user_id = cur.id
                    where s.decision = 'rejected' and s.avatar_hash = cur.hash));
$$;

-- Flagged avatars still live, for the owner to keep or remove.
create or replace function public.avatar_screen_flagged(p_limit integer default 50)
returns table (user_id uuid, handle text, display_name text, avatar_url text,
               reason text, screened_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.handle::text, p.display_name, p.avatar_url, s.reason, s.screened_at
    from public.avatar_screenings s
    join public.profiles p on p.id = s.user_id
   where s.decision = 'rejected'
     and p.avatar_url is not null
     and s.avatar_hash = public.vb_reset_hash('reset_avatar', p.avatar_url)
   order by s.screened_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.avatar_screen_candidates(integer) from public, anon, authenticated;
revoke all on function public.avatar_screen_status() from public, anon, authenticated;
revoke all on function public.avatar_screen_flagged(integer) from public, anon, authenticated;
grant execute on function public.avatar_screen_candidates(integer) to service_role;
grant execute on function public.avatar_screen_status() to service_role;
grant execute on function public.avatar_screen_flagged(integer) to service_role;

commit;

-- ── After running: every line should return true ────────────────────────
-- select to_regclass('public.safety_notices') is not null,
--        to_regclass('public.moderation_actions') is not null,
--        to_regclass('public.avatar_screenings') is not null;
-- select public.vb_message_text_blocked('you n1gg3r'),
--        not public.vb_message_text_blocked('Scunthorpe assessment, love you xxx');
-- select has_function_privilege('authenticated', 'public.my_safety_status()', 'execute'),
--        not has_function_privilege('anon', 'public.my_safety_status()', 'execute'),
--        not has_function_privilege('authenticated', 'public.avatar_screen_candidates(integer)', 'execute');
-- select not has_table_privilege('authenticated', 'public.safety_notices', 'insert'),
--        has_column_privilege('authenticated', 'public.safety_notices', 'read_at', 'update'),
--        not has_column_privilege('authenticated', 'public.safety_notices', 'kind', 'update'),
--        not has_table_privilege('authenticated', 'public.moderation_actions', 'select');
-- select count(*) = 4 from pg_trigger
--  where tgname in ('messages_safety_guard', 'friendships_suspension_guard',
--                   'reports_ack_reporter', 'profiles_reset_guard') and not tgisinternal;
-- select count(*) = 7 from pg_policies where schemaname = 'public'
--  and policyname in ('messages_select', 'messages_insert', 'messages_delete',
--                     'message_reactions_select', 'message_reactions_insert',
--                     'friendships: insert as requester', 'friendships: addressee accepts');
-- Then: Supabase → Advisors → Security (item 81) — expect no new findings.

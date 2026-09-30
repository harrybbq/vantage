-- ============================================================================
-- Audit schema — October 2026 pre-launch pass
-- ============================================================================
-- Run AFTER security_hotfix_2026_09_30.sql, in the Supabase SQL editor.
-- One transaction: if any statement fails, nothing changes.
--
-- Additive only. New tables, new nullable columns, new functions, new
-- defaults for NEW rows, NOT VALID constraints (existing rows are never
-- re-checked), and one FK relaxed from CASCADE to SET NULL. No existing
-- row is updated or deleted.
--
-- Every consumer in the code fails soft until this is run, so deploying
-- the code first is safe; running this first is also safe.
-- Numbers refer to STARTUP_REQUIREMENTS.md.
-- ============================================================================
begin;

-- ── 45. Durable daily AI caps ───────────────────────────────────────────
-- netlify/lib/aiQuota.js calls ai_usage_bump with the service role.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket  text not null,
  day     date not null default current_date,
  n       integer not null default 0,
  primary key (user_id, bucket, day)
);
alter table public.ai_usage enable row level security;   -- no policies: service role only
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.ai_usage_bump(p_user uuid, p_bucket text, p_limit integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  cnt integer;
begin
  insert into public.ai_usage as u (user_id, bucket, day, n)
  values (p_user, p_bucket, current_date, 1)
  on conflict (user_id, bucket, day) do update set n = u.n + 1
  returning u.n into cnt;
  return cnt <= p_limit;
end;
$$;
revoke all on function public.ai_usage_bump(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_bump(uuid, text, integer) to service_role;

-- ── 77. Client error reports (netlify/functions/client-error.js) ────────
create table if not exists public.client_errors (
  id       bigint generated always as identity primary key,
  user_id  uuid references auth.users(id) on delete set null,
  at       timestamptz not null default now(),
  kind     text,
  message  text,
  stack    text,
  url      text,
  ua       text,
  release  text
);
create index if not exists client_errors_at_idx on public.client_errors (at desc);
alter table public.client_errors enable row level security;  -- service role only
revoke all on public.client_errors from anon, authenticated;
-- Retention: delete rows older than 30 days by hand, or schedule it:
--   delete from public.client_errors where at < now() - interval '30 days';

-- ── 63. Moderation: report status, evidence that survives deletion ──────
alter table public.reports add column if not exists status text not null default 'open';
alter table public.reports add column if not exists actioned_at timestamptz;
alter table public.reports add column if not exists actioned_by uuid;
alter table public.reports add column if not exists note text;
alter table public.reports add column if not exists reported_snapshot jsonb;
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('open', 'actioned', 'dismissed')) not valid;
create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';

-- An abuser deleting their account used to cascade away every report
-- about them. Keep the report; lose only the link.
alter table public.reports alter column reported_id drop not null;
alter table public.reports drop constraint if exists reports_reported_id_fkey;
alter table public.reports
  add constraint reports_reported_id_fkey
  foreign key (reported_id) references auth.users(id) on delete set null;

-- Same for the reporter: deleting their account removes who filed it,
-- not the report itself (the queue still needs it to act on).
alter table public.reports alter column reporter_id drop not null;
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports
  add constraint reports_reporter_id_fkey
  foreign key (reporter_id) references auth.users(id) on delete set null;

-- Clients may file a report, never set its outcome.
revoke insert, update, delete on public.reports from anon, authenticated;
grant insert (reporter_id, reported_id, reason, context, reported_snapshot)
  on public.reports to authenticated;

-- ── 63 / 44. Server-owned profile flags ─────────────────────────────────
-- profiles already uses column-level UPDATE grants, so new columns are
-- not client-writable. suspended_at hides a user from every public
-- surface; prestiged_at enforces the prestige cooldown.
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists prestiged_at timestamptz;
create index if not exists profiles_suspended_idx on public.profiles (id) where suspended_at is not null;

create or replace function public.search_profiles_by_handle(q text)
returns table(id uuid, handle text, display_name text, avatar_url text, level integer)
language sql security definer set search_path = 'public'
as $$
  select p.id, p.handle::text, p.display_name, p.avatar_url, p.level
  from profiles p
  where p.is_searchable = true
    and p.suspended_at is null
    and p.handle is not null
    and p.handle ilike q || '%'
    and p.id <> auth.uid()
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id      and b.blocked_id = auth.uid())
    )
  limit 10
$$;
revoke execute on function public.search_profiles_by_handle(text) from public, anon;
grant  execute on function public.search_profiles_by_handle(text) to authenticated;

-- ── 68. Privacy defaults for NEW accounts only ──────────────────────────
-- Existing rows keep whatever they have; nothing is updated.
alter table public.profiles alter column is_searchable     set default false;
alter table public.profiles alter column leaderboard_optin set default false;

-- ── 63. Profile fields shown to strangers ───────────────────────────────
-- NOT VALID: checked on every new write, existing rows are left alone.
-- (Live max today: avatar 6.8k chars, name 6 chars — both well inside.)
alter table public.profiles drop constraint if exists profiles_avatar_url_shape;
alter table public.profiles add constraint profiles_avatar_url_shape
  check (avatar_url is null
         or (avatar_url ~ '^data:image/(jpeg|png|webp);base64,' and length(avatar_url) <= 300000))
  not valid;
alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 40) not valid;

-- ── Abuse throttles (economy audit #4, #13) ─────────────────────────────
-- Messages: 30 a minute per sender. Friend requests: 20 an hour.
create or replace function public.throttle_messages()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.messages
       where sender_id = new.sender_id
         and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Slow down — too many messages in a minute.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_throttle on public.messages;
create trigger messages_throttle before insert on public.messages
  for each row execute function public.throttle_messages();

create or replace function public.throttle_friend_requests()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.friendships
       where requester_id = new.requester_id
         and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many friend requests — try again later.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists friendships_throttle on public.friendships;
create trigger friendships_throttle before insert on public.friendships
  for each row execute function public.throttle_friend_requests();
create index if not exists friendships_requester_created_idx
  on public.friendships (requester_id, created_at desc);

revoke execute on function public.throttle_messages() from public, anon, authenticated;
revoke execute on function public.throttle_friend_requests() from public, anon, authenticated;

-- ── 49. health-sync token lookup without a full-table scan ──────────────
-- PostgREST's `state->>healthToken=eq.X` filter uses this index directly.
create index if not exists user_data_health_token_idx
  on public.user_data ((state->>'healthToken'))
  where state ? 'healthToken';

-- ── 54. Server-side anti-wipe predicate mirrors the client's ────────────
-- src/lib/state/meaningful.js: any non-empty store counts unless it is on
-- the ignore list of seeded / derived / auto-written keys. The old list
-- missed vitalsLog, burnLog, bodyLog, subscriptions, holidays… so a
-- wearable-only user got no pre-wipe snapshot. Keep the two in step.
create or replace function public.vb_state_meaningful(s jsonb)
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(s is not null and jsonb_typeof(s) = 'object' and (
       coalesce(nullif(s->>'coins', '')::numeric, 0) > 0
    or btrim(coalesce(s->'profile'->>'name', '')) <> ''
    or btrim(coalesce(s->'profile'->>'tagline', '')) <> ''
    or coalesce(s->>'brainScore', 'null')   not in ('null', 'false', '0', '')
    or coalesce(s->>'financeScore', 'null') not in ('null', 'false', '0', '')
    or coalesce(s->>'fitnessScore', 'null') not in ('null', 'false', '0', '')
    or coalesce(s->>'socialScore', 'null')  not in ('null', 'false', '0', '')
    or (jsonb_typeof(s->'achievements') = 'array' and (
          jsonb_array_length(s->'achievements') > 4
       or exists (select 1 from jsonb_array_elements(s->'achievements') a
                   where coalesce((a->>'completed')::boolean, false)
                      or coalesce(a->>'id', '') not in ('a1', 'a2', 'a3', 'a4'))))
    or (jsonb_typeof(s->'trackers') = 'array' and (
          jsonb_array_length(s->'trackers') > 3
       or exists (select 1 from jsonb_array_elements(s->'trackers') t
                   where coalesce(t->>'id', '') not in ('t1', 't2', 't3'))))
    or (jsonb_typeof(s->'planLedger'->'months') = 'object'
        and exists (select 1 from jsonb_object_keys(s->'planLedger'->'months')))
    or exists (
         select 1 from jsonb_each(s) e
          where e.key not in (
            'calYear','calMonth','ghCache','multiSelectedDays','multiSelectMode',
            'connectingFrom','selectedLogDate','shopFilter','_multiLogOpen','__slim',
            'profile','achievements','trackers','connections','notifications','privacy','lastfm',
            'ratings','prestige','streaks','coachMemory','coachBriefHistory','coachBrief','whoopLastError',
            'planLedger','widgetPositions','widgetSizes','widgetZ','widgetLayoutW','hubSnap',
            'moduleTransparency','bgFx')
            and ((jsonb_typeof(e.value) = 'array'  and jsonb_array_length(e.value) > 0)
              or (jsonb_typeof(e.value) = 'object' and e.value <> '{}'::jsonb)))
  ), false);
$$;

commit;

-- ── After running, these should all return true ─────────────────────────
-- select to_regclass('public.ai_usage') is not null, to_regclass('public.client_errors') is not null;
-- select count(*) = 2 from information_schema.columns
--   where table_name = 'profiles' and column_name in ('suspended_at','prestiged_at');
-- select public.vb_state_meaningful('{"vitalsLog":{"2026-09-01":{"weight":80}}}'::jsonb);   -- true
-- select not public.vb_state_meaningful('{"trackers":[{"id":"t1"}],"achievements":[{"id":"a1"}]}'::jsonb); -- true

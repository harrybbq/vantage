-- ============================================================================
-- Security hotfix — 2026-09-30 pre-launch audit
-- ============================================================================
-- Run once in the Supabase SQL editor. Wrapped in a transaction: if any
-- statement fails, nothing changes. It touches GRANTS, POLICIES, VIEW
-- OPTIONS, one FOREIGN KEY and one INDEX. It reads and writes NO user data.
--
-- Every hole below was confirmed against the live database (catalogue
-- queries only) on 2026-09-30. Numbers refer to STARTUP_REQUIREMENTS.md.
--
-- Client code already matches these grants: the app only ever updates
-- friendships (status, accepted_at) and messages (read_at), calls
-- search_profiles_by_handle signed in, and seeds macros for itself.
-- ============================================================================
begin;

-- ── 32. Views that bypass RLS, readable with the public anon key ─────────
-- notifications_pending exposed every user's queued pushes; coach_nudges_active
-- every user's AI nudges. security_invoker makes the caller's RLS apply
-- (own rows only). push-dispatch uses the service role, which is unaffected.
alter view public.notifications_pending set (security_invoker = on);
alter view public.coach_nudges_active  set (security_invoker = on);
revoke all on public.notifications_pending from anon;
revoke all on public.coach_nudges_active  from anon;

-- ── 33. Profiles readable by anyone holding the anon key ─────────────────
-- The read policy has no role, so `anon` matched its "searchable" branch.
revoke all on public.profiles from anon;

-- ── 34. Blocks that don't block ─────────────────────────────────────────
-- Policies checked `blocks` under the CALLER's RLS, and a blocked user
-- can't see the row that blocks them — so the check always passed.
-- A definer helper sees both directions.
create or replace function public.is_blocked_either(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b)
        or (blocker_id = b and blocked_id = a)
  );
$$;
revoke all on function public.is_blocked_either(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_either(uuid, uuid) to authenticated;

drop policy if exists "friendships: insert as requester" on public.friendships;
create policy "friendships: insert as requester" on public.friendships
  for insert
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and not public.is_blocked_either(requester_id, addressee_id)
  );

-- Accepting may only flip status/accepted_at on a row that is yours,
-- and never onto someone who blocks you (or whom you block).
drop policy if exists "friendships: addressee accepts" on public.friendships;
create policy "friendships: addressee accepts" on public.friendships
  for update
  using (addressee_id = auth.uid() and status = 'pending')
  with check (
    addressee_id = auth.uid()
    and status = 'accepted'
    and not public.is_blocked_either(requester_id, addressee_id)
  );
-- Column grants: an addressee could previously rewrite requester_id and
-- manufacture an accepted friendship with anyone.
revoke update on public.friendships from authenticated, anon;
grant update (status, accepted_at) on public.friendships to authenticated;

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages
  for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.requester_id = auth.uid() and f.addressee_id = messages.recipient_id)
           or (f.requester_id = messages.recipient_id and f.addressee_id = auth.uid()))
    )
    and not public.is_blocked_either(auth.uid(), recipient_id)
  );

-- ── 35. Recipients could rewrite messages they received ─────────────────
revoke update on public.messages from authenticated, anon;
grant update (read_at) on public.messages to authenticated;

-- ── 36. SECURITY DEFINER functions callable without signing in ──────────
revoke execute on function public.search_profiles_by_handle(text) from public, anon;
grant  execute on function public.search_profiles_by_handle(text) to authenticated;

-- seed_default_macros wrote default macros for ANY user id, callable by anon.
create or replace function public.seed_default_macros(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id is null or p_user_id is distinct from auth.uid() then
    raise exception 'not allowed';
  end if;
  insert into public.nutrition_macros (user_id, name, unit, daily_goal, color, display_order, is_default)
  values
    (p_user_id, 'Calories', 'kcal', 2000, '#e8b830', 0, true),
    (p_user_id, 'Protein',  'g',    150,  '#1a7a4a', 1, true),
    (p_user_id, 'Carbs',    'g',    250,  '#d4700a', 2, true),
    (p_user_id, 'Fat',      'g',    70,   '#c84040', 3, true)
  on conflict (user_id, name) do nothing;
end;
$$;
revoke execute on function public.seed_default_macros(uuid) from public, anon;
grant  execute on function public.seed_default_macros(uuid) to authenticated;

-- Trigger functions (enqueue_*, check_friend_cap, bump_food_contribution_reports,
-- vb_snapshot_user_data, owner_content_archive) are deliberately NOT revoked here:
-- the advisor flags them, but they cannot be called as RPCs anyway, and
-- vb_snapshot_user_data is the anti-wipe snapshot on every user_data save —
-- not worth any risk for a hygiene-only change.

-- ── 37. Account deletion would FAIL for anyone with a tracker_streaks row ──
-- The FK was NO ACTION, breaking the item-20 rule (0 rows today).
alter table public.tracker_streaks drop constraint tracker_streaks_user_id_fkey;
alter table public.tracker_streaks
  add constraint tracker_streaks_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- ── 38. nutrition_log has only its primary key ──────────────────────────
-- Every client query filters user_id + log_date.
create index if not exists nutrition_log_user_date_idx
  on public.nutrition_log (user_id, log_date);

commit;

-- ── After running: expect all of these to return false / empty ──────────
-- select has_table_privilege('anon','public.notifications_pending','select');
-- select has_table_privilege('anon','public.profiles','select');
-- select has_function_privilege('anon','public.search_profiles_by_handle(text)','execute');
-- select column_name from information_schema.column_privileges
--  where table_name in ('friendships','messages') and grantee='authenticated'
--    and privilege_type='UPDATE';   -- expect only status, accepted_at, read_at
-- Also: Dashboard → Authentication → enable Leaked Password Protection (item 39).

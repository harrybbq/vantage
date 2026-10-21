-- ============================================================================
-- Prestige rewards — October 2026: show prestige where people meet you
-- ============================================================================
-- Run in the Supabase SQL editor AFTER prestige_schema.sql,
-- audit_schema_2026_10.sql and dm_upgrade_2026_10.sql (it replaces the
-- versions of two functions those files created).
-- One transaction: if any statement fails, nothing changes. Re-runnable.
--
-- ── RUN ORDER ───────────────────────────────────────────────────────────────
--   Either order is safe. The client reads `prestige` from both functions
--   with a default of 0, so until this runs the handle search and the invite
--   page simply draw no prestige ring or badge (they still work). Running it
--   before the deploy is also safe: today's client ignores the extra field.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────
-- Changes two SECURITY DEFINER functions. NO table, row, column or grant on a
-- table is touched; nothing is deleted.
--
--   A. search_profiles_by_handle(q) — also returns ratings_ovr and prestige.
--      ratings_ovr is already a public column (privacy_lockdown_2026_10b.sql
--      grants it "for the OVR chip on friends / requests / search"); the
--      audit_schema_2026_10 rewrite of this function dropped it, so search
--      results showed "OVR 1" for everyone. prestige is already public on
--      the leaderboard and friends boards; this lets search draw the frame.
--      The return type changes, which CREATE OR REPLACE cannot do, so the
--      function is dropped and recreated inside this transaction (no window
--      where it is missing) and its grants re-applied exactly as before.
--      The row filter is unchanged: searchable, not suspended, has a handle,
--      not yourself, no block either way, 10 rows.
--   B. preview_friend_invite(p_code) — the inviter card also carries
--      `prestige`. Same jsonb shape otherwise. `level` stays in it for the
--      older client still in the field (Level was retired 2026-10; nothing
--      new reads it).
--
-- Deliberately NOT done: the `profiles.prestige` column is NOT added to the
-- public column grant. Friends' prestige comes from the friends leaderboard
-- (service role), which already carries it.
--
-- ── VERIFY AFTER RUNNING ────────────────────────────────────────────────────
--   -- 1. Search returns the new columns (as a signed-in user, in the app:
--   --    Friends → Add friend → type a handle; a P1+ user shows a ring).
--   select pg_get_function_result('public.search_profiles_by_handle(text)'::regprocedure);
--   --    expect: TABLE(id uuid, handle text, display_name text, avatar_url text,
--   --            level integer, ratings_ovr integer, prestige integer)
--   -- 2. Grants unchanged: authenticated yes, anon no.
--   select has_function_privilege('authenticated', 'public.search_profiles_by_handle(text)', 'execute'),
--          has_function_privilege('anon',          'public.search_profiles_by_handle(text)', 'execute'),
--          has_function_privilege('anon',          'public.preview_friend_invite(text)',     'execute');
--   --    expect: true, false, true
-- ============================================================================

begin;

-- ── A. Handle search ────────────────────────────────────────────────────────
drop function if exists public.search_profiles_by_handle(text);
create function public.search_profiles_by_handle(q text)
returns table(id uuid, handle text, display_name text, avatar_url text, level integer,
              ratings_ovr integer, prestige integer)
language sql security definer set search_path = 'public'
as $$
  select p.id, p.handle::text, p.display_name, p.avatar_url, p.level,
         p.ratings_ovr::integer, coalesce(p.prestige, 0)::integer
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

-- ── B. Invite preview ───────────────────────────────────────────────────────
-- Body as in dm_upgrade_2026_10.sql; one key added ('prestige').
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
      'ratings_ovr',  pj -> 'ratings_ovr',
      'prestige',     coalesce(pj -> 'prestige', '0'::jsonb)
    ),
    'expires_at',   inv.expires_at,
    'relationship', rel
  );
end;
$$;
revoke all on function public.preview_friend_invite(text) from public;
grant execute on function public.preview_friend_invite(text) to anon, authenticated;

commit;

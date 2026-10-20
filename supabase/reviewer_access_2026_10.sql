-- ════════════════════════════════════════════════════════════════════
-- reviewer_access_2026_10.sql — App Review accounts (STARTUP_REQUIREMENTS
-- items 116 and 122; store pack gaps P2 and P3)
-- Run in the Supabase SQL editor. Owner-run; nothing applies it for you.
-- ════════════════════════════════════════════════════════════════════
--
-- WHY
--   A reviewer who buys Pro with Apple's/Google's sandbox account must end
--   up with server-side Pro, or the coach answers 403 right after "Welcome
--   to Pro". Sandbox events used to be honoured only by a GLOBAL switch
--   (REVENUECAT_ALLOW_SANDBOX=true) that had to be remembered and turned
--   off. This file gives the webhook a narrow list instead: the demo
--   accounts whose credentials go in the review notes. See
--   netlify/lib/reviewSandbox.js for the full decision (the list, the
--   self-expiring REVIEW_WINDOW_UNTIL env, the legacy override).
--
-- WHAT IT DOES
--   1. public.reviewer_access(email citext pk, note, expires_at,
--      grant_pro, prior_tier, granted_at, added_at) — RLS on, NO
--      policies, every privilege revoked from anon/authenticated. Keyed
--      by EMAIL so a row can be written before the account exists, like
--      lifetime_grants.sql. Each row expires (max 90 days): an expired
--      row stops honouring sandbox events on its own.
--   2. Owner functions — SQL-editor / service-role ONLY (execute revoked
--      from public, anon and authenticated, so no app session can call
--      them). They do not use is_app_owner(): the SQL editor has no
--      session, so an owner-in-app check would refuse there, and the SQL
--      editor is where the owner already runs lifetime grants.
--        reviewer_access_add(email, days, grant_pro, note) → jsonb
--        reviewer_access_remove(email)                     → jsonb
--        reviewer_access_list()                            → rows
--        review_preflight()                                → rows (check, ok, detail)
--   3. reviewer_sandbox_allowed(user_id) → boolean, for the RevenueCat
--      webhook (service role). True only for an unexpired row whose email
--      matches the account's CONFIRMED auth email — an unconfirmed
--      sign-up using a listed address inherits nothing.
--   4. Pro for the browsing demo account: grant_pro => true sets the
--      account's tier to 'lifetime' and records the tier it had before.
--      Lifetime, not 'pro', on purpose: the webhook never writes a
--      lifetime row (tier=neq.lifetime on every PATCH), so a reviewer's
--      sandbox subscription expiring on that account cannot demote it
--      mid-review. reviewer_access_remove puts back the recorded prior
--      tier — only if THIS list granted it and it is still lifetime.
--      A row's expiry ends sandbox honouring; it does NOT revoke the
--      grant (keep the demo account Pro for later reviews; remove the
--      row to revoke).
--
-- EXISTING ROWS: none are read or changed by running this file. The
--   only writes happen later, when you call reviewer_access_add/_remove,
--   and they touch profiles.tier of the listed (demo) accounts only.
--
-- PREREQUISITES
--   · supabase/paywall_schema.sql (public.profiles, public.config — live)
--   · citext (social_schema.sql — live)
--
-- RE-RUNNABLE: create … if not exists / create or replace. One transaction.
--
-- USE (SQL editor; addresses are placeholders — never commit real ones):
--   select public.reviewer_access_add('<reviewer-pro@company-domain>', 60, true,  'A: Pro demo');
--   select public.reviewer_access_add('<reviewer-free@company-domain>', 60, false, 'B: buys Pro in sandbox');
--   select * from public.reviewer_access_list();
--   select * from public.review_preflight();      -- before every submission
--   select public.reviewer_access_remove('<reviewer-free@company-domain>');
--
-- VERIFY after running:
--   select has_table_privilege('authenticated', 'public.reviewer_access', 'select'),
--          has_function_privilege('authenticated', 'public.reviewer_sandbox_allowed(uuid)', 'execute'),
--          has_function_privilege('anon', 'public.review_preflight()', 'execute'),
--          has_function_privilege('service_role', 'public.reviewer_sandbox_allowed(uuid)', 'execute');
--     -- expect false, false, false, true
--   select * from public.review_preflight();   -- runs; rows explain what is missing
--   Then Supabase → Advisors (security).
-- ════════════════════════════════════════════════════════════════════

begin;

do $$ begin
  perform public.ops_mark('sql', 'reviewer_access_2026_10.sql — start');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

do $$ begin
  if to_regclass('public.profiles') is null or to_regclass('public.config') is null then
    raise exception 'reviewer_access_2026_10.sql needs public.profiles and public.config — run supabase/paywall_schema.sql first';
  end if;
end $$;

create extension if not exists citext;

-- ── 1. The list ─────────────────────────────────────────────────────
create table if not exists public.reviewer_access (
  email      citext primary key
             check (char_length(email::text) between 3 and 254
                    and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  note       text check (note is null or char_length(note) <= 200),
  expires_at timestamptz not null,
  grant_pro  boolean not null default false,
  -- Set only when this list actually changed the account's tier to
  -- lifetime; prior_tier is what to put back on removal.
  prior_tier text check (prior_tier is null or prior_tier in ('free', 'pro')),
  granted_at timestamptz,
  added_at   timestamptz not null default now()
);

alter table public.reviewer_access enable row level security;
-- No policies on purpose: with RLS on and no policy, clients see nothing.
revoke all on public.reviewer_access from public, anon, authenticated;

-- ── 2. Helpers ──────────────────────────────────────────────────────
create or replace function public.reviewer_access_clean_email(p_email text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v) < 3 or char_length(v) > 254
     or v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function public.reviewer_access_clean_email(text) from public, anon, authenticated;

-- ── 3. Webhook check (service role) ─────────────────────────────────
create or replace function public.reviewer_sandbox_allowed(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from auth.users u
      join public.reviewer_access r on lower(r.email::text) = lower(u.email)
     where u.id = p_user_id
       and u.email_confirmed_at is not null
       and r.expires_at > now()
  );
$$;
revoke all on function public.reviewer_sandbox_allowed(uuid) from public, anon, authenticated;
grant execute on function public.reviewer_sandbox_allowed(uuid) to service_role;

-- ── 4. Owner functions (SQL editor / service role) ──────────────────
create or replace function public.reviewer_access_add(
  p_email text, p_days int default 30, p_grant_pro boolean default false, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text := public.reviewer_access_clean_email(p_email);
  v_note    text := nullif(left(btrim(coalesce(p_note, '')), 200), '');
  v_days    int  := coalesce(p_days, 30);
  v_uid     uuid;
  v_conf    boolean;
  v_tier    text;
  v_granted boolean := false;
  v_row     public.reviewer_access;
begin
  if v_days < 1 or v_days > 90 then
    raise exception 'days must be between 1 and 90' using errcode = '22023';
  end if;

  insert into public.reviewer_access as r (email, note, expires_at, grant_pro)
  values (v_email, v_note, now() + make_interval(days => v_days), coalesce(p_grant_pro, false))
  on conflict (email) do update
    set note       = coalesce(excluded.note, r.note),
        expires_at = excluded.expires_at,
        grant_pro  = excluded.grant_pro or r.grant_pro;

  select u.id, u.email_confirmed_at is not null into v_uid, v_conf
    from auth.users u where lower(u.email) = v_email limit 1;

  if v_uid is not null then
    select p.tier into v_tier from public.profiles p where p.id = v_uid;
    select * into v_row from public.reviewer_access r where lower(r.email::text) = v_email;
    -- Grant lifetime once, recording what it replaces. An account that
    -- is already lifetime (a founder grant) is left alone and NOT
    -- recorded, so removing it from this list never takes that away.
    if v_row.grant_pro and v_tier is not null and v_tier <> 'lifetime' and v_row.granted_at is null then
      update public.profiles set tier = 'lifetime', tier_updated_at = now() where id = v_uid;
      update public.reviewer_access set prior_tier = v_tier, granted_at = now() where lower(email::text) = v_email;
      v_granted := true;
      v_tier := 'lifetime';
    end if;
  end if;

  select * into v_row from public.reviewer_access r where lower(r.email::text) = v_email;
  return jsonb_build_object(
    'email', v_email,
    'expires_at', v_row.expires_at,
    'account_found', v_uid is not null,
    'email_confirmed', coalesce(v_conf, false),
    'profile_found', v_tier is not null,
    'tier', v_tier,
    'granted_now', v_granted,
    'hint', case
      when v_uid is null then 'no account with this email yet: create it, then run this again to apply the grant'
      when v_tier is null then 'account has no profiles row yet: sign in once (or run the demo seeder), then run this again'
      when not coalesce(v_conf, false) then 'email not confirmed: sandbox events stay refused until it is'
      else null end);
end;
$$;
revoke all on function public.reviewer_access_add(text, int, boolean, text) from public, anon, authenticated;
grant execute on function public.reviewer_access_add(text, int, boolean, text) to service_role;

create or replace function public.reviewer_access_remove(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email    text := public.reviewer_access_clean_email(p_email);
  v_row      public.reviewer_access;
  v_uid      uuid;
  v_reverted text := null;
begin
  select * into v_row from public.reviewer_access r where lower(r.email::text) = v_email;
  if not found then
    return jsonb_build_object('email', v_email, 'removed', false);
  end if;
  if v_row.granted_at is not null then
    select u.id into v_uid from auth.users u where lower(u.email) = v_email limit 1;
    if v_uid is not null then
      update public.profiles
         set tier = coalesce(v_row.prior_tier, 'free'), tier_updated_at = now()
       where id = v_uid and tier = 'lifetime';
      if found then v_reverted := coalesce(v_row.prior_tier, 'free'); end if;
    end if;
  end if;
  delete from public.reviewer_access r where lower(r.email::text) = v_email;
  return jsonb_build_object('email', v_email, 'removed', true, 'tier_reverted_to', v_reverted);
end;
$$;
revoke all on function public.reviewer_access_remove(text) from public, anon, authenticated;
grant execute on function public.reviewer_access_remove(text) to service_role;

create or replace function public.reviewer_access_list()
returns table (email text, note text, expires_at timestamptz, active boolean,
               grant_pro boolean, granted_by_list boolean, account_found boolean, tier text)
language sql stable security definer set search_path = '' as $$
  select r.email::text, r.note, r.expires_at, r.expires_at > now(),
         r.grant_pro, r.granted_at is not null, u.id is not null, p.tier
    from public.reviewer_access r
    left join auth.users u on lower(u.email) = lower(r.email::text)
    left join public.profiles p on p.id = u.id
   order by r.added_at, r.email::text;
$$;
revoke all on function public.reviewer_access_list() from public, anon, authenticated;
grant execute on function public.reviewer_access_list() to service_role;

-- ── 5. Before every submission ──────────────────────────────────────
-- One row per check. Emails appear in `detail` (this runs in the owner's
-- SQL editor only); user ids never do. Columns that a given database may
-- not have (leaderboard_optin, is_searchable) are read through to_jsonb
-- so a missing column reads as "unknown", not an error.
create or replace function public.review_preflight()
returns table (check_name text, ok boolean, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_live   text;
  v_active int;
  r        record;
  v_pj     jsonb;
  v_days   numeric;
  v_state  jsonb;
begin
  select c.value into v_live from public.config c where c.key = 'pro_live';
  check_name := 'config.pro_live is ''true''';
  ok := coalesce(v_live, '') = 'true';
  detail := case when ok then 'paywall shows the store products'
                 else 'currently ' || coalesce('''' || v_live || '''', 'missing') ||
                      ' — run: update public.config set value = ''true'' where key = ''pro_live'';' end;
  return next;

  select count(*) into v_active from public.reviewer_access a where a.expires_at > now();
  check_name := 'reviewer list has active rows';
  ok := v_active > 0;
  detail := v_active || ' active (sandbox purchases on these accounts unlock Pro)';
  return next;

  check_name := 'Apple token revocation table (item 117)';
  ok := to_regclass('public.apple_tokens') is not null;
  detail := case when ok then 'apple_tokens exists' else 'run supabase/apple_revocation_2026_10.sql' end;
  return next;

  for r in
    select a.email::text as email, a.expires_at, a.grant_pro, a.granted_at,
           u.id as uid, u.created_at as u_created, u.email_confirmed_at
      from public.reviewer_access a
      left join auth.users u on lower(u.email) = lower(a.email::text)
     order by a.added_at, a.email::text
  loop
    check_name := r.email || ': account exists and is confirmed';
    ok := r.uid is not null and r.email_confirmed_at is not null;
    detail := case when r.uid is null then 'no account — create it (scripts/reviewer-demo, or sign up)'
                   when r.email_confirmed_at is null then 'email not confirmed'
                   else 'ok' end;
    return next;

    check_name := r.email || ': list row valid for 7+ more days';
    ok := r.expires_at > now() + interval '7 days';
    detail := 'expires ' || to_char(r.expires_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC' ||
              case when ok then '' else ' — extend: select public.reviewer_access_add(''' || r.email || ''', 60, ' ||
                   r.grant_pro::text || ');' end;
    return next;

    continue when r.uid is null;

    v_days := extract(epoch from (now() - r.u_created)) / 86400;
    check_name := r.email || ': account is 28+ days old';
    ok := v_days >= 28;
    detail := round(v_days)::text || ' days — ratings cap history at account age (item 122)';
    return next;

    select to_jsonb(p) into v_pj from public.profiles p where p.id = r.uid;
    check_name := r.email || ': tier';
    if r.grant_pro then
      ok := coalesce(v_pj->>'tier', '') = 'lifetime';
      detail := 'expected lifetime (grant_pro), is ' || coalesce(v_pj->>'tier', 'no profile row');
    else
      ok := v_pj is not null;
      detail := coalesce(v_pj->>'tier', 'no profile row — sign in once') ||
                ' (no grant; buys Pro in sandbox)';
    end if;
    return next;

    check_name := r.email || ': off the public board and handle search';
    ok := v_pj is not null
          and coalesce(v_pj->>'leaderboard_optin', 'false') = 'false'
          and coalesce(v_pj->>'is_searchable', 'false') = 'false';
    detail := 'leaderboard_optin=' || coalesce(v_pj->>'leaderboard_optin', 'unknown') ||
              ', is_searchable=' || coalesce(v_pj->>'is_searchable', 'unknown');
    return next;

    v_state := null;
    begin
      execute 'select state from public.user_data where id = $1' into v_state using r.uid;
    exception when undefined_table then v_state := null;
    end;
    check_name := r.email || ': has seeded data';
    ok := v_state is not null and v_state ? 'profile';
    detail := case when v_state is null then 'no user_data row — run scripts/reviewer-demo/seed.mjs'
                   when v_state ? 'demoSeed' then 'demo seed present'
                   else 'state present (not from the demo seeder)' end;
    return next;
  end loop;
end;
$$;
revoke all on function public.review_preflight() from public, anon, authenticated;
grant execute on function public.review_preflight() to service_role;

do $$ begin
  perform public.ops_mark('sql', 'reviewer_access_2026_10.sql — done');
exception when undefined_function or undefined_table or invalid_schema_name or insufficient_privilege then null;
end $$;

commit;

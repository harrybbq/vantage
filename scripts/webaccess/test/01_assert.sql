-- Assertions for web_access_2026_10b.sql. Runs as postgres and switches
-- role / JWT subject per check, the way PostgREST does per request.
\set ON_ERROR_STOP 1

-- Mode seeded open; config is readable by anon (paywall policy).
do $$ begin
  assert (select value from public.config where key = 'web_access') = 'open', 'mode seeded open';
end $$;

set role anon;
do $$ begin
  assert (select value from public.config where key = 'web_access') = 'open', 'anon reads the mode';
end $$;
-- anon can't call any management RPC, nor the allowed check, nor read the list
do $$
declare f text;
begin
  foreach f in array array['web_access_list()', 'web_access_add(''a@b.co'',null)', 'web_access_remove(''a@b.co'')',
                            'web_access_set_mode(''open'')', 'web_access_allowed()'] loop
    begin
      execute 'select public.' || f;
      raise exception 'anon could call %', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform 1 from public.web_access_allowlist;
    raise exception 'anon could read the list';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Open mode: everyone signed in is allowed.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin assert public.web_access_allowed(), 'open mode → stranger allowed'; end $$;

-- A non-owner gets 42501 from every management RPC and can't touch the table.
do $$
declare f text;
begin
  foreach f in array array['web_access_list()', 'web_access_add(''x@y.co'',''n'')', 'web_access_remove(''x@y.co'')',
                            'web_access_set_mode(''allowlist'')'] loop
    begin
      execute 'select public.' || f;
      raise exception 'non-owner could call %', f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform 1 from public.web_access_allowlist;
    raise exception 'authenticated could read the table';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.config set value = 'allowlist' where key = 'web_access';
  exception when insufficient_privilege then null;   -- or 0 rows under RLS
  end;
end $$;
-- internal helpers are not callable from a client
do $$ begin
  begin perform public.web_access_mark('x'); raise exception 'mark callable'; exception when insufficient_privilege then null; end;
  begin perform public.web_access_mode(); raise exception 'mode() callable'; exception when insufficient_privilege then null; end;
  begin perform public.web_access_require_owner(); raise exception 'require_owner callable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select value from public.config where key = 'web_access') = 'open', 'non-owner could not flip the mode';
end $$;

-- Owner manages the list.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$
declare r record; n int;
begin
  select * into r from public.web_access_add('  FRIEND@example.com ', '  school friend ');
  assert r.email = 'friend@example.com', 'email stored lower-cased and trimmed: ' || r.email;
  assert r.note = 'school friend', 'note trimmed';
  perform public.web_access_add('pending@example.com', null);
  perform public.web_access_add('gone@example.com', 'to remove');
  -- re-adding keeps one row and updates the note
  perform public.web_access_add('Friend@Example.com', 'best friend');
  select count(*) into n from public.web_access_list();
  assert n = 3, 'three entries, got ' || n;
  assert (select l.note from public.web_access_list() l where l.email = 'friend@example.com') = 'best friend', 'note updated';
  -- bad input refused
  begin perform public.web_access_add('not-an-email', null); raise exception 'bad email accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.web_access_set_mode('closed'); raise exception 'bad mode accepted';
  exception when invalid_parameter_value then null; end;
  -- remove
  assert public.web_access_remove('GONE@example.com') = true, 'removed';
  assert public.web_access_remove('gone@example.com') = false, 'second remove is a no-op';
  select count(*) into n from public.web_access_list();
  assert n = 2, 'two entries left';
  -- switch to allowlist
  assert (public.web_access_set_mode('ALLOWLIST') ->> 'mode') = 'allowlist', 'mode set';
  assert public.web_access_allowed(), 'owner allowed in allowlist mode without being listed';
end $$;
reset role;
do $$ begin
  assert (select value from public.config where key = 'web_access') = 'allowlist', 'config row flipped';
  assert (select added_by from public.web_access_allowlist where email = 'friend@example.com')
         = '00000000-0000-4000-8000-000000000001', 'added_by recorded server-side';
  -- the list RPC has no user-id output column
  assert not exists (select 1 from information_schema.parameters p
                       join information_schema.routines r on r.specific_name = p.specific_name
                      where r.routine_name in ('web_access_list', 'web_access_add')
                        and p.parameter_mode = 'OUT' and p.data_type = 'uuid'), 'no uuid returned';
end $$;

-- Allowlist mode answers.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$ begin assert public.web_access_allowed(), 'listed friend (mixed-case auth email) allowed'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin assert not public.web_access_allowed(), 'stranger refused'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
do $$ begin assert not public.web_access_allowed(), 'unconfirmed account using a listed address refused'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);
do $$ begin assert not public.web_access_allowed(), 'listed but unconfirmed refused'; end $$;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin assert not public.web_access_allowed(), 'no session refused'; end $$;
-- a stranger still can't reopen it
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin
  begin perform public.web_access_set_mode('open'); raise exception 'stranger reopened';
  exception when insufficient_privilege then null; end;
end $$;
-- owner removes the friend → refused; reopens → everyone allowed
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$ begin perform public.web_access_remove('friend@example.com'); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
do $$ begin assert not public.web_access_allowed(), 'removed friend refused'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
do $$ begin assert (public.web_access_set_mode('open') ->> 'mode') = 'open', 'reopened'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin assert public.web_access_allowed(), 'reopened → stranger allowed'; end $$;
reset role;

-- A missing config row reads as open.
delete from public.config where key = 'web_access';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);
do $$ begin assert public.web_access_allowed(), 'missing row → open'; end $$;
reset role;
insert into public.config (key, value) values ('web_access', 'open');

-- Privileges as the verify block in the file header states them.
do $$ begin
  assert not has_table_privilege('authenticated', 'public.web_access_allowlist', 'select'), 'no table select';
  assert not has_function_privilege('anon', 'public.web_access_add(text,text)', 'execute'), 'anon no add';
  assert has_function_privilege('authenticated', 'public.web_access_allowed()', 'execute'), 'authenticated may ask';
  assert (select relrowsecurity from pg_class where oid = 'public.web_access_allowlist'::regclass), 'RLS on';
  assert (select count(*) from pg_policies where tablename = 'web_access_allowlist') = 0, 'no policies';
end $$;

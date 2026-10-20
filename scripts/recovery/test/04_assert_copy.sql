-- Assertions on the COPY side: what export_user_bundle produces.
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

create temp table b as select pg_read_file(:'dir' || '/alice.json')::jsonb as j;

select pg_temp.check((select j ->> 'format' from b) = 'vantage-user-bundle', 'bundle format tag');
select pg_temp.check((select (j -> 'manifest' ->> 'schema_version')::int from b) = 1, 'manifest schema_version');
select pg_temp.check((select j -> 'manifest' ->> 'source_note' from b) = 'test copy at T', 'manifest source note');
select pg_temp.check((select (j -> 'manifest' -> 'tables' ->> 'nutrition_log')::int from b) = 2000, 'manifest: 2000 food rows for Alice (none of Bob''s)');
select pg_temp.check((select jsonb_array_length(j -> 'tables' -> 'nutrition_log' -> 'rows') from b) = 2000, 'rows match the manifest count');
select pg_temp.check((select (j -> 'manifest' -> 'tables' ->> 'messages')::int from b) = 4, 'messages: sent and received (1,2,20,21), not Bob→Carol');
select pg_temp.check((select (j -> 'manifest' -> 'tables' ->> 'training_sets')::int from b) = 20, 'training sets exported');
select pg_temp.check((select (j -> 'manifest' -> 'tables' ->> 'profiles')::int from b) = 1, 'profile row exported (matched on id)');
select pg_temp.check((select j -> 'manifest' -> 'policies' ->> 'nutrition_log' from b) = 'restore', 'nutrition_log policy restore');
select pg_temp.check((select j -> 'manifest' -> 'policies' ->> 'messages' from b) = 'review', 'messages policy review');
select pg_temp.check((select j -> 'manifest' -> 'policies' ->> 'whoop_tokens' from b) = 'never', 'whoop_tokens policy never');
select pg_temp.check((select j -> 'manifest' -> 'policies' ->> 'zz_generated_probe' from b) = 'review', 'an unknown table defaults to review');
select pg_temp.check((select not (j -> 'tables' ? 'client_errors') from b), 'skip tables (client_errors) are not exported');
select pg_temp.check((select not (j -> 'tables' ? 'user_data') from b), 'user_data is not in tables[] (handled separately)');

-- Identity for matching only, never the password hash.
select pg_temp.check((select j -> 'identity' ->> 'email' from b) = 'alice@example.test', 'identity email');
select pg_temp.check((select j::text not like '%HASH-must-never-be-exported%' from b), 'no password hash anywhere in the bundle');
select pg_temp.check((select not (j -> 'identity' ? 'encrypted_password') from b), 'identity has no password field');

-- Secrets stripped.
select pg_temp.check((select j::text not like '%SECRET-ACCESS%' and j::text not like '%SECRET-REFRESH%' and j::text not like '%SECRET-PUSH-TOKEN%' from b),
                     'no OAuth or push token in the bundle');
select pg_temp.check((select jsonb_array_length(j -> 'tables' -> 'whoop_tokens' -> 'rows') from b) = 1, 'the WHOOP row is still listed (redacted)');

-- user_data: whole row, heavy state and photo included.
select pg_temp.check((select (j -> 'user_data' -> 'state' ->> 'coins')::int from b) = 421, 'state at T');
select pg_temp.check((select j -> 'user_data' -> 'state' ? 'backgrounds' from b), 'backgrounds included (history snapshots strip them)');
select pg_temp.check((select j -> 'user_data' ->> 'photo' like 'data:image/jpeg;base64,%' from b), 'photo column included');
select pg_temp.check((select (j -> 'manifest' ->> 'state_bytes')::int from b) > 100000, 'manifest state_bytes reports a heavy state');
select pg_temp.check((select j -> 'manifest' -> 'copy_hints' ? 'latest_ops_mark' from b), 'copy hints carry the newest ops mark');

-- The export was marked in the copy.
select pg_temp.check((select count(*) from public.ops_log where kind = 'recovery' and label = 'export_user_bundle') = 2, 'each export wrote an ops_log mark');
select pg_temp.check((select details::text not like '%aaaaaaaa%' from public.ops_log where label = 'export_user_bundle' order by id limit 1), 'marks hold a user_ref, not the raw id');

-- An unknown id is an error, not an empty bundle.
do $$ begin
  perform public.export_user_bundle('dddddddd-0000-4000-8000-000000000009');
  raise exception 'FAIL: export of an unknown user should raise';
exception when raise_exception then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok  export refuses an id with no auth.users row';
end $$;

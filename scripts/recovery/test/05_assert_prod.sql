-- Assertions on the PRODUCTION side: import_user_bundle, ops_log, grants.
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

create temp table b as select pg_read_file(:'dir' || '/alice.json')::jsonb as j;
create temp table bc as select pg_read_file(:'dir' || '/carol.json')::jsonb as j;
grant select on b, bc to authenticated, anon, service_role;

create temp table snap_before as
select (select count(*) from public.nutrition_log where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') as food,
       (select count(*) from public.training_sets) as sets,
       (select count(*) from public.messages) as msgs,
       (select count(*) from public.user_data_history where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') as hist,
       (select count(*) from public.ops_log) as marks,
       (select state from public.user_data where id = 'aaaaaaaa-0000-4000-8000-000000000001') as state,
       (select updated_at from public.user_data where id = 'aaaaaaaa-0000-4000-8000-000000000001') as updated_at;

select pg_temp.check((select food from snap_before) = 1801, 'prod starts with 1,801 food rows (200 lost, 1 added)');

-- ── 1. dry_run reports, keeps nothing ───────────────────────────────
create temp table r1 as select public.import_user_bundle((select j from b)) as r;   -- default mode = dry_run

select pg_temp.check((select r ->> 'ok' from r1) = 'true' and (select r ->> 'mode' from r1) = 'dry_run', 'dry_run is the default mode');
select pg_temp.check((select (r -> 'tables' -> 'nutrition_log' ->> 'insert')::int from r1) = 200, 'dry_run: 200 food rows would be inserted');
select pg_temp.check((select (r -> 'tables' -> 'nutrition_log' ->> 'conflict_production_kept')::int from r1) = 1, 'dry_run: 1 conflict (edited after T) reported');
select pg_temp.check((select (r -> 'tables' -> 'nutrition_log' ->> 'already_present')::int from r1) = 1799, 'dry_run: 1,799 identical rows already present');
select pg_temp.check((select r -> 'tables' -> 'nutrition_log' -> 'conflict_sample_pk' -> 0 ->> 'id' from r1) = md5('nl1')::uuid::text, 'dry_run: conflict sample names the row by primary key only');
select pg_temp.check((select (r -> 'tables' -> 'training_sessions' ->> 'insert')::int from r1) = 1, 'dry_run: the lost session would come back');
select pg_temp.check((select (r -> 'tables' -> 'training_sets' ->> 'insert')::int from r1) = 4, 'dry_run: its 4 sets too (parent inserted first, inside the rolled-back block)');
select pg_temp.check((select (r -> 'tables' -> 'body_measurements' ->> 'skipped_other_unique')::int from r1) = 1, 'dry_run: a row colliding on a non-PK unique key is reported, not forced');
select pg_temp.check((select (r -> 'tables' -> 'messages' ->> 'not_selected')::int from r1) = 3, 'dry_run: 3 lost DMs listed but not selected (review table)');
select pg_temp.check((select (r -> 'tables' -> 'friendships' ->> 'not_selected')::int from r1) = 1, 'dry_run: the unfriending is not undone by default');
select pg_temp.check((select r -> 'tables' -> 'whoop_tokens' ->> 'status' from r1) like 'never imported%', 'dry_run: WHOOP tokens never imported');
select pg_temp.check((select r -> 'tables' -> 'zz_no_pk' ->> 'status' from r1) like 'skipped: table has no primary key%', 'dry_run: a table without a primary key is skipped');
select pg_temp.check((select (r -> 'tables' -> 'tracker_streaks' ->> 'already_present')::int from r1) = 3, 'dry_run: composite-key rows matched');
select pg_temp.check((select r -> 'user_data' ->> 'status' from r1) like 'dry_run (rolled back): state differs%', 'dry_run: state difference reported as a would-be snapshot');
select pg_temp.check((select r -> 'user_data' ->> 'photo' from r1) like 'production has none%', 'dry_run: lost photo reported as restorable');
select pg_temp.check((select (r -> 'user_data' ->> 'bundle_meaningful')::boolean and not (r -> 'user_data' ->> 'production_meaningful')::boolean from r1), 'dry_run: meaningful flags (bundle yes, wiped production no)');

select pg_temp.check((select count(*) from public.nutrition_log where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select food from snap_before), 'dry_run wrote no food rows');
select pg_temp.check((select count(*) from public.training_sets) = (select sets from snap_before), 'dry_run wrote no sets');
select pg_temp.check((select count(*) from public.user_data_history where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select hist from snap_before), 'dry_run added no history snapshot');
select pg_temp.check((select count(*) from public.recovery_bundles) = 0, 'dry_run kept no bundle');
select pg_temp.check((select count(*) from public.ops_log) = (select marks from snap_before) + 1, 'dry_run wrote exactly one ops mark');
select pg_temp.check((select label from public.ops_log order by id desc limit 1) = 'import_user_bundle dry_run', 'the mark names the mode');

-- A hand-edited bundle can't slip another user's row in.
select pg_temp.check((
  select (public.import_user_bundle(jsonb_insert(j, '{tables,nutrition_log,rows,0}',
            jsonb_build_object('id', gen_random_uuid(), 'user_id', 'bbbbbbbb-0000-4000-8000-000000000002',
                               'log_date', '2026-05-05', 'meal_type', 'lunch', 'food_name', 'smuggled'))) -> 'tables' -> 'nutrition_log' ->> 'not_this_user')::int
  from b) = 1, 'a row belonging to someone else is rejected (not_this_user)');
select pg_temp.check((select count(*) from public.nutrition_log where food_name = 'smuggled') = 0, 'and never written');

-- ── 2. restore_missing: inserts only what is missing ────────────────
create temp table r2 as select public.import_user_bundle((select j from b), 'restore_missing') as r;

select pg_temp.check((select r ->> 'ok' from r2) = 'true', 'restore_missing ok');
select pg_temp.check((select (r -> 'totals' ->> 'failed')::int from r2) = 0, 'restore_missing: no failures');
select pg_temp.check((select count(*) from public.nutrition_log where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 2001, 'the 200 lost food rows are back (1801 + 200)');
select pg_temp.check((select calories from public.nutrition_log where id = md5('nl1')::uuid) = 9999, 'the row edited after T keeps production''s value');
select pg_temp.check((select count(*) from public.nutrition_log where id = md5('nl-after-T')::uuid) = 1, 'the row added after T is untouched');
select pg_temp.check((select (additional_nutrients ->> 'vit_c_mg')::int from public.nutrition_log where id = md5('nl20')::uuid) = 20, 'restored rows keep every column (jsonb included)');
select pg_temp.check((select created_at from public.nutrition_log where id = md5('nl20')::uuid) = timestamptz '2026-01-01 08:00+00' + interval '20 hours', 'restored rows keep their original timestamps');
select pg_temp.check((select count(*) from public.training_sets where session_id = md5('ts1')::uuid) = 4, 'the lost session and its sets are back');
select pg_temp.check((select count(*) from public.body_measurements where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 30
                     and (select waist_cm from public.body_measurements where id = md5('bm1-relogged')::uuid) = 84.5,
                     'the re-logged measurement is kept; the colliding old one is not forced in');
select pg_temp.check((select count(*) from public.messages) = (select msgs from snap_before), 'DMs (review) not restored by default');
select pg_temp.check((select count(*) from public.friendships) = 0, 'friendship (review) not restored by default');
select pg_temp.check((select count(*) from public.whoop_tokens) = 0, 'WHOOP tokens never restored');

-- user_data.state is NEVER overwritten.
select pg_temp.check((select state from public.user_data where id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select state from snap_before), 'production state untouched');
select pg_temp.check((select updated_at from public.user_data where id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select updated_at from snap_before), 'production updated_at untouched (devices see no change)');
select pg_temp.check((select photo is null from public.user_data where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'photo column not written');
select pg_temp.check((select count(*) from public.user_data_history where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select hist from snap_before) + 1, 'one history snapshot added');
select pg_temp.check((select h.reason = 'bundle-restore' and (h.state ->> 'coins')::int = 421 and h.state ? 'backgrounds'
                        from public.user_data_history h where h.id = (select (r -> 'user_data' ->> 'history_snapshot_id')::bigint from r2)),
                     'the snapshot is the bundle''s full state (backgrounds included), reason bundle-restore');
select pg_temp.check((select count(*) from public.recovery_bundles where id = (select (r ->> 'recovery_bundle_id')::bigint from r2)) = 1, 'bundle + report kept in recovery_bundles');
select pg_temp.check((select history_snapshot_id from public.recovery_bundles limit 1) = (select (r -> 'user_data' ->> 'history_snapshot_id')::bigint from r2), 'recovery_bundles points at the snapshot');
select pg_temp.check((select label from public.ops_log order by id desc limit 1) = 'import_user_bundle restore_missing', 'restore_missing wrote its mark');
select pg_temp.check((select (details -> 'totals' ->> 'insert')::int from public.ops_log order by id desc limit 1) = 205, 'the mark carries the totals (200 food + 1 session + 4 sets)');

-- Re-running is harmless.
create temp table r3 as select public.import_user_bundle((select j from b), 'restore_missing') as r;
select pg_temp.check((select (r -> 'totals' ->> 'insert')::int from r3) = 0, 're-run inserts nothing');
select pg_temp.check((select count(*) from public.user_data_history where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = (select hist from snap_before) + 1, 're-run does not stack another identical snapshot');

-- ── 3. review tables only when named ────────────────────────────────
create temp table r4 as select public.import_user_bundle((select j from b), 'restore_missing',
                                                         array['messages', 'friendships', 'zz_generated_probe']) as r;
select pg_temp.check((select (r -> 'tables' -> 'messages' ->> 'insert')::int from r4) = 3 and (select (r -> 'tables' -> 'messages' ->> 'failed')::int from r4) = 0,
                     'named review table: 3 DMs back, the reply retried after the message it quotes');
select pg_temp.check((select reply_to from public.messages where id = 21) = 20, 'reply link intact');
select pg_temp.check((select count(*) from public.friendships) = 1, 'friendship back when named');
select pg_temp.check((select kilos from public.zz_generated_probe where id = md5('gp2')::uuid) = 2.5, 'generated column recomputed, not copied');
select pg_temp.check((select (r -> 'tables' -> 'nutrition_log' ->> 'not_selected')::int from r4) = 0
                     and not (select (r -> 'tables' -> 'nutrition_log' ->> 'selected')::boolean from r4), 'p_tables narrows the selection');
insert into public.messages (sender_id, recipient_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'new after restore');
select pg_temp.check((select max(id) from public.messages) > 21, 'identity sequence unaffected by explicit ids');

-- ── 4. refusals ─────────────────────────────────────────────────────
select pg_temp.check((select (public.import_user_bundle(j) ->> 'refused') like 'email in the bundle differs%' from bc), 'email mismatch refused');
select pg_temp.check((select (public.import_user_bundle(j, 'restore_missing') ->> 'ok')::boolean = false from bc), 'email mismatch refused in restore mode too');
select pg_temp.check((select label from public.ops_log order by id desc limit 1) = 'import_user_bundle refused', 'a refusal is marked');
select pg_temp.check((select (public.import_user_bundle(jsonb_set(j, '{identity,id}', '"dddddddd-0000-4000-8000-000000000009"')) ->> 'refused') like 'that user id does not exist%' from b),
                     'unknown user id refused');
select pg_temp.check((select (public.import_user_bundle(j, 'overwrite') ->> 'refused') like 'p_mode must be%' from b), 'unknown mode refused');
select pg_temp.check((public.import_user_bundle('{"hello":1}'::jsonb) ->> 'refused') like 'not a Vantage user bundle%', 'non-bundle refused');
select pg_temp.check((select (public.import_user_bundle(jsonb_set(j, '{version}', '2')) ->> 'refused') like 'unsupported bundle version%' from b), 'future bundle version refused');
create temp table r5 as select public.import_user_bundle((select j from bc), 'restore_missing', null, true) as r;
select pg_temp.check((select r ->> 'ok' from r5) = 'true' and (select r ->> 'email_matched' from r5) = 'false', 'explicit override imports and says the email did not match');

-- recovery_bundles cascades with the account (item 20).
select pg_temp.check((select count(*) from public.recovery_bundles where user_id = 'cccccccc-0000-4000-8000-000000000003') = 1, 'Carol''s import kept a bundle');
delete from auth.users where id = 'cccccccc-0000-4000-8000-000000000003';
select pg_temp.check((select count(*) from public.recovery_bundles where user_id = 'cccccccc-0000-4000-8000-000000000003') = 0, 'deleting the account deletes the held bundle');

-- ── 5. grants: ops_log append-only, functions SQL-editor only ───────
create function pg_temp.denied(sql text, as_role text) returns boolean language plpgsql as $$
begin
  execute format('set local role %I', as_role);
  begin
    execute sql;
  exception when insufficient_privilege then
    reset role;
    return true;
  end;
  reset role;
  return false;
end $$;

begin;
select pg_temp.check(pg_temp.denied('select * from public.ops_log', 'authenticated'), 'authenticated cannot read ops_log');
select pg_temp.check(pg_temp.denied($q$insert into public.ops_log (kind, label) values ('x', 'y')$q$, 'authenticated'), 'authenticated cannot insert into ops_log');
select pg_temp.check(pg_temp.denied($q$update public.ops_log set label = 'forged'$q$, 'authenticated'), 'authenticated cannot update ops_log');
select pg_temp.check(pg_temp.denied('delete from public.ops_log', 'authenticated'), 'authenticated cannot delete from ops_log');
select pg_temp.check(pg_temp.denied($q$select public.ops_mark('x', 'y')$q$, 'authenticated'), 'authenticated cannot call ops_mark');
select pg_temp.check(pg_temp.denied($q$select public.ops_mark('x', 'y')$q$, 'anon'), 'anon cannot call ops_mark');
select pg_temp.check(pg_temp.denied('select public.import_user_bundle((select j from pg_temp.b))', 'authenticated'), 'authenticated cannot call import_user_bundle');
select pg_temp.check(pg_temp.denied($q$select public.export_user_bundle('aaaaaaaa-0000-4000-8000-000000000001')$q$, 'authenticated'), 'authenticated cannot call export_user_bundle');
select pg_temp.check(pg_temp.denied('select public.import_user_bundle((select j from pg_temp.b))', 'service_role'), 'service_role cannot call import_user_bundle (SQL editor only)');
select pg_temp.check(pg_temp.denied($q$select public.export_user_bundle('aaaaaaaa-0000-4000-8000-000000000001')$q$, 'service_role'), 'service_role cannot call export_user_bundle');
select pg_temp.check(pg_temp.denied('select * from public.recovery_bundles', 'authenticated'), 'authenticated cannot read recovery_bundles');
select pg_temp.check(pg_temp.denied('select * from public.recovery_bundles', 'service_role'), 'service_role cannot read recovery_bundles');
select pg_temp.check(not pg_temp.denied($q$select public.ops_mark('test', 'service mark', '{"actor":"netlify:test"}')$q$, 'service_role'), 'service_role CAN call ops_mark');
select pg_temp.check(not pg_temp.denied('select count(*) from public.ops_log', 'service_role'), 'service_role CAN read ops_log');
select pg_temp.check(pg_temp.denied($q$update public.ops_log set label = 'forged'$q$, 'service_role'), 'service_role cannot update ops_log');
select pg_temp.check(pg_temp.denied('delete from public.ops_log', 'service_role'), 'service_role cannot delete from ops_log');
commit;
select pg_temp.check((select actor from public.ops_log where label = 'service mark') = 'netlify:test', 'details.actor names the caller');
select pg_temp.check((select not (details ? 'actor') from public.ops_log where label = 'service mark'), 'actor is moved out of details');

-- Even the owner can't edit or remove a mark without dropping the trigger.
do $$ begin
  update public.ops_log set label = 'forged';
  raise exception 'FAIL: owner update should be refused';
exception when insufficient_privilege then raise notice 'ok  owner update refused by the append-only trigger';
end $$;
do $$ begin
  delete from public.ops_log;
  raise exception 'FAIL: owner delete should be refused';
exception when insufficient_privilege then raise notice 'ok  owner delete refused by the append-only trigger';
end $$;
do $$ begin
  truncate public.ops_log;
  raise exception 'FAIL: owner truncate should be refused';
exception when insufficient_privilege then raise notice 'ok  owner truncate refused by the append-only trigger';
end $$;

-- Marks order correctly and the SQL file's own start/done marks exist.
select pg_temp.check((select count(*) from public.ops_log where label = 'recovery_2026_10b.sql — done') >= 1, 'the SQL file marked itself done');
select pg_temp.check((select count(*) from public.ops_log where label = 'recovery_2026_10b.sql — start') >= 1, 'a re-run marked its start (ops_mark existed by then)');
select pg_temp.check((select bool_and(at <= clock_timestamp()) from public.ops_log), 'mark times are real clock times');
select pg_temp.check(
  (select s.at < d.at from public.ops_log s, public.ops_log d
    where s.label = 'recovery_2026_10b.sql — start' and d.label = 'recovery_2026_10b.sql — done' and d.id > s.id
    order by s.id desc limit 1),
  'start and done marks of one transaction get distinct times (clock_timestamp)');

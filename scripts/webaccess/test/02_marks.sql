-- With recovery_2026_10b.sql applied: start/done marks and one mark per
-- edit, none holding an email.
\set ON_ERROR_STOP 1
do $$ begin
  assert exists (select 1 from public.ops_log where label = 'web_access_2026_10b.sql — done'), 'done mark';
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
select public.web_access_add('mark@example.com', 'n');
select public.web_access_set_mode('allowlist');
select public.web_access_remove('mark@example.com');
select public.web_access_set_mode('open');
reset role;
do $$ begin
  assert (select count(*) from public.ops_log where kind = 'web_access') = 4, 'four edit marks';
  assert not exists (select 1 from public.ops_log where details::text like '%@%' or label like '%@%'), 'no email in marks';
  assert exists (select 1 from public.ops_log where label = 'web access: mode set to allowlist'
                   and (details ->> 'listed')::int = 1), 'mark carries the list size';
end $$;

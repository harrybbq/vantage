-- Retire what is left of the waitlist (removed from the app in #229).
--
-- Run in the Supabase SQL editor. One transaction; safe to re-run.
--
-- WHY
--   Supabase's security advisor flags `public.waitlist_count` as an ERROR
--   (security_definer_view): a view that runs with its creator's rights,
--   readable without signing in. Nothing in the app reads it any more, and
--   nothing writes the waitlist either, so the insert policy is a door to
--   a room nobody uses.
--
-- WHAT IT CHANGES
--   · drops the view `waitlist_count` (a count, no data of its own)
--   · drops the insert policy on `waitlist`, so no client can add a row
--
-- WHAT IT DOES NOT TOUCH
--   The rows already in `waitlist` stay exactly as they are. Deleting them
--   is a separate decision (they are email sign-ups for a launch that has
--   happened); the statement is at the bottom, commented out.
--
-- VERIFY AFTER RUNNING
--   select to_regclass('public.waitlist_count');           -- expect null
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'waitlist'; -- expect 0
--   Then Supabase → Advisors → Security: the ERROR is gone.

begin;

do $$ begin
  perform public.ops_mark('sql', 'waitlist_retire_2026_10.sql — start');
exception when others then null;
end $$;

drop view if exists public.waitlist_count;

do $$ begin
  if to_regclass('public.waitlist') is not null then
    execute 'drop policy if exists "waitlist: own insert" on public.waitlist';
  end if;
end $$;

do $$ begin
  perform public.ops_mark('sql', 'waitlist_retire_2026_10.sql — done');
exception when others then null;
end $$;

commit;

-- OPTIONAL, only if you decide to: delete the old sign-ups.
-- delete from public.waitlist;

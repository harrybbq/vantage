-- ═══════════════════════════════════════
-- Vantage — Body Recomposition Schema
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Additive only. Creates five new tables and touches nothing that
-- already exists: nutrition_macros, nutrition_log and
-- nutrition_daily_summary are not altered, and no data is migrated,
-- rewritten or deleted. Running this cannot lose anything.
--
-- The client is written to work WITHOUT these tables — the plan
-- currently drives macro targets from a compile-time constant, gated to
-- the owner. Applying this does not switch anything on by itself; it
-- makes the plan durable and per-user instead of hard-coded, which is
-- what the follow-up client work needs.
--
-- Order: create every table first, then RLS + policies + indexes, so no
-- policy references a table that does not exist yet.
-- ═══════════════════════════════════════

-- ── rota_config ───────────────────────────────────────────────
-- One row per user. `anchor_date` is any known Day 1 of the cycle;
-- everything else about the rota derives from it, which is why the
-- spec asks for exactly one input.
create table if not exists rota_config (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  anchor_date  date not null,
  cycle_length int  not null default 16 check (cycle_length between 2 and 90),
  created_at   timestamptz not null default now()
);

-- ── nutrition_macro_targets ───────────────────────────────────
-- Day-type overrides for an existing macro. The ABSENCE of a row falls
-- back to nutrition_macros.daily_goal, which is what keeps every
-- existing user — and the owner on any day type they have not filled
-- in — exactly as they are today.
create table if not exists nutrition_macro_targets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  macro_id   uuid not null references nutrition_macros(id) on delete cascade,
  day_type   text not null check (day_type in ('day_shift','off','night_shift')),
  daily_goal numeric not null default 0,
  -- Protein and fat are FLOORS: under-hitting is the miss, over-hitting
  -- is not. The UI reads this to decide whether crossing the number is
  -- success or overshoot.
  is_floor   boolean not null default false,
  unique (macro_id, day_type)
);

-- ── body_weight_log ───────────────────────────────────────────
-- One weight per day. The app must never show a bare daily figure as a
-- headline — in a recomposition the scale barely moves for months, so
-- the 7-day rolling average is the only number worth reading large.
create table if not exists body_weight_log (
  user_id   uuid not null references auth.users(id) on delete cascade,
  log_date  date not null,
  weight_kg numeric not null check (weight_kg > 0 and weight_kg < 500),
  primary key (user_id, log_date)
);

-- ── body_measurements ─────────────────────────────────────────
-- Waist and shoulders, from which the shoulder-to-waist ratio comes.
-- That ratio is the primary metric of the whole plan; bodyweight is
-- secondary to it.
create table if not exists body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  log_date     date not null,
  waist_cm     numeric check (waist_cm is null or waist_cm > 0),
  shoulders_cm numeric check (shoulders_cm is null or shoulders_cm > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ── training_sessions ─────────────────────────────────────────
-- `load_scale` is 0.8 on night shifts: same sets, same reps, lighter
-- bar. Stored per session rather than derived at read time, because a
-- session that was actually done at full load on a night should not be
-- retro-labelled maintenance by a later rota edit.
create table if not exists training_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  log_date     date not null,
  session_code text not null check (session_code in ('push','pull','legs','upper','lower')),
  rota_day     int,
  load_scale   numeric not null default 1.0 check (load_scale > 0 and load_scale <= 2),
  notes        text,
  created_at   timestamptz not null default now()
);

-- ── training_sets ─────────────────────────────────────────────
-- One row per set. `user_id` is carried alongside session_id so RLS can
-- be enforced on this table directly rather than through a join — the
-- cheaper and harder-to-get-wrong option on a Micro instance.
create table if not exists training_sets (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references training_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  exercise   text not null,
  set_index  int  not null,
  weight_kg  numeric check (weight_kg is null or weight_kg >= 0),
  reps       int  check (reps is null or reps >= 0),
  rir        int  check (rir is null or rir between 0 and 10),
  created_at timestamptz not null default now()
);

-- ═══ RLS ═══════════════════════════════════════════════════════
-- Four own-row policies per table, matching nutrition_schema.sql.
-- Nothing here is ever shared, so there is no read policy wider than
-- "your own rows" — unlike profiles, which friends can see.

alter table rota_config enable row level security;
drop policy if exists "rota_config: own read"   on rota_config;
drop policy if exists "rota_config: own insert" on rota_config;
drop policy if exists "rota_config: own update" on rota_config;
drop policy if exists "rota_config: own delete" on rota_config;
create policy "rota_config: own read"   on rota_config for select using (auth.uid() = user_id);
create policy "rota_config: own insert" on rota_config for insert with check (auth.uid() = user_id);
create policy "rota_config: own update" on rota_config for update using (auth.uid() = user_id);
create policy "rota_config: own delete" on rota_config for delete using (auth.uid() = user_id);

alter table nutrition_macro_targets enable row level security;
drop policy if exists "nutrition_macro_targets: own read"   on nutrition_macro_targets;
drop policy if exists "nutrition_macro_targets: own insert" on nutrition_macro_targets;
drop policy if exists "nutrition_macro_targets: own update" on nutrition_macro_targets;
drop policy if exists "nutrition_macro_targets: own delete" on nutrition_macro_targets;
create policy "nutrition_macro_targets: own read"   on nutrition_macro_targets for select using (auth.uid() = user_id);
create policy "nutrition_macro_targets: own insert" on nutrition_macro_targets for insert with check (auth.uid() = user_id);
create policy "nutrition_macro_targets: own update" on nutrition_macro_targets for update using (auth.uid() = user_id);
create policy "nutrition_macro_targets: own delete" on nutrition_macro_targets for delete using (auth.uid() = user_id);

alter table body_weight_log enable row level security;
drop policy if exists "body_weight_log: own read"   on body_weight_log;
drop policy if exists "body_weight_log: own insert" on body_weight_log;
drop policy if exists "body_weight_log: own update" on body_weight_log;
drop policy if exists "body_weight_log: own delete" on body_weight_log;
create policy "body_weight_log: own read"   on body_weight_log for select using (auth.uid() = user_id);
create policy "body_weight_log: own insert" on body_weight_log for insert with check (auth.uid() = user_id);
create policy "body_weight_log: own update" on body_weight_log for update using (auth.uid() = user_id);
create policy "body_weight_log: own delete" on body_weight_log for delete using (auth.uid() = user_id);

alter table body_measurements enable row level security;
drop policy if exists "body_measurements: own read"   on body_measurements;
drop policy if exists "body_measurements: own insert" on body_measurements;
drop policy if exists "body_measurements: own update" on body_measurements;
drop policy if exists "body_measurements: own delete" on body_measurements;
create policy "body_measurements: own read"   on body_measurements for select using (auth.uid() = user_id);
create policy "body_measurements: own insert" on body_measurements for insert with check (auth.uid() = user_id);
create policy "body_measurements: own update" on body_measurements for update using (auth.uid() = user_id);
create policy "body_measurements: own delete" on body_measurements for delete using (auth.uid() = user_id);

alter table training_sessions enable row level security;
drop policy if exists "training_sessions: own read"   on training_sessions;
drop policy if exists "training_sessions: own insert" on training_sessions;
drop policy if exists "training_sessions: own update" on training_sessions;
drop policy if exists "training_sessions: own delete" on training_sessions;
create policy "training_sessions: own read"   on training_sessions for select using (auth.uid() = user_id);
create policy "training_sessions: own insert" on training_sessions for insert with check (auth.uid() = user_id);
create policy "training_sessions: own update" on training_sessions for update using (auth.uid() = user_id);
create policy "training_sessions: own delete" on training_sessions for delete using (auth.uid() = user_id);

alter table training_sets enable row level security;
drop policy if exists "training_sets: own read"   on training_sets;
drop policy if exists "training_sets: own insert" on training_sets;
drop policy if exists "training_sets: own update" on training_sets;
drop policy if exists "training_sets: own delete" on training_sets;
create policy "training_sets: own read"   on training_sets for select using (auth.uid() = user_id);
create policy "training_sets: own insert" on training_sets for insert with check (auth.uid() = user_id);
create policy "training_sets: own update" on training_sets for update using (auth.uid() = user_id);
create policy "training_sets: own delete" on training_sets for delete using (auth.uid() = user_id);

-- ═══ Indexes ═══════════════════════════════════════════════════
-- The access patterns this has to serve cheaply on a Micro instance:
--   · "my last N weigh-ins"                     (rolling average)
--   · "my measurements, newest first"           (ratio + trend)
--   · "my sessions for this date"               (today's log)
--   · "the last time I did THIS exercise"       (double progression —
--      the whole point of the training log, and the one query that
--      would be slow without an index once there are thousands of sets)

create index if not exists body_weight_log_user_date_idx
  on body_weight_log (user_id, log_date desc);
create index if not exists body_measurements_user_date_idx
  on body_measurements (user_id, log_date desc);
create index if not exists training_sessions_user_date_idx
  on training_sessions (user_id, log_date desc);
create index if not exists training_sets_session_idx
  on training_sets (session_id, set_index);
create index if not exists training_sets_user_exercise_idx
  on training_sets (user_id, exercise, created_at desc);
create index if not exists nutrition_macro_targets_user_idx
  on nutrition_macro_targets (user_id, day_type);

-- ═══ Seed ══════════════════════════════════════════════════════
-- Day-type targets for the four core macros, guarded the same way
-- seed_default_macros() is: it only fills gaps, so re-running it will
-- not overwrite a number you have since changed by hand.
--
-- rota_config.anchor_date is deliberately NOT seeded. It is the one
-- fact only you know, and guessing it would silently put every shift on
-- the wrong day. Set it with the statement at the bottom of this file.

create or replace function seed_recomp_macro_targets()
returns void
language plpgsql
-- SECURITY INVOKER (the default), deliberately. seed_default_macros()
-- takes a user id as an argument so it needs definer rights; this one
-- resolves auth.uid() itself and only ever writes the caller's own
-- rows, so RLS applying as the caller IS the guarantee we want. A
-- definer function here would be a privilege-escalation surface for no
-- gain.
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_macro record;
  v_targets jsonb := jsonb_build_object(
    'Calories', jsonb_build_object('day_shift', 2250, 'off', 2250, 'night_shift', 2450, 'floor', false),
    'Protein',  jsonb_build_object('day_shift',  165, 'off',  165, 'night_shift',  180, 'floor', true),
    'Fat',      jsonb_build_object('day_shift',   65, 'off',   65, 'night_shift',   70, 'floor', true),
    'Carbs',    jsonb_build_object('day_shift',  250, 'off',  250, 'night_shift',  275, 'floor', false)
  );
  v_row jsonb;
  v_day text;
begin
  if v_user is null then
    raise exception 'seed_recomp_macro_targets() must be called by a signed-in user';
  end if;

  for v_macro in
    select id, name from nutrition_macros
    where user_id = v_user and v_targets ? name
  loop
    v_row := v_targets -> v_macro.name;
    foreach v_day in array array['day_shift','off','night_shift'] loop
      insert into nutrition_macro_targets (user_id, macro_id, day_type, daily_goal, is_floor)
      values (v_user, v_macro.id, v_day, (v_row ->> v_day)::numeric, (v_row ->> 'floor')::boolean)
      on conflict (macro_id, day_type) do nothing;   -- never clobber an edit
    end loop;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- AFTER running the above, run these two as the signed-in owner:
--
--   -- 1. Seed the nine day-type targets (safe to re-run):
--   select seed_recomp_macro_targets();
--
--   -- 2. Set your rota anchor — ANY date you know was a Day 1
--   --    (the first DAY shift of a block). Replace the date:
--   insert into rota_config (user_id, anchor_date)
--   values (auth.uid(), '2026-07-23')
--   on conflict (user_id) do update set anchor_date = excluded.anchor_date;
--
-- To check it took:
--   select * from rota_config;
--   select m.name, t.day_type, t.daily_goal, t.is_floor
--     from nutrition_macro_targets t
--     join nutrition_macros m on m.id = t.macro_id
--    order by m.name, t.day_type;
-- ═══════════════════════════════════════════════════════════════

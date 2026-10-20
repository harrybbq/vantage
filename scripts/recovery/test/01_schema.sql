-- Minimal copies of the real user-scoped tables (shapes from supabase/*.sql;
-- user_data and tracker_streaks were created in the dashboard, so these
-- follow how the code uses them). Enough variety to exercise the recovery
-- functions: uuid / identity-always / composite primary keys, a non-PK
-- unique key, parent→child FKs, a two-user table, a self-referencing
-- trigger, a generated column, secrets, and a table without a primary key.

create table public.user_data (
  id         uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  photo      text,
  updated_at timestamptz not null default now()
);
alter table public.user_data enable row level security;

create table public.profiles (
  id     uuid primary key references auth.users(id) on delete cascade,
  tier   text not null default 'free',
  handle text
);

create table public.nutrition_macros (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name    text not null,
  unit    text not null,
  daily_goal numeric not null default 0
);

create table public.nutrition_log (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  log_date  date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  food_name text not null,
  calories  numeric not null default 0,
  protein_g numeric not null default 0,
  additional_nutrients jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.nutrition_log enable row level security;
create policy "nutrition_log: own read" on public.nutrition_log for select using (auth.uid() = user_id);

create table public.body_measurements (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  waist_cm numeric,
  unique (user_id, log_date)
);

create table public.training_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  log_date     date not null,
  session_code text not null
);
create table public.training_sets (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  exercise   text not null,
  set_index  int not null,
  reps       int
);

create table public.tracker_streaks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tracker_id text not null,
  streak     int not null default 0,
  primary key (user_id, tracker_id)
);

create table public.messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body         text not null,
  reply_to     bigint references public.messages(id) on delete set null,
  created_at   timestamptz not null default now()
);
-- Same guard as supabase/dm_upgrade_2026_10.sql.
create or replace function public.messages_reply_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from public.messages q
     where q.id = new.reply_to
       and ((q.sender_id = new.sender_id and q.recipient_id = new.recipient_id)
         or (q.sender_id = new.recipient_id and q.recipient_id = new.sender_id))
  ) then
    raise exception 'That reply points at a message outside this conversation.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger messages_reply_guard before insert on public.messages
  for each row execute function public.messages_reply_guard();

create table public.friendships (
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending',
  primary key (requester_id, addressee_id)
);

create table public.whoop_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

create table public.push_tokens (
  user_id  uuid not null references auth.users(id) on delete cascade,
  token    text not null,
  platform text not null default 'web',
  primary key (user_id, token)
);

create table public.client_errors (
  id      bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  message text
);

-- Not a real table: a 'review' table with a generated column, and one
-- with no primary key.
create table public.zz_generated_probe (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  grams    numeric not null,
  kilos    numeric generated always as (grams / 1000) stored
);
create table public.zz_no_pk (
  user_id uuid not null references auth.users(id) on delete cascade,
  note    text
);

-- ============================================================================
-- Books — October 2026 (owner-only Upgrade → Books)
-- ============================================================================
-- Run in the Supabase SQL editor. One transaction: if any statement fails,
-- nothing changes. Re-runnable (every statement is IF NOT EXISTS / guarded).
--
-- Additive only: three NEW tables. No existing table, column, row or policy
-- is touched, and nothing here reads or writes user_data.
--
--   books_entries     the ledger: one row per money movement (income,
--                     expense or a transfer between the owner's own
--                     accounts). Written by netlify/functions/books.js only.
--   books_recurring   bills that repeat monthly or yearly; "Post due bills"
--                     materialises them into books_entries (source
--                     'recurring', source_ref 'recurring:<id>:<date>').
--   books_config      small owner preferences (key 'prefs').
--
-- Bookkeeping figures only. Books does not file anything with HMRC or
-- Companies House — that stays with approved software or an accountant.
--
-- Soft delete only: the app sets books_entries.deleted_at and never issues a
-- DELETE. Recurring bills are "deleted" by setting active = false.
--
-- All tables: RLS on with NO policies, and no grants to anon or
-- authenticated — only the service role (the Netlify function) can read or
-- write them. The function checks the owner's verified email server-side.
--
-- books.js fails soft (`{ ok:false, reason:'not_configured' }`) until this
-- has been run.
--
-- Widening later: `kind` and `source` are NAMED check constraints
-- (books_entries_kind_check, books_entries_source_check). A later migration
-- can widen either with
--   alter table public.books_entries drop constraint books_entries_kind_check;
--   alter table public.books_entries add constraint books_entries_kind_check check (kind in (...));
-- without touching any row.
-- ============================================================================
begin;

-- ── Ledger ──────────────────────────────────────────────────────────────
create table if not exists public.books_entries (
  id            uuid primary key default gen_random_uuid(),
  occurred_on   date not null,
  kind          text not null,
  category      text not null check (char_length(category) between 1 and 40),
  -- Always a magnitude in the entry's own currency; the direction is the kind.
  amount_pence  bigint not null check (amount_pence >= 0),
  currency      text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- GBP per 1 unit of `currency`; NULL for GBP entries.
  fx_rate       numeric null check (fx_rate is null or fx_rate > 0),
  -- The GBP value every report uses.
  gbp_pence     bigint not null check (gbp_pence >= 0),
  vat_pence     bigint null check (vat_pence is null or vat_pence >= 0),
  counterparty  text check (counterparty is null or char_length(counterparty) <= 120),
  description   text check (description is null or char_length(description) <= 300),
  source        text not null default 'manual',
  -- Stable id of the row in its source file (import de-duplication).
  source_ref    text null check (source_ref is null or char_length(source_ref) <= 200),
  note          text check (note is null or char_length(note) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz null
);

-- Named so a later migration can widen them (see the header).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'books_entries_kind_check' and conrelid = 'public.books_entries'::regclass) then
    alter table public.books_entries add constraint books_entries_kind_check
      check (kind in ('income', 'expense', 'transfer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_entries_source_check' and conrelid = 'public.books_entries'::regclass) then
    alter table public.books_entries add constraint books_entries_source_check
      check (source in ('manual', 'bank_csv', 'apple', 'google', 'revenuecat', 'recurring'));
  end if;
  -- Import de-duplication: `insert … on conflict (source, source_ref) do
  -- nothing`. A unique constraint allows many NULL refs (manual entries).
  -- Its index also serves lookups by (source, source_ref).
  if not exists (select 1 from pg_constraint where conname = 'books_entries_source_ref_key' and conrelid = 'public.books_entries'::regclass) then
    alter table public.books_entries add constraint books_entries_source_ref_key
      unique (source, source_ref);
  end if;
end $$;

-- Reports read a date range of live rows.
create index if not exists books_entries_occurred_live_idx
  on public.books_entries (occurred_on) where deleted_at is null;

alter table public.books_entries enable row level security;   -- no policies: service role only
revoke all on public.books_entries from anon, authenticated;
grant select, insert, update on public.books_entries to service_role;   -- no delete: soft delete only

-- ── Recurring bills ─────────────────────────────────────────────────────
create table if not exists public.books_recurring (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  kind          text not null default 'expense' check (kind in ('income', 'expense')),
  category      text not null check (char_length(category) between 1 and 40),
  amount_pence  bigint not null check (amount_pence >= 0),
  currency      text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  -- GBP value to post for a non-GBP bill (NULL for GBP bills).
  gbp_pence     bigint null check (gbp_pence is null or gbp_pence >= 0),
  cadence       text not null check (cadence in ('monthly', 'yearly')),
  next_due      date not null,
  -- The day of month the bill falls on (a bill on the 31st posts on the
  -- last day of shorter months and returns to the 31st after).
  anchor_day    smallint null check (anchor_day is null or anchor_day between 1 and 31),
  active        boolean not null default true,
  note          text check (note is null or char_length(note) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists books_recurring_due_idx
  on public.books_recurring (next_due) where active;

alter table public.books_recurring enable row level security;   -- no policies: service role only
revoke all on public.books_recurring from anon, authenticated;
grant select, insert, update on public.books_recurring to service_role;

-- ── Preferences ─────────────────────────────────────────────────────────
-- Keys are validated by books.js (today: 'prefs' only).
create table if not exists public.books_config (
  key         text primary key check (char_length(key) between 1 and 40),
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.books_config enable row level security;   -- no policies: service role only
revoke all on public.books_config from anon, authenticated;
grant select, insert, update on public.books_config to service_role;

commit;

# Moving the trading app's schemas out of Vantage's project

STARTUP_REQUIREMENTS item 69 (LAUNCH). The sibling trading app keeps its
data in three schemas inside Vantage's Supabase project: `ledger`,
`paper` and `research`. They share one database, one restore unit and
one set of admin credentials with every Vantage user's data. Before
launch they move to a Supabase project of their own.

This is a runbook for the owner. Nothing here can be done from a Claude
session: it needs a new Supabase project, a `pg_dump` over the direct
database connection, and a change to the trading app's own
configuration.

## What was checked (live, read-only, 2026-10-22)

| Check | Result |
|---|---|
| Size | `ledger` 13 tables + 3 views + 8 functions (656 kB), `paper` 6 tables (152 kB), `research` 2 tables + 2 functions (48 kB). About 158 rows in total. |
| Other objects | 5 custom types, 2 sequences, 11 triggers. All inside the three schemas, so `pg_dump -n` carries them. |
| Links to Vantage | **None.** No foreign key, view or function crosses between these schemas and `public`/`auth`. |
| API exposure | No grants to `anon` or `authenticated`. Only `postgres` (plus Supabase's read-only and ETL system roles) has `USAGE`. The trading app therefore connects with the direct Postgres connection string, not the REST API. |
| Scheduled jobs | `pg_cron` is not installed. |
| Vantage code | Never reads these schemas. Vantage reaches the trading app only over HTTP: `netlify/functions/trading-summary.js` calls `TRADING_REPORT_URL` with `TRADING_REPORT_TOKEN`. The `ledger` and `books` names in `src/lib/books/` are Vantage's own bookkeeping feature (`books_*` tables in `public`), unrelated to the trading app. |

So the move touches no Vantage table, and Vantage keeps working
throughout, as long as the trading app's report endpoint stays up.

## Steps

1. **Create the new project** (Supabase dashboard → New project). Use the
   same region as now (eu-central-2) unless the trading app's host argues
   otherwise. Note that it has its own cost on the Pro plan (one more
   compute instance).
2. **Pause the trading app's writers**: the agents and anything that
   writes orders, fills or marks. The data is small, so a few minutes is
   enough.
3. **Dump only the three schemas** from the old project. Take the
   *direct* connection string from Project settings → Database, not the
   pooler:
   ```sh
   pg_dump "$OLD_DB_URL" --schema=ledger --schema=paper --schema=research \
     --no-owner --no-privileges --format=custom --file=trading.dump
   ```
4. **Restore into the new project:**
   ```sh
   pg_restore --dbname="$NEW_DB_URL" --no-owner --no-privileges trading.dump
   ```
   Then re-enable RLS where the dump shows it (it is on for every table
   today, with no policies) and re-apply any grants the trading app
   relies on.
5. **Check row counts match**, table by table, old vs new:
   ```sql
   select schemaname, relname, n_live_tup from pg_stat_user_tables
    where schemaname in ('ledger','paper','research') order by 1, 2;
   ```
   `n_live_tup` is an estimate; for an exact check run `select count(*)`
   on each table in both projects.
6. **Repoint the trading app** at the new project (its database URL and
   any keys), restart it, and confirm it reads and writes there.
7. **Check Vantage**: open the trading widget, or call `trading-summary`.
   Only `TRADING_REPORT_URL` matters to Vantage. If the report endpoint
   moved, update `TRADING_REPORT_URL` / `TRADING_REPORT_TOKEN` in Netlify
   and redeploy.
8. **Leave the old schemas in place for at least two weeks**, untouched,
   as the fallback. Then drop them in the old project:
   ```sql
   drop schema research cascade; drop schema paper cascade; drop schema ledger cascade;
   ```
   Take a backup first. This is the one destructive step, and it touches
   only the trading app's data, never Vantage's.

## Afterwards

- Mark item 69 done in STARTUP_REQUIREMENTS.md.
- The Supabase security advisor's `ledger.*`, `paper.*` and `research.*`
  findings disappear from Vantage's project. Its mutable `search_path`
  warnings on `ledger.assert_*`, `ledger.reject_mutation`,
  `ledger.protect_report_token` and `research.protect_*` move with them,
  and are worth fixing in the new project (`set search_path = ''`).

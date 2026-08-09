-- ============================================================
-- Vantage — CV master-file storage (Upgrade → Career tab)
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Why a bucket at all:
--   The structured CV the app edits lives in user_data.state. The
--   master .pdf/.docx must NOT: state is ~1 MB already, is
--   re-downloaded on every app open and rewritten on every save, and
--   an attachment would ride on all of it forever.
--
-- Why private:
--   A CV carries a full name, address, phone number and work history.
--   A public bucket means a guessable URL is the only thing between
--   that and the open internet. Reads go through short-lived signed
--   URLs instead (see src/lib/career/cvFile.js).
--
-- Path convention: <user_id>/<timestamp>__<filename>
--   The leading folder IS the authorisation check — every policy below
--   compares it against auth.uid(), so one account can never read,
--   write or delete another's file even though they share a bucket.
--
-- Until this is run the Career tab still works: the CV editor is
-- unaffected and the file slot reports that storage isn't set up.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cv', 'cv', false, 8388608,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Policies are dropped first so re-running picks up any edits above
-- rather than silently keeping the old definition.
drop policy if exists "cv owner read"   on storage.objects;
drop policy if exists "cv owner insert" on storage.objects;
drop policy if exists "cv owner update" on storage.objects;
drop policy if exists "cv owner delete" on storage.objects;

-- (storage.foldername(name))[1] is the first path segment — the user id.
create policy "cv owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cv' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cv' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cv owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = auth.uid()::text);

-- Note on account deletion: storage.objects has no FK to auth.users, so
-- deleting an account leaves these files behind. Item 20 in
-- STARTUP_REQUIREMENTS covers the same class of problem for tables; if
-- CV upload ever leaves owner-only use, the delete-account path has to
-- empty this bucket too.

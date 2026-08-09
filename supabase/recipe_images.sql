-- ============================================================
-- Vantage — recipe photo storage (Upgrade → Diet → Recipes)
-- Run in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Why a bucket:
--   Recipe text lives in user_data.state; photos must not. State is
--   ~1 MB, re-downloaded on every app open and rewritten on every save,
--   so a dozen photos would ride on all of it forever.
--
-- Why private:
--   Same posture as the cv bucket. Nothing here is as sensitive as a CV,
--   but a public bucket means a guessable URL is the only thing between
--   a user's uploads and the open internet, and there is no reason to
--   accept that for a feature that reads fine over signed URLs.
--
-- Path convention: <user_id>/<recipe_id>-<timestamp>.jpg
--   The leading folder IS the authorisation check — every policy below
--   compares it to auth.uid(), so one account can never read, write or
--   delete another's photo even though they share a bucket.
--
-- Client-side the image is downscaled to a 1400px long edge and
-- re-encoded as JPEG before upload, so the 6 MB limit here is a
-- backstop against something odd rather than the normal case.
--
-- Until this is run the Recipes tab still works: text, macros, tags and
-- logging are all unaffected, and the photo slot reports that storage
-- isn't set up.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recipes', 'recipes', false, 6291456,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "recipes owner read"   on storage.objects;
drop policy if exists "recipes owner insert" on storage.objects;
drop policy if exists "recipes owner update" on storage.objects;
drop policy if exists "recipes owner delete" on storage.objects;

create policy "recipes owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'recipes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recipes owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recipes owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'recipes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recipes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "recipes owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recipes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Same caveat as cv_storage.sql: storage.objects has no FK to
-- auth.users, so account deletion leaves these behind. If the meal
-- library ever leaves owner-only use, the delete-account path has to
-- empty this bucket too.

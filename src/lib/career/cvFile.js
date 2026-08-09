/**
 * CV master-file storage.
 *
 * The structured CV lives in `S` and is the working copy. This is the
 * other half: the actual .pdf/.docx you send people, which must NOT go
 * in `S` — state is already around a megabyte, is re-downloaded on
 * every open and rewritten on every save, and a CV attachment would be
 * carried on all of it forever.
 *
 * So it goes in Supabase Storage, which this app has never used before.
 * That means a bucket and its policies have to be created by hand
 * (`supabase/cv_storage.sql`) — migrations here are approval-gated and
 * tooling cannot apply them. Everything below therefore FAILS SOFT: if
 * the bucket is absent the editor still works and the file slot says
 * what to run, rather than the tab erroring out.
 */
import { supabase } from '../supabase';

export const CV_BUCKET = 'cv';
export const MAX_BYTES = 8 * 1024 * 1024;

/** Storage path. Prefixed by user id because the RLS policy keys on it. */
export const cvPath = (userId, name) => `${userId}/${name}`;

/** Missing-bucket is a setup state, not a failure — say which. */
function classify(error) {
  const msg = String(error?.message || error || '');
  if (/bucket not found/i.test(msg) || error?.statusCode === '404' || error?.status === 404) {
    return { setup: true, message: 'Storage isn’t set up yet — run supabase/cv_storage.sql in the SQL editor.' };
  }
  if (/row-level security|not authorized|403/i.test(msg)) {
    return { setup: true, message: 'The cv bucket exists but its policies don’t — re-run supabase/cv_storage.sql.' };
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return { setup: false, message: 'Couldn’t reach storage — check your connection.' };
  }
  return { setup: false, message: msg || 'Upload failed.' };
}

export async function listCvFiles(userId) {
  if (!userId) return { files: [], error: null };
  const { data, error } = await supabase.storage.from(CV_BUCKET).list(userId, {
    limit: 20, sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) return { files: [], error: classify(error) };
  return { files: (data || []).filter(f => f.name && f.id !== null), error: null };
}

export async function uploadCv(userId, file) {
  if (!userId) return { error: { setup: false, message: 'Not signed in.' } };
  if (file.size > MAX_BYTES) {
    return { error: { setup: false, message: `That file is ${(file.size / 1048576).toFixed(1)} MB — the cap is 8 MB.` } };
  }
  // Timestamped name: uploads become versions rather than overwriting
  // the one copy, which is the behaviour you want the day you upload
  // the wrong draft.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-60);
  const path = cvPath(userId, `${stamp}__${safe}`);
  const { error } = await supabase.storage.from(CV_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  });
  if (error) return { error: classify(error) };
  return { path, error: null };
}

/** Short-lived link — the bucket is private, so no public URL exists. */
export async function cvOpenUrl(userId, name) {
  const { data, error } = await supabase.storage.from(CV_BUCKET)
    .createSignedUrl(cvPath(userId, name), 120);
  if (error) return { url: null, error: classify(error) };
  return { url: data?.signedUrl || null, error: null };
}

export async function deleteCv(userId, name) {
  const { error } = await supabase.storage.from(CV_BUCKET).remove([cvPath(userId, name)]);
  return { error: error ? classify(error) : null };
}

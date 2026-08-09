/**
 * Recipe photos.
 *
 * Same reasoning as the CV master file: these cannot go in `S`. State is
 * around a megabyte, re-downloaded on every open and rewritten on every
 * save — a dozen photos would ride on all of it forever.
 *
 * So: a private Supabase bucket, `supabase/recipe_images.sql`. Fails
 * soft in exactly the same way, because migrations here are
 * approval-gated and a recipe list that errors out because a bucket is
 * missing would be worse than one without pictures.
 *
 * Photos are downscaled in the browser before upload. A phone camera
 * JPEG is 3–6 MB and a recipe card renders it at about 300px; uploading
 * the original would cost storage, upload time on mobile data, and
 * download time on every view, for no visible difference.
 */
import { supabase } from '../supabase';

export const RECIPE_BUCKET = 'recipes';
export const MAX_EDGE = 1400;      // long edge after downscale
export const JPEG_QUALITY = 0.82;
export const MAX_BYTES = 6 * 1024 * 1024;

function classify(error) {
  const msg = String(error?.message || error || '');
  if (/bucket not found/i.test(msg) || error?.statusCode === '404' || error?.status === 404) {
    return { setup: true, message: 'Photo storage isn’t set up yet — run supabase/recipe_images.sql in the SQL editor.' };
  }
  if (/row-level security|not authorized|403/i.test(msg)) {
    return { setup: true, message: 'The recipes bucket exists but its policies don’t — re-run supabase/recipe_images.sql.' };
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return { setup: false, message: 'Couldn’t reach storage — check your connection.' };
  }
  return { setup: false, message: msg || 'Upload failed.' };
}

/**
 * Downscale to MAX_EDGE and re-encode as JPEG. Returns a Blob.
 * Falls back to the original file if canvas is unavailable or the image
 * won't decode — a slightly large upload beats a failed one.
 */
export async function downscale(file) {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) { bitmap.close?.(); return file; }
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Upload and return the storage path to store on the recipe. */
export async function uploadRecipeImage(userId, recipeId, file) {
  if (!userId) return { error: { setup: false, message: 'Not signed in.' } };
  if (file.size > MAX_BYTES) {
    return { error: { setup: false, message: `That image is ${(file.size / 1048576).toFixed(1)} MB — the cap is 6 MB.` } };
  }
  const blob = await downscale(file);
  // Timestamped so replacing a photo doesn't have to race a CDN cache.
  const path = `${userId}/${recipeId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(RECIPE_BUCKET)
    .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });
  if (error) return { error: classify(error) };
  return { path, error: null };
}

/**
 * Signed URLs for a batch of paths, in one request.
 *
 * One-at-a-time would be a request per card, which on a grid of twenty
 * recipes is twenty round trips before anything renders.
 */
export async function signedUrls(paths, seconds = 3600) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return { urls: {}, error: null };
  const { data, error } = await supabase.storage.from(RECIPE_BUCKET)
    .createSignedUrls(list, seconds);
  if (error) return { urls: {}, error: classify(error) };
  const urls = {};
  (data || []).forEach(d => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl; });
  return { urls, error: null };
}

export async function deleteRecipeImage(path) {
  if (!path) return { error: null };
  const { error } = await supabase.storage.from(RECIPE_BUCKET).remove([path]);
  return { error: error ? classify(error) : null };
}

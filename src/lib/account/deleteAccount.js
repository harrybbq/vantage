import { supabase } from '../supabase';
import { authFetch } from '../authFetch';
import { clearLocalUserData } from '../state/clearLocal';

/**
 * Delete the signed-in account — the one flow, shared by Settings →
 * Account and the web gate page (item 131: Google requires deletion on
 * the web even for people without the app, and a gated web visitor
 * never reaches Settings).
 *
 * Two confirms, the second a plain "are you sure"; the first says a
 * store subscription is NOT cancelled by this (App Store 5.1.1(v) /
 * Play: Apple or Google bill it, so deleting here cannot stop it).
 */
export const DELETE_CONFIRM_FIRST =
  'Delete your Vantage account?\n\nYour login and everything in the account are permanently erased. This cannot be undone.\n\nAn App Store or Google Play subscription is NOT cancelled by this — cancel it in the store.';
export const DELETE_CONFIRM_SECOND = 'Are you absolutely sure? Press OK to confirm deletion.';

/**
 * Ask twice, then delete. Resolves false if either confirm is declined,
 * true once the account is gone and this device is signed out. Throws
 * (with a user-readable message) if the server did not confirm — the
 * caller shows it and the user stays signed in.
 *   onStart — called after both confirms, before the request
 */
export async function confirmAndDeleteAccount(userId, { onStart } = {}) {
  if (!window.confirm(DELETE_CONFIRM_FIRST)) return false;
  if (!window.confirm(DELETE_CONFIRM_SECOND)) return false;
  onStart?.();
  // Goes through a server function because deleting the ACCOUNT (not
  // merely its data) needs the service role. The old flow removed the
  // user_data row and signed out, which left auth.users, profiles,
  // friendships and push_tokens behind — the account still existed,
  // which fails App Store 5.1.1(v) and is an incomplete erasure under UK
  // GDPR. Deleting the auth user cascades the rest.
  const res = await authFetch('/.netlify/functions/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new Error(out.error || 'Deletion failed.');
  // The account is gone server-side, so this device's copies of it go
  // too (item 56) — backup, pictures, pending edit, breadcrumb, SW
  // caches. Only after the server confirms.
  await clearLocalUserData(userId, { deleted: true });
  // Only sign out once the server confirms — otherwise the user is
  // logged out believing they're deleted when they aren't.
  await supabase.auth.signOut();
  return true;
}

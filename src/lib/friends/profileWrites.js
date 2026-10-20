import { supabase } from '../supabase';
import { authFetch } from '../authFetch';
import { patchOwnProfileCache } from './profileReads.js';
import { OWN_WRITE_RETURNING } from './profileColumns.js';

/**
 * Writes of what strangers see — handle, display_name, avatar_url — go
 * through netlify/functions/profile-update (item 84): the server applies
 * the name filter and screens the picture, and once
 * supabase/privacy_lockdown_2026_10b.sql has run it is the only path
 * (the client's UPDATE on those columns is revoked).
 *
 *   writePublicProfile(userId, { handle?, display_name?, avatar_url? })
 *     → { ok, profile, avatar?, reason? }
 *   Throws an Error whose .message is the server's user-facing line and
 *   whose .field names the offending field (for inline errors).
 *
 * Only a 404 (the function isn't there: local `vite` without functions)
 * falls back to the direct write, and then never with a picture — an
 * unscreened avatar is never published. In production the function
 * ships in the same deploy as this code, so the fallback isn't reached.
 */
export const PUBLIC_TEXT_FIELDS = ['handle', 'display_name', 'avatar_url'];

export class ProfileWriteError extends Error {
  constructor(message, { field = null, status = 0 } = {}) {
    super(message);
    this.name = 'ProfileWriteError';
    this.field = field;
    this.status = status;
  }
}

export async function writePublicProfile(userId, patch) {
  const body = {};
  for (const k of PUBLIC_TEXT_FIELDS) if (patch && k in patch) body[k] = patch[k];
  if (!userId || Object.keys(body).length === 0) return null;

  let res;
  try {
    res = await authFetch('/.netlify/functions/profile-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProfileWriteError('You look offline — your profile will update when you\'re back.', { status: 0 });
  }

  if (res.status === 404) return legacyWrite(userId, body);

  let out = {};
  try { out = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new ProfileWriteError(out?.error || 'Could not save your profile — try again.', { field: out?.field || null, status: res.status });
  }
  if (out?.profile) patchOwnProfileCache(userId, out.profile);
  return out;
}

async function legacyWrite(userId, body) {
  const clean = { ...body };
  if ('avatar_url' in clean) clean.avatar_url = null;
  const { data, error } = await supabase
    .from('profiles')
    .update(clean)
    .eq('id', userId)
    .select(OWN_WRITE_RETURNING)
    .maybeSingle();
  if (error) {
    const taken = /duplicate key/i.test(error.message || '') && /handle/i.test(error.message || '');
    throw new ProfileWriteError(taken ? 'That handle is taken.' : 'Could not save your profile — try again.', { field: taken ? 'handle' : null });
  }
  if (data) patchOwnProfileCache(userId, data);
  return { ok: true, profile: data, avatar: 'avatar_url' in body ? 'pending' : undefined };
}

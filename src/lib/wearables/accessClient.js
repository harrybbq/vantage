import { supabase } from '../supabase';
import { apiFetch } from '../authFetch';

/**
 * Item 127's network half: the owner's RPCs (each checks is_app_owner()
 * in Postgres — supabase/wearable_access_2026_10.sql) and the connect
 * status check the panels make before Connect is pressed. Decisions and
 * words live in ./access.js.
 */

const TIMEOUT_MS = 4000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), TIMEOUT_MS)),
  ]);
}

async function call(fn, args) {
  try {
    const { data, error } = await withTimeout(supabase.rpc(fn, args));
    return error ? { data: null, error } : { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export const listWearableAccess = () => call('wearable_access_list');
export const addWearableAccess = (handle, note) => call('wearable_access_add', { p_handle: handle, p_note: note });
export const removeWearableAccess = id => call('wearable_access_remove', { p_id: id });
export const setWearableAccessMode = mode => call('wearable_access_set_mode', { p_mode: mode });
export const wearableAccessSummary = () => call('wearable_access_summary');

/**
 * Ask `<provider>-connect` whether this account could connect, without
 * starting anything. → { allowed, limited, listed, message } or null on
 * any failure (the panel then says nothing extra — Connect itself still
 * returns the clear refusal). One call per panel mount, unconnected only.
 */
export async function checkConnectAccess(provider) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;
    const res = await apiFetch(`/.netlify/functions/${provider}-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ check: true }),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && body.access ? body.access : null;
  } catch {
    return null;
  }
}

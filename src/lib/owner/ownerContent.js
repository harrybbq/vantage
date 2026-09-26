/**
 * Owner-only content, fetched at runtime from `public.owner_content`.
 *
 * ── Why this exists ──
 * The Upgrade section is owner-only in the UI, but the UI gate is not an
 * access control: everything imported into the app ships in the public
 * JS bundle. Personal planning data (salary, savings, house plans) must
 * therefore never be imported — it is fetched here, and row-level
 * security (supabase/owner_content.sql) decides who gets rows back. A
 * non-owner, or someone signed out, gets an empty list.
 *
 * ── Fails soft ──
 * Before the SQL has been run the table does not exist; that is a setup
 * state with a message naming the file, not an error.
 *
 * Module-scope cache so switching tabs does not refetch; saves update
 * the cache optimistically and roll back if the write is refused.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';

const cache = new Map();            // key → data
let inflight = null;

export const SETUP_MESSAGE = 'Owner content isn’t set up yet — run supabase/owner_content.sql in the Supabase SQL editor, then the seed file.';

export function describeError(err) {
  const code = err && (err.code || err.status);
  const msg = String((err && err.message) || err || '');
  if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(msg)) {
    return { setup: true, message: SETUP_MESSAGE };
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return { setup: false, message: 'Not allowed — this content is owner-only.' };
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return { setup: false, message: 'Offline — couldn’t reach the server.' };
  }
  return { setup: false, message: msg || 'Something went wrong.' };
}

/** Fetch every row whose key starts with `prefix` (e.g. 'career.'). */
export async function loadPrefix(prefix) {
  const { data, error } = await supabase
    .from('owner_content')
    .select('key, data')
    .like('key', `${prefix}%`);
  if (error) throw error;
  for (const row of data || []) cache.set(row.key, row.data);
  return Object.fromEntries((data || []).map(r => [r.key, r.data]));
}

export async function saveKey(key, data) {
  const { error } = await supabase
    .from('owner_content')
    .upsert({ key, data }, { onConflict: 'key' });
  if (error) throw error;
  cache.set(key, data);
}

/**
 * React hook: { data, state: 'loading'|'ready'|'setup'|'error', message, save(key, value), reload() }.
 * `data` is { key: value } for the prefix. `save` is optimistic.
 */
export function useOwnerContent(prefix) {
  const cached = () => Object.fromEntries([...cache].filter(([k]) => k.startsWith(prefix)));
  const [data, setData] = useState(() => cached());
  const [state, setState] = useState(() => (Object.keys(cached()).length ? 'ready' : 'loading'));
  const [message, setMessage] = useState('');
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      inflight = inflight || loadPrefix(prefix);
      const d = await inflight;
      if (!alive.current) return;
      setData(d);
      setState('ready');
      setMessage('');
    } catch (err) {
      if (!alive.current) return;
      const e = describeError(err);
      setState(e.setup ? 'setup' : 'error');
      setMessage(e.message);
    } finally {
      inflight = null;
    }
  }, [prefix]);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => { alive.current = false; };
  }, [reload]);

  const save = useCallback(async (key, value) => {
    const before = cache.has(key) ? cache.get(key) : undefined;
    setData(d => ({ ...d, [key]: value }));
    try {
      await saveKey(key, value);
      return { ok: true };
    } catch (err) {
      if (alive.current) setData(d => ({ ...d, [key]: before }));
      return { ok: false, ...describeError(err) };
    }
  }, []);

  return { data, state, message, save, reload };
}

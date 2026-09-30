/**
 * The parts of an account that don't live in `S`, gathered for export
 * (UK GDPR Art. 15/20): the food log, your own profile row, and the
 * friendships and messages you are party to. Before this the export was
 * `S` alone, which left out everything in its own table — including
 * every meal ever logged.
 *
 * Read-only, and each table on its own: one that fails (not deployed,
 * RLS, network) is recorded in `missing` and the rest still export.
 * Nothing here writes anything.
 *
 * Load: runs only when someone presses Export, reads their own rows
 * through RLS in pages of 1000 (PostgREST's default cap), ordered on a
 * stable key so pages can't overlap or skip.
 */
import { supabase } from '../supabase';
import { fetchAllPages } from './paginate';

export async function collectAccountData(userId) {
  const tables = {};
  const missing = [];
  if (!userId) return { tables, missing: ['nutrition_log', 'profile', 'friendships', 'messages'] };

  async function grab(name, fn) {
    try { tables[name] = await fn(); } catch { missing.push(name); }
  }

  await grab('nutrition_log', () => fetchAllPages((from, to) => supabase
    .from('nutrition_log').select('*').eq('user_id', userId)
    .order('log_date', { ascending: true }).order('id', { ascending: true })
    .range(from, to)));

  await grab('profile', async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data || null;
  });

  await grab('friendships', () => fetchAllPages((from, to) => supabase
    .from('friendships').select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order('created_at', { ascending: true }).order('requester_id', { ascending: true })
    .range(from, to)));

  await grab('messages', () => fetchAllPages((from, to) => supabase
    .from('messages').select('*')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('id', { ascending: true })
    .range(from, to)));

  return { tables, missing };
}

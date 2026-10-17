// STUB — replaced by the data agent's version at merge
import { supabase } from '../supabase';
import { inviteUrl, isValidInviteCode, isNotConfigured, parseInvitePath } from './dmModel.js';

/**
 * Personal invite links — UI-side stub with the data agent's exports and
 * shapes. Nothing throws: { ok: true, … } | { ok: false, reason }.
 * Reasons: not_configured · invalid · revoked · expired · unavailable ·
 * self · already_friends · already_requested · incoming_request ·
 * throttled · signed_out · error.
 */

const PENDING_KEY = 'vantage.pendingInvite';
const origin = () => { try { return window.location.origin; } catch { return ''; } };

function fail(error, fallback) {
  if (isNotConfigured(error)) return { ok: false, reason: 'not_configured' };
  const msg = error?.message || fallback;
  if (/sign in/i.test(msg) || error?.code === '28000') return { ok: false, reason: 'signed_out' };
  if (/too many/i.test(msg)) return { ok: false, reason: 'throttled', message: msg };
  if (/unavailable/i.test(msg)) return { ok: false, reason: 'unavailable', message: msg };
  return { ok: false, reason: 'error', message: msg };
}
function shape(row) {
  if (!row?.code) return { ok: false, reason: 'error', message: 'No invite code came back.' };
  return { ok: true, code: row.code, url: inviteUrl(row.code, origin()), expiresAt: row.expires_at || null };
}

export async function getMyInvite() {
  let uid = null;
  try { const { data } = await supabase.auth.getSession(); uid = data?.session?.user?.id || null; } catch { /* */ }
  if (!uid) return { ok: false, reason: 'signed_out' };
  const { data, error } = await supabase.from('friend_invites')
    .select('code, expires_at, uses, max_uses')
    .eq('user_id', uid).is('revoked_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1);
  if (error) return fail(error, 'Could not load your invite link.');
  const live = (data || []).find(r => (r.uses ?? 0) < (r.max_uses ?? 50));
  return live ? shape(live) : regenerateInvite();
}

export async function regenerateInvite() {
  const { data, error } = await supabase.rpc('create_friend_invite');
  if (error) return fail(error, 'Could not make a new invite link.');
  return shape(Array.isArray(data) ? data[0] : data);
}

/** → { ok, inviter: { id, name, handle, avatarUrl, level, ovr }, relationship, expiresAt } */
export async function previewInvite(code) {
  if (!isValidInviteCode(code)) return { ok: false, reason: 'invalid' };
  const { data, error } = await supabase.rpc('preview_friend_invite', { p_code: code });
  if (error) return fail(error, 'Could not open this invite.');
  if (!data?.ok) return { ok: false, reason: data?.reason || 'invalid' };
  const p = data.inviter || {};
  return {
    ok: true,
    inviter: {
      id: p.id || null,
      name: p.display_name || (p.handle ? `@${p.handle}` : 'A Vantage user'),
      handle: p.handle || null,
      avatarUrl: p.avatar_url || null,
      level: p.level ?? null,
      ovr: p.ratings_ovr ?? null,
    },
    relationship: data.relationship || 'none',
    expiresAt: data.expires_at || null,
  };
}

export async function acceptInvite(code) {
  if (!isValidInviteCode(code)) return { ok: false, reason: 'invalid' };
  const { data, error } = await supabase.rpc('accept_friend_invite', { p_code: code });
  if (error) return fail(error, 'Could not send the request.');
  if (!data?.ok) return { ok: false, reason: data?.reason || 'error' };
  return { ok: true, inviterId: data.inviter_id || null };
}

export function rememberPendingInvite(code) {
  if (!isValidInviteCode(code)) return false;
  try { sessionStorage.setItem(PENDING_KEY, code); return true; } catch { return false; }
}
export function peekPendingInvite() {
  try { const c = sessionStorage.getItem(PENDING_KEY); return isValidInviteCode(c) ? c : null; } catch { return null; }
}
export function takePendingInvite() {
  const c = peekPendingInvite();
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  return c;
}

export { inviteUrl, isValidInviteCode, parseInvitePath };

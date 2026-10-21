import { supabase } from '../supabase';
import { webOrigin } from '../native/platform';
import { inviteUrl, isValidInviteCode, isNotConfigured, parseInvitePath } from './dmModel.js';

/**
 * Personal invite links — /invite/<code>. The code lives in
 * public.friend_invites and is only ever written by the SECURITY DEFINER
 * RPCs in supabase/dm_upgrade_2026_10.sql:
 *
 *   create_friend_invite()      new code, previous one revoked
 *   preview_friend_invite(code) the inviter's public card (works signed out)
 *   accept_friend_invite(code)  pending request accepter → inviter, via_invite
 *
 * Nothing here throws. Every call resolves to { ok: true, … } or
 * { ok: false, reason, message? }. Before the SQL is run the reason is
 * 'not_configured', so the UI can hide the invite section quietly.
 *
 * Reasons from the server: invalid · revoked · expired · unavailable
 * (blocked either way, or a suspended account — deliberately vague) ·
 * self · already_friends · already_requested · incoming_request (they
 * already asked you — accept theirs) · throttled · signed_out.
 */

const PENDING_KEY = 'vantage.pendingInvite';

// The site an invite link must point at. Inside the native app the page
// origin is capacitor://localhost, which means nothing on anyone else's
// phone — webOrigin() gives the deployed site there (item 129).
function origin() {
  try { return webOrigin() || ''; } catch { return ''; }
}

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

/** Your current invite link, created on first call. */
export async function getMyInvite() {
  let uid = null;
  try {
    const { data } = await supabase.auth.getSession();
    uid = data?.session?.user?.id || null;
  } catch { /* fall through */ }
  if (!uid) return { ok: false, reason: 'signed_out' };

  const { data, error } = await supabase
    .from('friend_invites')
    .select('code, expires_at, uses, max_uses')
    .eq('user_id', uid)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return fail(error, 'Could not load your invite link.');
  const live = (data || []).find(r => (r.uses ?? 0) < (r.max_uses ?? 50));
  if (live) return shape(live);
  return regenerateInvite();
}

/** Revoke the current link and make a new one. */
export async function regenerateInvite() {
  const { data, error } = await supabase.rpc('create_friend_invite');
  if (error) return fail(error, 'Could not make a new invite link.');
  return shape(Array.isArray(data) ? data[0] : data);
}

/**
 * The inviter's card for the landing page. Works signed out.
 * → { ok: true, inviter: { id, name, handle, avatarUrl, ovr, prestige },
 *     relationship: 'none'|'self'|'friends'|'outgoing'|'incoming',
 *     expiresAt }
 * (`inviter.id` is null when signed out.)
 */
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
      ovr: p.ratings_ovr ?? null,
      // 0 until supabase/prestige_rewards_2026_10.sql adds it to the
      // preview (fail soft: no frame, no badge). Level is not read.
      prestige: Math.max(0, Math.floor(Number(p.prestige) || 0)),
    },
    relationship: data.relationship || 'none',
    expiresAt: data.expires_at || null,
  };
}

/** Send the inviter a friend request (they accept with one tap). */
export async function acceptInvite(code) {
  if (!isValidInviteCode(code)) return { ok: false, reason: 'invalid' };
  const { data, error } = await supabase.rpc('accept_friend_invite', { p_code: code });
  if (error) return fail(error, 'Could not send the request.');
  if (!data?.ok) return { ok: false, reason: data?.reason || 'error' };
  return { ok: true, inviterId: data.inviter_id || null };
}

// ── Surviving sign-up ───────────────────────────────────────────────────
// A signed-out visitor goes through sign-up/sign-in and comes back; the
// code waits in sessionStorage (this tab only, gone when it closes).

export function rememberPendingInvite(code) {
  if (!isValidInviteCode(code)) return false;
  try { sessionStorage.setItem(PENDING_KEY, code); return true; } catch { return false; }
}

export function peekPendingInvite() {
  try {
    const c = sessionStorage.getItem(PENDING_KEY);
    return isValidInviteCode(c) ? c : null;
  } catch { return null; }
}

export function takePendingInvite() {
  const c = peekPendingInvite();
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  return c;
}

export { inviteUrl, isValidInviteCode, parseInvitePath };

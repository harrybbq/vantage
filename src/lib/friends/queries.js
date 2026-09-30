import { supabase } from '../supabase';
import { publicNameProblem } from '../moderation/nameFilter.js';

/**
 * Friends data layer — every Supabase call from the social feature
 * goes through here. Two reasons to keep it concentrated:
 *
 *   1. The error-mapping logic for the friend-cap trigger is in
 *      one place (Postgres raises a generic exception; we want a
 *      friendly client-facing string).
 *   2. Sprint 4+ may want to swap individual calls for an Edge
 *      Function (e.g. server-side notifications when a request is
 *      accepted) without touching the components.
 *
 * All functions accept a userId where it's not auth.uid() — the
 * caller knows whose perspective the query is from. RLS does the
 * real auth check; the parameter is just so the queries are
 * explicit and grep-friendly.
 */

// MUST match the trigger value in supabase/social_schema.sql.
// Bumping one without the other lies to the user about what they
// can do — a check-list note in the migration README catches it.
export const FREE_FRIEND_CAP = 5;

// Presence threshold — a friend whose last_active_at is within this
// window is "online". The heartbeat in usePublishProfile fires every
// 60s while the tab is visible, so this gives 3 missed pings of
// tolerance for transient network issues before going offline.
export const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

const DAY_MS = 86_400_000;

/** Pure helper — derives presence + last-seen from a profile-shaped
 *  row. Used to enrich friend rows in useFriends without re-fetching. */
export function derivePresence(lastActiveAt) {
  if (!lastActiveAt) return { online: false, lastSeenDays: null };
  const t = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(t)) return { online: false, lastSeenDays: null };
  const ageMs = Date.now() - t;
  if (ageMs < ONLINE_THRESHOLD_MS) {
    return { online: true, lastSeenDays: 0 };
  }
  return { online: false, lastSeenDays: Math.max(0, Math.floor(ageMs / DAY_MS)) };
}

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;

/** Validate a handle locally. Mirrors the SQL check constraint
 *  exactly — rejecting invalid handles before they hit the network
 *  saves a round-trip and a less-helpful error message. */
export function validateHandle(handle) {
  if (!handle) return 'Pick a handle to continue.';
  if (handle.length < 3) return 'Handle must be at least 3 characters.';
  if (handle.length > 20) return 'Handle must be 20 characters or fewer.';
  if (!HANDLE_RE.test(handle)) return 'Letters, numbers, and underscores only.';
  // Strangers see handles (search, the global board), so they get the
  // same public-text filter as group names (Apple 1.2). Every path that
  // sets a handle comes through here.
  return publicNameProblem(handle, 'handle');
}

/** Translate Supabase / Postgres errors into something a user can act
 *  on. Falls back to the raw message so unexpected failures aren't
 *  silently swallowed. */
function friendlyError(err, fallback = 'Something went wrong.') {
  const msg = err?.message || '';
  if (/Friend limit reached/i.test(msg)) {
    return 'Friend limit reached — upgrade to Pro for unlimited friends.';
  }
  if (/free-tier friend cap/i.test(msg)) {
    return 'They\'ve reached their friend limit. Ask them to upgrade or remove an old friend.';
  }
  if (/duplicate key/i.test(msg) && /friendships/i.test(msg)) {
    return 'A request between you two already exists.';
  }
  if (/duplicate key/i.test(msg) && /profiles_handle/i.test(msg)) {
    return 'That handle is taken.';
  }
  if (/profiles_handle_format/i.test(msg)) {
    return 'Letters, numbers, and underscores only (3–20 chars).';
  }
  return msg || fallback;
}

// ── Profile (self) ────────────────────────────────────────────────────

/** Read your own profile row. Returns null if no row exists yet
 *  (paywall_schema usually creates it on first login, but this is a
 *  defensive check for older accounts or fresh test users). */
export async function getOwnProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_url, level, is_searchable, last_active_at, tier')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error, 'Could not load profile.'));
  return data;
}

/** Claim or update your handle. Validates locally first, then writes
 *  through the self-update RLS policy. The unique constraint catches
 *  races where two users hit submit simultaneously on the same handle. */
export async function setHandle(userId, handle) {
  const err = validateHandle(handle);
  if (err) throw new Error(err);
  const { data, error } = await supabase
    .from('profiles')
    .update({ handle })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw new Error(friendlyError(error, 'Could not save handle.'));
  return data;
}

/** Update display_name / avatar_url / is_searchable. Each call
 *  upserts the row in case the paywall init missed it (defensive). */
export async function updateOwnProfile(userId, patch) {
  const allowed = ['display_name', 'avatar_url', 'is_searchable', 'level', 'last_active_at', 'leaderboard_optin', 'leaderboard_color'];
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([k]) => allowed.includes(k))
  );
  // Last line of defence for the display name other people see: a name
  // the public-text filter refuses is published as no name at all. The
  // user's own S.profile.name is untouched — this only decides what
  // leaves the device.
  // 40 chars: the profiles_display_name_len check (audit SQL).
  if (typeof clean.display_name === 'string') clean.display_name = clean.display_name.slice(0, 40);
  if (typeof clean.display_name === 'string' && publicNameProblem(clean.display_name)) {
    clean.display_name = null;
  }
  if (Object.keys(clean).length === 0) return null;
  const { data, error } = await supabase
    .from('profiles')
    .update(clean)
    .eq('id', userId)
    .select()
    .maybeSingle();
  if (error) throw new Error(friendlyError(error, 'Could not save profile.'));
  return data;
}

// ── Public stats ─────────────────────────────────────────────────────

/** Upsert your own public_stats row. Friends read this to render
 *  your friend-card heatmap and recent wins. */
export async function upsertOwnPublicStats(userId, stats) {
  const row = {
    user_id: userId,
    level: stats.level ?? 1,
    current_streak: stats.current_streak ?? 0,
    streak_habit: stats.streak_habit ?? null,
    heatmap_days: stats.heatmap_days ?? [],
    recent_wins: stats.recent_wins ?? [],
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('public_stats')
    .upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(friendlyError(error, 'Could not publish stats.'));
}

/** Fetch a friend's public_stats row. Returns null if they haven't
 *  published yet (new user, or never opened the app post-feature). */
export async function getFriendPublicStats(friendId) {
  const { data, error } = await supabase
    .from('public_stats')
    .select('*')
    .eq('user_id', friendId)
    .maybeSingle();
  if (error) throw new Error(friendlyError(error, 'Could not load friend stats.'));
  return data;
}

// ── Friendships ───────────────────────────────────────────────────────

/** Accepted friendships from your perspective. Returns enriched
 *  rows that already include the friend's profile fields, so the
 *  list view doesn't need a second round-trip per friend. */
export async function listAcceptedFriends(userId) {
  // Two queries because Supabase joins through FKs require explicit
  // alias hints; this is simpler and the cardinality is small (≤5
  // for free, modest for Pro).
  const { data: edges, error } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, accepted_at')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw new Error(friendlyError(error, 'Could not load friends.'));
  const otherIds = (edges || []).map(e =>
    e.requester_id === userId ? e.addressee_id : e.requester_id
  );
  if (otherIds.length === 0) return [];
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    // last_active_at drives the online-bubble heuristic in the rail.
    // Pulled here (rather than per-friend on selection) so the list
    // can sort online-first without an N+1 round-trip. ratings_ovr is
    // the server-canonical overall rating (written by the recompute
    // function) — it replaced `level` on the friend card.
    .select('id, handle, display_name, avatar_url, level, ratings_ovr, last_active_at')
    .in('id', otherIds);
  if (pErr) throw new Error(friendlyError(pErr, 'Could not load friend profiles.'));
  return (profiles || []).map(p => ({
    ...p,
    accepted_at: edges.find(e =>
      e.requester_id === p.id || e.addressee_id === p.id
    )?.accepted_at,
  }));
}

/** Lightweight relationship state for the current user — used to render
 *  the right action on leaderboard rows (Add / Requested / Friends)
 *  without a full useFriends instance. Returns three Sets of other-user
 *  ids. Fails soft (empty sets) so the leaderboard never breaks. */
export async function listRelationshipIds(userId) {
  const empty = { friends: new Set(), outgoing: new Set(), incoming: new Set() };
  if (!userId) return empty;
  const { data, error } = await supabase
    .from('friendships')
    .select('requester_id, addressee_id, status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) return empty;
  const out = { friends: new Set(), outgoing: new Set(), incoming: new Set() };
  for (const e of data || []) {
    const other = e.requester_id === userId ? e.addressee_id : e.requester_id;
    if (e.status === 'accepted') out.friends.add(other);
    else if (e.requester_id === userId) out.outgoing.add(other);
    else out.incoming.add(other);
  }
  return out;
}

/** Incoming pending requests (someone asked YOU). */
export async function listPendingRequests(userId) {
  const { data: edges, error } = await supabase
    .from('friendships')
    .select('requester_id, created_at')
    .eq('addressee_id', userId)
    .eq('status', 'pending');
  if (error) throw new Error(friendlyError(error, 'Could not load requests.'));
  const ids = (edges || []).map(e => e.requester_id);
  if (ids.length === 0) return [];
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_url, level, ratings_ovr')
    .in('id', ids);
  if (pErr) throw new Error(friendlyError(pErr, 'Could not load requesters.'));
  return (profiles || []).map(p => ({
    ...p,
    requested_at: edges.find(e => e.requester_id === p.id)?.created_at,
  }));
}

/**
 * How many friend requests are waiting, and nothing else.
 *
 * listPendingRequests above costs two round trips because it resolves
 * the requesters' profiles for the list UI. The chrome bar only needs
 * the number, and asks for it every minute, so it counts rows and stops
 * there — `head: true` fetches no bodies at all.
 *
 * Fails to zero rather than throwing: a chip that cannot count is a chip
 * that should not appear, and this runs on every page whether or not the
 * social migrations have been applied.
 */
export async function countPendingRequests(userId) {
  if (!userId) return 0;
  try {
    const { count, error } = await supabase
      .from('friendships')
      .select('requester_id', { count: 'exact', head: true })
      .eq('addressee_id', userId)
      .eq('status', 'pending');
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

/** Search by handle prefix. Calls the SECURITY DEFINER RPC so the
 *  results respect block lists without leaking blocker identity. */
export async function searchByHandle(q) {
  const trimmed = (q || '').trim().replace(/^@/, '');
  if (trimmed.length < 2) return [];
  const { data, error } = await supabase.rpc('search_profiles_by_handle', { q: trimmed });
  if (error) throw new Error(friendlyError(error, 'Search failed.'));
  return data || [];
}

/** Send a friend request. Insert a pending row with you as the
 *  requester. Cap check on insert is non-blocking (only fires for
 *  status='accepted'); the cap kicks in when they accept. */
export async function sendFriendRequest(fromUserId, toUserId) {
  const { error } = await supabase
    .from('friendships')
    .insert({ requester_id: fromUserId, addressee_id: toUserId, status: 'pending' });
  if (error) throw new Error(friendlyError(error, 'Could not send request.'));
}

/** Accept an incoming request. Returns the updated row so callers
 *  can refresh their lists from the response. */
export async function acceptFriendRequest(currentUserId, requesterId) {
  const { data, error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('requester_id', requesterId)
    .eq('addressee_id', currentUserId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw new Error(friendlyError(error, 'Could not accept request.'));
  return data;
}

/** Decline an incoming request OR unfriend an accepted one. RLS
 *  delete policy allows either party to delete; we don't surface the
 *  difference in the API since the operation is the same row-delete. */
export async function removeFriendship(currentUserId, otherUserId) {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${currentUserId},addressee_id.eq.${otherUserId}),` +
      `and(requester_id.eq.${otherUserId},addressee_id.eq.${currentUserId})`
    );
  if (error) throw new Error(friendlyError(error, 'Could not remove.'));
}

// ── Moderation ───────────────────────────────────────────────────────

export async function blockUser(currentUserId, blockedUserId) {
  // Drop any existing friendship in the same call so the block is
  // immediately effective; the friendships RLS allows either party
  // to delete.
  await removeFriendship(currentUserId, blockedUserId).catch(() => {});
  const { error } = await supabase
    .from('blocks')
    .insert({ blocker_id: currentUserId, blocked_id: blockedUserId });
  if (error) throw new Error(friendlyError(error, 'Could not block.'));
}

/**
 * File a report. `snapshot` ({ handle, display_name, where }) is a copy
 * of what the reporter was looking at: `reported_id` goes null when the
 * reported account is deleted, and a report that no longer says who or
 * what it was about can't be acted on or recognised as repeat abuse.
 *
 * The column arrives with supabase/audit_schema_2026_10.sql. Until that
 * has been run, PostgREST refuses the insert with "column not found"
 * (PGRST204 / 42703) — so it is retried once without the snapshot and
 * the report still lands exactly as it did before.
 */
export async function reportUser(currentUserId, reportedUserId, reason, context, snapshot) {
  const row = {
    reporter_id: currentUserId,
    reported_id: reportedUserId,
    reason: reason || null,
    context: context || null,
  };
  let { error } = snapshot
    ? await supabase.from('reports').insert({ ...row, reported_snapshot: snapshot })
    : await supabase.from('reports').insert(row);
  if (error && snapshot && isMissingColumn(error, 'reported_snapshot')) {
    ({ error } = await supabase.from('reports').insert(row));
  }
  if (error) throw new Error(friendlyError(error, 'Could not submit report.'));
}

function isMissingColumn(error, column) {
  const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return error?.code === 'PGRST204' || error?.code === '42703' || text.includes(column);
}

/** The snapshot a report carries — what the reporter could see. */
export function reportSnapshot({ handle, name, displayName, where } = {}) {
  const snap = {
    handle: handle ? String(handle).replace(/^@/, '').slice(0, 64) : null,
    display_name: (displayName || name) ? String(displayName || name).slice(0, 120) : null,
    where: where || null,
    at: new Date().toISOString(),
  };
  return snap;
}

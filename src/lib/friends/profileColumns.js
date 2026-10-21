/**
 * Which `profiles` columns another signed-in user may read (item 83).
 *
 * supabase/privacy_lockdown_2026_10b.sql replaces the table-wide SELECT
 * grant with a column list, so a query naming any other column fails
 * with "permission denied for column …" once that SQL has run. This is
 * the client's copy of that list, and profileColumns.test.mjs fails the
 * build if the two drift, or if any `from('profiles').select(…)` in src/
 * names a column outside it.
 *
 * Who reads each one, and why it is public:
 *   id            every query (and the UPDATE filter `id = me`)
 *   handle        search results, friend list, requests, inbox, invites
 *   display_name  the same surfaces
 *   avatar_url    the same surfaces (screened server-side, item 84)
 *   level         retired 2026-10 (no longer written or selected; the
 *                 grant stays so an older client's select still works)
 *   ratings_ovr   the OVR chip on the friend list, requests and search
 *   suspended_at  the inbox's "Account suspended" note — already shown
 *                 to anyone who has a thread with that account
 *
 * Deliberately NOT public any more — each was readable by every
 * signed-in user who could see the row (any searchable stranger):
 *   tier, tier_updated_at   who pays (own row: my_profile RPC)
 *   last_active_at          when someone was last online (friends only:
 *                           friend_presence RPC; own row: my_profile)
 *   is_searchable, leaderboard_optin, leaderboard_color   own settings
 *   ratings                 category ratings (item 103 — still shown on
 *                           the leaderboard and group boards, which read
 *                           them with the service key; only the raw
 *                           column read is closed)
 *   prestige, prestige_baseline, prestiged_at, lifetime_rating,
 *   ratings_computed_at, waitlist_joined_at   server bookkeeping
 */
export const PUBLIC_PROFILE_COLUMNS = Object.freeze([
  'id', 'handle', 'display_name', 'avatar_url', 'level', 'ratings_ovr', 'suspended_at',
]);

/** The friend-list / requests column set. */
export const PUBLIC_PROFILE_SELECT = 'id, handle, display_name, avatar_url, ratings_ovr';

/** What a write through PostgREST may ask back (RETURNING needs SELECT
 *  on every column it names, so `.select()` with no argument — `*` —
 *  would fail the whole UPDATE once the grants are narrowed). */
export const OWN_WRITE_RETURNING = 'id, handle, display_name, avatar_url';

/*
 * LEGACY fallbacks — used ONLY when the RPC that replaces them is
 * missing (the SQL has not been run yet). Under today's table-wide grant
 * they work; once the SQL has run the RPC exists and they are never
 * reached. The source scan allows these names in profileReads.js only.
 */
export const LEGACY_OWN_PROFILE_SELECT = '*';
export const LEGACY_PRESENCE_SELECT = 'id, last_active_at';

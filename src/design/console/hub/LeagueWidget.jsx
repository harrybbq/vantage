/**
 * League — the friends board as a division table.
 *
 * Data: the friends leaderboard (get-leaderboard, scope friends, all
 * time), fetched once by useFriendsHub and shared with the Friends
 * widget and the player strip. Rows carry server-canonical OVR, the four
 * categories, prestige and the 7-day OVR climb.
 *
 * No promotion / relegation rails: the friends board has no such
 * mechanic, and a rail must only ever mean something the server will do
 * (hub/NOTES.md). The footer says the one derivable thing instead — how
 * far behind the person above you are.
 */
import Icon from '../../../components/Icon';
import DivisionTable from './DivisionTable';

export function boardRows(board) {
  const rows = (board && Array.isArray(board.rows)) ? board.rows : [];
  return rows.map(r => ({
    id: r.userId || `r${r.rank}`,
    userId: r.userId || null,
    pos: r.rank,
    name: r.username || 'Unknown',
    avatarUrl: r.avatarUrl || null,
    prestige: r.prestige || 0,
    cats: r.categories || null,
    weekly: r.climb,
    ovr: r.ovr,
    isSelf: !!r.isSelf,
    zone: null,
  }));
}

/** "2 OVR behind Tom", "Top of the table", or null. */
export function gapNote(rows) {
  const i = rows.findIndex(r => r.isSelf);
  if (i < 0 || rows.length < 2) return null;
  const first = s => String(s || '').replace(/^@/, '@').split(/\s+/)[0];
  if (i === 0) {
    const d = (rows[0].ovr || 0) - (rows[1].ovr || 0);
    return d > 0 ? `${d} OVR clear of ${first(rows[1].name)}` : `Even with ${first(rows[1].name)}`;
  }
  const d = (rows[i - 1].ovr || 0) - (rows[i].ovr || 0);
  return d > 0 ? `${d} OVR behind ${first(rows[i - 1].name)}` : `Even with ${first(rows[i - 1].name)}`;
}

export function leagueMeta(hub) {
  const rows = boardRows(hub?.board);
  const me = rows.find(r => r.isSelf);
  if (!me || rows.length < 2) return 'Friends';
  return `Friends · ${ordinal(me.pos)} of ${rows.length}`;
}

export const ordinal = n => (n == null ? '–' : n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'));

export default function LeagueWidget({ navigate, size, isMobile, friendsHub: hub }) {
  const rows = boardRows(hub?.board);
  if (hub?.boardLoading && !rows.length) return <p className="cx-hub-empty">Loading the table…</p>;
  if (rows.length < 2) {
    return (
      <div className="cx-hub-empty-cta">
        <p className="cx-hub-pre"><b>Pre-season.</b> The table fills as friends join. Everyone you add plays on the same four ratings.</p>
        <button type="button" className="cx-btn" onClick={() => hub?.openAdd?.()}>
          <Icon name="user-plus" size={16} strokeWidth={1.75} /> Invite friends
        </button>
      </div>
    );
  }
  const limit = isMobile ? 5 : size === 'large' ? 12 : 7;
  return (
    <DivisionTable
      rows={rows}
      showCats={!isMobile}
      limit={limit}
      note={gapNote(rows)}
      label="Friends league"
      onRow={r => {
        if (!r.isSelf && r.userId && hub?.isFriend?.(r.userId)) hub.openFriend(r.userId);
        else navigate?.('leaderboard');
      }}
    />
  );
}

/**
 * Console Leaderboard: the same three boards as classic LeaderboardSection
 * (My group · Division · Friends and global), under one segmented control.
 *
 *   My group    classic GroupsTab view="group", restyled from outside.
 *               It holds every group write (create, join, leave, rename,
 *               crest, kick), so it is mounted whole, never forked.
 *   Division    the division table with promotion and relegation rails,
 *               fed by the same useGroups read the classic tab uses.
 *               Drawn by DivisionTable (see the import below).
 *   Individual  classic LeaderboardPanel (friends / global, all-time /
 *               weekly climb, add friend, the friend ratings sheet),
 *               restyled from outside.
 *
 * The "week closes" countdown stays: everything on the first two tabs is
 * scored since Monday, so how long is left decides whether tonight matters.
 */
import { useEffect, useState } from 'react';
import GroupsTab from '../../../components/groups/GroupsTab';
import LeaderboardPanel from '../../../components/LeaderboardPanel';
import { useGroups } from '../../../hooks/useGroups';
// SWAP POINT: HUB's shared table. Replace with
//   import DivisionTable from '../hub/DivisionTable';
// once hub/DivisionTable.jsx exists (same props: data, division, onPickDivision).
import DivisionTable from './DivisionTablePlaceholder';
import { Segmented } from '../ui';
import PageHead from './PageHead';

const TABS = [
  { value: 'group', label: 'My group' },
  { value: 'division', label: 'Division' },
  { value: 'individual', label: 'Individual' },
];

/** Time to the next Monday 00:00 UTC, when the week is settled. */
function useWeekClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const next = new Date(now);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7 || 7));
  const ms = next.getTime() - now;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  return {
    label: days > 0 ? `${days}d ${hours % 24}h` : `${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`,
    urgent: ms < 6 * 3_600_000,
  };
}

function DivisionView() {
  const [division, setDivision] = useState(null);
  const { data, loading, error } = useGroups(division);
  if (loading && !data) return <p className="cx-sweep-quiet">Loading…</p>;
  if (data && data.setup === false) {
    return <p className="cx-sweep-quiet">Groups aren't switched on yet. The individual board works either way.</p>;
  }
  if (error) return <p className="cx-sweep-quiet cx-danger" role="alert">{error}</p>;
  if (!data) return null;
  return <DivisionTable data={data} division={division ?? data.group?.division ?? 10} onPickDivision={setDivision} />;
}

export default function ConsoleLeaderboard({ userId, isMobile, navigate }) {
  const [tab, setTab] = useState('group');
  const clock = useWeekClock();

  return (
    <section className="section active cx-page cx-sweep-page cx-sweep-leaderboard">
      <PageHead
        title="Leaderboard"
        meta="Groups and divisions settle every Monday. Top three go up, bottom three go down."
        actions={(
          <div className={`cx-sweep-clock${clock.urgent ? ' is-urgent' : ''}`}>
            <span className="cx-t12 cx-muted">Week closes in</span>
            <span className="cx-num cx-t17">{clock.label}</span>
          </div>
        )}
      />
      <Segmented label="Board" options={TABS} value={tab} onChange={setTab} className="cx-sweep-tabs" />
      <div className="cx-sweep-lb-body">
        {tab === 'division' && <DivisionView />}
        {tab === 'group' && (
          <div className="cx-sweep-scope cx-sweep-groups">
            <GroupsTab view="group" />
          </div>
        )}
        {tab === 'individual' && (
          <div className="cx-sweep-scope cx-sweep-lbpanel">
            <LeaderboardPanel
              userId={userId}
              onOpenSelfBreakdown={() => navigate?.('hub')}
              onAddFriends={() => navigate?.(isMobile ? 'friends' : 'hub')}
              onOpenSettings={() => navigate?.('settings')}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * LeaderboardSection — three boards under one heading.
 *
 *   My Group   what your group did this week, and who did it
 *   Division   the fifteen groups you are up against
 *   Individual you against your friends, or everyone
 *
 * Groups sit ON TOP of the individual board rather than replacing it.
 * The individual ranking is the one that has always been here and the
 * one a person on their own still cares about; a group is a reason for
 * four friends to care about each other's week.
 *
 * The clock in the corner is doing real work: everything on the first
 * two tabs is scored since Monday and settled at the next one, so "how
 * long is left" is the number that decides whether tonight matters.
 */
import { useEffect, useState } from 'react';
import LeaderboardPanel from './LeaderboardPanel';
import GroupsTab from './groups/GroupsTab';
import SectionHelp from './SectionHelp';

const TABS = [
  ['group', 'My Group'],
  ['division', 'Division'],
  ['individual', 'Individual'],
];

/** Time to the next Monday 00:00 UTC — when the week is settled. */
function useWeekClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // A minute is plenty: this is a countdown in days and hours, and a
    // per-second tick would re-render the whole board for nothing.
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

export default function LeaderboardSection({
  active,
  userId,
  onOpenSelfBreakdown,
  onAddFriends,
  onOpenSettings,
}) {
  const [tab, setTab] = useState('group');
  const clock = useWeekClock();

  return (
    <section id="leaderboard" className={`section${active ? ' active' : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="lb-section-head">
          <div>
            <div className="eyebrow">Standings</div>
            <div className="sec-title">Leaderboard <SectionHelp
              title="Leaderboard"
              rows={[
                { term: 'OVR', def: 'Brain, Finance, Fitness and Social, each out of 99, averaged.' },
                { term: 'Group score', def: "How much every member's OVR grew since Monday, added up." },
                { term: 'Divisions', def: 'Top three go up on Monday, bottom three go down.' },
                { term: 'Prestige', def: 'At 99 you can trade it for a colour band and start again.' },
              ]}
              foot="Hide yourself from the global board in Settings → Privacy."
            /></div>
          </div>
          <div className={`lb-clock${clock.urgent ? ' is-urgent' : ''}`}>
            <div className="lb-clock-lbl">Week closes</div>
            <div className="lb-clock-num">{clock.label}</div>
            <div className="lb-clock-sub">Mon 00:00 reset</div>
          </div>
        </div>

        <div className="lb-toptabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`lb-toptab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >{label}</button>
          ))}
        </div>

        {tab === 'individual' ? (
          <LeaderboardPanel
            userId={userId}
            onOpenSelfBreakdown={onOpenSelfBreakdown}
            onAddFriends={onAddFriends}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <GroupsTab view={tab} />
        )}
      </div>
    </section>
  );
}

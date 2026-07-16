/**
 * LeaderboardSection — top-level page (peer of Hub / Achievements /
 * Track / etc). Renders the LeaderboardPanel inside a section header so
 * it slots into the same layout as the rest of the app.
 *
 * Props are thin pass-throughs: parent handles nav (open settings, add
 * friends) and self-breakdown opens the user's own RatingsPanel modal
 * via an action that lives one layer up.
 */
import LeaderboardPanel from './LeaderboardPanel';
import SectionHelp from './SectionHelp';

export default function LeaderboardSection({
  active,
  userId,
  onOpenSelfBreakdown,
  onAddFriends,
  onOpenSettings,
}) {
  return (
    <section id="leaderboard" className={`section${active ? ' active' : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="eyebrow">Standings</div>
          <div className="sec-title">Leaderboard <SectionHelp text="Your OVR rating (Brain, Finance, Fitness, Social — each 0–99) ranked against friends or everyone, by all-time or weekly climb. Add people straight from the board with the + button. At OVR 99 you can Prestige for a colour-band badge. Hide yourself from the global board any time in Settings → Privacy." /></div>
        </div>
        <LeaderboardPanel
          userId={userId}
          onOpenSelfBreakdown={onOpenSelfBreakdown}
          onAddFriends={onAddFriends}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </section>
  );
}

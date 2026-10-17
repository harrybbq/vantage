/**
 * MobileFriendsSection
 *
 * Standalone Friends route for mobile. The desktop hub mounts
 * `<FriendsRail/>` in its right rail; on mobile that rail isn't
 * rendered (the hub is single-column), so without a dedicated route
 * the More-drawer Friends entry pointed at "hub" and surfaced
 * nothing — the "takes you nowhere" bug.
 *
 * This wraps the same `FriendsRail` orchestrator at full width so
 * mobile users get the same friends list, request flow, and friend
 * cards. Reusing the rail (rather than re-implementing) means
 * mutations / RLS gates / handle-claim flow stay in lockstep with
 * desktop — fixing a bug in one fixes both.
 *
 * `layout="page"` tells the rail it owns the screen: a conversation
 * opens full-screen with Back, not as a floating modal over the list.
 */
import FriendsRail from '../friends/FriendsRail';

export default function MobileFriendsSection({ userId, onUpgrade }) {
  return (
    <section className="section m-friends-wrap">
      <div className="m-friends">
        <div className="m-section-header-block">
          <div className="m-section-eyebrow">// CHEERLEADERS</div>
          <div className="m-section-title-row">
            <div className="m-section-title">Friends</div>
          </div>
        </div>
        <FriendsRail userId={userId} onUpgrade={onUpgrade} layout="page" />
      </div>
    </section>
  );
}

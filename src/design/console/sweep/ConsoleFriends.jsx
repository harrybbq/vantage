/**
 * Console Friends page (the 'friends' route; a phone reaches it from
 * More, desktop by deep link).
 *
 * Same FriendsRail as classic, mounted whole: requests, the list, the
 * friend cards, messages, report and block, the handle claim. Only the
 * page around it is new, and the rail is restyled from outside through
 * the scoped token bridge in sweep.css (.cx-sweep-scope). No data path
 * is forked, so a fix to the rail lands here too.
 */
import FriendsRail from '../../../components/friends/FriendsRail';
import PageHead from './PageHead';

export default function ConsoleFriends({ userId, onOpenPaywall }) {
  return (
    <section className="section active cx-page cx-sweep-page cx-sweep-friends">
      <PageHead title="Friends" meta="Requests, your friends and your messages." />
      <div className="cx-sweep-scope cx-sweep-rail">
        <FriendsRail userId={userId} onUpgrade={() => onOpenPaywall?.('friends')} layout="page" />
      </div>
    </section>
  );
}

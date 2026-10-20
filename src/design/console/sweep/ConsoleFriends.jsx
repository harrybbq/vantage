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
import { useEffect, useRef } from 'react';
import FriendsRail from '../../../components/friends/FriendsRail';
import PageHead from './PageHead';

/**
 * In page layout the rail renders the picked friend's card BELOW the list,
 * which on a phone is off screen, so picking a friend looked like nothing
 * happened. Watch for the card and bring it into view (the classic rail is
 * read-only, so this is done from outside).
 */
function useRevealFriendCard(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return undefined;
    let shown = null;
    const reveal = () => {
      const card = root.querySelector('.fc-card-slot');
      if (card && card !== shown) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() => card.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
      }
      shown = card;
    };
    const mo = new MutationObserver(reveal);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref]);
}

export default function ConsoleFriends({ userId, onOpenPaywall }) {
  const railRef = useRef(null);
  useRevealFriendCard(railRef);
  return (
    <section className="section active cx-page cx-sweep-page cx-sweep-friends">
      <PageHead title="Friends" meta="Requests, your friends and your messages." />
      <div className="cx-sweep-scope cx-sweep-rail" ref={railRef}>
        <FriendsRail userId={userId} onUpgrade={() => onOpenPaywall?.('friends')} layout="page" />
      </div>
    </section>
  );
}

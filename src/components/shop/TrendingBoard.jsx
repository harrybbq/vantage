import { useEffect, useState } from 'react';
import { TRENDING_ITEMS } from '../../data/trendingItems';
import { supabase } from '../../lib/supabase';

/**
 * TrendingBoard — a single-item-wide list that slowly rolls, like an
 * advertisement board, surfacing items to discover. Right rail on
 * desktop, a horizontal ticker at the bottom on mobile (layout via CSS).
 *
 * Two sources, toggled in the header:
 *   • Popular  — a curated catalogue (data/trendingItems)
 *   • Friends  — what your accepted friends are saving for, aggregated
 *                by the friends-trending function (anonymous counts).
 * Friends is the default whenever your friends have wishlist items.
 *
 * The list is duplicated so the CSS marquee loops seamlessly; hovering
 * pauses it. Each card can be added straight to your own wishlist.
 */
export default function TrendingBoard({ onAdd }) {
  const [friends, setFriends] = useState(null); // null=loading, []=none
  const [source, setSource] = useState('popular');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/.netlify/functions/friends-trending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        });
        const body = await res.json().catch(() => ({}));
        const items = Array.isArray(body.items) ? body.items : [];
        if (cancelled) return;
        setFriends(items);
        if (items.length) setSource('friends'); // prefer friends when available
      } catch {
        if (!cancelled) setFriends([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const hasFriends = Array.isArray(friends) && friends.length > 0;

  // Normalise both sources to one card shape.
  const items = source === 'friends' && hasFriends
    ? friends.map(f => ({
        name: f.name,
        emoji: '🛍️',
        category: `${f.count} friend${f.count === 1 ? '' : 's'}`,
        price: f.price || '',
        blurb: '',
        url: f.url || '',
        coins: f.coins || 0,
      }))
    : TRENDING_ITEMS;

  const duration = Math.max(24, items.length * 4.5);
  const loop = [...items, ...items];

  return (
    <aside className="shop-trending" aria-label="Trending items">
      <div className="shop-trending-head">
        <span className="shop-trending-title">Trending</span>
        {hasFriends ? (
          <div className="shop-trending-toggle" onClick={e => e.stopPropagation()}>
            <button type="button" className={`shop-trending-tab${source === 'friends' ? ' on' : ''}`} onClick={() => setSource('friends')}>Friends</button>
            <button type="button" className={`shop-trending-tab${source === 'popular' ? ' on' : ''}`} onClick={() => setSource('popular')}>Popular</button>
          </div>
        ) : (
          <span className="shop-trending-sub">Popular picks</span>
        )}
      </div>
      <div className="shop-trending-viewport">
        <div className="shop-trending-track" style={{ animationDuration: `${duration}s` }}>
          {loop.map((item, i) => (
            <div className="shop-trend-card" key={i} aria-hidden={i >= items.length ? true : undefined}>
              <div className="shop-trend-emoji">{item.emoji}</div>
              <div className="shop-trend-body">
                <div className="shop-trend-name">{item.name}</div>
                <div className="shop-trend-meta">
                  <span className="shop-trend-cat">{item.category}</span>
                  {item.price && <span className="shop-trend-price">{item.price}</span>}
                </div>
                {item.blurb && <div className="shop-trend-blurb">{item.blurb}</div>}
              </div>
              <button
                type="button"
                className="shop-trend-add"
                title={`Add ${item.name} to your wishlist`}
                onClick={() => onAdd?.(item)}
              >+ Add</button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

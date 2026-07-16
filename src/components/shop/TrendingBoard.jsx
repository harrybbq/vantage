import { useEffect, useRef, useState } from 'react';
import { TRENDING_ITEMS } from '../../data/trendingItems';
import { supabase } from '../../lib/supabase';

/**
 * TrendingBoard — a single-item-wide list that slowly rolls, like an
 * advertisement board, surfacing items to discover. Right rail on
 * desktop, a horizontal ticker at the bottom on mobile (layout via CSS).
 *
 * Three sources, toggled in the header:
 *   • Friends  — what your accepted friends are saving for, aggregated
 *                by the friends-trending function (anonymous counts).
 *   • Global   — what everyone on Vantage is saving for, aggregated by
 *                the global-trending function (anonymous; shown as an
 *                "N wishlists" count, only items on ≥ 2 wishlists).
 *   • Popular  — a curated catalogue (data/trendingItems), the evergreen
 *                fallback when there's no live data yet.
 * Default preference: Friends → Global → Popular.
 *
 * The list is duplicated so the CSS marquee loops seamlessly; hovering
 * pauses it. Each card can be added straight to your own wishlist.
 */
export default function TrendingBoard({ onAdd }) {
  const [friends, setFriends] = useState(null); // null=loading, []=none
  const [everyone, setEveryone] = useState(null); // global source; null=loading, []=none
  const [source, setSource] = useState('popular');
  const userChose = useRef(false); // set once the user taps a tab

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
      const load = async (fn) => {
        try {
          const res = await fetch(`/.netlify/functions/${fn}`, { method: 'POST', headers: auth });
          const body = await res.json().catch(() => ({}));
          return Array.isArray(body.items) ? body.items : [];
        } catch { return []; }
      };
      const [fr, gl] = await Promise.all([load('friends-trending'), load('global-trending')]);
      if (cancelled) return;
      setFriends(fr);
      setEveryone(gl);
      // Prefer Friends, then Global, then leave on Popular — unless the
      // user has already picked a tab, in which case respect their choice.
      if (!userChose.current) setSource(fr.length ? 'friends' : gl.length ? 'global' : 'popular');
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFriends = Array.isArray(friends) && friends.length > 0;
  const hasGlobal = Array.isArray(everyone) && everyone.length > 0;

  const choose = (s) => { userChose.current = true; setSource(s); };

  const mapAgg = (arr, unit) => arr.map(f => ({
    name: f.name,
    emoji: '🛍️',
    category: `${f.count} ${unit}${f.count === 1 ? '' : 's'}`,
    price: f.price || '',
    blurb: '',
    url: f.url || '',
    coins: f.coins || 0,
  }));

  // Normalise the active source to one card shape.
  const items =
    source === 'friends' && hasFriends ? mapAgg(friends, 'friend')
    : source === 'global' && hasGlobal ? mapAgg(everyone, 'wishlist')
    : TRENDING_ITEMS;

  const duration = Math.max(24, items.length * 4.5);
  const loop = [...items, ...items];

  return (
    <aside className="shop-trending" aria-label="Trending items">
      <div className="shop-trending-head">
        <span className="shop-trending-title">Trending</span>
        {(hasFriends || hasGlobal) ? (
          <div className="shop-trending-toggle" onClick={e => e.stopPropagation()}>
            {hasFriends && (
              <button type="button" className={`shop-trending-tab${source === 'friends' ? ' on' : ''}`} onClick={() => choose('friends')}>Friends</button>
            )}
            {hasGlobal && (
              <button type="button" className={`shop-trending-tab${source === 'global' ? ' on' : ''}`} onClick={() => choose('global')}>Global</button>
            )}
            <button type="button" className={`shop-trending-tab${source === 'popular' ? ' on' : ''}`} onClick={() => choose('popular')}>Popular</button>
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

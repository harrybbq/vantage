import { useEffect, useRef, useState } from 'react';
import { TRENDING_ITEMS } from '../../data/trendingItems';
import { supabase } from '../../lib/supabase';
import { apiUrl } from '../../lib/authFetch';
import Icon from '../Icon';

/**
 * TrendingBoard — a single-item-wide list that slowly rolls, like an
 * advertisement board, surfacing items to discover. Right rail on
 * desktop, a horizontal ticker at the bottom on mobile (layout via CSS).
 *
 * Three sources, toggled in the header:
 *   • Friends  — what your accepted friends are saving for, aggregated
 *                by the friends-trending function (anonymous counts,
 *                only items ≥ 3 friends want).
 *   • Global   — what everyone on Vantage is saving for, aggregated by
 *                the global-trending function (anonymous; shown as an
 *                "N wishlists" count, only items ≥ 5 people want).
 *   • Popular  — a curated catalogue (data/trendingItems), the evergreen
 *                fallback when there's no live data yet.
 * Default preference: Friends → Global → Popular.
 *
 * The list is duplicated so the CSS marquee loops seamlessly; hovering
 * pauses it. Each card can be added straight to your own wishlist.
 */
export default function TrendingBoard({ onAdd, collapsible = false }) {
  const [friends, setFriends] = useState(null); // null=loading, []=none
  const [everyone, setEveryone] = useState(null); // global source; null=loading, []=none
  const [source, setSource] = useState('popular');
  const userChose = useRef(false); // set once the user taps a tab
  // Phones (`collapsible`): the board sits at the END of the list as one
  // closed line and opens in place. It used to be pinned above the tab
  // bar, covering ~30% of the screen. Deliberately not persisted — every
  // stored key costs a read and a write on every load and save.
  const [open, setOpen] = useState(!collapsible);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Signed out, there is nothing to ask for: both functions need a
      // token. This used to send "Authorization: Bearer undefined" and
      // collect two 401s.
      let token = null;
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token || null;
      } catch { /* treat as signed out */ }
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const load = async (fn) => {
        if (!token) return [];
        try {
          const res = await fetch(apiUrl(`/.netlify/functions/${fn}`), { method: 'POST', headers: auth });
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
  // The rolling marquee is for the desktop strip only. On a phone a
  // moving row of "+ Add" buttons is a moving tap target, so the open
  // board is a still row you swipe — one copy of each item, no loop.
  const marquee = !collapsible;
  const loop = marquee ? [...items, ...items] : items;
  const sourceLabel = source === 'friends' && hasFriends ? 'from friends'
    : source === 'global' && hasGlobal ? 'on Vantage' : 'picks';

  const tabs = (hasFriends || hasGlobal) ? (
    <div className="shop-trending-toggle" role="group" aria-label="Trending source">
      {hasFriends && (
        <button type="button" aria-pressed={source === 'friends'} className={`shop-trending-tab${source === 'friends' ? ' on' : ''}`} onClick={() => choose('friends')}>Friends</button>
      )}
      {hasGlobal && (
        <button type="button" aria-pressed={source === 'global'} className={`shop-trending-tab${source === 'global' ? ' on' : ''}`} onClick={() => choose('global')}>Global</button>
      )}
      <button type="button" aria-pressed={source === 'popular'} className={`shop-trending-tab${source === 'popular' ? ' on' : ''}`} onClick={() => choose('popular')}>Popular</button>
    </div>
  ) : (
    <span className="shop-trending-sub">Popular picks</span>
  );

  return (
    <aside className={`shop-trending${open ? '' : ' is-collapsed'}${collapsible ? ' is-collapsible' : ''}`} aria-label="Trending items">
      {collapsible ? (
        <button
          type="button"
          className="shop-trending-line"
          aria-expanded={open}
          aria-controls="shop-trending-body"
          onClick={() => setOpen(v => !v)}
        >
          <span className="shop-trending-title">Trending</span>
          <span className="shop-trending-sub">· {items.length} {sourceLabel}</span>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} style={{ marginLeft: 'auto' }} />
        </button>
      ) : (
        <div className="shop-trending-head">
          <span className="shop-trending-title">Trending</span>
          {tabs}
        </div>
      )}
      {open && (
        <div id="shop-trending-body" className="shop-trending-body">
          {collapsible && (hasFriends || hasGlobal) && <div className="shop-trending-tabsrow">{tabs}</div>}
          <div className={`shop-trending-viewport${marquee ? '' : ' is-still'}`}>
            <div className="shop-trending-track" style={marquee ? { animationDuration: `${duration}s` } : undefined}>
              {loop.map((item, i) => {
                const copy = i >= items.length;
                return (
                  <div className="shop-trend-card" key={i} aria-hidden={copy ? true : undefined}>
                    <div className="shop-trend-emoji" aria-hidden="true">{item.emoji}</div>
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
                      aria-label={`Add ${item.name} to your wishlist`}
                      title={`Add ${item.name} to your wishlist`}
                      tabIndex={copy ? -1 : undefined}
                      onClick={() => onAdd?.(item)}
                    >+ Add</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

import { TRENDING_ITEMS } from '../../data/trendingItems';

/**
 * TrendingBoard — a single-item-wide list that slowly rolls, like an
 * advertisement board, surfacing popular picks users might not have
 * come across. Right rail on desktop, a shorter strip at the bottom on
 * mobile (layout via CSS). The list is duplicated so the CSS marquee
 * loops seamlessly; hovering pauses it. Each card can be added straight
 * to the user's own wishlist.
 *
 * Data comes from a curated catalogue today (see data/trendingItems);
 * it's a drop-in for a live most-wishlisted feed later.
 */
export default function TrendingBoard({ onAdd }) {
  const items = TRENDING_ITEMS;
  // ~4.5s per item keeps it a slow, readable roll.
  const duration = Math.max(24, items.length * 4.5);
  const loop = [...items, ...items]; // duplicate for a seamless cycle

  return (
    <aside className="shop-trending" aria-label="Trending items">
      <div className="shop-trending-head">
        <span className="shop-trending-title">Trending</span>
        <span className="shop-trending-sub">Popular picks</span>
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

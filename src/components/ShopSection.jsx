import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { firePurchase } from '../utils/confetti';
import SectionHelp from './SectionHelp';
import TrendingBoard from './shop/TrendingBoard';
import Icon from './Icon';
import { SORTS, sortItems, searchItems, totalFor, fmtMoney } from '../lib/shop/list';
import { sweepPrices, priceMovement } from '../lib/shop/priceWatch';

const PRIORITY_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
const PRIORITY_CLASS = { high: 'priority-high', med: 'priority-med', low: 'priority-low' };
const PRIORITY_COLOR = { high: '#e05252', med: '#d99114', low: '#2fbf83' };

// Small coloured dot replacing the old 🔴🟡🟢 emoji — matches the
// SVG-icon language used everywhere else in the app.
function PrioDot({ p, size = 7 }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: PRIORITY_COLOR[p] || 'var(--text-muted)', flexShrink: 0 }} />;
}

let _dragItemId = null;

/**
 * Overflow menu for a shop card — phones only (CSS hides the trigger
 * above the mobile breakpoint, where the footer shows every action as
 * its own button).
 *
 * Why it exists: on a 390px screen the four footer buttons ate ~150px
 * of the row, squeezing the product name down to ~80px — every item
 * read "Notedfy Thi…". Link, Edit and Delete move in here; only the
 * bought toggle stays out, because it's the one action you use often.
 * Delete being one level down is a bonus: it's the destructive one and
 * it was sitting a thumb-width from the name.
 */
function CardMenu({ item, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = e => {
      if (ref.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    // Scrolling with a menu open would leave it floating over an item it
    // no longer belongs to — close instead of chasing the anchor.
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  /* The menu is portalled to <body> and positioned with fixed
     coordinates rather than being absolutely placed inside the card.
     It has to be: the wishlist column and the pinned Trending rail are
     siblings with their own z-indexes, so ANY z-index set on a
     descendant of the column is trapped below the rail — the menu came
     out underneath it. A portal escapes that stacking context entirely.
     Cards low on the screen open upward so the menu never lands behind
     the tab bar. */
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 190;
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      top: up ? undefined : Math.round(r.bottom + 6),
      bottom: up ? Math.round(window.innerHeight - r.top + 6) : undefined,
    });
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="shop-card-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="shop-icon-btn shop-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${item.name}`}
        onClick={() => setOpen(v => !v)}
      ><Icon name="ellipsis" size={16} /></button>
      {open && pos && createPortal(
        <div
          className="shop-card-menu-pop"
          role="menu"
          ref={popRef}
          style={{ right: pos.right, top: pos.top, bottom: pos.bottom }}
          onClick={e => e.stopPropagation()}
        >
          {item.url
            ? <a role="menuitem" href={item.url} target="_blank" rel="noreferrer" onClick={close}>
                <Icon name="external-link" size={14} />View online
              </a>
            : <span className="is-disabled"><Icon name="external-link" size={14} />No link added</span>}
          <button role="menuitem" type="button" onClick={() => { close(); onEdit(item.id); }}>
            <Icon name="pencil" size={14} />Edit item
          </button>
          <button role="menuitem" type="button" className="is-danger" onClick={() => { close(); onDelete(item.id); }}>
            <Icon name="trash-2" size={14} />Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

function CategoryTotal({ items }) {
  const { sum, counted, unknown } = totalFor(items);
  if (!counted) return null;
  return (
    <div
      className="shop-category-total"
      title={unknown ? `${unknown} item${unknown > 1 ? 's have' : ' has'} no readable price` : undefined}
    >
      {fmtMoney(sum)}{unknown ? <span className="shop-category-total-partial">+{unknown}</span> : null}
    </div>
  );
}

function ShopCard({ item, coins, requireCoins = true, onToggleBought, onDelete, onEdit, revealDelay, bulkMode, selected, onToggleSelect }) {
  const move = priceMovement(item);
  const hasLink = !!item.url;
  // With the gate off nothing is unaffordable, so the card must stop
  // saying "need more" about an item it will happily let you unlock.
  const canAfford = !requireCoins || (coins || 0) >= item.coinCost || item.bought;
  // Names > 50 chars truncate with an ellipsis the user can tap to
  // expand. Persists per-card session-only — not worth storing.
  const NAME_LIMIT = 50;
  const longName = item.name && item.name.length > NAME_LIMIT;
  const [nameExpanded, setNameExpanded] = useState(false);
  const shownName = longName && !nameExpanded
    ? item.name.slice(0, NAME_LIMIT).trimEnd() + '…'
    : item.name;

  return (
    <motion.div
      className={`shop-item-card prio-${item.priority || 'med'}${item.bought ? ' bought' : ''}${bulkMode ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}`}
      onClick={bulkMode ? () => onToggleSelect?.(item.id) : undefined}
      draggable={!bulkMode}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3, boxShadow: '0 12px 36px rgba(0,0,0,0.18)' }}
      viewport={{ once: true }}
      transition={{ duration: 0.3, delay: revealDelay ?? 0, ease: 'easeOut' }}
      onDragStart={e => {
        _dragItemId = item.id;
        setTimeout(() => e.target.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
      }}
      onDragEnd={e => {
        e.target.classList.remove('dragging');
        _dragItemId = null;
        document.querySelectorAll('.shop-drop-zone').forEach(z => {
          z.classList.remove('drag-over');
          z._enterCount = 0;
        });
      }}
    >
      {bulkMode && (
        <span className={`shop-select-dot${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected ? <Icon name="check" size={12} /> : null}
        </span>
      )}
      <div className="shop-item-img" style={{ position: 'relative' }}>
        {/* Cart icon sits underneath; a loaded image covers it, and a
            broken image simply hides itself to reveal the icon again. */}
        <Icon name="shopping-cart" size={22} strokeWidth={1.75} style={{ opacity: 0.45 }} />
        {item.imageUrl && (
          <img src={item.imageUrl} alt={item.name}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }} />
        )}
      </div>
      <div className="shop-item-body">
        {/* Class, not an inline style: an inline style can't be beaten by
            the mobile rules, and hiding the priority pill on phones is
            where the product name gets its width back. */}
        <div className="shop-item-topline">
          <div
            className={`shop-item-name${longName ? ' is-truncatable' : ''}${nameExpanded ? ' is-expanded' : ''}`}
            onClick={() => longName && setNameExpanded(v => !v)}
            role={longName ? 'button' : undefined}
            tabIndex={longName ? 0 : undefined}
            title={longName && !nameExpanded ? 'Tap to show full name' : undefined}
          >{shownName}</div>
          <span className={`shop-item-priority ${PRIORITY_CLASS[item.priority]}`}>
            <PrioDot p={item.priority} size={6} />{PRIORITY_LABEL[item.priority]}
          </span>
        </div>
        {/* Price and the drop/rise badge share a line. The badge keeps
            its absolute top-right position on desktop (CSS) — sitting in
            the body here only changes where it lands on phones, where the
            card is a single row and a corner overlay would collide with
            the buttons. */}
        {(item.price || move) && (
          <div className="shop-item-priceline">
            {item.price && <span className="shop-item-price">{item.price}</span>}
            {move && (
              <span className={`shop-pricemove shop-pricemove-${move.direction}`}
                title={`${fmtMoney(move.from)} → ${fmtMoney(move.to)} since you added it`}>
                {move.direction === 'down' ? '▼' : '▲'} {Math.abs(move.pct).toFixed(0)}%
              </span>
            )}
          </div>
        )}
        {item.bought && item.boughtAt && (
          <div className="shop-item-notes" style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>
            Bought {new Date(item.boughtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        )}
        {item.coinCost > 0 && (
          <div className={`shop-coin-cost${!canAfford && !item.bought ? ' cant-afford' : ''}`}>
            ⬡ {item.coinCost} coins{item.bought ? ' · spent' : !canAfford ? ' · need more' : ' to unlock'}
          </div>
        )}
        {item.notes && <div className="shop-item-notes">{item.notes}</div>}
      </div>
      <div className="shop-item-footer">
        {hasLink
          ? <a className="shop-link-btn" href={item.url} target="_blank" rel="noreferrer">View Online</a>
          : <span className="shop-link-btn no-link">No link added</span>
        }
        <motion.button className="shop-icon-btn shop-bought-btn"
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          onClick={() => onToggleBought(item.id)}
          title={item.bought ? 'Mark as not bought' : 'Mark as bought'}
        >
          {item.bought ? <Icon name="check" size={15} /> : <Icon name="shopping-bag" size={14} />}
        </motion.button>
        <button className="shop-icon-btn shop-edit-btn" title="Edit item" onClick={() => onEdit(item.id)}><Icon name="pencil" size={13} /></button>
        <button className="shop-icon-btn shop-del-btn" title="Delete item" onClick={() => onDelete(item.id)}><Icon name="trash-2" size={13} /></button>
        {!bulkMode && <CardMenu item={item} onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </motion.div>
  );
}

function DropZone({ categoryId, items, coins, requireCoins = true, onToggleBought, onDeleteItem, onEditItem, onDrop, bulkMode, selected, onToggleSelect }) {
  const handleDragEnter = e => {
    e.preventDefault();
    e.currentTarget._enterCount = (e.currentTarget._enterCount || 0) + 1;
    e.currentTarget.classList.add('drag-over');
  };
  const handleDragLeave = e => {
    e.currentTarget._enterCount = Math.max(0, (e.currentTarget._enterCount || 1) - 1);
    if (e.currentTarget._enterCount === 0) e.currentTarget.classList.remove('drag-over');
  };
  const handleDragOver = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = e => {
    e.preventDefault();
    e.currentTarget._enterCount = 0;
    e.currentTarget.classList.remove('drag-over');
    const dragId = e.dataTransfer.getData('text/plain') || _dragItemId;
    if (dragId) onDrop(dragId, categoryId);
  };

  if (!items.length) {
    return (
      <div
        className="shop-drop-zone"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <span className="shop-drop-hint">Drop items here</span>
      </div>
    );
  }

  return (
    <div
      className="shop-drop-zone has-items"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="shop-grid" style={{ padding: 0, display: 'grid' }}>
        {items.map((item, index) => (
          <ShopCard
            key={item.id}
            item={item}
            coins={coins}
            requireCoins={requireCoins}
            onToggleBought={onToggleBought}
            onDelete={onDeleteItem}
            onEdit={onEditItem}
            revealDelay={index * 0.06}
            bulkMode={bulkMode}
            selected={selected?.has(item.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default function ShopSection({ S, update, active, onOpenModal, onShowCoinToast }) {
  const { shopItems, shopCategories, shopFilter, coins } = S;
  // Settings → Goals → Shopping coins. Absent means required, so no
  // existing account changes behaviour.
  const requireCoins = S.shopRequireCoins !== false;
  // Which category tab reads as current. This used to FILTER the list
  // down to one category; it now just tracks where you are, because the
  // tabs scroll to a section instead of replacing the page. Kept in sync
  // by the scroll-spy below so it follows manual scrolling too.
  const [activeCategory, setActiveCategory] = useState('all');
  const gridRef = useRef(null);

  // View state, deliberately NOT persisted to S — a way of looking at
  // the list for a minute, not a setting, and every stored key is paid
  // for on every load and save.
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('added');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [moveTo, setMoveTo] = useState('');

  // One price sweep per mount, for items with a URL that haven't been
  // checked lately. Fails soft and writes only if something moved.
  const swept = useRef(false);
  useEffect(() => {
    if (swept.current || !active) return;
    swept.current = true;
    let alive = true;
    (async () => {
      const next = await sweepPrices(shopItems || []);
      if (!alive || next === shopItems) return;   // identity = nothing changed
      update(prev => {
        // Re-map onto the LATEST items so a concurrent edit isn't lost.
        const byId = new Map(next.map(i => [i.id, i]));
        return {
          ...prev,
          shopItems: (prev.shopItems || []).map(it => {
            const fresh = byId.get(it.id);
            if (!fresh) return it;
            return {
              ...it,
              price: fresh.price ?? it.price,
              priceCheckedAt: fresh.priceCheckedAt,
              ...(fresh.priceHistory ? { priceHistory: fresh.priceHistory } : {}),
            };
          }),
        };
      });
    })();
    return () => { alive = false; };
    // Runs once per mount; shopItems intentionally not a dependency.
  }, [active]);

  const toggleSelect = id => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  function exitBulk() { setBulkMode(false); setSelected(new Set()); setMoveTo(''); }

  function bulkMove(categoryId) {
    if (!selected.size) return;
    update(prev => ({
      ...prev,
      shopItems: (prev.shopItems || []).map(i =>
        selected.has(i.id) ? { ...i, categoryId: categoryId || null } : i),
    }));
    exitBulk();
  }
  function bulkBought(value) {
    if (!selected.size) return;
    update(prev => ({
      ...prev,
      shopItems: (prev.shopItems || []).map(i => selected.has(i.id)
        ? { ...i, bought: value, boughtAt: value ? Date.now() : undefined }
        : i),
    }));
    exitBulk();
  }
  function bulkDelete() {
    if (!selected.size) return;
    const n = selected.size;
    if (!window.confirm(`Delete ${n} item${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
    update(prev => ({
      ...prev,
      shopItems: (prev.shopItems || []).filter(i => !selected.has(i.id)),
    }));
    exitBulk();
  }

  const prefersReducedMotion = () =>
    typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /** Scroll a category's heading to the top of the viewport. The offset
   *  that stops it hiding under the header is `scroll-margin-top` in CSS,
   *  so it can differ per breakpoint without any JS measuring. */
  function goToCategory(key) {
    setActiveCategory(key);
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (key === 'all') {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const el = gridRef.current?.querySelector(`[data-shop-cat="${CSS.escape(key)}"]`);
    if (el) el.scrollIntoView({ behavior, block: 'start' });
  }

  // Scroll-spy: whichever section is nearest the top of the viewport owns
  // the active tab. rootMargin pulls the trigger line down from the very
  // top so a section counts as "current" once its heading is near the top,
  // matching where goToCategory lands you.
  useEffect(() => {
    const root = gridRef.current;
    if (!root || shopFilter !== 'all') return;
    const sections = [...root.querySelectorAll('[data-shop-cat]')];
    if (!sections.length) return;

    const io = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        // At the very top of the page, "All" is the honest answer.
        if (window.scrollY < 40) { setActiveCategory('all'); return; }
        setActiveCategory(visible[0].target.dataset.shopCat);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 }
    );
    sections.forEach(s => io.observe(s));
    return () => io.disconnect();
    // Re-observe when the set of sections changes.
  }, [shopFilter, shopCategories.length, shopItems.length]);

  const total = shopItems.length;
  const bought = shopItems.filter(s => s.bought).length;
  const totalVal = shopItems.filter(s => s.price).reduce((acc, s) => {
    const n = parseFloat(s.price.replace(/[^0-9.]/g, ''));
    return acc + (isNaN(n) ? 0 : n);
  }, 0);

  function setFilter(f) {
    update(prev => ({ ...prev, shopFilter: f }));
  }

  // Add a Trending pick straight to the user's own wishlist.
  function handleAddTrending(item) {
    update(prev => ({
      ...prev,
      shopItems: [...(prev.shopItems || []), {
        id: 's' + Date.now(),
        name: item.name,
        price: item.price || '',
        coinCost: item.coins || 0,
        priority: 'med',
        categoryId: null,
        notes: '',
        imageUrl: item.imageUrl || '',
        url: item.url || '',
        bought: false,
      }],
    }));
    onShowCoinToast?.(`Added ${item.name} to your wishlist`, false);
  }

  function handleToggleBought(id) {
    update(prev => {
      const item = prev.shopItems.find(s => s.id === id);
      if (!item) return prev;
      // Opt-out of the balance gate (Settings → Goals). Default ON, so
      // an absent key behaves exactly as before. It removes the BLOCK
      // only — the coins are still spent and still refunded, because a
      // purchase that costs nothing while the setting is off and
      // refunds in full once it's back on would mint coins.
      const requireCoins = prev.shopRequireCoins !== false;
      let newCoins = prev.coins || 0;
      let newHistory = [...(prev.coinHistory || [])];
      if (!item.bought && item.coinCost > 0) {
        if (requireCoins && newCoins < item.coinCost) {
          onShowCoinToast('Need ' + item.coinCost + ' ⬡ — you have ' + newCoins, false);
          return prev;
        }
        newCoins -= item.coinCost;
        newHistory.unshift({ type: 'spend', label: item.name, amount: -item.coinCost, ts: Date.now() });
        onShowCoinToast('-' + item.coinCost + ' ⬡ spent on ' + item.name + '!', false);
      } else if (item.bought) {
        // Refund what was actually PAID, not what the item costs now.
        // Refunding the current price minted coins: buy at 0, edit the
        // cost up to 5000, un-buy, collect 5000 you never spent. Items
        // bought before paidCoins existed fall back to coinCost, which
        // is what they were charged.
        const paid = item.paidCoins != null ? item.paidCoins : item.coinCost;
        if (paid > 0) {
          newCoins += paid;
          newHistory.unshift({ type: 'refund', label: item.name, amount: paid, ts: Date.now() });
        }
      }
      if (!item.bought) firePurchase();
      return {
        ...prev,
        // boughtAt drives the Archive view (sorted newest-first there);
        // un-buying clears it and returns the item to the active list.
        shopItems: prev.shopItems.map(s => s.id === id
          ? {
              ...s,
              bought: !s.bought,
              boughtAt: !s.bought ? Date.now() : undefined,
              // Price paid, pinned at purchase so a later edit to
              // coinCost can't change what a refund is worth.
              paidCoins: !s.bought ? (s.coinCost || 0) : undefined,
            }
          : s),
        coins: newCoins,
        coinHistory: newHistory,
      };
    });
  }

  function handleDeleteItem(id) {
    update(prev => ({ ...prev, shopItems: prev.shopItems.filter(s => s.id !== id) }));
  }

  function handleEditItem(id) {
    onOpenModal('editShopModal:' + id);
  }

  function handleDeleteCategory(id) {
    update(prev => ({
      ...prev,
      shopItems: prev.shopItems.map(s => s.categoryId === id ? { ...s, categoryId: null } : s),
      shopCategories: prev.shopCategories.filter(c => c.id !== id),
    }));
  }

  function handleDrop(itemId, categoryId) {
    update(prev => ({
      ...prev,
      shopItems: prev.shopItems.map(s => s.id === itemId ? { ...s, categoryId: categoryId || null } : s),
    }));
  }

  // Labels are JSX now — coloured dots + SVG icons instead of emoji.
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'high', label: <><PrioDot p="high" /> High</> },
    { key: 'med', label: <><PrioDot p="med" /> Medium</> },
    { key: 'low', label: <><PrioDot p="low" /> Low</> },
    { key: 'bought', label: <><Icon name="archive" size={12} /> Archive</> },
  ];

  // Bought items are ARCHIVED: they leave every active view the moment
  // they're purchased (no clutter) and live only under the Archive
  // filter, newest purchase first. Un-buying restores them.
  let filtered = shopItems;
  if (shopFilter === 'bought') {
    filtered = filtered.filter(s => s.bought)
      .slice()
      .sort((a, b) => (b.boughtAt || 0) - (a.boughtAt || 0));
  }
  else if (shopFilter === 'high') filtered = filtered.filter(s => s.priority === 'high' && !s.bought);
  else if (shopFilter === 'med') filtered = filtered.filter(s => s.priority === 'med' && !s.bought);
  else if (shopFilter === 'low') filtered = filtered.filter(s => s.priority === 'low' && !s.bought);
  else filtered = filtered.filter(s => !s.bought);

  // Search then sort, on top of whatever the priority filter left.
  // `shopItems` is passed as the ordering reference so "Recently added"
  // still means insertion order after filtering.
  filtered = sortItems(searchItems(filtered, query), sortKey, shopItems);
  const matching = filtered.length;

  return (
    <section id="shop" className={`section${active ? ' active' : ''}`}>
      <div className="shop-page">
      <div className="shop-layout">
        <div className="shop-toolbar">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <div className="eyebrow">Wishlist</div>
            <div className="sec-title">Shopping List <SectionHelp
              title="Shopping list"
              rows={[
                { term: 'Wishlist', def: 'Paste a product link to fill in the name and price.' },
                { term: 'Coins', def: 'Unlock items with what you earn, or switch that off and keep a plain list.' },
                { term: 'Trending', def: 'What other people are saving for. Counts only, no names.' },
              ]}
              foot="You are counted in Trending anonymously. Opt out in Settings → Privacy."
            /></div>
          </motion.div>
          <div className="shop-toolbar-actions" style={{ display: 'flex', gap: '10px' }}>
            {/* Show/hide Trending. A plain toggle beside the other two
                actions rather than buried in Settings: it is a view
                preference about this page, so it belongs on this page.
                Settings → Privacy still governs whether you are COUNTED
                in it, which is a different question. */}
            <motion.button
              className="btn btn-ghost"
              onClick={() => update(prev => ({ ...prev, showTrending: prev.showTrending === false }))}
              title={S.showTrending !== false ? 'Hide the Trending board' : 'Show the Trending board'}
              aria-pressed={S.showTrending !== false}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
              <Icon name={S.showTrending !== false ? 'eye' : 'eye-off'} size={14} />
              {S.showTrending !== false ? 'Hide Trending' : 'Show Trending'}
            </motion.button>
            <motion.button className="btn btn-ghost" onClick={() => onOpenModal('addCategoryModal')}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
              <Icon name="layout-grid" size={14} /> Add Category
            </motion.button>
            <motion.button className="btn btn-primary" onClick={() => onOpenModal('addShopModal')}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
              <Icon name="plus" size={15} /> Add Item
            </motion.button>
          </div>
        </div>

        <div className="shop-summary">
          <div className="shop-summary-stat"><div className="shop-summary-val">{total}</div><div className="shop-summary-lbl">Items</div></div>
          <div className="shop-summary-stat"><div className="shop-summary-val">{bought}</div><div className="shop-summary-lbl">Bought</div></div>
          <div className="shop-summary-stat"><div className="shop-summary-val">{total - bought}</div><div className="shop-summary-lbl">Remaining</div></div>
          {totalVal > 0 && <div className="shop-summary-stat"><div className="shop-summary-val">£{totalVal.toFixed(2)}</div><div className="shop-summary-lbl">Total Value</div></div>}
        </div>

        <div className="shop-filters">
          {filters.map(f => (
            <button
              key={f.key}
              className={`shop-filter-btn${shopFilter === f.key ? ' active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setFilter(f.key)}
            >{f.label}</button>
          ))}
        </div>

        <div className="shop-controls">
          <div className="shop-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your list…"
              aria-label="Search wishlist"
            />
            {query && (
              <button type="button" className="shop-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          <label className="shop-sort">
            {/* The word "Sort" is redundant next to a select that reads
                "Recently added" — it only earns its space on desktop. */}
            <span className="shop-sort-lbl">Sort</span>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)} aria-label="Sort items">
              {SORTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className={`shop-select-toggle${bulkMode ? ' is-on' : ''}`}
            onClick={() => (bulkMode ? exitBulk() : setBulkMode(true))}
          >
            <Icon name={bulkMode ? 'check' : 'square-check-big'} size={13} />
            <span>{bulkMode ? 'Done' : 'Select'}</span>
          </button>
        </div>

        {query && (
          <div className="shop-search-note">
            {matching === 0
              ? <>No items match <strong>{query}</strong>.</>
              : <>{matching} item{matching > 1 ? 's' : ''} matching <strong>{query}</strong>.</>}
          </div>
        )}

        {bulkMode && (
          <div className="shop-bulkbar">
            <span className="shop-bulkbar-count">{selected.size} selected</span>
            <button type="button" onClick={() => setSelected(new Set(filtered.map(i => i.id)))}>
              Select all{query || shopFilter !== 'all' ? ' shown' : ''}
            </button>
            <button type="button" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button>
            <select
              value={moveTo}
              disabled={!selected.size}
              onChange={e => { setMoveTo(e.target.value); if (e.target.value) bulkMove(e.target.value === '__none' ? null : e.target.value); }}
              aria-label="Move selected to category"
            >
              <option value="">Move to…</option>
              <option value="__none">Uncategorised</option>
              {shopCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" onClick={() => bulkBought(true)} disabled={!selected.size}>Mark bought</button>
            <button type="button" onClick={() => bulkBought(false)} disabled={!selected.size}>Mark unbought</button>
            <button type="button" className="shop-bulkbar-del" onClick={bulkDelete} disabled={!selected.size}>Delete</button>
          </div>
        )}

        {/* Category tabs — pivots between categories one tap at a
            time. "All" stacks every category (legacy desktop view).
            Lives at every viewport so behavior is predictable. */}
        {shopFilter === 'all' && (
          <div className="shop-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeCategory === 'all'}
              className={`shop-tab${activeCategory === 'all' ? ' is-active' : ''}`}
              onClick={() => goToCategory('all')}
            >All ({filtered.length})</button>
            <button
              role="tab"
              aria-selected={activeCategory === 'uncategorised'}
              className={`shop-tab${activeCategory === 'uncategorised' ? ' is-active' : ''}`}
              onClick={() => goToCategory('uncategorised')}
            >Uncategorised ({filtered.filter(s => !s.categoryId).length})</button>
            {shopCategories.map(cat => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={activeCategory === cat.id}
                className={`shop-tab${activeCategory === cat.id ? ' is-active' : ''}`}
                onClick={() => goToCategory(cat.id)}
              >{cat.name} ({filtered.filter(s => s.categoryId === cat.id).length})</button>
            ))}
          </div>
        )}

        <div className="shop-grid" id="shopGrid" ref={gridRef} style={{ marginTop: '16px', display: 'block' }}>
          {shopFilter === 'all' ? (
            <>
              <div className="shop-category-section" data-shop-cat="uncategorised">
                  <div className="shop-category-header">
                    <div className="shop-category-label">Uncategorised</div>
                    <div className="shop-category-line"></div>
                    <CategoryTotal items={filtered.filter(s => !s.categoryId)} />
                    <div className="shop-category-count">{filtered.filter(s => !s.categoryId).length}</div>
                  </div>
                  <DropZone
                    categoryId={null}
                    items={filtered.filter(s => !s.categoryId)}
                    coins={coins}
            requireCoins={requireCoins}
                    onToggleBought={handleToggleBought}
                    onDeleteItem={handleDeleteItem}
                    onEditItem={handleEditItem}
                    onDrop={handleDrop}
                    bulkMode={bulkMode}
                    selected={selected}
                    onToggleSelect={toggleSelect}
                  />
              </div>
              {shopCategories.map(cat => (
                <div key={cat.id} className="shop-category-section" data-shop-cat={cat.id}>
                  <div className="shop-category-header">
                    <div className="shop-category-label">{cat.name}</div>
                    <div className="shop-category-line"></div>
                    <CategoryTotal items={filtered.filter(s => s.categoryId === cat.id)} />
                    <div className="shop-category-count">{filtered.filter(s => s.categoryId === cat.id).length}</div>
                    <button className="shop-category-del-btn" onClick={() => handleDeleteCategory(cat.id)} title="Delete category" aria-label={`Delete category ${cat.name}`}><Icon name="x" size={11} /></button>
                  </div>
                  <DropZone
                    categoryId={cat.id}
                    items={filtered.filter(s => s.categoryId === cat.id)}
                    coins={coins}
            requireCoins={requireCoins}
                    onToggleBought={handleToggleBought}
                    onDeleteItem={handleDeleteItem}
                    onEditItem={handleEditItem}
                    onDrop={handleDrop}
                    bulkMode={bulkMode}
                    selected={selected}
                    onToggleSelect={toggleSelect}
                  />
                </div>
              ))}
              {!shopItems.length && (
                <div className="section-empty">
                  <div className="section-empty-icon"><Icon name="shopping-bag" size={34} strokeWidth={1.5} /></div>
                  <div className="section-empty-title">Nothing here yet</div>
                  <div className="section-empty-body">Add things you want to save up for. Earn coins by hitting your tracker goals.</div>
                  <button className="btn btn-primary btn-sm section-empty-cta" onClick={() => onOpenModal('addShopModal')}>Add first item</button>
                </div>
              )}
            </>
          ) : (
            filtered.length === 0
              ? <div className="shop-empty"><div className="shop-empty-icon"><Icon name={shopFilter === 'bought' ? 'archive' : 'shopping-bag'} size={30} strokeWidth={1.5} /></div><div>{shopFilter === 'bought' ? 'Archive is empty — items you mark as bought land here.' : 'Nothing here.'}</div></div>
              : (
                <div className="shop-grid" style={{ display: 'grid' }}>
                  {filtered.map((item, index) => (
                    <ShopCard
                      key={item.id}
                      item={item}
                      coins={coins}
            requireCoins={requireCoins}
                      onToggleBought={handleToggleBought}
                      onDelete={handleDeleteItem}
                      onEdit={handleEditItem}
                      revealDelay={index * 0.06}
                      bulkMode={bulkMode}
                      selected={selected.has(item.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              )
          )}
        </div>
      </div>
      {/* Trending is opt-out, not permanent furniture. It is the one
          thing on this page that is about other people, and someone
          shopping their own list should be able to put it away. `!==
          false` so the absence of the key means shown — the same shape
          every other opt-out in S uses. */}
      {S.showTrending !== false && <TrendingBoard onAdd={handleAddTrending} />}
      </div>
    </section>
  );
}

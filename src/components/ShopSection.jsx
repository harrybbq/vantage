import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { firePurchase } from '../utils/confetti';
import SectionHelp from './SectionHelp';
import TrendingBoard from './shop/TrendingBoard';
import Icon from './Icon';
import { useHubModuleMenu } from './HubModuleMenu';
import { useIsMobile } from '../hooks/useIsMobile';
import { SORTS, sortItems, searchItems, totalFor, fmtMoney } from '../lib/shop/list';
import { sweepPrices, priceMovement } from '../lib/shop/priceWatch';
import { itemPrice, totalsFor, fmtGBP } from '../lib/shop/price';

const PRIORITY_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
const PRIORITY_CLASS = { high: 'priority-high', med: 'priority-med', low: 'priority-low' };
const PRIORITY_COLOR = { high: '#e05252', med: '#d99114', low: '#2fbf83' };

// Small coloured dot replacing the old 🔴🟡🟢 emoji — matches the
// SVG-icon language used everywhere else in the app.
function PrioDot({ p, size = 7 }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: PRIORITY_COLOR[p] || 'var(--text-muted)', flexShrink: 0 }} />;
}

let _dragItemId = null;

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/*
 * The list animates ONCE per browser session: the first time the Shop
 * opens. Cards used to fade in one by one (0.06 s apiece), so a filtered
 * view of 37 cards took 2.2 s to finish appearing — and it replayed on
 * every filter change and every return to the page. Now the cards are
 * simply there, and the first visit gets one short fade of the whole
 * list. The time window absorbs React's StrictMode double render (and
 * a remount within the same moment) without letting a later visit
 * animate again. Reduced motion: never.
 */
let _entryAt = 0;
let _entryAllowed = false;
function entryAnimates() {
  const now = Date.now();
  if (!_entryAt) {
    _entryAt = now;
    let seen = false;
    try { seen = sessionStorage.getItem('vantage.shopEntered') === '1'; sessionStorage.setItem('vantage.shopEntered', '1'); } catch { /* private mode: animate once per load */ }
    _entryAllowed = !seen && !prefersReducedMotion();
  }
  return _entryAllowed && now - _entryAt < 1500;
}

/** "Sony WH-1000XM5 Wireless Noise Cancelling…" → first six words, for toasts. */
function shortName(name) {
  const words = String(name || 'item').trim().split(/\s+/);
  const s = words.slice(0, 6).join(' ');
  return words.length > 6 || s.length > 44 ? s.slice(0, 44).trimEnd() + '…' : s;
}

/** "£18.00" → "£18"; pennies stay when they matter. */
function fmtShort(n) {
  const s = fmtGBP(n);
  return s ? s.replace(/\.00$/, '') : '';
}

/**
 * A ⋯ button that opens a small action menu. Used on each card (phones)
 * and on each category heading (all sizes).
 *
 * The menu is portalled to <body> and positioned with fixed coordinates
 * rather than being absolutely placed inside the card. It has to be: the
 * wishlist column and the Trending strip are siblings with their own
 * z-indexes, so ANY z-index set on a descendant of the column is trapped
 * below them. A portal escapes that stacking context entirely. Triggers
 * low on the screen open upward so the menu never lands behind the tab
 * bar.
 *
 * Keyboard (WAI-ARIA menu button): opening moves focus to the first
 * item (ArrowUp on the trigger opens on the last); arrows, Home and End
 * move; Escape and Tab close and hand focus back to the trigger, so a
 * keyboard user is never left on a menu that has disappeared.
 */
/** Fixed-position coordinates for a menu anchored under (or over) `r`. */
function placeMenu(r, up) {
  return {
    right: Math.max(8, window.innerWidth - r.right),
    top: up ? undefined : Math.round(r.bottom + 6),
    bottom: up ? Math.round(window.innerHeight - r.top + 6) : undefined,
  };
}

function MenuButton({ label, items, className = '', iconSize = 16 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const focusAt = useRef('first');

  const focusables = () => [...(popRef.current?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') || [])];
  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = e => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // The menu follows its trigger while the page scrolls (a smooth
    // scroll from Tab-focusing the trigger is still running when Enter
    // opens it), and closes once the trigger leaves the screen. If focus
    // was inside, it goes back to the trigger rather than <body>.
    const drop = () => {
      const hadFocus = popRef.current?.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) btnRef.current?.focus({ preventScroll: true });
    };
    const follow = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { drop(); return; }
      setPos(placeMenu(r, openUp.current));
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', drop);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', drop);
    };
  }, [open]);

  const openUp = useRef(false);
  useLayoutEffect(() => {
    if (!open || !btnRef.current) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    openUp.current = window.innerHeight - r.bottom < 60 + items.length * 48;
    setPos(placeMenu(r, openUp.current));
  }, [open, items.length]);

  // Focus moves in once, when the menu first appears — not on every
  // reposition.
  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed) return;
    const els = focusables();
    (focusAt.current === 'last' ? els[els.length - 1] : els[0])?.focus({ preventScroll: true });
  }, [open, placed]);

  const onMenuKey = e => {
    const els = focusables();
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(true); }
  };

  return (
    <div className={`shop-menu ${className}`} onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        className="shop-icon-btn shop-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => { focusAt.current = 'first'; setOpen(v => !v); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            focusAt.current = e.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          }
        }}
      ><Icon name="ellipsis" size={iconSize} /></button>
      {open && pos && createPortal(
        <div
          className="shop-card-menu-pop shop-portal"
          role="menu"
          aria-label={label}
          ref={popRef}
          style={{ right: pos.right, top: pos.top, bottom: pos.bottom }}
          onKeyDown={onMenuKey}
          onClick={e => e.stopPropagation()}
        >
          {items.map(it => {
            const inner = <><Icon name={it.icon} size={15} />{it.label}</>;
            if (it.disabled) return <span key={it.label} role="menuitem" aria-disabled="true" className="is-disabled">{inner}</span>;
            if (it.href) {
              return <a key={it.label} role="menuitem" tabIndex={-1} href={it.href} target="_blank" rel="noreferrer" onClick={() => close(false)}>{inner}</a>;
            }
            return (
              <button key={it.label} role="menuitem" tabIndex={-1} type="button"
                className={it.danger ? 'is-danger' : undefined}
                onClick={() => { close(true); it.onSelect(); }}
              >{inner}</button>
            );
          })}
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
      {fmtMoney(sum)}{unknown ? <span className="shop-category-total-partial" aria-label={`plus ${unknown} unpriced`}>+{unknown}</span> : null}
    </div>
  );
}

/*
 * One wishlist card. In select mode the whole card becomes a checkbox
 * (Space or Enter toggles it from the keyboard) and its own buttons step
 * aside: the bulk bar is where actions live while selecting, and a
 * button nested inside a checkbox is two controls fighting over one tap.
 */
function ShopCard({ item, coins, requireCoins = true, onToggleBought, onDelete, onEdit, bulkMode, selected, onToggleSelect, onDragState }) {
  const move = priceMovement(item);
  const price = itemPrice(item);
  // The user's own text is what the card shows (it is what they typed,
  // "From £20" and all). The last checked price sits beside it, muted,
  // only when it says something different.
  const now = price.now && Number.isFinite(price.now.value) ? price.now : null;
  const showNow = !!now && (price.value == null || Math.abs(now.value - price.value) >= 0.005);
  const hasLink = !!item.url;
  // With the gate off nothing is unaffordable, so the card must stop
  // saying "need more" about an item it will happily let you unlock.
  const canAfford = !requireCoins || (coins || 0) >= item.coinCost || item.bought;
  // Names > 50 chars truncate with an ellipsis the user can expand.
  // Session-only — not worth storing.
  const NAME_LIMIT = 50;
  const longName = item.name && item.name.length > NAME_LIMIT;
  const [nameExpanded, setNameExpanded] = useState(false);
  const shownName = longName && !nameExpanded
    ? item.name.slice(0, NAME_LIMIT).trimEnd() + '…'
    : item.name;

  const selectProps = bulkMode ? {
    role: 'checkbox',
    'aria-checked': !!selected,
    'aria-label': item.name,
    tabIndex: 0,
    onClick: () => onToggleSelect?.(item.id),
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggleSelect?.(item.id); }
    },
  } : {};

  return (
    <div
      className={`shop-item-card prio-${item.priority || 'med'}${item.bought ? ' bought' : ''}${bulkMode ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}`}
      draggable={!bulkMode}
      {...selectProps}
      onDragStart={e => {
        _dragItemId = item.id;
        onDragState?.(true);
        const el = e.currentTarget;
        setTimeout(() => el.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
      }}
      onDragEnd={e => {
        e.currentTarget.classList.remove('dragging');
        _dragItemId = null;
        onDragState?.(false);
      }}
    >
      {bulkMode && (
        <span className={`shop-select-dot${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected ? <Icon name="check" size={12} /> : null}
        </span>
      )}
      <div className="shop-item-img" aria-hidden="true">
        {/* Cart icon sits underneath; a loaded image covers it, and a
            broken image simply hides itself to reveal the icon again.
            Decorative: the name is right beside it, so alt="" rather
            than reading a 100-character product name out twice. */}
        <Icon name="shopping-cart" size={22} strokeWidth={1.75} style={{ opacity: 0.45 }} />
        {item.imageUrl && (
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }} />
        )}
      </div>
      <div className="shop-item-body">
        {/* Class, not an inline style: an inline style can't be beaten by
            the mobile rules, and hiding the priority pill on phones is
            where the product name gets its width back. */}
        <div className="shop-item-topline">
          {longName && !bulkMode ? (
            <button
              type="button"
              className={`shop-item-name is-truncatable${nameExpanded ? ' is-expanded' : ''}`}
              aria-expanded={nameExpanded}
              aria-label={item.name}
              title={nameExpanded ? undefined : 'Show full name'}
              onClick={() => setNameExpanded(v => !v)}
            >{shownName}</button>
          ) : (
            <div className="shop-item-name">{shownName}</div>
          )}
          <span className={`shop-item-priority ${PRIORITY_CLASS[item.priority] || ''}`}>
            <PrioDot p={item.priority} size={6} />{PRIORITY_LABEL[item.priority]}
          </span>
        </div>
        {(item.price || showNow || move) && (
          <div className="shop-item-priceline">
            {item.price && <span className="shop-item-price">{item.price}</span>}
            {showNow && (
              <span className="shop-item-now"
                title={now.at ? `Last checked ${new Date(now.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Last checked price'}>
                Now {fmtShort(now.value)}
              </span>
            )}
            {move && (
              <span className={`shop-pricemove shop-pricemove-${move.direction}`}
                title={`${fmtMoney(move.from)} → ${fmtMoney(move.to)} since you added it`}>
                <span aria-hidden="true">{move.direction === 'down' ? '▼' : '▲'} </span>
                <span className="shop-sr">{move.direction === 'down' ? 'Down' : 'Up'} </span>
                {Math.abs(move.pct).toFixed(0)}%
              </span>
            )}
          </div>
        )}
        {item.bought && item.boughtAt && (
          <div className="shop-item-bought-on">
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
      {!bulkMode && (
        <div className="shop-item-footer">
          {hasLink
            ? <a className="shop-link-btn" href={item.url} target="_blank" rel="noreferrer">View Online</a>
            : <span className="shop-link-btn no-link">No link added</span>
          }
          <button type="button" className="shop-icon-btn shop-bought-btn"
            onClick={() => onToggleBought(item.id)}
            aria-pressed={!!item.bought}
            aria-label={item.bought ? `Mark ${item.name} as not bought` : `Mark ${item.name} as bought`}
            title={item.bought ? 'Mark as not bought' : 'Mark as bought'}
          >
            {item.bought ? <Icon name="check" size={16} /> : <Icon name="shopping-bag" size={15} />}
          </button>
          <button type="button" className="shop-icon-btn shop-edit-btn" title="Edit item" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item.id)}><Icon name="pencil" size={14} /></button>
          <button type="button" className="shop-icon-btn shop-del-btn" title="Delete item" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item.id)}><Icon name="trash-2" size={14} /></button>
          <MenuButton
            className="shop-card-menu"
            label={`More actions for ${item.name}`}
            items={[
              hasLink
                ? { label: 'View online', icon: 'external-link', href: item.url }
                : { label: 'No link added', icon: 'external-link', disabled: true },
              { label: 'Edit item', icon: 'pencil', onSelect: () => onEdit(item.id) },
              { label: 'Delete', icon: 'trash-2', danger: true, onSelect: () => onDelete(item.id) },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/*
 * A category's cards, and the drop target for dragging cards into it.
 * The dashed "Drop here" box only exists WHILE a drag is in progress:
 * rendering one under every empty category all the time is how an
 * empty search used to show nine of them around a one-line message.
 */
function DropZone({ categoryId, items, dragging, onDrop, renderCard }) {
  const [over, setOver] = useState(false);
  const enter = useRef(0);
  useEffect(() => { if (!dragging) { enter.current = 0; setOver(false); } }, [dragging]);

  if (!items.length && !dragging) return null;

  const dnd = {
    onDragEnter: e => { e.preventDefault(); enter.current += 1; setOver(true); },
    onDragLeave: () => { enter.current = Math.max(0, enter.current - 1); if (!enter.current) setOver(false); },
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDrop: e => {
      e.preventDefault();
      enter.current = 0;
      setOver(false);
      const dragId = e.dataTransfer.getData('text/plain') || _dragItemId;
      if (dragId) onDrop(dragId, categoryId);
    },
  };

  if (!items.length) {
    return (
      <div className={`shop-drop-zone${over ? ' drag-over' : ''}`} {...dnd}>
        <span className="shop-drop-hint">Drop here</span>
      </div>
    );
  }
  return (
    <div className={`shop-drop-zone has-items${over ? ' drag-over' : ''}`} {...dnd}>
      <div className="shop-grid">{items.map(renderCard)}</div>
    </div>
  );
}

/**
 * One category in the rail.
 *
 * Carries the two things the old horizontal tab strip could not fit
 * beside a name: how many items are in it, and what they come to. The
 * total is the same totalFor() the category headings use, so the rail
 * and the heading can never disagree — and it reports unknown-price
 * items as "+N" rather than quietly leaving them out of a number
 * someone might budget against.
 *
 * A jump link, not a tab: it scrolls to the heading and the list stays
 * whole, so it reports the current place with aria-current.
 */
function RailCat({ label, items, count, colour, active, onGo }) {
  const { sum, unknown } = totalFor(items || []);
  return (
    <button
      type="button"
      aria-current={active ? 'location' : undefined}
      className={`shop-railcat${active ? ' is-active' : ''}`}
      onClick={onGo}
    >
      <span className="shop-railcat-dot" aria-hidden="true" style={colour ? { background: colour } : undefined} />
      <span className="shop-railcat-name">{label}</span>
      <span className="shop-railcat-meta">
        {sum > 0 && <span className="shop-railcat-sum">{fmtMoney(sum)}{unknown ? <i aria-label={`plus ${unknown} unpriced`}>+{unknown}</i> : null}</span>}
        <span className="shop-railcat-n">{count}</span>
      </span>
    </button>
  );
}

/*
 * Undo for a delete. Deleting is immediate — the item leaves the list
 * through the same additive state update as any other edit — and for
 * five seconds the removed object is held here so Undo can put it back
 * exactly where it was. The clock pauses while the toast is hovered or
 * focused, so reaching it by keyboard never races the timer.
 */
function UndoToast({ undo, onUndo, onDone, btnRef }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!undo || paused) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [undo, paused, onDone]);
  // The live region is always mounted (empty when idle) so a screen
  // reader is already listening when the message arrives.
  return createPortal(
    <div className="shop-undo-wrap shop-portal" role="status" aria-live="polite">
      {undo && (
        <div
          className="shop-undo"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <span className="shop-undo-msg">{undo.msg}</span>
          <button ref={btnRef} type="button" className="shop-undo-btn" onClick={onUndo}>
            <Icon name="rotate-ccw" size={14} /> Undo
          </button>
        </div>
      )}
    </div>,
    document.body
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

  /*
   * The board — a rail of context beside the list — is a DESKTOP layout,
   * and only a desktop layout.
   *
   * On a phone it was wrong twice over. Visually, a sidebar has nowhere
   * to go on a 390px screen: it becomes a tall stack of stats and
   * category rows that the wishlist has to be scrolled past, which is
   * the opposite of what the rail is for. Structurally it was worse —
   * putting the Trending marquee inside the board's grid handed the
   * track's `1fr` minimum to a `width:max-content` ticker, blowing the
   * page out to 6649px at a 390px viewport (measured) and making iOS
   * zoom out to fit it. That second part is fixed in CSS regardless,
   * but the first part is a judgement, and the judgement is that phones
   * keep the rendition they had: stats strip, priority pills, category
   * tabs, then the list.
   */
  const isMobile = useIsMobile();

  // Right-click a column of the board to drop its fill so the user's
  // background shows through — the same gesture, store and switch the
  // hub and Track use. Desktop only, because the board is.
  const moduleMenu = useHubModuleMenu({ S, update });

  // View state, deliberately NOT persisted to S — a way of looking at
  // the list for a minute, not a setting, and every stored key is paid
  // for on every load and save.
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('added');
  const [selected, setSelected] = useState(() => new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  // Wishlist / Purchased. A tab rather than the old "Archive" filter
  // pill, so the priority pills can apply inside either one. A legacy
  // shopFilter of 'bought' opens on Purchased.
  const [view, setView] = useState(() => (shopFilter === 'bought' ? 'purchased' : 'wishlist'));
  // True only while a card is being dragged — the empty drop targets
  // exist for exactly that long.
  const [dragging, setDragging] = useState(false);
  // A card dropped into another category is re-mounted there, so its own
  // dragend never reaches React (the node that started the drag is gone).
  // Any drop, or any dragend that does arrive, ends the drag here.
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(false);
    window.addEventListener('drop', end, true);
    window.addEventListener('dragend', end, true);
    return () => {
      window.removeEventListener('drop', end, true);
      window.removeEventListener('dragend', end, true);
    };
  }, [dragging]);
  const [entering, setEntering] = useState(entryAnimates);
  useEffect(() => {
    if (!entering) return;
    const t = setTimeout(() => setEntering(false), 700);
    return () => clearTimeout(t);
  }, [entering]);
  const [undo, setUndo] = useState(null);
  const undoBtnRef = useRef(null);
  const clearUndo = useRef(() => setUndo(null)).current;

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
    if (!root || view !== 'wishlist') return;
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
  }, [view, shopFilter, query, shopCategories.length, shopItems.length]);

  const total = shopItems.length;
  const bought = shopItems.filter(s => s.bought).length;
  // The one-line header: what is still wanted and what it comes to,
  // through the shared price reader so it matches every other total.
  const wantedTotals = totalsFor(shopItems.filter(s => !s.bought));

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

  /*
   * Deletes are immediate and undoable (5 s), not confirmed. The saved
   * object and its index are captured from the list as rendered; Undo
   * re-inserts that same object at the same position, and does nothing
   * if the item somehow came back in the meantime — it never overwrites.
   */
  function offerUndo(msg, restore) {
    setUndo({ msg, restore, key: Date.now() + Math.random() });
  }
  function runUndo() {
    const u = undo;
    setUndo(null);
    u?.restore();
  }

  function handleDeleteItem(id) {
    const index = shopItems.findIndex(s => s.id === id);
    if (index < 0) return;
    const saved = shopItems[index];
    update(prev => ({ ...prev, shopItems: (prev.shopItems || []).filter(s => s.id !== id) }));
    offerUndo(`Deleted ${shortName(saved.name)}`, () => update(prev => {
      const list = prev.shopItems || [];
      if (list.some(s => s.id === saved.id)) return prev;
      const next = [...list];
      next.splice(Math.min(index, next.length), 0, saved);
      return { ...prev, shopItems: next };
    }));
  }

  function handleEditItem(id) {
    onOpenModal('editShopModal:' + id);
  }

  function handleDeleteCategory(id) {
    const catIndex = shopCategories.findIndex(c => c.id === id);
    if (catIndex < 0) return;
    const cat = shopCategories[catIndex];
    // Its items fall back to Uncategorised (they are never deleted with
    // it); Undo sends the ones still uncategorised back.
    const memberIds = new Set(shopItems.filter(s => s.categoryId === id).map(s => s.id));
    update(prev => ({
      ...prev,
      shopItems: prev.shopItems.map(s => s.categoryId === id ? { ...s, categoryId: null } : s),
      shopCategories: prev.shopCategories.filter(c => c.id !== id),
    }));
    offerUndo(`Deleted category ${shortName(cat.name)}`, () => update(prev => {
      const cats = prev.shopCategories || [];
      let nextCats = cats;
      if (!cats.some(c => c.id === cat.id)) {
        nextCats = [...cats];
        nextCats.splice(Math.min(catIndex, nextCats.length), 0, cat);
      }
      return {
        ...prev,
        shopCategories: nextCats,
        shopItems: (prev.shopItems || []).map(s =>
          memberIds.has(s.id) && !s.categoryId ? { ...s, categoryId: cat.id } : s),
      };
    }));
  }

  function handleDrop(itemId, categoryId) {
    update(prev => ({
      ...prev,
      shopItems: prev.shopItems.map(s => s.id === itemId ? { ...s, categoryId: categoryId || null } : s),
    }));
  }

  // After a delete from a ⋯ menu the trigger is gone with its card, so
  // focus would fall to <body>. Hand it to Undo instead — the one thing
  // a keyboard user is likely to want next.
  useEffect(() => {
    if (!undo) return;
    const a = document.activeElement;
    if (!a || a === document.body || !document.contains(a)) undoBtnRef.current?.focus();
  }, [undo]);

  // Priority applies inside either tab. 'bought' is the retired Archive
  // pill's value; it reads as "all priorities" now.
  const prio = ['high', 'med', 'low'].includes(shopFilter) ? shopFilter : 'all';

  // Labels are JSX — coloured dots instead of emoji.
  const filters = [
    { key: 'all', label: 'All' },
    { key: 'high', label: <><PrioDot p="high" /> High</> },
    { key: 'med', label: <><PrioDot p="med" /> Medium</> },
    { key: 'low', label: <><PrioDot p="low" /> Low</> },
  ];

  // "Coin cost" is a sort about nothing when coins are switched off and
  // no item carries a cost.
  const showCoinSort = requireCoins || shopItems.some(i => Number(i.coinCost) > 0);
  const sortOptions = SORTS.filter(o => o.key !== 'coins' || showCoinSort);
  const effectiveSort = sortOptions.some(o => o.key === sortKey) ? sortKey : 'added';

  const catIds = new Set(shopCategories.map(c => c.id));
  // An item whose category no longer exists reads as Uncategorised rather
  // than vanishing from every section.
  const isUncat = s => !s.categoryId || !catIds.has(s.categoryId);

  let filtered = shopItems.filter(s => (view === 'purchased' ? s.bought : !s.bought));
  if (prio !== 'all') filtered = filtered.filter(s => s.priority === prio);
  // Search then sort. `shopItems` is passed as the ordering reference so
  // "Recently added" still means insertion order after filtering.
  filtered = sortItems(searchItems(filtered, query), effectiveSort, shopItems);
  // Purchased reads newest purchase first unless another sort is chosen.
  if (view === 'purchased' && effectiveSort === 'added') {
    filtered = [...filtered].sort((a, b) => (b.boughtAt || 0) - (a.boughtAt || 0));
  }
  const matching = filtered.length;
  const narrowing = !!query.trim() || prio !== 'all';

  function chooseView(v) {
    if (v === view) return;
    setView(v);
    setSelected(new Set());
    if (shopFilter === 'bought') setFilter('all');
  }

  const renderCard = item => (
    <ShopCard
      key={item.id}
      item={item}
      coins={coins}
      requireCoins={requireCoins}
      onToggleBought={handleToggleBought}
      onDelete={handleDeleteItem}
      onEdit={handleEditItem}
      bulkMode={bulkMode}
      selected={selected.has(item.id)}
      onToggleSelect={toggleSelect}
      onDragState={setDragging}
    />
  );

  /* "61 wanted · £12,854 + 12 unpriced". One line instead of four stat
     boxes; the bought count lives on the Purchased tab. */
  const headline = (() => {
    const t = wantedTotals;
    if (!t.count) return shopItems.length ? 'Everything on your list is bought' : 'Your list is empty';
    const parts = [`${t.count} wanted`];
    if (t.priced) parts.push(`${fmtShort(Math.round(t.sum))}${t.unpriced ? ` + ${t.unpriced} unpriced` : ''}`);
    else if (t.unpriced) parts.push(`${t.unpriced} unpriced`);
    if (t.otherCurrency) parts.push(`${t.otherCurrency} other currency`);
    return parts.join(' · ');
  })();

  // Trending is opt-out, not permanent furniture. It is the one thing on
  // this page that is about other people, and someone shopping their own
  // list should be able to put it away. `!== false` so the absence of the
  // key means shown — the same shape every other opt-out in S uses.
  const showTrending = S.showTrending !== false;

  const toolbarNode = (
    <div className="shop-toolbar">
      <div className="shop-titleblock">
        <div className="eyebrow">Wishlist</div>
        <h2 className="sec-title">Shopping List <SectionHelp
          title="Shopping list"
          rows={[
            { term: 'Wishlist', def: 'Paste a product link to fill in the name and price.' },
            { term: 'Coins', def: 'Unlock items with what you earn, or switch that off and keep a plain list.' },
            { term: 'Trending', def: 'What other people are saving for. Counts only, no names.' },
          ]}
          foot="You are counted in Trending anonymously. Opt out in Settings → Privacy."
        /></h2>
        <p className="shop-headline">{headline}</p>
      </div>
      <div className="shop-toolbar-actions">
        {/* Show/hide Trending. A plain toggle beside the other two
            actions rather than buried in Settings: it is a view
            preference about this page, so it belongs on this page.
            Settings → Privacy still governs whether you are COUNTED
            in it, which is a different question. */}
        <motion.button
          type="button"
          className="btn btn-ghost shop-trend-toggle"
          onClick={() => update(prev => ({ ...prev, showTrending: prev.showTrending === false }))}
          title={showTrending ? 'Hide the Trending board' : 'Show the Trending board'}
          aria-pressed={showTrending}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
          <Icon name={showTrending ? 'eye' : 'eye-off'} size={15} />
          <span>{showTrending ? 'Hide Trending' : 'Show Trending'}</span>
        </motion.button>
        <motion.button type="button" className="btn btn-ghost" onClick={() => onOpenModal('addCategoryModal')}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
          <Icon name="layout-grid" size={15} /> Add Category
        </motion.button>
        <motion.button type="button" className="btn btn-primary" onClick={() => onOpenModal('addShopModal')}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
          <Icon name="plus" size={16} /> Add Item
        </motion.button>
      </div>
    </div>
  );

  const viewTabsNode = (
    <div className="shop-viewrow">
      <div className="shop-viewtabs" role="tablist" aria-label="Wishlist or purchased">
        {[['wishlist', 'Wishlist', total - bought], ['purchased', 'Purchased', bought]].map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`shop-tab-${key}`}
            aria-selected={view === key}
            aria-controls="shopGrid"
            tabIndex={view === key ? 0 : -1}
            className={`shop-viewtab${view === key ? ' is-on' : ''}`}
            onClick={() => chooseView(key)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const next = view === 'wishlist' ? 'purchased' : 'wishlist';
                chooseView(next);
                document.getElementById(`shop-tab-${next}`)?.focus();
              }
            }}
          >{label}<span className="shop-viewtab-n">{n}</span></button>
        ))}
      </div>
      <button
        type="button"
        className={`shop-select-toggle${bulkMode ? ' is-on' : ''}`}
        aria-pressed={bulkMode}
        onClick={() => (bulkMode ? exitBulk() : setBulkMode(true))}
      >
        <Icon name={bulkMode ? 'check' : 'square-check-big'} size={15} />
        <span>{bulkMode ? 'Done' : 'Select'}</span>
      </button>
    </div>
  );

  const filtersNode = (
    <div className="shop-filters" role="group" aria-label="Priority">
      {filters.map(f => (
        <button
          key={f.key}
          type="button"
          aria-pressed={prio === f.key}
          className={`shop-filter-btn${prio === f.key ? ' active' : ''}`}
          onClick={() => setFilter(f.key)}
        >{f.label}</button>
      ))}
    </div>
  );

  const controlsNode = (
    <div className="shop-controls">
      <div className="shop-search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search your list…"
          aria-label="Search wishlist"
        />
        {query && (
          <button type="button" className="shop-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      <label className="shop-sort">
        {/* The word "Sort" is redundant next to a select that reads
            "Recently added" — it only earns its space on desktop. */}
        <span className="shop-sort-lbl">Sort</span>
        <select value={effectiveSort} onChange={e => setSortKey(e.target.value)} aria-label="Sort items">
          {sortOptions.map(o => (
            <option key={o.key} value={o.key}>{o.key === 'added' && view === 'purchased' ? 'Recently bought' : o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );

  const searchNoteNode = query && matching > 0 ? (
    <div className="shop-search-note" role="status">
      {matching} item{matching > 1 ? 's' : ''} matching <strong>{query}</strong>
    </div>
  ) : null;

  const bulkBarNode = bulkMode ? (
    <div className="shop-bulkbar" role="toolbar" aria-label="Selected items">
      <span className="shop-bulkbar-count" role="status">{selected.size} selected</span>
      <button type="button" onClick={() => setSelected(new Set(filtered.map(i => i.id)))}>
        Select all{narrowing ? ' shown' : ''}
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
      {view === 'wishlist'
        ? <button type="button" onClick={() => bulkBought(true)} disabled={!selected.size}>Mark bought</button>
        : <button type="button" onClick={() => bulkBought(false)} disabled={!selected.size}>Mark unbought</button>}
      <button type="button" className="shop-bulkbar-del" onClick={bulkDelete} disabled={!selected.size}>Delete</button>
    </div>
  ) : null;

  // Phone category jump-tabs (desktop has the rail).
  const catTabsNode = view === 'wishlist' && !narrowing && shopCategories.length > 0 ? (
    <div className="shop-tabs" role="navigation" aria-label="Jump to category">
      {[
        ['all', `All (${filtered.length})`],
        ['uncategorised', `Uncategorised (${filtered.filter(isUncat).length})`],
        ...shopCategories.map(c => [c.id, `${c.name} (${filtered.filter(s => s.categoryId === c.id).length})`]),
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-current={activeCategory === key ? 'location' : undefined}
          className={`shop-tab${activeCategory === key ? ' is-active' : ''}`}
          onClick={() => goToCategory(key)}
        >{label}</button>
      ))}
    </div>
  ) : null;

  /* One message for an empty result, on a solid surface — never a stack
     of empty sections around it. */
  const emptyNode = (() => {
    if (!shopItems.length) {
      return (
        <div className="shop-empty shop-plate">
          <div className="shop-empty-icon"><Icon name="shopping-bag" size={32} strokeWidth={1.5} /></div>
          <div className="shop-empty-title">Nothing here yet</div>
          <div className="shop-empty-body">Add things you want to save up for. Earn coins by hitting your tracker goals.</div>
          <button type="button" className="btn btn-primary shop-empty-cta" onClick={() => onOpenModal('addShopModal')}>Add first item</button>
        </div>
      );
    }
    if (matching > 0) return null;
    if (query.trim()) {
      return (
        <div className="shop-empty shop-plate" role="status">
          <div className="shop-empty-title">No matches for ‘{query.trim()}’</div>
          {prio !== 'all' && <div className="shop-empty-body">Only {PRIORITY_LABEL[prio].toLowerCase()} priority is showing.</div>}
          <button type="button" className="btn btn-ghost shop-empty-cta" onClick={() => setQuery('')}>Clear search</button>
        </div>
      );
    }
    if (prio !== 'all') {
      return (
        <div className="shop-empty shop-plate" role="status">
          <div className="shop-empty-title">No {PRIORITY_LABEL[prio].toLowerCase()}-priority items {view === 'purchased' ? 'bought yet' : 'on your list'}</div>
          <button type="button" className="btn btn-ghost shop-empty-cta" onClick={() => setFilter('all')}>Show all priorities</button>
        </div>
      );
    }
    return (
      <div className="shop-empty shop-plate">
        <div className="shop-empty-icon"><Icon name={view === 'purchased' ? 'archive' : 'shopping-bag'} size={30} strokeWidth={1.5} /></div>
        <div className="shop-empty-title">{view === 'purchased' ? 'Nothing bought yet' : 'Nothing left on your wishlist'}</div>
        <div className="shop-empty-body">{view === 'purchased' ? 'Items you mark as bought land here.' : 'Everything you wanted is in Purchased.'}</div>
      </div>
    );
  })();

  const sections = view === 'wishlist'
    ? [{ key: 'uncategorised', cat: null, label: 'Uncategorised', items: filtered.filter(isUncat) },
       ...shopCategories.map(cat => ({ key: cat.id, cat, label: cat.name, items: filtered.filter(s => s.categoryId === cat.id) }))]
    : [];

  const gridNode = (
    <div
      className={`shop-list${entering ? ' is-entering' : ''}`}
      id="shopGrid"
      ref={gridRef}
      role="tabpanel"
      aria-labelledby={`shop-tab-${view}`}
    >
      {emptyNode || (view === 'wishlist' ? sections.map(sec => {
        // While narrowing, a section with no matches is noise. Otherwise
        // an empty category keeps its heading (its ⋯ is how you delete
        // it); an empty Uncategorised has nothing to offer and hides.
        const hide = !sec.items.length && !dragging && (narrowing || !sec.cat);
        if (hide) return null;
        return (
          <section key={sec.key} className="shop-category-section" data-shop-cat={sec.key} aria-labelledby={`shop-cat-h-${sec.key}`}>
            <div className="shop-category-header">
              <h3 className="shop-category-label" id={`shop-cat-h-${sec.key}`}>{sec.label}</h3>
              <div className="shop-category-line" aria-hidden="true"></div>
              <CategoryTotal items={sec.items} />
              <div className="shop-category-count" aria-label={`${sec.items.length} item${sec.items.length === 1 ? '' : 's'}`}>{sec.items.length}</div>
              {sec.cat && (
                <MenuButton
                  className="shop-cat-menu"
                  label={`Options for category ${sec.cat.name}`}
                  iconSize={15}
                  items={[{ label: 'Delete category', icon: 'trash-2', danger: true, onSelect: () => handleDeleteCategory(sec.cat.id) }]}
                />
              )}
            </div>
            <DropZone
              categoryId={sec.cat ? sec.cat.id : null}
              items={sec.items}
              dragging={dragging}
              onDrop={handleDrop}
              renderCard={renderCard}
            />
          </section>
        );
      }) : (
        <div className="shop-grid">{filtered.map(renderCard)}</div>
      ))}
    </div>
  );

  return (
    <section id="shop" className={`section${active ? ' active' : ''}`}>
      <div className="shop-page">
      <div className="shop-layout">
        {isMobile ? (
          /* ── Phones ──
             Everything above the list sits on ONE solid plate: title,
             the one-line total, actions, Wishlist/Purchased, priority,
             search/sort and the category jump-tabs. Over a photo
             background, see-through controls measured 2.0–3.8:1. */
          <>
            <div className="shop-plate shop-head">
              {toolbarNode}
              {viewTabsNode}
              {filtersNode}
              {controlsNode}
              {searchNoteNode}
              {bulkBarNode}
              {catTabsNode}
            </div>

            {gridNode}

            {/* Trending: one collapsed line at the END of the list on
                phones, never pinned over it (it covered ~30% of the
                screen). Expands in place. */}
            {showTrending && <TrendingBoard collapsible onAdd={handleAddTrending} />}
          </>
        ) : (
          /* ── Desktop: title plate, then one board ──
             A rail of context beside the list it describes, both inside
             a single shell. */
          <>
            <div className="shop-plate shop-head">{toolbarNode}</div>
            <div
              className="shop-board"
              ref={moduleMenu.rootRef}
              onContextMenu={moduleMenu.onContextMenu}
            >
              <aside className="shop-rail" data-hub-module="shop-rail" data-hub-module-label="Sidebar">
                {/* The COLUMN carries the surface and the full height; the
                    inner block is what sticks. Making the sticky element
                    itself the column left the fill ending wherever the
                    content did, so the left side of the board just stopped
                    partway down. */}
                <div className="shop-rail-sticky">
                  <div className="shop-rail-group">
                    <h3 className="shop-rail-h">Priority</h3>
                    {filtersNode}
                  </div>

                  {/* Categories: jump links that scroll the grid to that
                      heading; the scroll-spy lights the row you land on.
                      Each carries its count AND its running total. */}
                  {view === 'wishlist' && !narrowing && (
                    <div className="shop-rail-group" role="navigation" aria-label="Jump to category">
                      <h3 className="shop-rail-h">Categories</h3>
                      <div className="shop-rail-cats">
                        <RailCat label="All" count={filtered.length} items={filtered}
                                 active={activeCategory === 'all'} onGo={() => goToCategory('all')} />
                        <RailCat label="Uncategorised"
                                 items={filtered.filter(isUncat)}
                                 count={filtered.filter(isUncat).length}
                                 active={activeCategory === 'uncategorised'}
                                 onGo={() => goToCategory('uncategorised')} />
                        {shopCategories.map(cat => {
                          const inCat = filtered.filter(s => s.categoryId === cat.id);
                          return (
                            <RailCat key={cat.id} label={cat.name} items={inCat} count={inCat.length}
                                     colour={cat.color}
                                     active={activeCategory === cat.id}
                                     onGo={() => goToCategory(cat.id)} />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              <div className="shop-main" data-hub-module="shop-list" data-hub-module-label="List">
                {viewTabsNode}
                {controlsNode}
                {searchNoteNode}
                {bulkBarNode}
                {gridNode}

                {/* Trending sits INSIDE the board, along the bottom, rather
                    than as a rail beside it. It is the one part of this
                    page about other people and it was getting the same
                    billing as the list you came to read. */}
                {showTrending && (
                  <div className="shop-trend-strip" data-hub-module="shop-trending" data-hub-module-label="Trending">
                    <TrendingBoard onAdd={handleAddTrending} />
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Outside .shop-board on purpose. The columns carry backdrop-filter,
          which makes them the containing block for position:fixed
          descendants — the Track menu was landing at y=1081 in a 950px
          viewport before this was moved out. */}
      {!isMobile && moduleMenu.menuNode}
      </div>{/* /.shop-page */}

      <UndoToast undo={undo} onUndo={runUndo} onDone={clearUndo} btnRef={undoBtnRef} />
    </section>
  );
}

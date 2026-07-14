import { useState } from 'react';
import { motion } from 'framer-motion';
import { firePurchase } from '../utils/confetti';
import SectionHelp from './SectionHelp';
import TrendingBoard from './shop/TrendingBoard';

const PRIORITY_LABEL = { high: '🔴 High', med: '🟡 Medium', low: '🟢 Low' };
const PRIORITY_CLASS = { high: 'priority-high', med: 'priority-med', low: 'priority-low' };

let _dragItemId = null;

function ShopCard({ item, coins, onToggleBought, onDelete, onEdit, revealDelay }) {
  const hasLink = !!item.url;
  const canAfford = (coins || 0) >= item.coinCost || item.bought;
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
      className={`shop-item-card${item.bought ? ' bought' : ''}`}
      draggable
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
      <div className="shop-item-img">
        {item.imageUrl
          ? <img src={item.imageUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.parentElement.innerHTML = '🛒'; }} />
          : '🛒'
        }
      </div>
      <div className="shop-item-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div
            className={`shop-item-name${longName ? ' is-truncatable' : ''}${nameExpanded ? ' is-expanded' : ''}`}
            onClick={() => longName && setNameExpanded(v => !v)}
            role={longName ? 'button' : undefined}
            tabIndex={longName ? 0 : undefined}
            title={longName && !nameExpanded ? 'Tap to show full name' : undefined}
          >{shownName}</div>
          <span className={`shop-item-priority ${PRIORITY_CLASS[item.priority]}`}>{PRIORITY_LABEL[item.priority]}</span>
        </div>
        {item.price && <div className="shop-item-price">{item.price}</div>}
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
          {item.bought ? '✓' : '⬡'}
        </motion.button>
        <button className="shop-icon-btn shop-edit-btn" title="Edit item" onClick={() => onEdit(item.id)}>✎</button>
        <button className="shop-icon-btn shop-del-btn" onClick={() => onDelete(item.id)}>✕</button>
      </div>
    </motion.div>
  );
}

function DropZone({ categoryId, items, coins, onToggleBought, onDeleteItem, onEditItem, onDrop }) {
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
            onToggleBought={onToggleBought}
            onDelete={onDeleteItem}
            onEdit={onEditItem}
            revealDelay={index * 0.06}
          />
        ))}
      </div>
    </div>
  );
}

export default function ShopSection({ S, update, active, onOpenModal, onShowCoinToast }) {
  const { shopItems, shopCategories, shopFilter, coins } = S;
  // Category tab — independent of priority filter so the user can
  // stack "Tech category" + "High priority" without one fighting the
  // other. 'all' = show every category stacked. Sticky to component
  // state so a refresh resets to all (intentional — same on every
  // viewport so behavior is predictable across desktop/mobile).
  const [activeCategory, setActiveCategory] = useState('all');

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
        imageUrl: '',
        url: '',
        bought: false,
      }],
    }));
    onShowCoinToast?.(`Added ${item.name} to your wishlist`, false);
  }

  function handleToggleBought(id) {
    update(prev => {
      const item = prev.shopItems.find(s => s.id === id);
      if (!item) return prev;
      let newCoins = prev.coins || 0;
      let newHistory = [...(prev.coinHistory || [])];
      if (!item.bought && item.coinCost > 0) {
        if (newCoins < item.coinCost) {
          onShowCoinToast('Need ' + item.coinCost + ' ⬡ — you have ' + newCoins, false);
          return prev;
        }
        newCoins -= item.coinCost;
        newHistory.unshift({ type: 'spend', label: item.name, amount: -item.coinCost, ts: Date.now() });
        onShowCoinToast('-' + item.coinCost + ' ⬡ spent on ' + item.name + '!', false);
      } else if (item.bought && item.coinCost > 0) {
        newCoins += item.coinCost;
      }
      if (!item.bought) firePurchase();
      return {
        ...prev,
        shopItems: prev.shopItems.map(s => s.id === id ? { ...s, bought: !s.bought } : s),
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

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'high', label: '🔴 High' },
    { key: 'med', label: '🟡 Medium' },
    { key: 'low', label: '🟢 Low' },
    { key: 'bought', label: '✓ Bought' },
  ];

  let filtered = shopItems;
  if (shopFilter === 'bought') filtered = filtered.filter(s => s.bought);
  else if (shopFilter === 'high') filtered = filtered.filter(s => s.priority === 'high' && !s.bought);
  else if (shopFilter === 'med') filtered = filtered.filter(s => s.priority === 'med' && !s.bought);
  else if (shopFilter === 'low') filtered = filtered.filter(s => s.priority === 'low' && !s.bought);

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
            <div className="sec-title">Shopping List <SectionHelp text="Build a wishlist with priorities and coin costs. Paste a product URL to auto-fill the name and price. Drag items between categories." /></div>
          </motion.div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <motion.button className="btn btn-ghost" onClick={() => onOpenModal('addCategoryModal')}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>+ Add Category</motion.button>
            <motion.button className="btn btn-primary" onClick={() => onOpenModal('addShopModal')}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}>+ Add Item</motion.button>
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
              onClick={() => setFilter(f.key)}
            >{f.label}</button>
          ))}
        </div>

        {/* Category tabs — pivots between categories one tap at a
            time. "All" stacks every category (legacy desktop view).
            Lives at every viewport so behavior is predictable. */}
        {shopFilter === 'all' && (
          <div className="shop-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={activeCategory === 'all'}
              className={`shop-tab${activeCategory === 'all' ? ' is-active' : ''}`}
              onClick={() => setActiveCategory('all')}
            >All ({filtered.length})</button>
            <button
              role="tab"
              aria-selected={activeCategory === 'uncategorised'}
              className={`shop-tab${activeCategory === 'uncategorised' ? ' is-active' : ''}`}
              onClick={() => setActiveCategory('uncategorised')}
            >Uncategorised ({filtered.filter(s => !s.categoryId).length})</button>
            {shopCategories.map(cat => (
              <button
                key={cat.id}
                role="tab"
                aria-selected={activeCategory === cat.id}
                className={`shop-tab${activeCategory === cat.id ? ' is-active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >{cat.name} ({filtered.filter(s => s.categoryId === cat.id).length})</button>
            ))}
          </div>
        )}

        <div className="shop-grid" id="shopGrid" style={{ marginTop: '16px', display: 'block' }}>
          {shopFilter === 'all' ? (
            <>
              {(activeCategory === 'all' || activeCategory === 'uncategorised') && (
                <div className="shop-category-section">
                  <div className="shop-category-header">
                    <div className="shop-category-label">Uncategorised</div>
                    <div className="shop-category-line"></div>
                    <div className="shop-category-count">{filtered.filter(s => !s.categoryId).length}</div>
                  </div>
                  <DropZone
                    categoryId={null}
                    items={filtered.filter(s => !s.categoryId)}
                    coins={coins}
                    onToggleBought={handleToggleBought}
                    onDeleteItem={handleDeleteItem}
                    onEditItem={handleEditItem}
                    onDrop={handleDrop}
                  />
                </div>
              )}
              {shopCategories
                .filter(cat => activeCategory === 'all' || activeCategory === cat.id)
                .map(cat => (
                <div key={cat.id} className="shop-category-section">
                  <div className="shop-category-header">
                    <div className="shop-category-label">{cat.name}</div>
                    <div className="shop-category-line"></div>
                    <div className="shop-category-count">{filtered.filter(s => s.categoryId === cat.id).length}</div>
                    <button className="shop-category-del-btn" onClick={() => handleDeleteCategory(cat.id)} title="Delete category">✕</button>
                  </div>
                  <DropZone
                    categoryId={cat.id}
                    items={filtered.filter(s => s.categoryId === cat.id)}
                    coins={coins}
                    onToggleBought={handleToggleBought}
                    onDeleteItem={handleDeleteItem}
                    onEditItem={handleEditItem}
                    onDrop={handleDrop}
                  />
                </div>
              ))}
              {!shopItems.length && (
                <div className="section-empty">
                  <div className="section-empty-icon">🛍</div>
                  <div className="section-empty-title">Nothing here yet</div>
                  <div className="section-empty-body">Add things you want to save up for. Earn coins by hitting your tracker goals.</div>
                  <button className="btn btn-primary btn-sm section-empty-cta" onClick={() => onOpenModal('addShopModal')}>Add first item</button>
                </div>
              )}
            </>
          ) : (
            filtered.length === 0
              ? <div className="shop-empty"><div className="shop-empty-icon">🛍</div><div>Nothing here.</div></div>
              : (
                <div className="shop-grid" style={{ display: 'grid' }}>
                  {filtered.map((item, index) => (
                    <ShopCard
                      key={item.id}
                      item={item}
                      coins={coins}
                      onToggleBought={handleToggleBought}
                      onDelete={handleDeleteItem}
                      revealDelay={index * 0.06}
                    />
                  ))}
                </div>
              )
          )}
        </div>
      </div>
      <TrendingBoard onAdd={handleAddTrending} />
      </div>
    </section>
  );
}

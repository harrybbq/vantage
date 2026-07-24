import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../hooks/useCapacitor';
import { useSubscriptionContext } from '../../context/SubscriptionContext';
import Icon from '../Icon';

const PRO_CHIP_DISMISSED_KEY = 'vb4_more_pro_chip_dismissed';

/**
 * Bottom-sheet drawer surfaced from the More tab in BottomTabBar.
 *
 * Holds the secondary sections that don't make the cut for primary
 * bottom tabs:
 *   - Profile      (mobile-only — photo, name, email, password)
 *   - Achievements
 *   - Shopping
 *   - Friends   (mobile-only route → MobileFriendsSection wraps the
 *               FriendsRail orchestrator full-width)
 *   - Settings
 *
 * Interactions:
 *   - Tap row → close drawer + navigate
 *   - Tap backdrop → close
 *   - Drag handle (top of sheet) → close (basic touch handling)
 *   - Esc → close (keyboard accessibility)
 */
const MORE_ITEMS = [
  { id: 'profile',      icon: 'circle-user', label: 'Profile',      desc: 'Photo, name, email, password' },
  { id: 'achievements', icon: 'star',        label: 'Achievements', desc: 'Your goal map' },
  { id: 'shop',         icon: 'shopping-bag', label: 'Shopping',     desc: 'Things to buy with coins' },
  { id: 'friends',      icon: 'users',       label: 'Friends',      desc: 'See your friends\' progress' },
  { id: 'settings',     icon: 'settings',    label: 'Settings',     desc: 'Theme, privacy, tools' },
];

// Owner-only: shift rotation calendar. Slotted above Settings and
// simply absent for everyone else (mirrors the desktop sidebar tab).
const OWNER_ITEMS = [
  { id: 'schedule', icon: 'calendar-days', label: 'Rotation', desc: 'Shift rotation + training calendar' },
];

export default function MoreDrawer({ open, onClose, onNavigate, activeSection, onUpgrade, isOwner }) {
  const { hasPro } = useSubscriptionContext();
  // Persistent dismiss for the Pro chip — once the user closes it,
  // don't re-show on later opens. Surfaces again on paywall trigger
  // anyway, so dismiss-here ≠ never see Pro CTA again.
  const [chipDismissed, setChipDismissed] = useState(() => {
    try { return localStorage.getItem(PRO_CHIP_DISMISSED_KEY) === '1'; }
    catch { return false; }
  });
  function dismissChip(e) {
    e.stopPropagation();
    setChipDismissed(true);
    try { localStorage.setItem(PRO_CHIP_DISMISSED_KEY, '1'); } catch { /* quota */ }
  }
  function handleChipClick() {
    haptic('LIGHT');
    onClose();
    // Generic upgrade context — same paywall as a cap-triggered one
    // but with a feature gate that explains the broader pitch.
    onUpgrade && onUpgrade();
  }
  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock background scroll while open — prevents the page underneath
  // from rubber-banding while the user scrolls within the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Touch drag-to-close on the handle. Lightweight — no momentum,
  // just a downward drag past 80px closes. Prevents the sheet from
  // feeling stuck on touch devices.
  const sheetRef = useRef(null);
  const handleRef = useRef(null);
  const dragStart = useRef(null);
  function onHandleStart(e) {
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dragStart.current = { y, transform: '' };
  }
  function onHandleMove(e) {
    if (!dragStart.current || !sheetRef.current) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = Math.max(0, y - dragStart.current.y);
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  }
  function onHandleEnd(e) {
    if (!dragStart.current || !sheetRef.current) return;
    const y = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
    const dy = y - dragStart.current.y;
    sheetRef.current.style.transform = '';
    dragStart.current = null;
    if (dy > 80) onClose();
  }

  function handleSelect(item) {
    haptic('LIGHT');
    onClose();
    onNavigate(item.routeAs || item.id);
  }

  return (
    <>
      <div
        className={`m-drawer-backdrop${open ? ' m-drawer-backdrop-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <div
        ref={sheetRef}
        className={`m-drawer${open ? ' m-drawer-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="More"
        aria-hidden={!open}
      >
        <div
          ref={handleRef}
          className="m-drawer-handle-wrap"
          onTouchStart={onHandleStart}
          onTouchMove={onHandleMove}
          onTouchEnd={onHandleEnd}
          onMouseDown={onHandleStart}
          onMouseMove={onHandleMove}
          onMouseUp={onHandleEnd}
          onClick={onClose}
        >
          <div className="m-drawer-handle" />
        </div>
        <div className="m-drawer-body">
          <div className="m-drawer-eyebrow">More</div>
          <ul className="m-drawer-list">
            {[
              ...MORE_ITEMS.slice(0, -1),
              ...(isOwner ? OWNER_ITEMS : []),
              ...MORE_ITEMS.slice(-1),
            ].map(item => {
              const isActive = activeSection === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`m-drawer-item${isActive ? ' m-drawer-item-active' : ''}`}
                    onClick={() => handleSelect(item)}
                  >
                    <span className="m-drawer-item-icon" aria-hidden="true"><Icon name={item.icon} size={19} /></span>
                    <span className="m-drawer-item-text">
                      <span className="m-drawer-item-label">{item.label}</span>
                      <span className="m-drawer-item-desc">{item.desc}</span>
                    </span>
                    <span className="m-drawer-item-chev" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Free-tier upgrade chip — persistent across sessions until
              dismissed. Hidden once the user is Pro. Tap → paywall. */}
          {!hasPro && !chipDismissed && onUpgrade && (
            <button
              type="button"
              className="m-drawer-pro-chip"
              onClick={handleChipClick}
              aria-label="Go Pro — see what's included"
            >
              <span className="m-drawer-pro-chip-icon" aria-hidden="true"><Icon name="sparkles" size={17} /></span>
              <span className="m-drawer-pro-chip-text">
                <span className="m-drawer-pro-chip-label">Go Pro</span>
                <span className="m-drawer-pro-chip-sub">Unlimited everything · from £3.99/mo</span>
              </span>
              <span className="m-drawer-pro-chip-chev" aria-hidden="true"><Icon name="chevron-right" size={15} /></span>
              <span
                role="button"
                tabIndex={0}
                aria-label="Dismiss"
                className="m-drawer-pro-chip-dismiss"
                onClick={dismissChip}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') dismissChip(e); }}
              ><Icon name="x" size={14} /></span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

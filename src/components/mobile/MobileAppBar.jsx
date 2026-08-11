/**
 * Mobile-only top app bar. Replaces the desktop PageHeader at narrow
 * viewports — same data, different chrome.
 *
 * Layout (left → right):
 *   - Logo cap     ── small "V" mark, doubles as a settings shortcut
 *                     when activeSection isn't already settings
 *   - Section eyebrow ── current section name in mono caps
 *   - Background button ── opens the file picker to change the
 *                     current section's background. Stays subtle so
 *                     it doesn't compete with the coin chip; if a
 *                     background is already set, holding it removes.
 *   - Coin chip    ── total coins + tap to open coin history
 *
 * Per-page background:
 *   The background is keyed by activeSection (see App.jsx loadBgs /
 *   handleBgFileChange) so each section can have its own image. The
 *   app bar's button writes to whichever section the user is on,
 *   matching the desktop PageHeader's behavior.
 */
import { motion } from 'framer-motion';
import Logo from '../Logo';

const SECTION_LABELS = {
  hub: 'Hub',
  achievements: 'Achievements',
  track: 'Track',
  shop: 'Shopping',
  holiday: 'Holiday',
  habits: 'Habits',
  settings: 'Settings',
  friends: 'Friends',
};

export default function MobileAppBar({
  activeSection,
  coins = 0,
  onOpenCoinHistory,
  onNavigateSettings,
  onChangeBg,
  onRemoveBg,
  hasBg = false,
  onCoinContextMenu,
}) {
  const label = SECTION_LABELS[activeSection] || '';
  return (
    <header className="m-appbar" role="banner">
      <button
        type="button"
        className="m-appbar-logo"
        onClick={onNavigateSettings}
        aria-label="Open settings"
        title="Settings"
      >
        <Logo size={18} strokeWidth={8} />
      </button>
      <div className="m-appbar-eyebrow" aria-live="polite">{label}</div>
      {onChangeBg && (
        <motion.button
          type="button"
          className={`m-appbar-bg${hasBg ? ' m-appbar-bg-active' : ''}`}
          onClick={onChangeBg}
          // Long-press to remove if a background is set. Falls back
          // to a clean tap-to-change if no bg or no remove handler.
          onContextMenu={hasBg && onRemoveBg ? e => { e.preventDefault(); onRemoveBg(); } : undefined}
          aria-label={hasBg ? 'Change or remove background — long-press to remove' : 'Change background'}
          title={hasBg ? 'Tap: change · Long-press: remove' : 'Set a background'}
          whileTap={{ scale: 0.92 }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="1.5" y="2" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="5" cy="5.5" r="1" fill="currentColor"/>
            <path d="M2 9.5L5 7L8 9L12.5 5.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </motion.button>
      )}
      <motion.button
        type="button"
        className="m-appbar-coins"
        onClick={onOpenCoinHistory}
        onContextMenu={onCoinContextMenu ? e => { e.preventDefault(); onCoinContextMenu(); } : undefined}
        aria-label={`${coins} coins — view history`}
        whileTap={{ scale: 0.95 }}
      >
        <span className="m-appbar-coins-icon" aria-hidden="true">⬡</span>
        <span className="m-appbar-coins-val">{coins.toLocaleString()}</span>
      </motion.button>
    </header>
  );
}

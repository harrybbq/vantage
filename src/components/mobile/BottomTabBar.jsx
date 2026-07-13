/**
 * Mobile bottom-tab navigation. Replaces the desktop sidenav at
 * narrow viewports.
 *
 * Five primary tabs match the mockup's information architecture:
 *   - Hub      ⌂  the main board
 *   - Track    ☑  daily logging
 *   - Holiday  ✈  trip countdown
 *   - Habits   ◷  habit tracker
 *   - More     ⊞  bottom sheet → Achievements / Shopping / Friends / Settings
 *
 * Why these five and not all seven? Bottom-tab nav becomes useless
 * past ~5 entries (each tab gets too narrow to tap reliably). The
 * non-primary screens go into a More sheet that's still one tap away.
 *
 * The "More" tab is special — it doesn't navigate, it opens the
 * MoreDrawer overlay. The parent owns that state and decides which
 * tab is "active" (the underlying screen, not the drawer).
 */
import { haptic } from '../../hooks/useCapacitor';
import Icon from '../Icon';

const PRIMARY_TABS = [
  { id: 'hub',     icon: 'house',            label: 'Hub'     },
  { id: 'track',   icon: 'square-check-big', label: 'Track'   },
  { id: 'holiday', icon: 'plane',            label: 'Holiday' },
  { id: 'habits',  icon: 'flame',            label: 'Habits'  },
];

// Sections that live behind the More drawer. Used so we can highlight
// the More tab when the user is on one of these and they expect a
// nav indicator somewhere.
const MORE_SECTIONS = new Set(['achievements', 'shop', 'settings']);
// Friends doesn't have its own section yet (rail lives on hub) but
// we reserve the slot here so the More drawer can route there in
// future without changing the highlight logic.

export default function BottomTabBar({ activeSection, onNavigate, onOpenMore, moreOpen }) {
  // Highlight state:
  //   - if a primary tab matches active → highlight it
  //   - if active is a More-only section, OR the drawer is open →
  //     highlight More
  const moreActive = moreOpen || MORE_SECTIONS.has(activeSection);

  function handlePrimaryClick(id) {
    haptic('LIGHT');
    onNavigate(id);
  }
  function handleMoreClick() {
    haptic('LIGHT');
    onOpenMore();
  }

  return (
    <nav className="m-tabs" role="tablist" aria-label="Main navigation">
      {PRIMARY_TABS.map(tab => {
        const isActive = activeSection === tab.id && !moreOpen;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`m-tab${isActive ? ' m-tab-active' : ''}`}
            onClick={() => handlePrimaryClick(tab.id)}
          >
            <span className="m-tab-icon" aria-hidden="true"><Icon name={tab.icon} size={22} strokeWidth={1.9} /></span>
            <span className="m-tab-label">{tab.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected={moreActive}
        aria-haspopup="dialog"
        aria-expanded={!!moreOpen}
        className={`m-tab${moreActive ? ' m-tab-active' : ''}`}
        onClick={handleMoreClick}
      >
        <span className="m-tab-icon" aria-hidden="true"><Icon name="menu" size={22} strokeWidth={1.9} /></span>
        <span className="m-tab-label">More</span>
      </button>
    </nav>
  );
}

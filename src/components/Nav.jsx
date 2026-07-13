import Logo from './Logo';
import Icon from './Icon';

export default function Nav({ activeSection, onNavigate, onSignOut, isOwner }) {
  const tabs = [
    { id: 'hub', icon: 'house', label: 'Hub' },
    { id: 'achievements', icon: 'star', label: 'Achievements' },
    { id: 'track', icon: 'square-check-big', label: 'Track' },
    { id: 'shop', icon: 'shopping-bag', label: 'Shopping' },
    { id: 'holiday', icon: 'plane', label: 'Holiday' },
    { id: 'habits', icon: 'flame', label: 'Habits' },
    { id: 'leaderboard', icon: 'trophy', label: 'Leaderboard' },
    // Owner-only: shift rotation calendar. Slotted above Settings and
    // simply absent for everyone else.
    ...(isOwner ? [{ id: 'schedule', icon: 'calendar-days', label: 'Rotation' }] : []),
    { id: 'settings', icon: 'settings', label: 'Settings', mobileHide: true },
  ];

  return (
    <nav id="mainNav">
      <div className="nav-logo">
        <div className="nav-logo-icon"><Logo size={18} strokeWidth={8} c2={null} /></div>
        <div className="nav-logo-text">
          Vantage
        </div>
      </div>
      <div className="nav-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            id={`nav-tab-${tab.id}`}
            className={`nav-tab${activeSection === tab.id ? ' active' : ''}${tab.mobileHide ? ' nav-tab-mobile-hide' : ''}`}
            onClick={() => onNavigate(tab.id)}
          >
            <div className="nav-tab-icon"><Icon name={tab.icon} size={20} strokeWidth={1.9} /></div>
            <span className="nav-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="nav-bottom">
        <button
          className="nav-tab"
          onClick={onSignOut}
          title="Sign out"
          style={{ opacity: 0.6, fontSize: '11px' }}
        >
          <div className="nav-tab-icon"><Icon name="log-out" size={20} strokeWidth={1.9} /></div>
          <span className="nav-tab-label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

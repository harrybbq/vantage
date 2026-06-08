import Logo from './Logo';

export default function Nav({ activeSection, onNavigate, onSignOut }) {
  const tabs = [
    { id: 'hub', icon: '⌂', label: 'Hub' },
    { id: 'achievements', icon: '★', label: 'Achievements' },
    { id: 'track', icon: '◎', label: 'Track' },
    { id: 'shop', icon: '◈', label: 'Shopping' },
    { id: 'holiday', icon: '✈', label: 'Holiday' },
    { id: 'habits', icon: '⊘', label: 'Habits' },
    { id: 'leaderboard', icon: '⊿', label: 'Leaderboard' },
    { id: 'settings', icon: '⚙', label: 'Settings', mobileHide: true },
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
            <div className="nav-tab-icon">{tab.icon}</div>
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
          <div className="nav-tab-icon">→</div>
          <span className="nav-tab-label">Sign out</span>
        </button>
      </div>
    </nav>
  );
}

import { useEffect, useRef } from 'react';
import Logo from './Logo';

const SECTION_LABELS = {
  hub: 'Hub',
  achievements: 'Achievements',
  track: 'Track',
  shop: 'Shopping',
  holiday: 'Holiday',
  habits: 'Habits',
  settings: 'Settings',
};

function getDynamicGreeting(name) {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const n = name ? `, ${name}` : '';
  if (day === 1 && hour >= 5 && hour < 12) return `Monday grind${n} 💪`;
  if (day === 5) return `Happy Friday${n} ⚽`;
  if (day === 6) return `Happy Saturday${n} 🎉`;
  if (day === 0) return `Happy Sunday${n} ☕`;
  if (hour >= 5 && hour < 12) return `Good morning${n} 🌅`;
  if (hour >= 12 && hour < 17) return `Good afternoon${n} ☀️`;
  if (hour >= 17 && hour < 21) return `Good evening${n} 🌆`;
  return `Still up${n}? 🌙`;
}

export default function PageHeader({ activeSection, coins, onOpenCoinHistory, profileName, onChangeBg, onRemoveBg, onSignOut }) {
  const greeting = getDynamicGreeting(profileName);
  const labelRef = useRef(null);
  const prevSection = useRef(activeSection);

  useEffect(() => {
    if (prevSection.current === activeSection) return;
    prevSection.current = activeSection;
    const el = labelRef.current;
    if (!el) return;
    el.classList.add('fade-out');
    const t = setTimeout(() => el.classList.remove('fade-out'), 220);
    return () => clearTimeout(t);
  }, [activeSection]);

  return (
    <div id="pageHeader">
      <span id="pageHeader-title">
        <span className="header-title-full">Vision Board</span>
        <span className="header-title-short" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <Logo size={16} strokeWidth={8} c2={null} />
        </span>
      </span>

      {activeSection === 'hub'
        ? <span ref={labelRef} id="pageHeader-section" key="greeting" style={{ fontSize: '13px', fontStyle: 'italic', opacity: 0.9 }}>{greeting}</span>
        : <span ref={labelRef} id="pageHeader-section" key="section">{SECTION_LABELS[activeSection] || ''}</span>
      }

      {/* Push everything right */}
      <div style={{ flex: 1 }} />

      {/* Command palette / shortcuts now live in Settings → Tools.
          The Ctrl+K / Cmd+K hotkey is still bound globally via
          useKeyboardShortcuts so power users keep their muscle memory. */}

      {/* Sign out — mobile only */}
      <button className="mobile-signout-btn" onClick={onSignOut} title="Sign out">→</button>

      {/* Background controls — sits just left of coin wallet */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginRight: '8px' }}>
        <button
          onClick={onChangeBg}
          title="Change background image"
          style={{
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.9)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px 9px',
            lineHeight: 1,
            transition: 'all .18s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.35)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)'; }}
        >🖼</button>
        {onRemoveBg && (
          <button
            onClick={onRemoveBg}
            title="Remove custom background"
            style={{
              background: 'rgba(180,40,40,0.3)',
              border: '1px solid rgba(220,80,80,0.5)',
              borderRadius: '8px',
              color: '#f87171',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '4px 8px',
              lineHeight: 1,
              transition: 'all .18s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(180,40,40,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(180,40,40,0.3)'; }}
          >✕ bg</button>
        )}
      </div>

      <div id="coinWallet" onClick={onOpenCoinHistory} title="Your coins — click for history">
        <span className="cw-icon">⬡</span>
        <div>
          <div className="cw-amount" id="coinAmount">{coins}</div>
          <div className="cw-label">Coins</div>
        </div>
      </div>
    </div>
  );
}

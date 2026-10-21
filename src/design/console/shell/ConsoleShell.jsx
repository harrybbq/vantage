/**
 * The console shell: everything around a page in the console design.
 *
 *   desktop (> 768 px)  216 px sidebar + 60 px top bar
 *   phone   (≤ 768 px)  52 px app bar + 5-tab bottom bar + the More sheet
 *
 * App.jsx renders this INSTEAD of Nav, PageHeader, MobileAppBar,
 * BottomTabBar, MoreDrawer, HubFooter and BootSequence when the design is
 * console, and passes it the section prop bag (README §3). Lazy-loaded
 * there, so classic never downloads it. No clock, no countdown, no
 * "day 293 of 2026": the date is a plain label, recomputed on render.
 *
 * Pages sit in `.cx-page` (shell.css), whose offsets match these bars.
 */
import { useState } from 'react';
import Icon from '../../../components/Icon';
import Logo from '../../../components/Logo';
import { Sheet } from '../ui';
import { haptic } from '../../../hooks/useCapacitor';
import { usePendingCount } from '../../../lib/friends/usePendingCount';
import { useUnreadTotal } from '../../../lib/friends/useUnreadTotal';
import { coinsToday } from '../../../lib/coins/daily';
import { barRef } from './TopBarActions';
import {
  sidebarItems, TABS, moreItems, activeTab, canonicalSection, navSection, sectionTitle,
  longDate, shortDate, greeting, initials, paletteHint,
} from './nav';

const cx = (...a) => a.filter(Boolean).join(' ');
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-GB');

function Avatar({ S, size = 32, onClick }) {
  const name = S.profile?.name || '';
  const photo = S.profile?.photo || null;
  return (
    <button type="button" className="cx-shell-avatar" style={{ '--cx-shell-av': `${size}px` }} onClick={onClick}
            aria-label="Account settings" title="Account settings">
      <span className="cx-shell-avatar-face">
        {photo ? <img src={photo} alt="" /> : (initials(name) || <Icon name="user" size={16} strokeWidth={1.75} />)}
      </span>
    </button>
  );
}

/** Coins + today's net. Owner right-click is caught by App's data-admin-target handler. */
function CoinsChip({ S, onOpen }) {
  const today = coinsToday(S.coinHistory);
  const total = S.coins || 0;
  const todayLabel = today ? `${today > 0 ? '+' : '−'}${fmt(Math.abs(today))}` : '';
  return (
    <button type="button" className="cx-shell-chip cx-shell-coins" onClick={onOpen} data-admin-target="coins"
            aria-label={`${fmt(total)} coins${todayLabel ? `, ${todayLabel} today` : ''}. Open coin history`}>
      <Icon name="coin" size={14} strokeWidth={1.75} />
      <span className="cx-num cx-shell-coins-n">{fmt(total)}</span>
      {todayLabel && <span className={cx('cx-num cx-shell-coins-today', today < 0 && 'is-down')}>{todayLabel}</span>}
    </button>
  );
}

/** Friend requests and unread messages: absent at zero (as classic's header). Desktop only. */
function SocialChips({ userId, onOpen }) {
  const requests = usePendingCount(userId);
  const unread = useUnreadTotal(userId);
  const n = v => (v > 9 ? '9+' : String(v));
  return (
    <>
      {!!requests && (
        <button type="button" className="cx-shell-chip cx-shell-ask" onClick={onOpen}
                aria-label={`${requests} friend request${requests === 1 ? '' : 's'} waiting`}>
          <Icon name="user-plus" size={14} strokeWidth={1.75} /><span className="cx-num">{n(requests)}</span>
        </button>
      )}
      {!!unread && (
        <button type="button" className="cx-shell-chip cx-shell-ask"
                onClick={() => {
                  onOpen();
                  try { window.dispatchEvent(new CustomEvent('vantage:friends-tab', { detail: 'messages' })); } catch { /* old browsers */ }
                }}
                aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}>
          <Icon name="mail" size={14} strokeWidth={1.75} /><span className="cx-num">{n(unread)}</span>
        </button>
      )}
    </>
  );
}

function Sidebar({ section, isOwner, navigate, onSignOut }) {
  const items = sidebarItems({ isOwner });
  const lit = navSection(section);
  return (
    <div className="cx-shell-side" role="navigation" aria-label="Main" data-shell-nav="side">
      <div className="cx-shell-brand"><span className="cx-shell-logo" aria-hidden="true"><Logo size={30} c="var(--cx-accent)" c2="var(--cx-gold)" /></span>Vantage</div>
      <ul className="cx-shell-side-list">
        {items.map(it => {
          const on = lit === it.id;
          return (
            <li key={it.id}>
              <button type="button" className={cx('cx-shell-ni', on && 'is-on')} aria-current={on ? 'page' : undefined}
                      onClick={() => navigate(it.id)} title={it.label} data-cx-nav={it.id}>
                <Icon name={it.icon} size={18} strokeWidth={1.75} />
                <span className="cx-shell-ni-label">{it.label}</span>
                {it.key && <kbd className="cx-shell-kbd" aria-label={`Shortcut ${it.key}`}>{it.key}</kbd>}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="cx-shell-ni cx-shell-signout" onClick={onSignOut} title="Sign out">
        <Icon name="log-out" size={18} strokeWidth={1.75} />
        <span className="cx-shell-ni-label">Sign out</span>
      </button>
    </div>
  );
}

function TopBar({ S, section, userId, navigate, onOpenModal, onOpenPalette, now }) {
  const hint = paletteHint(typeof navigator !== 'undefined' ? (navigator.userAgentData?.platform || navigator.platform) : '');
  return (
    <header className="cx-shell-top" data-shell-bar="top">
      <h1 className="cx-shell-title">{sectionTitle(section)}</h1>
      <span className="cx-shell-context">{longDate(now)}</span>
      <div className="cx-shell-slot cx-shell-slot-start" ref={barRef.start} />
      <span className="cx-shell-sp" />
      <div className="cx-shell-slot" ref={barRef.end} />
      {onOpenPalette && (
        <button type="button" className="cx-shell-chip cx-shell-search" onClick={onOpenPalette} aria-label={`Search or jump to (${hint})`}>
          <Icon name="search" size={14} strokeWidth={1.75} />
          <span className="cx-shell-search-label">Search or jump to</span>
          <kbd className="cx-shell-kbd">{hint}</kbd>
        </button>
      )}
      <SocialChips userId={userId} onOpen={() => navigate('hub')} />
      {/* The hub's player strip already shows the balance; one is enough. */}
      {section !== 'hub' && <CoinsChip S={S} onOpen={() => onOpenModal('coinHistoryModal')} />}
      <Avatar S={S} onClick={() => navigate('profile')} />
    </header>
  );
}

function AppBar({ S, section, navigate, onOpenModal, now }) {
  const hub = section === 'hub';
  return (
    <header className={cx('cx-shell-appbar', hub && 'is-hub')} data-shell-bar="app">
      {hub ? (
        <>
          <Avatar S={S} size={32} onClick={() => navigate('profile')} />
          <div className="cx-shell-appbar-titles">
            <span className="cx-shell-appbar-date">{shortDate(now)}</span>
            <h1 className="cx-shell-appbar-greet">{greeting(now, S.profile?.name)}</h1>
          </div>
        </>
      ) : (
        <h1 className="cx-shell-appbar-title">{sectionTitle(section)}</h1>
      )}
      <span className="cx-shell-sp" />
      <div className="cx-shell-slot" ref={barRef.end} />
      <CoinsChip S={S} onOpen={() => onOpenModal('coinHistoryModal')} />
    </header>
  );
}

function TabBar({ section, moreOpen, navigate, onOpenMore }) {
  const on = activeTab(section, { moreOpen });
  return (
    <div className="cx-shell-tabs" role="navigation" aria-label="Main" data-shell-nav="tabs">
      {TABS.map(t => (
        <button key={t.id} type="button" className={cx('cx-shell-tab', on === t.id && 'is-on')}
                aria-current={on === t.id ? 'page' : undefined} data-cx-nav={t.id}
                onClick={() => { haptic('LIGHT'); navigate(t.id); }}>
          <Icon name={t.icon} size={22} strokeWidth={1.75} />
          <span className="cx-shell-tab-label">{t.label}</span>
        </button>
      ))}
      <button type="button" className={cx('cx-shell-tab', on === 'more' && 'is-on')}
              aria-haspopup="dialog" aria-expanded={moreOpen} data-cx-nav="more"
              onClick={() => { haptic('LIGHT'); onOpenMore(); }}>
        <Icon name="menu" size={22} strokeWidth={1.75} />
        <span className="cx-shell-tab-label">More</span>
      </button>
    </div>
  );
}

function MoreSheet({ section, isOwner, hasPro, navigate, onOpenPaywall, onClose }) {
  const go = id => { haptic('LIGHT'); onClose(); navigate(id); };
  return (
    <Sheet title="More" onClose={onClose} testId="cx-shell-more" className="cx-shell-more">
      <ul className="cx-shell-more-list" data-shell-more="">
        {moreItems({ isOwner }).map(it => {
          const on = canonicalSection(section) === it.id;
          return (
            <li key={it.id}>
              <button type="button" className={cx('cx-shell-mi', on && 'is-on')} aria-current={on ? 'page' : undefined} onClick={() => go(it.id)} data-cx-nav={it.id}>
                <Icon name={it.icon} size={18} strokeWidth={1.75} />
                <span className="cx-shell-mi-text">
                  <span className="cx-shell-mi-label">{it.label}</span>
                  {it.desc && <span className="cx-shell-mi-desc">{it.desc}</span>}
                </span>
                <Icon name="chevron-right" size={16} strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ul>
      {!hasPro && onOpenPaywall && (
        <button type="button" className="cx-shell-mi cx-shell-pro" onClick={() => { haptic('LIGHT'); onClose(); onOpenPaywall('generic'); }}>
          <Icon name="sparkles" size={18} strokeWidth={1.75} />
          <span className="cx-shell-mi-text">
            <span className="cx-shell-mi-label">Go Pro</span>
            {/* No price here: prices come from the store (App Store 3.1.2), and the paywall shows them. */}
            <span className="cx-shell-mi-desc">Higher limits, more widgets, accent colours</span>
          </span>
          <Icon name="chevron-right" size={16} strokeWidth={1.75} />
        </button>
      )}
    </Sheet>
  );
}

export default function ConsoleShell({
  S, userId, isMobile, isOwner, hasPro, navigate, activeSection,
  onOpenModal, onOpenPaywall, onOpenPalette, onSignOut,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const section = canonicalSection(activeSection);
  const now = new Date();
  if (isMobile) {
    return (
      <>
        <AppBar S={S} section={section} navigate={navigate} onOpenModal={onOpenModal} now={now} />
        <TabBar section={section} moreOpen={moreOpen} navigate={navigate} onOpenMore={() => setMoreOpen(true)} />
        {moreOpen && (
          <MoreSheet section={section} isOwner={isOwner} hasPro={hasPro} navigate={navigate}
                     onOpenPaywall={onOpenPaywall} onClose={() => setMoreOpen(false)} />
        )}
      </>
    );
  }
  return (
    <>
      <Sidebar section={section} isOwner={isOwner} navigate={navigate} onSignOut={onSignOut} />
      <TopBar S={S} section={section} userId={userId} navigate={navigate} onOpenModal={onOpenModal}
              onOpenPalette={onOpenPalette} now={now} />
    </>
  );
}

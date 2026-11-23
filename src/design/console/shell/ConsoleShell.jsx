/**
 * The console shell: everything around a page in the console design.
 *
 *   desktop (> 768 px)  sidebar + 60 px top bar; the open section's tabs
 *                       sit beside its name in the bar
 *   phone   (≤ 768 px)  52 px app bar, with the section's tabs as a second
 *                       row, + the bottom bar: Hub and the sections
 *
 * Three sections (nav.js): Track, Health and Social. Settings is behind
 * the avatar, which is on every page's bar; there is no More sheet.
 *
 * App.jsx renders this INSTEAD of Nav, PageHeader, MobileAppBar,
 * BottomTabBar, MoreDrawer, HubFooter and BootSequence when the design is
 * console, and passes it the section prop bag (README §3). Lazy-loaded
 * there, so classic never downloads it. No clock, no countdown, no
 * "day 293 of 2026": the date is a plain label, recomputed on render.
 *
 * Pages sit in `.cx-page` (shell.css), whose offsets match these bars.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/Icon';
import Logo from '../../../components/Logo';
import { Sheet } from '../ui';
import { haptic } from '../../../hooks/useCapacitor';
import { usePendingCount } from '../../../lib/friends/usePendingCount';
import { useUnreadTotal } from '../../../lib/friends/useUnreadTotal';
import { coinsToday } from '../../../lib/coins/daily';
import { useCountUp } from '../../../hooks/useCountUp';
import { barRef } from './TopBarActions';
import BackgroundSheet from './BackgroundSheet';
import { navScope, addableAreas } from '../../../lib/onboarding/areas';
import { addArea } from '../../../lib/onboarding/onboarding';
import {
  sidebarItems, tabItems, activeTab, canonicalSection, navSection, sectionTitle, placeOf, groupTabs,
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
  // The balance counts to its new value, and glints gold when it has grown: whatever paid (a tracker's
  // week, a goal, a habit), this is where the coins land.
  const shown = useCountUp(total);
  const was = useRef(total);
  const [up, setUp] = useState(false);
  useEffect(() => {
    const grew = total > was.current;
    was.current = total;
    if (!grew) return undefined;
    setUp(true);
    const t = setTimeout(() => setUp(false), 800);
    return () => clearTimeout(t);
  }, [total]);
  return (
    <button type="button" className={cx('cx-shell-chip cx-shell-coins', up && 'is-up')} onClick={onOpen} data-admin-target="coins"
            aria-label={`${fmt(total)} coins${todayLabel ? `, ${todayLabel} today` : ''}. Open coin history`}>
      <Icon name="coin" size={14} strokeWidth={1.75} />
      <span className="cx-num cx-shell-coins-n">{fmt(shown)}</span>
      {todayLabel && <span className={cx('cx-num cx-shell-coins-today', today < 0 && 'is-down')}>{todayLabel}</span>}
    </button>
  );
}

/** The page's background photo: opens BackgroundSheet. Lit while one is set. */
function BgButton({ on, onOpen }) {
  return (
    <button type="button" className={cx('cx-shell-chip cx-shell-bgbtn', on && 'is-on')} onClick={onOpen}
            aria-label={on ? 'Background photo: change, dim or remove' : 'Set a background photo for this page'}
            title="Background">
      <Icon name="image" size={16} strokeWidth={1.75} />
    </button>
  );
}

/** Friend requests and unread messages for a signed-in account; zeros while `userId` is null. */
function useSocialCounts(userId) {
  const requests = usePendingCount(userId);
  const unread = useUnreadTotal(userId);
  return useMemo(() => ({ requests: requests || 0, unread: unread || 0 }), [requests, unread]);
}
const upTo9 = v => (v > 9 ? '9+' : String(v));

/** Friend requests and unread messages: absent at zero. Desktop only; each opens its Social tab. */
function SocialChips({ counts, navigate }) {
  const { requests, unread } = counts;
  return (
    <>
      {!!requests && (
        <button type="button" className="cx-shell-chip cx-shell-ask" onClick={() => navigate('friends', 'friends')}
                aria-label={`${requests} friend request${requests === 1 ? '' : 's'} waiting`}>
          <Icon name="user-plus" size={14} strokeWidth={1.75} /><span className="cx-num">{upTo9(requests)}</span>
        </button>
      )}
      {!!unread && (
        <button type="button" className="cx-shell-chip cx-shell-ask" onClick={() => navigate('friends', 'messages')}
                aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}>
          <Icon name="mail" size={14} strokeWidth={1.75} /><span className="cx-num">{upTo9(unread)}</span>
        </button>
      )}
    </>
  );
}

/** What is waiting behind a nav entry or a tab: a count, or nothing. */
function waiting(id, counts) {
  if (!counts) return 0;
  if (id === 'social') return counts.requests + counts.unread;
  if (id === 'friends') return counts.requests;
  if (id === 'messages') return counts.unread;
  return 0;
}

/**
 * The open section's tabs: beside the title on a desktop, the app bar's
 * second row on a phone. Each is a place (nav.js): a route and its view.
 */
function SectionTabs({ place, tabs, counts, navigate, className }) {
  return (
    <div className={cx('cx-shell-sub', className)} role="navigation" aria-label={`${place.group.label} tabs`} data-shell-sub={place.group.id}>
      {tabs.map(tb => {
        const on = tb.id === place.tab.id;
        const n = waiting(tb.id, counts);
        return (
          <button key={tb.id} type="button" className={cx('cx-shell-st', on && 'is-on')} aria-current={on ? 'page' : undefined}
                  onClick={() => { haptic('LIGHT'); navigate(tb.section, tb.sub); }} data-cx-tab={tb.id}>
            <span>{tb.label}</span>
            {!!n && <span className="cx-shell-badge cx-num" aria-label={`${n} waiting`}>{upTo9(n)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({ lit, isOwner, navigate, goGroup, onSignOut, scope, canAdd, onAdd, counts }) {
  const all = sidebarItems({ isOwner, scope });
  // Hub and the sections, then "Add an area" (a scoped account), then the owner's Upgrade.
  const items = all.filter(it => it.id !== 'upgrade');
  const tail = all.filter(it => it.id === 'upgrade');
  const row = it => {
    const on = lit === it.id;
    const n = waiting(it.id, counts);
    return (
      <li key={it.id}>
        <button type="button" className={cx('cx-shell-ni', on && 'is-on')} aria-current={on ? 'page' : undefined}
                onClick={() => (it.tabs ? goGroup(it) : navigate(it.id))} title={it.label} data-cx-nav={it.id}>
          <Icon name={it.icon} size={18} strokeWidth={1.75} />
          <span className="cx-shell-ni-label">{it.label}</span>
          {!!n && <span className="cx-shell-badge cx-shell-ni-badge cx-num" aria-label={`${n} waiting`}>{upTo9(n)}</span>}
          {it.key && !scope && <kbd className="cx-shell-kbd" aria-label={`Shortcut ${it.key}`}>{it.key}</kbd>}
        </button>
      </li>
    );
  };
  return (
    <div className="cx-shell-side" role="navigation" aria-label="Main" data-shell-nav="side">
      <div className="cx-shell-brand"><span className="cx-shell-logo" aria-hidden="true"><Logo size={30} c="var(--cx-accent)" c2="var(--cx-gold)" /></span>Vantage</div>
      <ul className="cx-shell-side-list">
        {items.map(row)}
        {canAdd && (
          <li>
            <button type="button" className="cx-shell-ni cx-shell-add" onClick={onAdd} title="Add an area"
                    aria-haspopup="dialog" data-cx-nav="add-area">
              <Icon name="plus" size={18} strokeWidth={1.75} />
              <span className="cx-shell-ni-label">Add an area</span>
            </button>
          </li>
        )}
        {tail.map(row)}
      </ul>
      <button type="button" className="cx-shell-ni cx-shell-signout" onClick={onSignOut} title="Sign out">
        <Icon name="log-out" size={18} strokeWidth={1.75} />
        <span className="cx-shell-ni-label">Sign out</span>
      </button>
    </div>
  );
}

function TopBar({ S, section, title, place, tabs, counts, navigate, onOpenModal, onOpenPalette, now, bg }) {
  const hint = paletteHint(typeof navigator !== 'undefined' ? (navigator.userAgentData?.platform || navigator.platform) : '');
  return (
    <header className="cx-shell-top" data-shell-bar="top">
      <h1 className="cx-shell-title">{title}</h1>
      {place
        ? <SectionTabs place={place} tabs={tabs} counts={counts} navigate={navigate} />
        : <span className="cx-shell-context">{longDate(now)}</span>}
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
      <SocialChips counts={counts} navigate={navigate} />
      {bg && <BgButton on={bg.on} onOpen={bg.open} />}
      {/* The hub's player strip already shows the balance; one is enough. */}
      {section !== 'hub' && <CoinsChip S={S} onOpen={() => onOpenModal('coinHistoryModal')} />}
      <Avatar S={S} onClick={() => navigate('profile')} />
    </header>
  );
}

function AppBar({ S, section, title, place, tabs, counts, navigate, onOpenModal, now, bg }) {
  const hub = section === 'hub';
  return (
    <header className={cx('cx-shell-appbar', hub && 'is-hub', place && 'has-sub')} data-shell-bar="app">
      <div className="cx-shell-appbar-row">
        {hub ? (
          <>
            <Avatar S={S} size={32} onClick={() => navigate('profile')} />
            <div className="cx-shell-appbar-titles">
              <span className="cx-shell-appbar-date">{shortDate(now)}</span>
              <h1 className="cx-shell-appbar-greet">{greeting(now, S.profile?.name)}</h1>
            </div>
          </>
        ) : (
          <h1 className="cx-shell-appbar-title">{title}</h1>
        )}
        <span className="cx-shell-sp" />
        <div className="cx-shell-slot" ref={barRef.end} />
        {bg && <BgButton on={bg.on} onOpen={bg.open} />}
        <CoinsChip S={S} onOpen={() => onOpenModal('coinHistoryModal')} />
        {/* Settings is behind the avatar: it leads the hub's bar and closes every other page's. */}
        {!hub && <Avatar S={S} size={32} onClick={() => navigate('profile')} />}
      </div>
      {place && <SectionTabs place={place} tabs={tabs} counts={counts} navigate={navigate} className="is-row" />}
    </header>
  );
}

function TabBar({ lit, tabs, navigate, goGroup, counts, canAdd, onAdd }) {
  return (
    <div className="cx-shell-tabs" role="navigation" aria-label="Main" data-shell-nav="tabs"
         style={{ '--cx-shell-tabs-n': tabs.length + (canAdd ? 1 : 0) }}>
      {tabs.map(t => {
        const n = waiting(t.id, counts);
        return (
          <button key={t.id} type="button" className={cx('cx-shell-tab', lit === t.id && 'is-on')}
                  aria-current={lit === t.id ? 'page' : undefined} data-cx-nav={t.id}
                  onClick={() => { haptic('LIGHT'); if (t.tabs) goGroup(t); else navigate(t.id); }}>
            <span className="cx-shell-tab-ico">
              <Icon name={t.icon} size={22} strokeWidth={1.75} />
              {!!n && <span className="cx-shell-badge cx-num" aria-label={`${n} waiting`}>{upTo9(n)}</span>}
            </span>
            <span className="cx-shell-tab-label">{t.label}</span>
          </button>
        );
      })}
      {/* A scoped account's way to the rest (lib/onboarding/areas.js). It was a row in the More sheet. */}
      {canAdd && (
        <button type="button" className="cx-shell-tab cx-shell-tab-add" aria-haspopup="dialog" data-cx-nav="add-area"
                onClick={() => { haptic('LIGHT'); onAdd(); }}>
          <span className="cx-shell-tab-ico"><Icon name="plus" size={22} strokeWidth={1.75} /></span>
          <span className="cx-shell-tab-label">Add</span>
        </button>
      )}
    </div>
  );
}

/**
 * "Add an area" (lib/onboarding/areas.js): the picks this account has not
 * asked for, with the onboarding's own line for each. Add puts the area
 * in the navigation and its first thing on the Getting started card,
 * then opens it.
 */
function AddAreaSheet({ areas, onAdd, onClose }) {
  return (
    <Sheet title="Add an area" onClose={onClose} testId="cx-shell-addarea" className="cx-shell-more cx-shell-addarea">
      <p className="cx-shell-addarea-note">Each one joins your menu, with a first step on your hub. Nothing you have is changed.</p>
      <ul className="cx-shell-more-list">
        {areas.map(a => (
          <li key={a.id}>
            <button type="button" className="cx-shell-mi" onClick={() => onAdd(a)} data-cx-area={a.id}>
              <Icon name={a.icon} size={18} strokeWidth={1.75} />
              <span className="cx-shell-mi-text">
                <span className="cx-shell-mi-label">{a.label}</span>
                <span className="cx-shell-mi-desc">{a.line}</span>
              </span>
              <span className="cx-shell-addarea-go">Add</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export default function ConsoleShell({
  S, update, userId, isMobile, isOwner, navigate, activeSection, activeSub = null,
  onOpenModal, onOpenPalette, onSignOut,
  background = null, bgFx = null, onChangeBg, onRemoveBg, onBgFx,
}) {
  const [bgOpen, setBgOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const section = canonicalSection(activeSection);
  // The smaller app: a scoped account's navigation follows what it picked
  // (null = everything, which is every account that is not scoped).
  const scope = useMemo(() => navScope(S),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.onboarding, S.savings, S.achievements, S.habits, S.shopItems, S.ratingInputs]);
  const areas = useMemo(() => (update ? addableAreas(S) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [S.onboarding, update]);
  const canAdd = areas.length > 0;

  // Where this page sits: a section and one of its tabs, or null (Hub, Settings, Upgrade).
  const sub = activeSub ? activeSub[section] || null : null;
  const place = useMemo(() => placeOf(section, sub), [section, sub]);
  const tabs = useMemo(() => (place ? groupTabs(place.group, { isOwner, scope }) : []), [place, isOwner, scope]);
  const lit = navSection(section, sub);
  const title = sectionTitle(section, sub);
  // A section reopens on the tab it was left on; tapping the open section goes to its first.
  const last = useRef({});
  useEffect(() => { if (place) last.current[place.group.id] = place.tab.id; }, [place]);
  const goGroup = g => {
    const here = place && place.group.id === g.id;
    const tab = g.tabs.find(x => !here && x.id === last.current[g.id]) || g.tabs[0];
    if (tab) navigate(tab.section, tab.sub);
  };
  // Requests and unread messages, for the Social entry and its tabs — only where Social is shown.
  const social = useMemo(() => tabItems({ isOwner, scope }).some(x => x.id === 'social'), [isOwner, scope]);
  const counts = useSocialCounts(social ? userId : null);

  // The tabs are drawn when there is a choice to make: a scoped account's Track may be the calendar alone.
  const shown = place && tabs.length > 1 ? place : null;
  // A phone's app bar grows a second row for the tabs; pages offset from --cx-shell-app-h (shell.css).
  const strip = !!isMobile && !!shown;
  useEffect(() => {
    const r = document.documentElement;
    r.toggleAttribute('data-cx-subnav', strip);
    return () => r.removeAttribute('data-cx-subnav');
  }, [strip]);

  const addSheet = addOpen && canAdd && (
    <AddAreaSheet
      areas={areas}
      onClose={() => setAddOpen(false)}
      onAdd={a => {
        haptic('LIGHT');
        update(prev => addArea(prev, a.id));
        setAddOpen(false);
        navigate(a.section, a.sub);
      }}
    />
  );
  const now = new Date();
  // Background photo for this page (App owns the picker, crop and writes).
  const bg = onChangeBg ? { on: !!background, open: () => setBgOpen(true) } : null;
  const bgSheet = bgOpen && bg && (
    <BackgroundSheet
      title={place ? place.tab.label : title} photo={background} fx={bgFx}
      onChoose={() => { setBgOpen(false); onChangeBg(); }}
      onRemove={() => { onRemoveBg?.(); }}
      onFx={next => onBgFx?.(next)}
      onClose={() => setBgOpen(false)}
    />
  );
  if (isMobile) {
    const bar = tabItems({ isOwner, scope });
    return (
      <>
        <AppBar S={S} section={section} title={title} place={shown} tabs={tabs} counts={counts}
                navigate={navigate} onOpenModal={onOpenModal} now={now} bg={bg} />
        <TabBar lit={activeTab(section, sub, { tabs: bar })} tabs={bar} navigate={navigate} goGroup={goGroup} counts={counts}
                canAdd={canAdd} onAdd={() => setAddOpen(true)} />
        {addSheet}
        {bgSheet}
      </>
    );
  }
  return (
    <>
      <Sidebar lit={lit} isOwner={isOwner} navigate={navigate} goGroup={goGroup} onSignOut={onSignOut}
               scope={scope} canAdd={canAdd} onAdd={() => setAddOpen(true)} counts={counts} />
      <TopBar S={S} section={section} title={title} place={shown} tabs={tabs} counts={counts} navigate={navigate}
              onOpenModal={onOpenModal} onOpenPalette={onOpenPalette} now={now} bg={bg} />
      {addSheet}
      {bgSheet}
    </>
  );
}

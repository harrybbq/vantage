import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from './lib/supabase';
import { useVisionBoardState, hasLocalStorageData, clearLocalStorageData } from './hooks/useVisionBoardState';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { useTierLimits } from './hooks/useTierLimits';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import AuthScreen from './components/AuthScreen';
import Nav from './components/Nav';
import PageHeader from './components/PageHeader';
import HubSection from './components/HubSection';
import MobileHubSection from './components/mobile/MobileHubSection';
import AchievementsSection from './components/AchievementsSection';
import TrackSection from './components/TrackSection';
import ShopSection from './components/ShopSection';
import HolidaySection from './components/HolidaySection';
import HabitsSection from './components/HabitsSection';
import MobileHabitsSection from './components/mobile/MobileHabitsSection';
import MobileFriendsSection from './components/mobile/MobileFriendsSection';
import MobileProfileSection from './components/mobile/MobileProfileSection';
import SettingsSection from './components/SettingsSection';
import { SCHEMES, applyScheme, applyTheme, schemeFromHex } from './components/SettingsSection';
import { useSubscriptionContext } from './context/SubscriptionContext';
import Modals from './components/Modals';
import PaywallModal from './components/PaywallModal';
import HubFooter from './components/HubFooter';
import CoinToast from './components/CoinToast';
import ConnectToast from './components/ConnectToast';
import CommandPalette from './components/CommandPalette';
import ShortcutsModal from './components/ShortcutsModal';
import LegalPage from './components/LegalPage';
import CookieBanner from './components/CookieBanner';
import InstallPrompt from './components/InstallPrompt';
import TutorialOverlay from './components/TutorialOverlay';
import BackgroundCropModal from './components/BackgroundCropModal';
import LeaderboardSection from './components/LeaderboardSection';
import AdminEditModal from './components/AdminEditModal';
import VisionsModal from './components/VisionsModal';
import { useIsOwner } from './hooks/useIsOwner';
import { useCapacitor, haptic } from './hooks/useCapacitor';
import { useIsMobile } from './hooks/useIsMobile';
import { useVisions } from './lib/visions/useVisions';
import { usePublishProfile } from './lib/friends/usePublishProfile';
import { useRatings } from './hooks/useRatings';
import BottomTabBar from './components/mobile/BottomTabBar';
import MoreDrawer from './components/mobile/MoreDrawer';
import MobileAppBar from './components/mobile/MobileAppBar';
import { registerPushToken, handleIncomingPush } from './lib/push/handlers';
import NotificationPermissionPrompt, { hasAskedPushPrePrompt } from './components/NotificationPermissionPrompt';

const pageMotion = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

// ── Background helpers ────────────────────────────────────────────────────
// Backgrounds used to live in localStorage (device-local), which meant they
// didn't follow the account between mobile and desktop. They now live in the
// synced state (S.backgrounds). These helpers only handle the one-time
// migration off the old localStorage key.
const LEGACY_BG_KEY = 'vb4_bg';
function loadLegacyBgs() {
  try { return JSON.parse(localStorage.getItem(LEGACY_BG_KEY) || '{}'); } catch { return {}; }
}

/**
 * Downscale a base64/data-URL image to a sane size so syncing it in the
 * state blob doesn't bloat every save. Max 1600px on the long edge,
 * JPEG @ 0.72. Resolves to a data URL (or the original on failure).
 */
function compressImageDataUrl(dataUrl, max = 1600, quality = 0.72) {
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch { resolve(dataUrl); }
  });
}

// Maps add-modal IDs to the free-tier cap key + a fn that counts current items
// for that key. Anything not listed here is unmetered.
const MODAL_CAPS = {
  addLinkModal:        { key: 'links',        count: S => (S.links || []).length },
  addAchievementModal: { key: 'achievements', count: S => (S.achievements || []).length },
  addTrackerModal:     { key: 'trackers',     count: S => (S.trackers || []).length },
  addShopModal:        { key: 'shopItems',    count: S => (S.shopItems || []).length },
  addHolidayModal:     { key: 'holidays',     count: S => (S.holidays || []).length },
  addHabitModal:       { key: 'habits',       count: S => (S.habits || []).length },
};

function Board({ userId, userEmail, onSignOut }) {
  const {
    S, update, loading, justMigrated, dismissMigrationBanner,
    loadError, retryLoad, startFresh, restoreFromBackup, hasBackup,
  } = useVisionBoardState(userId);
  const { atLimit } = useTierLimits();
  const { hasPro } = useSubscriptionContext();
  const { isOwner } = useIsOwner(userEmail);
  // Owner admin edit modal — opened via right-click on OVR / coin chip
  // (handlers in PageHeader + MobileAppBar + RatingsPanel).
  const [adminEdit, setAdminEdit] = useState(null); // 'rating' | 'coins' | null
  // Global owner-only handlers:
  //   1. Coin chip uses data-admin-target='coins' (caught here via
  //      capture-phase contextmenu so the React handler can't preventDefault
  //      first).
  //   2. The Ratings module is wrapped in the hub-module right-click menu
  //      already, so we expose a 'vantage:admin-edit' CustomEvent the menu
  //      fires when an owner clicks its admin row — see HubModuleMenu.
  //   window.__vantageOwner is set so HubModuleMenu can detect ownership
  //   without prop-threading through HubSection.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__vantageOwner = !!isOwner;
    }
    if (!isOwner) return;
    const onCtx = e => {
      const el = e.target.closest && e.target.closest('[data-admin-target]');
      if (!el) return;
      const target = el.getAttribute('data-admin-target');
      if (target !== 'rating' && target !== 'coins') return;
      e.preventDefault();
      e.stopPropagation();
      setAdminEdit(target);
    };
    const onEvt = e => {
      const t = e.detail;
      if (t === 'rating' || t === 'coins') setAdminEdit(t);
    };
    // Capture phase so we run before React's bubbling handlers.
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('vantage:admin-edit', onEvt);
    return () => {
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('vantage:admin-edit', onEvt);
    };
  }, [isOwner]);
  // Visions catalogue modal — global "view what visions exist + which
  // ones you've unlocked". Triggered from Settings + a coin-wallet
  // menu option.
  const [visionsOpen, setVisionsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('hub');
  const [openModal, setOpenModal] = useState(null);
  const [coinToast, setCoinToast] = useState({ message: '', type: '', visible: false });
  const [localDataExists, setLocalDataExists] = useState(() => hasLocalStorageData());
  const [noBanner, setNoBanner] = useState(() => localStorage.getItem('vb4_no_banner') === '1');
  // Backgrounds now live in synced state (S.backgrounds) so they follow
  // the account across devices. See the migration effect below.
  const backgrounds = S.backgrounds || {};
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [legalPage, setLegalPage] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const isMobile = useIsMobile();

  // Native plugins (no-op on web).
  // Push handlers delegate to src/lib/push/handlers.js — that module
  // owns the routing logic so this file stays slim. handleIncomingPush
  // takes a fresh `actions` bag each call so it always sees the
  // current navigate/showToast closures rather than stale ones.
  useCapacitor({
    onPushToken: token => {
      registerPushToken(userId, token, /* platform inferred server-side */ 'unknown');
    },
    onPushMessage: msg => {
      handleIncomingPush(msg, {
        navigate,
        showToast: showCoinToast,
        prefs: S.notifications,
      });
    },
  });
  const bgInputRef = useRef(null);
  const coinToastTimer = useRef(null);

  // Apply stored colour scheme once state loads
  useEffect(() => {
    if (S.colorScheme === 'custom' && S.customColor) {
      applyScheme(schemeFromHex(S.customColor));
    } else if (S.colorScheme) {
      const scheme = SCHEMES.find(s => s.id === S.colorScheme);
      if (scheme) applyScheme(scheme);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.colorScheme, S.customColor]);

  // One-time migration: backgrounds used to be stored device-locally in
  // localStorage('vb4_bg'). Move any found into the synced state so they
  // follow the account, then clear the legacy key. Won't clobber if the
  // account already has synced backgrounds.
  const bgMigratedRef = useRef(false);
  useEffect(() => {
    if (loading || bgMigratedRef.current) return;
    bgMigratedRef.current = true;
    const legacy = loadLegacyBgs();
    const keys = Object.keys(legacy);
    if (!keys.length) return;
    if (Object.keys(S.backgrounds || {}).length > 0) {
      try { localStorage.removeItem(LEGACY_BG_KEY); } catch {}
      return;
    }
    (async () => {
      const out = {};
      for (const k of keys) out[k] = await compressImageDataUrl(legacy[k]);
      update(prev => ({ ...prev, backgrounds: { ...(prev.backgrounds || {}), ...out } }));
      try { localStorage.removeItem(LEGACY_BG_KEY); } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Apply stored theme — Pro-gated (lifetime counts as Pro). If entitlement
  // flips false we auto-revert via applyTheme's resolveEffectiveTheme, so
  // a lapsed subscriber on dark-os falls to free `dark` (same mode), and
  // one on cream-pro falls to free `cream`. The resolved id is also
  // written back to S.theme on tier change so the saved preference stays
  // accurate — otherwise refreshing would keep showing the lock.
  useEffect(() => {
    const saved = S.theme || 'cream';
    const effective = applyTheme(saved, { hasPro });
    if (effective !== saved) {
      update(prev => ({ ...prev, theme: effective }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.theme, hasPro]);

  function showCoinToast(msg, isEarn, duration) {
    const type = isEarn ? 'earn' : (msg.includes('Need') ? 'error' : 'spend');
    // 30-day streak toast stays 4 s; default 2.6 s
    const ms = duration ?? (msg.includes('30 day streak') ? 4000 : 2600);
    if (isEarn) haptic('HEAVY');
    setCoinToast({ message: msg, type, visible: true });
    clearTimeout(coinToastTimer.current);
    coinToastTimer.current = setTimeout(() => setCoinToast(t => ({ ...t, visible: false })), ms);
  }

  // Visions runtime — derives the user's level/xp from their state
  // and stamps newly-met visions (with a toast). See src/lib/visions.
  // The hook is safe to call before state has loaded; it just won't
  // stamp anything until S has the shape it expects.
  // Auto-trigger the push pre-prompt the first time a vision unlocks
  // — it's the celebratable moment we want to ride. The pre-prompt's
  // own localStorage guard ensures this fires at most once per device,
  // even if a flurry of unlocks arrives in the same session.
  const [pushPrePromptOpen, setPushPrePromptOpen] = useState(false);
  const visionState = useVisions(S, update, showCoinToast, () => {
    if (!hasAskedPushPrePrompt()) setPushPrePromptOpen(true);
  });

  // Publish the user's friend-facing slice (display_name, level,
  // public_stats heatmap + wins) to Supabase so friends can see it.
  // Debounced inside the hook; safely no-ops if the social schema
  // hasn't been applied yet.
  usePublishProfile(userId, S, hasPro, visionState);

  // Ranked categories (F5 Sprint 3). Local recompute updates S.ratings
  // on a 1.5s debounce; server recompute fires the Netlify function on
  // a 30s debounce to update profiles.ratings (friend-visible truth).
  // friendCount comes from useFriends below — but to avoid a circular
  // import we pass 0 here; the social-rating component reads friend
  // count separately. TODO: thread real friendCount once F5 is fully
  // wired into the friends rail.
  useRatings(userId, S, update, 0);

  function navigate(id) { setActiveSection(id); }
  function handleOpenModal(id) {
    // Intercept add-flows that have a free-tier cap. If the user is over,
    // open the paywall modal instead of the add modal.
    const baseId = typeof id === 'string' ? id.split(':')[0] : id;
    const cap = MODAL_CAPS[baseId];
    if (cap && atLimit(cap.key, cap.count(S))) {
      setOpenModal(`paywall:${cap.key}`);
      return;
    }
    setOpenModal(id);
  }
  function handleCloseModal() { setOpenModal(null); }

  // ── AI Coach verb dispatch ──
  // Called when a Pro user taps an action button inside a coach insight.
  function handleCoachAct(verb) {
    if (!verb) return;
    switch (verb.action) {
      case 'open-modal':
        if (verb.args?.modalId) handleOpenModal(verb.args.modalId);
        break;
      case 'navigate':
        if (verb.args?.section) navigate(verb.args.section);
        break;
      case 'split-achievement': {
        // Auto-creates 3 stepping-stone milestones and connects them
        // to the parent. Shown to the user via a toast so they know
        // something happened and can find them on the board.
        const id = verb.args?.id;
        if (!id) break;
        update(prev => {
          const parent = (prev.achievements || []).find(a => a.id === id);
          if (!parent) return prev;
          const baseCoins = Math.max(10, Math.floor((parent.coins || 60) / 4));
          const baseX = parent.x ?? 60;
          const baseY = parent.y ?? 60;
          const now = Date.now();
          const stones = [1, 2, 3].map(i => ({
            id: `a${now}-${i}`,
            name: `${parent.name} — Step ${i}`,
            desc: `Stepping stone ${i} of 3`,
            icon: '◆',
            x: baseX + i * 40,
            y: baseY + 180,
            completed: false,
            coins: baseCoins,
          }));
          const newConnections = stones.map(s => [s.id, parent.id]);
          return {
            ...prev,
            achievements: [...(prev.achievements || []), ...stones],
            connections: [...(prev.connections || []), ...newConnections],
          };
        });
        showCoinToast('Created 3 stepping-stone milestones', 'earn');
        navigate('achievements');
        break;
      }
      case 'add-habit':
        // For v1, just open the habit modal. Future enhancement: pre-fill
        // the suggested name via a `suggest` URL param read in Modals.jsx.
        handleOpenModal('addHabitModal');
        break;
      default:
        // Unknown verb — silently ignore so future LLM-suggested verbs don't crash
        console.warn('Unknown coach verb:', verb.action);
    }
  }

  function handleCancelConnect() {
    update(prev => ({ ...prev, connectingFrom: null }));
    document.getElementById('connectToast').style.display = 'none';
    document.querySelectorAll('.achievement-node').forEach(n => n.style.outline = '');
  }

  function handleClearLocalStorage() {
    clearLocalStorageData();
    setLocalDataExists(false);
    dismissMigrationBanner();
  }

  function handleNeverShowAgain() {
    localStorage.setItem('vb4_no_banner', '1');
    setNoBanner(true);
  }

  // Background changer
  function handleChangeBgClick() {
    bgInputRef.current?.click();
  }

  // Open the crop modal after the user picks an image; the modal's
  // confirm callback is what actually writes to S.backgrounds. cropTarget
  // captures the section (rather than reading activeSection later) so the
  // saved crop lands where the user picked it even if they navigate
  // while the modal is open.
  const [cropTarget, setCropTarget] = useState(null); // { section, src } | null
  function handleBgFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const section = activeSection;
    const reader = new FileReader();
    reader.onload = ev => setCropTarget({ section, src: ev.target.result });
    reader.readAsDataURL(file);
    e.target.value = '';
  }
  async function handleBgCropConfirm(croppedDataUrl) {
    if (!cropTarget) return;
    const { section } = cropTarget;
    // The crop has already been rendered at output size; still pass
    // through the compressor as a safety net (clamps long edge + JPEG).
    const compressed = await compressImageDataUrl(croppedDataUrl);
    update(prev => ({
      ...prev,
      backgrounds: { ...(prev.backgrounds || {}), [section]: compressed },
    }));
    setCropTarget(null);
  }

  function handleRemoveBg() {
    const section = activeSection;
    update(prev => {
      const bgs = { ...(prev.backgrounds || {}) };
      delete bgs[section];
      return { ...prev, backgrounds: bgs };
    });
  }

  // Escape key to cancel connect
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape' && S.connectingFrom) handleCancelConnect();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.connectingFrom]);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    navigate,
    openModal: handleOpenModal,
    activeSection,
    openPalette: () => setPaletteOpen(true),
    openShortcuts: () => setShortcutsOpen(true),
    activeModalId: openModal,
    closeModal: handleCloseModal,
  });

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '2px' }}>
        LOADING...
      </div>
    );
  }

  // Load error — refused to overwrite cloud with defaults. The user
  // sees a clear screen and gets to choose: retry the load, sign out,
  // or (for empty_state) explicitly start fresh.
  if (loadError) {
    const isEmpty = loadError.kind === 'empty_state';
    const isSeenBefore = loadError.kind === 'seen_before_no_row';
    // Both "empty_state" and "seen_before_no_row" need the rescue
    // affordances (Start fresh, warning copy) — they're both
    // anomalous states where we refused to overwrite ambiguous cloud
    // data. Plain `load_failed` only gets Try-again + Sign-out.
    const isAlarm = isEmpty || isSeenBefore;
    const backupAvailable = isAlarm && typeof hasBackup === 'function' && hasBackup();
    const eyebrow =
      isSeenBefore ? 'Refused to overwrite' :
      isEmpty      ? 'No data found'        :
                     'Could not load';
    const headline =
      isSeenBefore ? 'Wait — we know you had data here.' :
      isEmpty      ? 'We didn\'t overwrite anything.'    :
                     'We couldn\'t reach your data.';
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', padding: '24px', textAlign: 'center',
        background: 'var(--bg-base)', color: 'var(--text)',
        fontFamily: 'var(--body)',
      }}>
        <div style={{
          maxWidth: 480, padding: '32px 28px',
          background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 14px 36px rgba(0,0,0,0.08)',
        }}>
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: 2.5,
            textTransform: 'uppercase', color: 'var(--em-mid, var(--em))',
            marginBottom: 8,
          }}>{eyebrow}</div>
          <h2 style={{
            fontFamily: 'var(--display)', fontSize: 24, fontStyle: 'italic',
            fontWeight: 700, color: 'var(--em)', margin: '0 0 14px',
          }}>
            {headline}
          </h2>
          <p style={{ color: 'var(--text-mid)', fontSize: 13.5, lineHeight: 1.6, margin: '0 0 20px' }}>
            {loadError.message}
          </p>
          {isAlarm && (
            <p style={{
              color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6,
              margin: '0 0 20px', fontStyle: 'italic',
            }}>
              {isSeenBefore
                ? 'If Try Again keeps failing, your row may have been deleted server-side. ' +
                  'Choose Start fresh ONLY if you accept losing whatever was in the cloud.'
                : 'If you\'ve never set up Vantage on this account before, choose Start fresh. ' +
                  'Otherwise — please don\'t proceed and contact support; your data may be recoverable.'}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={retryLoad}
              style={{ padding: '10px 20px' }}
            >
              Try again
            </button>
            {backupAvailable && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (window.confirm('Restore your most recent local backup to the cloud? Photos will need re-adding, but your goals, trackers, logs and progress will come back.')) {
                    restoreFromBackup();
                  }
                }}
                style={{ padding: '10px 20px' }}
              >
                Restore backup
              </button>
            )}
            {isAlarm && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (window.confirm('This will set up your account with default data. If you had data here before, it will not come back. Continue?')) {
                    startFresh();
                  }
                }}
                style={{ padding: '10px 20px' }}
              >
                Start fresh
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onSignOut}
              style={{ padding: '10px 20px' }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showBanner = !noBanner && (justMigrated || localDataExists);
  const currentBg = backgrounds[activeSection];

  return (
    <>
      {/* Migration banner */}
      {showBanner && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'var(--em, #2a9e62)', color: '#fff',
          padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
          fontFamily: 'var(--sans)', fontSize: '13px', flexWrap: 'wrap',
        }}>
          <span>
            {justMigrated ? 'Your data was migrated to the cloud.' : 'Old local data found in this browser.'}
            {' '}Safe to clear now.
          </span>
          <button onClick={handleClearLocalStorage} style={{ background: 'rgba(0,0,0,0.25)', border: 'none', borderRadius: '6px', color: '#fff', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
            Clear localStorage
          </button>
          <button onClick={handleNeverShowAgain} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '6px', color: 'rgba(255,255,255,0.85)', padding: '4px 12px', fontSize: '12px', cursor: 'pointer' }}>
            Never show again
          </button>
          <button onClick={() => { dismissMigrationBanner(); setLocalDataExists(false); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }} title="Dismiss">×</button>
        </div>
      )}

      {/* Hidden file input for background */}
      <input ref={bgInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgFileChange} />

      {/* Custom background image for current section */}
      {currentBg && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
          backgroundImage: `url(${currentBg})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
        }} />
      )}

      {/* Overlays — only shown when a custom background is active */}
      <div id="hub-overlay" className={activeSection === 'hub' && currentBg ? 'visible' : ''}></div>
      <div id="shop-overlay" className={activeSection === 'shop' && currentBg ? 'visible' : ''}></div>

      {/* Sidebar nav (desktop only — hidden via @media on mobile) */}
      <Nav activeSection={activeSection} onNavigate={navigate} onSignOut={onSignOut} />

      {/* Mobile chrome — bottom tab bar + app bar + More drawer.
          Only mounts on mobile viewports so we don't pay for these
          components on desktop where the sidenav handles navigation.
          The CSS hides .m-appbar and .m-tabs on desktop anyway, but
          conditional mounting saves a render and clarifies intent. */}
      {isMobile && (
        <>
          <MobileAppBar
            activeSection={activeSection}
            coins={S.coins || 0}
            onOpenCoinHistory={() => handleOpenModal('coinHistoryModal')}
            onNavigateSettings={() => navigate('settings')}
            onChangeBg={handleChangeBgClick}
            onRemoveBg={currentBg ? handleRemoveBg : null}
            hasBg={!!currentBg}
            onCoinContextMenu={isOwner ? () => setAdminEdit('coins') : null}
          />
          <BottomTabBar
            activeSection={activeSection}
            onNavigate={navigate}
            onOpenMore={() => setMoreOpen(true)}
            moreOpen={moreOpen}
          />
          <MoreDrawer
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            onNavigate={navigate}
            activeSection={activeSection}
            onUpgrade={() => handleOpenModal('paywall:generic')}
          />
        </>
      )}

      {/* Fixed page header (desktop only — hidden via @media on mobile) */}
      <PageHeader
        activeSection={activeSection}
        coins={S.coins || 0}
        onOpenCoinHistory={() => handleOpenModal('coinHistoryModal')}
        profileName={S.profile?.name || ''}
        onChangeBg={handleChangeBgClick}
        onRemoveBg={currentBg ? handleRemoveBg : null}
        onSignOut={onSignOut}
        onCoinContextMenu={isOwner ? () => setAdminEdit('coins') : null}
      />

      {/* Main sections */}
      <AnimatePresence mode="wait">
        {activeSection === 'hub' && (
          <motion.div key="hub" {...pageMotion}>
            {isMobile ? (
              <MobileHubSection
                S={S}
                update={update}
                visionState={visionState}
                hasPro={hasPro}
                navigate={navigate}
                onOpenModal={handleOpenModal}
              />
            ) : (
              <HubSection S={S} update={update} active onOpenModal={handleOpenModal} onOpenWaitlist={() => handleOpenModal('waitlistModal')} onNavigateSettings={() => navigate('settings')} onNavigateTrack={() => navigate('track')} onShowCoinToast={showCoinToast} onCoachAct={handleCoachAct} visionState={visionState} userId={userId} onUpgrade={() => handleOpenModal('paywall:friends')} onNavigate={navigate} />
            )}
          </motion.div>
        )}
        {activeSection === 'achievements' && (
          <motion.div key="achievements" {...pageMotion}>
            <AchievementsSection S={S} update={update} active onOpenModal={handleOpenModal} onShowCoinToast={showCoinToast} />
          </motion.div>
        )}
        {activeSection === 'track' && (
          <motion.div key="track" {...pageMotion}>
            <TrackSection S={S} update={update} active onOpenModal={handleOpenModal} onShowCoinToast={showCoinToast} userId={userId} />
          </motion.div>
        )}
        {activeSection === 'shop' && (
          <motion.div key="shop" {...pageMotion}>
            <ShopSection S={S} update={update} active onOpenModal={handleOpenModal} onShowCoinToast={showCoinToast} />
          </motion.div>
        )}
        {activeSection === 'holiday' && (
          <motion.div key="holiday" {...pageMotion}>
            <HolidaySection S={S} update={update} active onOpenModal={handleOpenModal} />
          </motion.div>
        )}
        {activeSection === 'habits' && (
          <motion.div key="habits" {...pageMotion}>
            {isMobile ? (
              <MobileHabitsSection S={S} update={update} onOpenModal={handleOpenModal} onShowCoinToast={showCoinToast} />
            ) : (
              <HabitsSection S={S} update={update} active onOpenModal={handleOpenModal} onShowCoinToast={showCoinToast} />
            )}
          </motion.div>
        )}
        {activeSection === 'leaderboard' && (
          <motion.div key="leaderboard" {...pageMotion}>
            <LeaderboardSection
              active
              onOpenSelfBreakdown={() => navigate('hub')}
              onAddFriends={() => navigate('hub')}
              onOpenSettings={() => navigate('settings')}
            />
          </motion.div>
        )}
        {activeSection === 'settings' && (
          <motion.div key="settings" {...pageMotion}>
            <SettingsSection S={S} update={update} active userId={userId} onOpenLegal={setLegalPage} onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenVisions={() => setVisionsOpen(true)} />
          </motion.div>
        )}
        {/* Friends — mobile-only route. Desktop puts FriendsRail in
            the hub right rail; mobile gives it a dedicated screen via
            MoreDrawer. Render on desktop too so deep-linking works,
            but in practice the bottom-tab/drawer surface is mobile. */}
        {activeSection === 'friends' && (
          <motion.div key="friends" {...pageMotion}>
            <MobileFriendsSection
              userId={userId}
              onUpgrade={() => handleOpenModal('paywall:friends')}
            />
          </motion.div>
        )}
        {/* Profile — mobile-only route. Centralises photo / name /
            email / password / sign-out under More → Profile so users
            don't have to dig into Settings tabs to find them. */}
        {activeSection === 'profile' && (
          <motion.div key="profile" {...pageMotion}>
            <MobileProfileSection
              S={S}
              update={update}
              userEmail={userEmail}
              onSignOut={onSignOut}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <Modals
        openModal={openModal}
        S={S}
        update={update}
        onClose={handleCloseModal}
        onOpen={handleOpenModal}
        onShowCoinToast={showCoinToast}
        userId={userId}
        userEmail={userEmail}
      />

      <PaywallModal
        openId={openModal}
        onClose={handleCloseModal}
        onUpgrade={() => { handleCloseModal(); handleOpenModal('waitlistModal'); }}
        onShowToast={showCoinToast}
      />

      <ConnectToast onCancel={handleCancelConnect} />
      <HubFooter visible={activeSection === 'hub'} onOpenLegal={setLegalPage} />
      <CoinToast message={coinToast.message} type={coinToast.type} visible={coinToast.visible} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigate={navigate}
        openModal={handleOpenModal}
        S={S}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <CookieBanner onOpenLegal={setLegalPage} />
      <InstallPrompt />
      <AdminEditModal
        open={!!adminEdit}
        target={adminEdit}
        userId={userId}
        S={S}
        update={update}
        onClose={() => setAdminEdit(null)}
      />
      <VisionsModal
        open={visionsOpen}
        S={S}
        onClose={() => setVisionsOpen(false)}
      />
      {cropTarget && (
        <BackgroundCropModal
          src={cropTarget.src}
          onCancel={() => setCropTarget(null)}
          onConfirm={handleBgCropConfirm}
        />
      )}
      <NotificationPermissionPrompt
        open={pushPrePromptOpen}
        onClose={() => setPushPrePromptOpen(false)}
        onPushToken={token => registerPushToken(userId, token, 'unknown')}
        onPushMessage={msg => handleIncomingPush(msg, {
          navigate, showToast: showCoinToast, prefs: S.notifications,
        })}
        headline="Vision unlocked. Want a ping for the next one?"
        body={(
          <>
            We'll only ping you for the categories you turn on in
            Settings — vision unlocks, friend requests, streak warnings.
            No marketing, no signup nudges.
            <br /><br />
            Quiet hours are honored. You can turn any of this off whenever.
          </>
        )}
      />
      {legalPage && <LegalPage page={legalPage} onClose={() => setLegalPage(null)} />}

      {/* Onboarding tutorial — shows once for new users, replayable
          from Settings. Dark OS users get the terser voice variant. */}
      <TutorialOverlay
        visible={!S.tutorialCompleted}
        theme={(S.theme === 'dark-os' && hasPro) || S.theme === 'dark' ? 'dark' : 'cream'}
        onNavigate={navigate}
        onClose={() => update(prev => ({ ...prev, tutorialCompleted: true }))}
      />
    </>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [legalPage, setLegalPage] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      // If user logged in without "remember me", sign out on next page load
      if (session && localStorage.getItem('vb4_remember') === '0') {
        await supabase.auth.signOut();
        setSession(null);
      } else {
        setSession(session);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // When the session goes away (sign-out, expiry, other tab) drop the
      // dark-os attribute on <html> so the AuthScreen always renders against
      // the cream surface it was designed for. The next authenticated boot
      // will re-apply the user's saved theme via Board's applyTheme effect.
      if (!session) document.documentElement.removeAttribute('data-theme');
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Legal page overlay — accessible before login
  if (legalPage) {
    return <LegalPage page={legalPage} onClose={() => setLegalPage(null)} />;
  }

  if (session === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '2px' }}>
        LOADING...
      </div>
    );
  }

  if (!session) return <AuthScreen onOpenLegal={setLegalPage} />;
  return (
    <SubscriptionProvider userId={session.user.id}>
      <Board userId={session.user.id} userEmail={session.user.email} onSignOut={handleSignOut} />
    </SubscriptionProvider>
  );
}

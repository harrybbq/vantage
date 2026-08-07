import { useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import { VitalsBody, BurnBody, MacrosBody } from './mobile/MobileWidget';
import { BodyBody, SubscriptionsBody, MoodBody } from './widgets/LifeWidgets';
import { SavingsPotsBody, SavingsProjectionBody } from './savings/SavingsWidgets';
import { tradingWidgetAvailable, TRADING_WIDGET_BUILD_EXCLUDED } from '../lib/trading/enabled';
import MarketBody from './widgets/MarketWidget';
import NewsBody from './widgets/NewsWidget';
import { reflow, MIN_W, MIN_H, SNAP_GAP as REFLOW_GAP } from '../lib/hub/reflow';
const TradingBody = TRADING_WIDGET_BUILD_EXCLUDED ? null : lazy(() => import('./widgets/TradingWidget'));
import { timeAgo } from '../utils/helpers';
import AiCoachWidget from './AiCoachWidget';
import CoachBriefPanel from './CoachBriefPanel';
import QuickLog from './QuickLog';
import HubOsLayout from './HubOsLayout';
import FriendsRail from './friends/FriendsRail';
import RatingsPanel from './RatingsPanel';
import { ovrTier } from '../lib/ratings/tiers';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { isOsLayoutTheme } from './SettingsSection';
import { useHubModuleMenu } from './HubModuleMenu';
import { APP_PRESETS } from '../data/appPresets';
import { fetchAppPreview } from '../lib/appPreview';
import { strikeState } from '../lib/habits/strikes';
import Icon from './Icon';
import { useOwnHandle } from '../hooks/useOwnHandle';

// ── GitHub helpers ──
async function fetchGitHub(username, cache) {
  if (cache[username]) return cache[username];
  try {
    const [userRes, reposRes] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`),
      fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=5`),
    ]);
    const user = await userRes.json();
    const repos = await reposRes.json();
    return { user, repos: Array.isArray(repos) ? repos : [] };
  } catch { return null; }
}

// ── Hub content widgets (Habits / Holidays) — imperative HTML ──
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Only ever emit http(s) into an href — escaping can't stop a
 *  `javascript:` URL, it just stops the attribute being broken out of. */
function safeUrl(u) {
  const v = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(v) ? escapeHtml(v) : '#';
}
function fmtHabitElapsed(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function habitTarget(h, elapsed) {
  const ms = (h.milestones || []).slice().sort((a, b) => a.duration - b.duration);
  const next = ms.find(m => m.duration > elapsed);
  const target = next ? next.duration : (ms.length ? ms[ms.length - 1].duration : elapsed || 1);
  return { target, next };
}
function habitsWidgetHtml(S) {
  const habits = (S.habits || []).filter(h => h.startTime).slice()
    .sort((a, b) => a.startTime - b.startTime).slice(0, 5); // oldest = longest running
  if (!habits.length) return '<div class="hub-widget-empty">No habits yet — add one in Habits.</div>';
  const now = Date.now();
  return habits.map(h => {
    const elapsed = now - h.startTime;
    const { target, next } = habitTarget(h, elapsed);
    const pct = Math.max(0, Math.min(100, target ? (elapsed / target) * 100 : 100));
    const strikes = strikeState(h, now);
    const struckCls = strikes.state === 'struck' ? ' is-struck' : strikes.state === 'maxed' ? ' is-maxed' : '';
    return `<div class="hub-habit hub-row-go" data-go-to="habits" role="link" tabindex="0">
      <div class="hub-habit-top"><span class="hub-habit-name">${escapeHtml(h.name)}</span><span class="hub-habit-time${struckCls}" data-habit-timer="${escapeHtml(h.id)}">${fmtHabitElapsed(elapsed)}</span></div>
      <div class="hub-habit-bar"><div class="hub-habit-fill" data-habit-bar="${escapeHtml(h.id)}" style="width:${pct}%"></div></div>
      ${next ? `<div class="hub-habit-next">${escapeHtml(next.label || '')}</div>` : ''}
    </div>`;
  }).join('');
}
function holidaysWidgetHtml(S) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trips = (S.holidays || []).filter(h => h.status !== 'completed').map(h => {
    let dep = null;
    if (h.from) { dep = new Date(h.from); dep.setHours(0, 0, 0, 0); }
    return { h, dep };
  }).filter(x => !x.dep || x.dep >= today)
    .sort((a, b) => { if (!a.dep) return 1; if (!b.dep) return -1; return a.dep - b.dep; })
    .slice(0, 5);
  if (!trips.length) return '<div class="hub-widget-empty">No upcoming trips — plan one in Holidays.</div>';
  return trips.map(({ h, dep }) => {
    const days = dep ? Math.round((dep - today) / 86400000) : null;
    const label = days == null ? 'TBC' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`;
    const img = h.imageUrl ? ` style="background-image:url(&quot;${escapeHtml(h.imageUrl)}&quot;)"` : '';
    return `<div class="hub-trip hub-row-go${h.imageUrl ? ' has-img' : ''}" data-go-to="holiday" role="link" tabindex="0"${img}><span class="hub-trip-name">${escapeHtml(h.dest || 'Trip')}</span><span class="hub-trip-when">${label}</span></div>`;
  }).join('');
}

// ── Widget canvas (DOM-based dragging) ──
const SNAP_GAP = 12;
function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function useWidgetDrag(canvasRef, S, update, snapRef) {
  const makeDraggable = useCallback((wrapper, linkId) => {
    const handle = wrapper.querySelector('[data-drag]');
    if (!handle) return;
    // Pointer events cover mouse + touch + pen in one path. touch-action:none
    // on the grip stops the browser fighting scroll-vs-drag on touch devices.
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', e => {
      // Ignore non-primary buttons (right-click etc.).
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      // ── Snapping → absolute conversion ──
      // Previously this called update() once PER widget inside a forEach,
      // landing N debounced cloud saves and a canvas re-render at exactly
      // the moment the user wanted to drag — visible as click-to-drag lag.
      // Now: do all DOM mutations immediately (instant feel), then commit
      // every position to React state in ONE batched update.
      if (wrapper.classList.contains('snapping')) {
        const all = canvas.querySelectorAll('.widget-wrapper');
        const snapshots = [];
        all.forEach(w => { const r = w.getBoundingClientRect(); snapshots.push({ w, x: r.left, y: r.top }); });
        canvas.style.cssText = 'position:relative;flex:1;min-height:calc(100vh - 180px);display:block;';
        const cr = canvas.getBoundingClientRect();
        const newPositions = {};
        snapshots.forEach(({ w, x, y }) => {
          w.classList.remove('snapping');
          const left = x - cr.left;
          const top  = y - cr.top;
          w.style.cssText = `position:absolute;min-width:280px;max-width:360px;width:300px;user-select:none;left:${left}px;top:${top}px;`;
          const id = w.dataset.linkId;
          if (id) newPositions[id] = { x: left, y: top };
        });
        if (Object.keys(newPositions).length) {
          update(prev => ({ ...prev, widgetPositions: { ...prev.widgetPositions, ...newPositions } }));
        }
      }

      // Cache layout values up-front — onMove ran getBoundingClientRect /
      // offsetWidth every frame before, forcing a relayout on each move.
      const wrapperW = wrapper.offsetWidth;
      const wrapperH = wrapper.offsetHeight;
      const canvasW  = canvas.offsetWidth;
      const maxX     = canvasW - wrapperW;
      const startX   = e.clientX - wrapper.offsetLeft;
      const startY   = e.clientY - wrapper.offsetTop;
      const island   = wrapper.querySelector('.link-island');
      if (island) island.classList.add('dragging-active');
      try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

      // ── Snap mode (toggle in the Actions module) ──
      // ON: while dragging, widgets in the way are pushed DOWN (live)
      // to make room, springing back if the dragged widget moves away
      // — everything is re-derived from original positions each frame.
      // OFF: classic free drag, allowed to overlap.
      let snapOthers = null;
      if (snapRef?.current) {
        snapOthers = [];
        canvas.querySelectorAll('.widget-wrapper').forEach(w2 => {
          if (w2 === wrapper) return;
          w2.classList.add('snap-push'); // smooth top transitions while pushed
          snapOthers.push({ el: w2, x: w2.offsetLeft, y: w2.offsetTop, w: w2.offsetWidth, h: w2.offsetHeight, cur: w2.offsetTop });
        });
        snapOthers.sort((a, b) => a.y - b.y || a.x - b.x);
      }
      function resolveSnap(dx, dy) {
        // Place the dragged rect first, then re-place every other widget
        // top-to-bottom from its ORIGINAL spot, pushing down past any
        // already-placed rect it collides with. Deterministic, no loops.
        const placed = [{ x: dx, y: dy, w: wrapperW, h: wrapperH }];
        for (const o of snapOthers) {
          const r = { x: o.x, y: o.y, w: o.w, h: o.h };
          let hit = placed.find(p => rectsIntersect(p, r));
          let guard = 0;
          while (hit && guard++ < 30) {
            r.y = hit.y + hit.h + SNAP_GAP;
            hit = placed.find(p => rectsIntersect(p, r));
          }
          placed.push(r);
          if (o.cur !== r.y) { o.el.style.top = r.y + 'px'; o.cur = r.y; }
        }
      }

      // rAF-coalesce moves so we never write style more than once per frame.
      let rafId = 0;
      let pending = null;
      function flush() {
        rafId = 0;
        if (!pending) return;
        wrapper.style.left = pending.x + 'px';
        wrapper.style.top  = pending.y + 'px';
        if (snapOthers) resolveSnap(pending.x, pending.y);
        pending = null;
      }
      function onMove(ev) {
        const nx = Math.max(0, Math.min(ev.clientX - startX, maxX));
        const ny = Math.max(0, ev.clientY - startY);
        pending = { x: nx, y: ny };
        if (!rafId) rafId = requestAnimationFrame(flush);
      }
      function onUp() {
        if (rafId) { cancelAnimationFrame(rafId); flush(); }
        if (island) island.classList.remove('dragging-active');
        update(prev => {
          const wp = { ...prev.widgetPositions, [linkId]: { x: wrapper.offsetLeft, y: wrapper.offsetTop } };
          // Snap mode moved neighbours too — commit them in the same write.
          if (snapOthers) {
            for (const o of snapOthers) {
              const id = o.el.dataset.linkId;
              if (id) wp[id] = { x: o.el.offsetLeft, y: o.el.offsetTop };
            }
          }
          return { ...prev, widgetPositions: wp };
        });
        if (snapOthers) snapOthers.forEach(o => o.el.classList.remove('snap-push'));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }, [canvasRef, update, snapRef]);

  return makeDraggable;
}

// ── Profile Card ──
// `children` (when provided) renders inside the same .profile-col rail
// after the action buttons — used by the cream layout to slot the
// QuickLog trackers under "Sort". The `--with-rail` modifier widens
// the column so the trackers stack vertically without being clipped.
function ProfileCard({ profile, S, update, handle, onSaveName, onSaveTagline, onUploadPhoto, onAddWidget, onSortWidgets, onSnapFill, onToggleSnap, onNavigateSettings, visionState, children }) {
  // OVR replaces the old Lvl badge (F5 Sprint 3). Read from S.ratings
  // — which is refreshed by useRatings on a 1.5s debounce. Falls back
  // to 1 if no rating computed yet (fresh user) so the chip never
  // shows an empty value.
  const ovr = S?.ratings?.ovr || 1;
  const prestige = ovrTier(ovr);
  return (
    <div className={`profile-col${children ? ' profile-col--with-rail' : ''}`}>
      <div className="card profile-card">
        <div className="profile-photo-wrap" onClick={() => document.getElementById('photoFileInput').click()}>
          {profile.photo
            ? <img className="profile-photo" src={profile.photo} alt="Profile" style={{ display: 'block' }} />
            : (
              <div className="profile-photo-placeholder" id="profilePlaceholder" style={{ display: 'flex' }}>
                <span><Icon name="image" size={20} strokeWidth={1.5} /></span><p>photo</p>
              </div>
            )
          }
          <div className="profile-edit-overlay">Edit</div>
        </div>
        <input type="file" id="photoFileInput" accept="image/*" style={{ display: 'none' }} onChange={onUploadPhoto} />
        <div className="profile-info-area">
          {/* Name + OVR badge share a row. OVR replaced Lvl (F5 Sprint 3)
              — more informative number (1-99 with category breakdown
              one tap away in the RatingsPanel below). Tooltip surfaces
              the same vision XP context the old Lvl badge had. */}
          <div className="profile-name-row">
            <input
              className="profile-name-input"
              type="text"
              placeholder="Your Name"
              defaultValue={profile.name}
              onChange={e => onSaveName(e.target.value)}
            />
            {handle && <span className="profile-handle" title={`@${handle}`}>@{handle}</span>}
            <span
              className={`profile-level-badge ovr-chip ovr-tier-${prestige.key}`}
              title={visionState
                ? `OVR ${ovr}/99 · ${prestige.label} tier · ${visionState.unlockedCount}/${visionState.totalCount} visions unlocked`
                : `OVR ${ovr}/99 · ${prestige.label} tier`}
            >
              OVR {ovr}
            </span>
          </div>
          <input
            className="profile-tagline-input"
            type="text"
            placeholder="tagline…"
            defaultValue={profile.tagline}
            onChange={e => onSaveTagline(e.target.value)}
          />
        </div>
      </div>

      {/* Ratings breakdown — OVR + 4 category tiles + tap-to-explain
          modal. Compact variant matches the profile rail's width. */}
      <RatingsPanel S={S} update={update} compact />

      <motion.button className="hub-action-btn add-widget" onClick={onAddWidget}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}><Icon name="plus" size={14} /> Add widget</motion.button>
      <motion.button className="hub-action-btn sort-widgets" onClick={onSortWidgets}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}><Icon name="layout-grid" size={13} /> Sort</motion.button>
      {onSnapFill && (
        <motion.button className="hub-action-btn sort-widgets" onClick={onSnapFill}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}><Icon name="layout-dashboard" size={13} /> Snap to fill</motion.button>
      )}
      {onToggleSnap && (
        <motion.button className={`hub-action-btn sort-widgets hub-snap-toggle${S.hubSnap ? ' is-on' : ''}`} onClick={onToggleSnap}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} aria-pressed={!!S.hubSnap}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>
          <Icon name="move" size={13} /> Snap drag <span className={`hub-snap-pip${S.hubSnap ? ' is-on' : ''}`}>{S.hubSnap ? 'ON' : 'OFF'}</span>
        </motion.button>
      )}
      <motion.button className="hub-action-btn settings-mobile-btn" onClick={onNavigateSettings}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}><Icon name="settings" size={13} /> Settings</motion.button>
      {children}
    </div>
  );
}

// ── Widget Canvas (imperative DOM approach) ──
export default function HubSection({ S, update, active, onOpenModal, onOpenWaitlist, onNavigateSettings, onNavigateTrack, onShowCoinToast, onCoachAct, visionState, userId, onUpgrade, onNavigate }) {
  const canvasRef = useRef(null);
  // Snap toggle lives in the Actions module; the drag engine reads the
  // live value through a ref so mid-drag state is never stale.
  const snapRef = useRef(false);
  snapRef.current = !!S.hubSnap;
  const makeDraggable = useWidgetDrag(canvasRef, S, update, snapRef);
  const { hasPro } = useSubscriptionContext();
  const ownHandle = useOwnHandle(userId);

  // React islands inside the imperative canvas — Vitals / Macros /
  // Calories reuse the mobile widget bodies rather than duplicating
  // their logic as HTML strings. hwId → { root, type }. Mounted by
  // renderCanvas, re-rendered with fresh props by the effect below,
  // unmounted before every canvas rebuild.
  const reactRootsRef = useRef(new Map());
  // Running top of the widget z-stack — click-to-front bumps this and
  // stamps the widget with the new value (persisted in S.widgetZ).
  const topZRef = useRef(10);
  // Which widget the user is actively resizing (grip held). Only that
  // widget's ResizeObserver reflows neighbours in snap mode — so the
  // neighbour width writes we make don't cascade into their observers.
  const activeResizeRef = useRef(null);
  // Which grip is held — the reflow needs the direction, not just the fact.
  const activeSideRef = useRef(null);
  function setHubWidgetCount(id, n) {
    update(prev => ({ ...prev, hubWidgets: (prev.hubWidgets || []).map(w => w.id === id ? { ...w, count: n } : w) }));
  }
  function reactWidgetEl(hw) {
    switch (hw.type) {
      case 'vitals':   return <VitalsBody S={S} update={update} />;
      case 'macros':   return <MacrosBody S={S} userId={userId} navigate={onNavigate} />;
      case 'calories': return <BurnBody S={S} update={update} userId={userId} />;
      case 'savings-pots': return <SavingsPotsBody S={S} count={hw.count || 1} onSetCount={n => setHubWidgetCount(hw.id, n)} navigate={onNavigate} />;
      case 'savings-projection': return <SavingsProjectionBody S={S} navigate={onNavigate} />;
      case 'body':          return <BodyBody S={S} update={update} navigate={onNavigate} />;
      case 'mood':          return <MoodBody S={S} update={update} navigate={onNavigate} />;
      case 'subscriptions': return <SubscriptionsBody S={S} navigate={onNavigate} />;
      case 'market':        return <MarketBody S={S} update={update} hasPro={hasPro} />;
      case 'news':          return <NewsBody S={S} update={update} hasPro={hasPro} />;
      case 'trading':       return (TradingBody && tradingWidgetAvailable())
        ? <Suspense fallback={null}><TradingBody /></Suspense> : null;
      default:         return null;
    }
  }
  const reactWidgetElRef = useRef(reactWidgetEl);
  reactWidgetElRef.current = reactWidgetEl;

  // Keep mounted islands in sync with state — the canvas only rebuilds
  // on structural changes (widget list, positions), not on every S
  // mutation (e.g. logging a vital), so re-render the roots directly.
  useEffect(() => {
    for (const [id, { root }] of reactRootsRef.current) {
      const hw = (S.hubWidgets || []).find(w => w.id === id) || { id, type: reactRootsRef.current.get(id).type };
      root.render(reactWidgetElRef.current(hw));
    }
  }, [S, userId]);

  // Right-click a hub module → toggle its background transparency.
  // syncKey re-applies after the imperative widget canvas re-renders
  // (S.links change) so the attribute isn't lost.
  const moduleMenu = useHubModuleMenu({
    S, update,
    syncKey: `${S.links?.length || 0}:${active}`,
  });

  // Live habit-timer ticks for Habits hub widgets — update the timer
  // text + progress bar widths in place each second (no canvas rebuild,
  // so drag/positions are preserved). Reads latest habits via a ref.
  const stateRef = useRef(S);
  stateRef.current = S;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      const habits = stateRef.current.habits || [];
      if (!habits.length) return;
      const now = Date.now();
      const byId = {};
      habits.forEach(h => { byId[h.id] = h; });
      document.querySelectorAll('#widgetCanvas [data-habit-timer]').forEach(el => {
        const h = byId[el.getAttribute('data-habit-timer')];
        if (h && h.startTime) el.textContent = fmtHabitElapsed(now - h.startTime);
      });
      document.querySelectorAll('#widgetCanvas [data-habit-bar]').forEach(el => {
        const h = byId[el.getAttribute('data-habit-bar')];
        if (!h || !h.startTime) return;
        const elapsed = now - h.startTime;
        const { target } = habitTarget(h, elapsed);
        el.style.width = Math.max(0, Math.min(100, target ? (elapsed / target) * 100 : 100)) + '%';
      });
    }, 1000);
    return () => clearInterval(id);
  }, [active]);

  // Click-through: any element inside the imperative canvas tagged
  // with [data-go-to="<section>"] jumps to that page. Lets habit/trip/
  // leaderboard rows act as navigational shortcuts without each render
  // function having to wire its own React handler. Capture-phase, but
  // we ignore clicks on the drag handle, delete button, or any anchor
  // so the existing affordances still win.
  useEffect(() => {
    if (!active || !onNavigate) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handler = (e) => {
      if (e.defaultPrevented) return;
      const skip = e.target.closest('a, button, [data-drag], .link-del-btn, .widget-drag-handle');
      if (skip) return;
      const row = e.target.closest('[data-go-to]');
      if (!row || !canvas.contains(row)) return;
      const dest = row.getAttribute('data-go-to');
      if (dest) onNavigate(dest);
    };
    canvas.addEventListener('click', handler);
    return () => canvas.removeEventListener('click', handler);
  }, [active, onNavigate]);

  // Pro-gated: the operator-console layout (HubOsLayout) renders for
  // EITHER dark-os OR cream-pro when the user has Pro. Free users
  // never see it. The two themes share the same panel/grid structure
  // but keep their own palettes (dark for dark-os, cream for cream-pro)
  // via the data-hub-os attribute + theme-scoped token overrides.
  const isOsLayout = hasPro && isOsLayoutTheme(S.theme);

  function handleUploadPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = ev => {
      update(prev => ({ ...prev, profile: { ...prev.profile, photo: ev.target.result } }));
    };
    r.readAsDataURL(file);
  }

  function handleSortWidgets() {
    // Sort re-flows widgets into the grid AND resets any custom sizes
    // the user dragged the widgets to (per the resize feature).
    update(prev => ({ ...prev, widgetPositions: {}, widgetSizes: {}, notepadPos: null }));
  }

  function handleToggleSnap() {
    update(prev => ({ ...prev, hubSnap: !prev.hubSnap }));
  }

  // Snap-to-fill: pack every widget into a balanced weighted-row grid
  // that uses the full canvas area. Heavier widgets (notepad, GitHub,
  // take proportionally more horizontal space; row heights are
  // equal. Read-only over current S — writes positions + sizes once.
  const WIDGET_WEIGHT = {
    notepad: 2.6,
    github:  2.4,
    leaderboard: 1.6,
    holidays: 1.6,
    habits:   1.6,
    link:     1.0,
  };
  function handleSnapToFill() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Gather every widget currently on the canvas. ghUser links count
    // as 'github' (richer body), plain links as 'link'.
    const items = [];
    for (const l of (S.links || [])) {
      const type = l.ghUser ? 'github' : 'link';
      items.push({ id: l.id, weight: WIDGET_WEIGHT[type] });
    }
    for (const h of (S.hubWidgets || [])) items.push({ id: h.id, weight: WIDGET_WEIGHT[h.type] || 1.6 });
    // Notepad lives outside hubWidgets — included only if visible.
    if (S.notepadText || S.notepadPos || S._showNotepad) {
      items.push({ id: '__notepad__', weight: WIDGET_WEIGHT.notepad });
    }
    if (!items.length) return;

    // Switch canvas to absolute-positioned mode (matches drag flow).
    canvas.style.cssText = 'position:relative;flex:1;min-height:calc(100vh - 180px);display:block;';
    const cw = canvas.clientWidth;
    const ch = Math.max(420, canvas.clientHeight);

    // Pick rows so cells are roughly square (cap 4 rows for legibility).
    const n = items.length;
    const rowCount = Math.min(4, Math.max(1, Math.round(Math.sqrt(n * (ch / cw)))));

    // Greedy least-loaded-bucket distribution — gives each row a
    // similar total weight so widths balance across rows.
    const sorted = items.slice().sort((a, b) => b.weight - a.weight);
    const rows = Array.from({ length: rowCount }, () => ({ items: [], total: 0 }));
    for (const it of sorted) {
      let target = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].total < rows[target].total) target = i;
      }
      rows[target].items.push(it);
      rows[target].total += it.weight;
    }

    const gap = 12;
    const rowH = Math.floor((ch - gap * (rowCount - 1)) / rowCount);

    const newPositions = {};
    const newSizes = {};
    let y = 0;
    let notepadW = null, notepadPos = null;
    for (const row of rows) {
      if (!row.items.length) { y += rowH + gap; continue; }
      const totalGap = gap * (row.items.length - 1);
      const usable = cw - totalGap;
      let x = 0;
      row.items.forEach((it, i) => {
        const w = i === row.items.length - 1
          ? (cw - x)                                              // last fills remainder (avoid sub-pixel gap)
          : Math.max(220, Math.floor((it.weight / row.total) * usable));
        if (it.id === '__notepad__') {
          notepadPos = { x, y };
          notepadW = w;
        } else {
          newPositions[it.id] = { x, y };
          newSizes[it.id] = { w, h: rowH };
        }
        x += w + gap;
      });
      y += rowH + gap;
    }

    update(prev => ({
      ...prev,
      widgetPositions: { ...(prev.widgetPositions || {}), ...newPositions },
      widgetSizes:     { ...(prev.widgetSizes || {}),     ...newSizes     },
      ...(notepadPos ? { notepadPos, notepadWidth: notepadW } : {}),
    }));
  }

  // Make a widget wrapper user-resizable: apply any saved size, show a
  // resize grip (CSS resize: both), and commit the new size to
  // S.widgetSizes ONLY when the user actually drags the grip. We detect
  // that by a pointerdown landing in the bottom-right grip zone, then
  // read the size on pointerup — so content-driven layout changes (e.g.
  // a GitHub widget's stats loading) never get mistaken for a resize.
  const makeResizable = useCallback((wrapper, id) => {
    const saved = (S.widgetSizes || {})[id];
    if (saved) {
      if (saved.w) wrapper.style.width = saved.w + 'px';
      if (saved.h) wrapper.style.height = saved.h + 'px';
    }
    // Apply any saved stacking order + track the running top so a fresh
    // click always lands above every sibling (see click-to-front below).
    const savedZ = (S.widgetZ || {})[id];
    if (savedZ) { wrapper.style.zIndex = savedZ; topZRef.current = Math.max(topZRef.current, savedZ); }

    // Custom grips on all edges (below) replace the native corner grip,
    // so the resize affordance matches on left / right / bottom.
    wrapper.style.resize = 'none';
    wrapper.style.overflow = 'hidden';
    // The default link wrapper is clamped 280–360px wide; lift the cap
    // and set floors so resize can grow/shrink freely.
    wrapper.style.maxWidth = 'none';
    wrapper.style.minWidth = '220px';
    wrapper.style.minHeight = '90px';

    // ── Click-to-front ──
    // A pointerdown anywhere on the widget raises it above overlapping
    // siblings. Instant in the DOM; the new order persists to S.widgetZ
    // (debounced by the save pipeline, so rapid clicks coalesce).
    wrapper.addEventListener('pointerdown', () => {
      const next = ++topZRef.current;
      wrapper.style.zIndex = next;
      update(prev => {
        if ((prev.widgetZ || {})[id] === next) return prev;
        return { ...prev, widgetZ: { ...(prev.widgetZ || {}), [id]: next } };
      });
    });

    // Per-gesture neighbour snapshot, used by the snap-resize reflow so
    // shrinking is measured from each neighbour's ORIGINAL rect (and
    // springs back cleanly when the widget is pulled small again).
    // Shared by all three custom edge grips below.
    let resizeNeighbours = null;
    // Snap ON → snapshot neighbours and arm the reflow observer. Only the
    // rightward-growth grip ('r') arms this — left/bottom never reflow.
    function armSnap() {
      if (!snapRef?.current) return;
      resizeNeighbours = [];
      canvasRef.current?.querySelectorAll('.widget-wrapper').forEach(w2 => {
        if (w2 === wrapper) return;
        w2.classList.add('snap-push');
        resizeNeighbours.push({ el: w2, x0: w2.offsetLeft, y0: w2.offsetTop, w0: w2.offsetWidth, h0: w2.offsetHeight });
      });
      activeResizeRef.current = id;
    }
    function commitResize() {
      const w = wrapper.offsetWidth, h = wrapper.offsetHeight;
      activeResizeRef.current = null;
      activeSideRef.current = null;
      const nbs = resizeNeighbours;
      resizeNeighbours = null;
      update(prev => {
        const sizes = { ...(prev.widgetSizes || {}) };
        const pos = { ...(prev.widgetPositions || {}) };
        sizes[id] = { w, h };
        pos[id] = { x: wrapper.offsetLeft, y: wrapper.offsetTop };
        if (nbs) {
          for (const nb of nbs) {
            nb.el.classList.remove('snap-push');
            const nid = nb.el.dataset.linkId;
            if (!nid) continue;
            pos[nid] = { x: nb.el.offsetLeft, y: nb.el.offsetTop };
            sizes[nid] = { w: nb.el.offsetWidth, h: nb.el.offsetHeight };
          }
        }
        return { ...prev, widgetSizes: sizes, widgetPositions: pos };
      });
    }

    // ── Snap reflow ──
    // While a grip is held with snap ON, the widgets being grown into
    // MOVE first and only give up size once they are against the
    // perimeter. The old behaviour shrank the neighbour immediately,
    // so a row lost total width every time you nudged one widget wider
    // even when there was empty canvas to slide into.
    //
    // Direction comes from the grip, and the geometry lives in
    // lib/hub/reflow.js so it can be asserted on without a browser.
    // Fires continuously because resizing mutates the box every frame.
    const ro = new ResizeObserver(() => {
      if (activeResizeRef.current !== id || !resizeNeighbours) return;
      const side = activeSideRef.current;
      if (!side) return;

      const moving = { id, x: wrapper.offsetLeft, y: wrapper.offsetTop,
                       w: wrapper.offsetWidth, h: wrapper.offsetHeight };
      // Neighbours are measured from their ORIGINAL rects so pulling the
      // widget small again springs them back rather than ratcheting.
      const others = resizeNeighbours.map(nb => ({
        id: nb.el.dataset.linkId || nb.el, el: nb.el,
        x: nb.x0, y: nb.y0, w: nb.w0, h: nb.h0,
      }));

      const canvasW = canvasRef.current?.clientWidth ?? null;
      const axis = (side === 'b' || side === 't') ? 'y' : 'x';
      const dir  = (side === 'l' || side === 't') ? -1 : 1;
      // Three of the four directions have a wall. Downward is the
      // exception: the canvas grows, so a push down never needs to
      // shrink anyone and passes a null limit.
      const limit = side === 'r' ? canvasW
                  : side === 'l' ? 0
                  : side === 't' ? 0
                  : null;

      const { ok, moved, maxExtent } = reflow(moving, others, axis, dir, {
        limit, min: axis === 'x' ? MIN_W : MIN_H, gap: REFLOW_GAP,
      });

      // Refused: a neighbour would drop below the size at which its own
      // contents stop fitting. Clamp the drag instead of letting that
      // happen — the promise is that a shrunken widget stays readable.
      if (!ok && maxExtent != null) {
        if (side === 'r') wrapper.style.width = Math.max(MIN_W, maxExtent - moving.x) + 'px';
        else if (side === 'l') {
          const right = moving.x + moving.w;
          wrapper.style.left = maxExtent + 'px';
          wrapper.style.width = Math.max(MIN_W, right - maxExtent) + 'px';
        } else if (side === 't') {
          const bottom = moving.y + moving.h;
          wrapper.style.top = maxExtent + 'px';
          wrapper.style.height = Math.max(MIN_H, bottom - maxExtent) + 'px';
        }
        return;
      }

      for (const o of others) {
        const r = moved.get(o.id);
        if (!r) {
          // Untouched this frame — restore its original rect so a
          // neighbour freed by shrinking the widget doesn't stay shoved.
          o.el.style.left = o.x + 'px';
          o.el.style.top = o.y + 'px';
          o.el.style.width = o.w + 'px';
          o.el.style.height = o.h + 'px';
          continue;
        }
        o.el.style.left = r.x + 'px';
        o.el.style.top = r.y + 'px';
        o.el.style.width = r.w + 'px';
        o.el.style.height = r.h + 'px';
      }
    });
    ro.observe(wrapper);

    // ── Edge resize grips (custom, matching design on all three sides) ──
    // Only meaningful once a widget is absolutely placed. Each grip is a
    // thin rail with a centred pill (see .widget-resize-* in index.css):
    //   left  → pins the RIGHT edge, grows/shrinks leftward
    //   right → pins the LEFT edge, grows/shrinks rightward (snap reflow)
    //   bottom→ pins the TOP edge, grows/shrinks downward
    if (wrapper.style.position === 'absolute') {
      const minW = 220, minH = 90;
      const canvasRect = () => canvasRef.current.getBoundingClientRect();
      const addGrip = (side) => {
        if (wrapper.querySelector('.widget-resize-' + side)) return;
        const grip = document.createElement('div');
        grip.className = 'widget-resize widget-resize-' + side;
        wrapper.appendChild(grip);
        grip.addEventListener('pointerdown', e => {
          if (e.button !== undefined && e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          const startLeft = wrapper.offsetLeft, startTop = wrapper.offsetTop;
          const rightAnchor = startLeft + wrapper.offsetWidth; // for 'l'
          const bottomAnchor = startTop + wrapper.offsetHeight; // for 't'
          try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          activeSideRef.current = side;
          armSnap(); // every direction reflows now, not just rightward
          function mv(ev) {
            if (side === 'l') {
              const newLeft = Math.max(0, Math.min(ev.clientX - canvasRect().left, rightAnchor - minW));
              wrapper.style.left = newLeft + 'px';
              wrapper.style.width = (rightAnchor - newLeft) + 'px';
            } else if (side === 'r') {
              wrapper.style.width = Math.max(minW, ev.clientX - canvasRect().left - startLeft) + 'px';
            } else if (side === 't') {
              // Mirror of 'l': the bottom edge is anchored and the top
              // travels, so height is derived rather than measured from
              // the pointer. bottomAnchor is captured once, so anything
              // that moves the widget mid-gesture would inflate the
              // height — the handle is inert while this rail exists, and
              // the clamp is the second line of defence.
              const newTop = Math.max(0, Math.min(ev.clientY - canvasRect().top, bottomAnchor - minH));
              wrapper.style.top = newTop + 'px';
              const canvasH = canvasRef.current?.clientHeight || Infinity;
              wrapper.style.height = Math.min(bottomAnchor - newTop, canvasH) + 'px';
            } else { // 'b'
              wrapper.style.height = Math.max(minH, ev.clientY - canvasRect().top - startTop) + 'px';
            }
          }
          function up() {
            document.removeEventListener('pointermove', mv);
            document.removeEventListener('pointerup', up);
            commitResize();
          }
          document.addEventListener('pointermove', mv);
          document.addEventListener('pointerup', up);
        });
      };
      // Top rail only exists with snap ON. Without snap it would just
      // be a second way to resize that also steals the drag handle.
      //
      // When it IS present it takes the whole bar and the handle beneath
      // stops receiving pointers. Sharing the bar meant a pointerdown in
      // the lower half started a DRAG while a resize was live, and the
      // resize measures height from the bottom edge captured at
      // pointerdown — so the height grew as the drag carried the widget
      // upward, ending as tall as the canvas. Making the two gestures
      // mutually exclusive removes that combination entirely.
      addGrip('l'); addGrip('r'); addGrip('b');
      const dragHandle = wrapper.querySelector('[data-drag]');
      if (snapRef?.current) {
        addGrip('t');
        wrapper.classList.add('has-top-grip');
        if (dragHandle) dragHandle.style.pointerEvents = 'none';
      } else {
        wrapper.querySelector('.widget-resize-t')?.remove();
        wrapper.classList.remove('has-top-grip');
        if (dragHandle) dragHandle.style.pointerEvents = '';
      }
    }
  // S.hubSnap, not just snapRef: the ref's identity never changes, so
  // with only the ref in here the top grip was created (or removed)
  // whenever some UNRELATED dependency happened to change, and not when
  // the user actually toggled snap. That is why the top edge appeared
  // dead until something else forced a re-render.
  }, [S.widgetSizes, S.widgetZ, S.hubSnap, update, snapRef]);

  // Render all widgets imperatively into the canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Tear down React islands before wiping their DOM.
    for (const [, { root }] of reactRootsRef.current) {
      try { root.unmount(); } catch { /* already gone */ }
    }
    reactRootsRef.current.clear();
    canvas.innerHTML = '';

    const hasPositions = Object.keys(S.widgetPositions).length > 0;

    if (hasPositions) {
      canvas.style.cssText = 'position:relative;flex:1;min-height:calc(100vh - 180px);display:block;';
    } else {
      // Columns deliberately NOT set here — CSS owns them (see
      // #widgetCanvas in index.css). auto-fill with a 300px minimum only
      // ever fitted two across in the OS layout's middle column, so a
      // fourth widget started a new row while a third would have fitted.
      // Leaving it to CSS also means the count reacts to the canvas
      // being resized, which an inline style set once at render cannot.
      canvas.style.cssText = 'flex:1;display:grid;gap:14px;align-content:start;align-items:start;';
    }

    // Links
    S.links.forEach(link => {
      const wrapper = document.createElement('div');
      wrapper.className = 'widget-wrapper' + (hasPositions ? '' : ' snapping');
      wrapper.dataset.linkId = link.id;

      if (hasPositions) {
        const pos = S.widgetPositions[link.id];
        wrapper.style.cssText = `position:absolute;min-width:280px;max-width:360px;width:300px;user-select:none;left:${pos ? pos.x : 0}px;top:${pos ? pos.y : 0}px;`;
      }

      const island = document.createElement('div');
      island.className = 'card link-island';
      island.id = 'island-' + link.id;

      // Tinted icon chip uses the link's brand colour as the accent ring;
      // the card surface itself stays neutral so it reads as a sibling
      // of the surrounding OS panels rather than a poster.
      const c = link.color || '#1a7a4a';

      const isGH = !!link.ghUser;
      const eyebrow = isGH ? 'WIDGET · GITHUB' : 'WIDGET · LINK';
      const host = link.url.replace(/^https?:\/\//, '').split('/')[0];
      const handle = isGH ? '@' + link.ghUser : host;
      // Live-data Our Apps presets — render a hero-image slot the
      // deferred fetcher (loadLivePreviewIntoLink) fills in after mount.
      const presetMeta = link.presetId ? APP_PRESETS.find(p => p.id === link.presetId) : null;
      const isLivePreset = !!(presetMeta && presetMeta.live);
      const bodyHtml = isGH
        ? `<div class="link-island-body"><div class="gh-skeleton" id="gh-body-${link.id}"><div class="sk-stats"><div class="sk-stat"></div><div class="sk-stat"></div><div class="sk-stat"></div></div><div class="sk-repo"></div><div class="sk-repo"></div><div class="sk-repo"></div></div></div>`
        : isLivePreset
          ? `<div class="link-island-body link-island-live" id="lp-body-${link.id}"><div class="link-island-live-hero">Loading…</div>${link.notes ? `<div class="link-island-notes">${escapeHtml(link.notes)}</div>` : ''}</div>`
          // escapeHtml, like the live-preset branch one line up. Notes
          // went into innerHTML raw here, so `<img src=x onerror=…>` in
          // a link's notes executed on every hub render — and notes ride
          // in user_data.state, which syncs across that account's
          // devices and is read back on every load.
          : (link.notes ? `<div class="link-island-body"><div class="link-island-notes">${escapeHtml(link.notes)}</div></div>` : '');

      island.innerHTML = `
        <div class="widget-drag-handle" data-drag="${escapeHtml(link.id)}"><span></span></div>
        <div class="link-island-header">
          <div class="link-island-icon" style="background:${escapeHtml(c)}1a;border-color:${escapeHtml(c)}55;color:${escapeHtml(c)};">${escapeHtml(link.icon)}</div>
          <div class="link-island-info">
            <span class="link-island-name">${escapeHtml(eyebrow)}</span>
            <span class="link-island-url">${escapeHtml(handle)}</span>
          </div>
        </div>
        <div class="link-island-brand">
          <div class="link-island-brand-info">
            <div class="link-island-brand-title">${escapeHtml(link.name)}</div>
            <div class="link-island-brand-host">${escapeHtml(host)}</div>
          </div>
          <div class="link-island-actions">
            <a class="link-open-btn" href="${safeUrl(link.url)}" target="_blank" rel="noreferrer" style="color:${escapeHtml(c)};">Open ↗</a>
            <button class="link-del-btn" data-del-link="${escapeHtml(link.id)}">✕</button>
          </div>
        </div>
        ${bodyHtml}
      `;

      // Delete handler
      island.querySelector('[data-del-link]')?.addEventListener('click', e => {
        e.stopPropagation();
        update(prev => ({ ...prev, links: prev.links.filter(l => l.id !== link.id), widgetPositions: (() => { const p = { ...prev.widgetPositions }; delete p[link.id]; return p; })() }));
      });

      wrapper.appendChild(island);
      canvas.appendChild(wrapper);
      makeDraggable(wrapper, link.id);
      makeResizable(wrapper, link.id);

      if (isGH) loadGHIsland(link, S.ghCache, update);
      else if (isLivePreset) loadLivePreviewIntoLink(link.id, link.url);
    });

    // Hub content widgets (Habits / Holidays) — added via the Add-Widget
    // picker, stored in S.hubWidgets. Same draggable/resizable island
    // shell as links. Habit timers tick via the interval effect below
    // (targeted DOM updates, no canvas rebuild).
    (S.hubWidgets || []).forEach(hw => {
      const wrapper = document.createElement('div');
      wrapper.className = 'widget-wrapper' + (hasPositions ? '' : ' snapping');
      wrapper.dataset.linkId = hw.id;
      if (hasPositions) {
        const pos = S.widgetPositions[hw.id];
        wrapper.style.cssText = `position:absolute;min-width:280px;max-width:360px;width:300px;user-select:none;left:${pos ? pos.x : 40}px;top:${pos ? pos.y : 40}px;`;
      }

      const island = document.createElement('div');
      island.className = 'card link-island';
      island.id = 'island-' + hw.id;
      const META = {
        habits:      { eyebrow: 'WIDGET · HABITS',      icon: '◷', title: 'Habits',      sub: 'Longest streaks',   body: () => habitsWidgetHtml(S) },
        holidays:    { eyebrow: 'WIDGET · HOLIDAYS',    icon: '✈', title: 'Holidays',    sub: 'Upcoming trips',    body: () => holidaysWidgetHtml(S) },
        // Leaderboard is rendered as a placeholder shell; live data is
        // fetched async after mount (we don't have the leaderboard data
        // synchronously here). The body fills in via fetch + DOM patch.
        leaderboard: { eyebrow: 'WIDGET · LEADERBOARD', icon: '⊿', title: 'Leaderboard', sub: 'Friends · all-time', body: () => `<div class="hub-widget-empty" data-lb-host="${hw.id}">Loading leaderboard…</div>` },
        // Vitals / Macros / Calories are interactive React components
        // shared with the mobile hub — rendered as React islands into
        // hosts the mount pass below picks up (see reactRootsRef).
        vitals:      { eyebrow: 'WIDGET · VITALS',      icon: '◐', title: 'Vitals',      sub: 'Weight · sleep · HR', body: () => `<div data-react-widget="vitals"></div>` },
        macros:      { eyebrow: 'WIDGET · MACROS',      icon: '◑', title: 'Macros',      sub: 'Today · net kcal',    body: () => `<div data-react-widget="macros"></div>` },
        calories:    { eyebrow: 'WIDGET · BURN',        icon: '◔', title: 'Calories Burned', sub: 'Activity · net',  body: () => `<div data-react-widget="calories"></div>` },
        'savings-pots':       { eyebrow: 'WIDGET · SAVINGS',    icon: '◒', title: 'Savings pots', sub: 'Progress',      body: () => `<div data-react-widget="savings-pots"></div>` },
        'savings-projection': { eyebrow: 'WIDGET · PROJECTION', icon: '⌁', title: 'Projection',   sub: 'Net · balance', body: () => `<div data-react-widget="savings-projection"></div>` },
        'trading':            { eyebrow: 'WIDGET · TRADING',    icon: '↗', title: 'Trading',      sub: 'Agents · P/L',  body: () => `<div data-react-widget="trading"></div>` },
        'market':             { eyebrow: 'WIDGET · MARKET',     icon: '↗', title: 'Market',       sub: 'Delayed quotes', body: () => `<div data-react-widget="market"></div>` },
        'news':               { eyebrow: 'WIDGET · NEWS',       icon: '❑', title: 'News',         sub: 'Today\u2019s headlines', body: () => `<div data-react-widget="news"></div>` },
        body:          { eyebrow: 'WIDGET · BODY', icon: '◍', title: 'Body',          sub: '7-day avg · goal',      body: () => `<div data-react-widget="body"></div>` },
        mood:          { eyebrow: 'WIDGET · MOOD', icon: '☺', title: 'Mood',          sub: 'Today · 8-week map',    body: () => `<div data-react-widget="mood"></div>` },
        subscriptions: { eyebrow: 'WIDGET · BILLS', icon: '↻', title: 'Subscriptions', sub: 'Monthly burn · renewals', body: () => `<div data-react-widget="subscriptions"></div>` },
      };
      const meta = META[hw.type] || META.habits;
      const { eyebrow, icon, title, sub } = meta;
      const body = meta.body();

      island.innerHTML = `
        <div class="widget-drag-handle" data-drag="${escapeHtml(hw.id)}"><span></span></div>
        <div class="link-island-header">
          <div class="link-island-icon" style="background:rgba(var(--em-rgb),.10);border-color:rgba(var(--em-rgb),.32);color:var(--em);">${escapeHtml(icon)}</div>
          <div class="link-island-info">
            <span class="link-island-name">${escapeHtml(eyebrow)}</span>
            <span class="link-island-url">${escapeHtml(sub)}</span>
          </div>
          <div class="link-island-actions">
            <button class="link-del-btn" data-del-hw="${escapeHtml(hw.id)}">✕</button>
          </div>
        </div>
        <div class="link-island-brand">
          <div class="link-island-brand-info">
            <div class="link-island-brand-title">${escapeHtml(title)}</div>
          </div>
        </div>
        <div class="link-island-body hub-widget-body">${body}</div>
      `;

      island.querySelector('[data-del-hw]')?.addEventListener('click', e => {
        e.stopPropagation();
        update(prev => ({
          ...prev,
          hubWidgets: (prev.hubWidgets || []).filter(w => w.id !== hw.id),
          widgetPositions: (() => { const p = { ...prev.widgetPositions }; delete p[hw.id]; return p; })(),
        }));
      });

      wrapper.appendChild(island);
      canvas.appendChild(wrapper);
      makeDraggable(wrapper, hw.id);
      makeResizable(wrapper, hw.id);
      if (hw.type === 'leaderboard') loadLeaderboardIntoWidget(hw.id);
      // Mount React-island bodies (vitals / macros / calories).
      const host = island.querySelector('[data-react-widget]');
      if (host) {
        const root = createRoot(host);
        root.render(reactWidgetElRef.current(hw));
        reactRootsRef.current.set(hw.id, { root, type: hw.type });
      }
    });

    // Notepad — show if text exists, position saved, or explicitly shown via _showNotepad flag
    if (S.notepadText || S.notepadPos || S._showNotepad) {
      renderNotepadInCanvas(canvas, S, update, hasPositions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.links, S.hubWidgets, S.holidays, S.habits, S.widgetPositions, S.notepadText, S.notepadPos, S.notepadWidth, S._showNotepad, S.hubSnap]);

  useEffect(() => {
    if (active) renderCanvas();
  }, [active, renderCanvas, isOsLayout]);

  // Tear down any live React islands when HubSection itself unmounts.
  // Deferred a tick — unmounting a root synchronously inside React's
  // own unmount pass triggers a dev warning.
  useEffect(() => () => {
    const roots = [...reactRootsRef.current.values()];
    reactRootsRef.current.clear();
    setTimeout(() => roots.forEach(({ root }) => { try { root.unmount(); } catch { /* gone */ } }), 0);
  }, []);

  // ── Dark OS layout (Pro only) ─────────────────────────────────────────
  if (isOsLayout) {
    return (
      <section id="hub" className={`section${active ? ' active' : ''}`}>
        <HubOsLayout
          S={S}
          update={update}
          canvasRef={canvasRef}
          onAddWidget={() => onOpenModal('addLinkModal')}
          onSort={handleSortWidgets}
          onSnapFill={handleSnapToFill}
          onNavigateSettings={onNavigateSettings}
          onNavigateTrack={onNavigateTrack}
          onShowCoinToast={onShowCoinToast}
          onOpenWaitlist={onOpenWaitlist}
          onCoachAct={onCoachAct}
          onUploadPhoto={handleUploadPhoto}
          onToggleSnap={handleToggleSnap}
          userId={userId}
          onUpgrade={onUpgrade}
        />
      </section>
    );
  }

  // ── Cream (default) layout ────────────────────────────────────────────
  return (
    <section id="hub" className={`section${active ? ' active' : ''}`}>
      <div className="hub-layout" ref={moduleMenu.rootRef} onContextMenu={moduleMenu.onContextMenu}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
        <ProfileCard
          profile={S.profile}
          S={S}
          update={update}
          handle={ownHandle}
          onSaveName={name => update(prev => ({ ...prev, profile: { ...prev.profile, name } }))}
          onSaveTagline={tagline => update(prev => ({ ...prev, profile: { ...prev.profile, tagline } }))}
          onUploadPhoto={handleUploadPhoto}
          onAddWidget={() => onOpenModal('addLinkModal')}
          onSortWidgets={handleSortWidgets}
          onSnapFill={handleSnapToFill}
          onToggleSnap={handleToggleSnap}
          onNavigateSettings={onNavigateSettings}
          visionState={visionState}
        >
          {/* Trackers sit in the left rail, directly under the Sort button.
              On mobile the .profile-col flips to a row and the rail wraps to
              its own line via CSS — see .profile-col--with-rail in index.css. */}
          <QuickLog S={S} update={update} onNavigateTrack={onNavigateTrack} onShowCoinToast={onShowCoinToast} />
        </ProfileCard>
        </motion.div>
        {/* Widget canvas wrapped in a panel shell so the cream hub
            reads as one consistent panel system (Trackers · Widgets ·
            Friends all share the same border/header treatment).
            The inner #widgetCanvas keeps its imperative drag math —
            position:relative is set inline by renderCanvas so the
            wrapper doesn't change the coordinate system. */}
        <div className="hub-canvas-panel">
          <div className="hub-canvas-panel-head">
            <span className="hub-canvas-panel-label">Widgets</span>
            <span className="hub-canvas-panel-meta">Canvas</span>
          </div>
          <div id="widgetCanvas" className="hub-links-col" ref={canvasRef}></div>
        </div>
        {/* Right rail — Sprint 2: friends list + expanded card. Mock
            data for now; Sprint 3 swaps in a real Supabase query.
            Animation + width handled in CSS so widgetCanvas keeps its
            existing flex behaviour and isn't pushed around. */}
        <aside className="hub-right-col">
          <FriendsRail userId={userId} onUpgrade={onUpgrade} />
        </aside>
      </div>
      <AiCoachWidget S={S} update={update} onOpenWaitlist={onOpenWaitlist} onCoachAct={onCoachAct} />
      <CoachBriefPanel S={S} update={update} onCoachAct={onCoachAct} userId={userId} />
      {moduleMenu.menuNode}
    </section>
  );
}

// ── GitHub island loader ──
async function loadGHIsland(link, cache, update) {
  const bodyEl = document.getElementById('gh-body-' + link.id);
  if (!bodyEl) return;
  const data = await fetchGitHub(link.ghUser, cache);
  if (!data || data.user.message) {
    bodyEl.textContent = 'Could not load GitHub data.';
    return;
  }
  const { user, repos } = data;
  const reposHtml = repos.map(r => `
    <a class="gh-repo" href="${r.html_url}" target="_blank">
      <div class="gh-repo-name">${r.name}</div>
      <div class="gh-repo-desc">${r.description || 'No description'}</div>
      <div class="gh-repo-meta">
        ${r.language ? `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:7px;background:var(--gold,#c8970a);display:inline-block;"></span>${r.language}</span>` : ''}
        <span>★ ${r.stargazers_count}</span>
        <span>⑂ ${r.forks_count}</span>
      </div>
    </a>`).join('');

  bodyEl.outerHTML = `
    <div class="link-island-body" id="gh-body-${link.id}">
      <div class="gh-username-form">
        <input id="gh-input-${link.id}" placeholder="Change username…" value="${link.ghUser}">
        <button class="btn btn-primary btn-sm" data-gh-go="${link.id}">Go</button>
      </div>
      <div class="gh-stats">
        <div class="gh-stat"><div class="gh-stat-val">${user.public_repos}</div><div class="gh-stat-lbl">Repos</div></div>
        <div class="gh-stat"><div class="gh-stat-val">${user.followers}</div><div class="gh-stat-lbl">Followers</div></div>
        <div class="gh-stat"><div class="gh-stat-val">${user.following}</div><div class="gh-stat-lbl">Following</div></div>
      </div>
      <div class="gh-repos">${reposHtml}</div>
    </div>
  `;

  // Wire up "Go" button to change GitHub user
  const goBtn = document.querySelector(`[data-gh-go="${link.id}"]`);
  if (goBtn) {
    goBtn.addEventListener('click', () => {
      const input = document.getElementById('gh-input-' + link.id);
      if (!input) return;
      const newUser = input.value.trim();
      if (!newUser) return;
      update(prev => ({
        ...prev,
        links: prev.links.map(l => l.id === link.id ? { ...l, ghUser: newUser, url: `https://github.com/${newUser}` } : l),
        ghCache: (() => { const c = { ...prev.ghCache }; delete c[newUser]; return c; })(),
      }));
    });
  }

  // Update cache
  update(prev => ({ ...prev, ghCache: { ...prev.ghCache, [link.ghUser]: data } }));
}

// Async fetch for the Leaderboard hub widget — friends/all-time top 5,
// patched into the placeholder host span on mount. Read-only summary;
// detailed views live on the dedicated Leaderboard page.
// Async hero-image preview for a live-data preset link. Replaces the
// placeholder slot in #lp-body-{id} once shop-autofill returns
// (cached 24h via fetchAppPreview).
async function loadLivePreviewIntoLink(linkId, url) {
  try {
    const data = await fetchAppPreview(url);
    const body = document.getElementById(`lp-body-${linkId}`);
    if (!body) return;
    const hero = body.querySelector('.link-island-live-hero');
    if (!hero) return;
    if (data && data.imageUrl) {
      hero.outerHTML = `<a class="link-island-live-hero" href="${url}" target="_blank" rel="noreferrer"><img src="${data.imageUrl}" alt="" loading="lazy" onerror="this.style.display='none'"></a>`;
    } else if (data && data.notes) {
      hero.outerHTML = `<div class="link-island-notes">${escapeHtml(data.notes)}</div>`;
    } else {
      // Nothing scrapeable — drop the loading slot so the card collapses cleanly.
      hero.remove();
      if (!body.children.length) body.remove();
    }
  } catch { /* swallow — body keeps its 'Loading…' label which is fine */ }
}

async function loadLeaderboardIntoWidget(hwId) {
  const host = document.querySelector(`[data-lb-host="${hwId}"]`);
  if (!host) return;
  try {
    const { supabase } = await import('../lib/supabase');
    const session = (await supabase.auth.getSession()).data?.session;
    const token = session?.access_token;
    if (!token) { host.textContent = 'Sign in to see the leaderboard.'; return; }
    const res = await fetch('/.netlify/functions/get-leaderboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scope: 'friends', timeframe: 'alltime' }),
    });
    if (!res.ok) { host.textContent = 'Leaderboard unavailable.'; return; }
    const data = await res.json();
    const rows = (data.rows || []).slice(0, 5);
    if (!rows.length) { host.textContent = 'No friends yet — add some to compete.'; return; }
    const { prestigeBadge } = await import('../lib/ratings/prestige');
    host.outerHTML = `<div class="hub-lb-list" data-go-to="leaderboard" role="link" tabindex="0">${rows.map(r => {
      const badge = prestigeBadge(r.prestige);
      const badgeHtml = badge
        ? `<span class="prestige-badge prestige-badge-sm prestige-${badge.band.key}">${badge.text}</span>`
        : '';
      return `
      <div class="hub-lb-row hub-row-go${r.isSelf ? ' is-self' : ''}">
        <span class="hub-lb-rank">${r.rank}</span>
        <span class="hub-lb-name">${escapeHtml(r.username)}</span>
        ${badgeHtml}
        <span class="hub-lb-ovr">${r.ovr}</span>
      </div>`;
    }).join('')}</div>`;
  } catch {
    host.textContent = 'Leaderboard unavailable.';
  }
}

// ── Notepad in canvas ──
let _notepadSaveTimer = null;

function renderNotepadInCanvas(canvas, S, update, hasPositions) {
  if (document.getElementById('notepadWrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'notepad-wrapper' + (hasPositions || S.notepadPos ? '' : ' snapping');
  wrapper.id = 'notepadWrapper';
  wrapper.style.width = (S.notepadWidth || 380) + 'px';

  if (S.notepadPos) {
    wrapper.style.position = 'absolute';
    wrapper.style.left = S.notepadPos.x + 'px';
    wrapper.style.top = S.notepadPos.y + 'px';
  }

  const now = new Date();
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  wrapper.innerHTML = `
    <div class="notepad-island">
      <div class="widget-drag-handle" id="notepadDragHandle"><span></span></div>
      <div class="notepad-header">
        <span class="notepad-header-icon">✎</span>
        <span class="notepad-header-title">NOTEPAD</span>
        <span class="notepad-date">${dateLabel}</span>
        <button class="notepad-clear-btn" id="notepadClearBtn">Clear</button>
        <button class="link-del-btn" id="notepadDelBtn" style="margin-left:4px;">✕</button>
      </div>
      <!-- escapeHtml: being inside a <textarea> is not protection when
           the whole thing is built with innerHTML. Typing
           "</textarea><img src=x onerror=…>" closed the element and ran
           the payload on every hub render, and notepadText persists in
           user_data.state, so it came back on each load and synced to
           the account's other devices. The browser decodes the entities
           back to plain text for the textarea's value, so what the user
           sees and edits is unchanged. -->
      <textarea class="notepad-textarea" id="notepadTextarea" placeholder="Quick notes, tasks for today, things to remember…">${escapeHtml(S.notepadText || '')}</textarea>
      <div class="notepad-footer">
        <span class="notepad-saved-indicator" id="notepadSavedIndicator">Auto-saved</span>
        <span class="notepad-char-count" id="notepadCharCount">${(S.notepadText || '').length} chars</span>
      </div>
    </div>
  `;

  canvas.appendChild(wrapper);

  // Wire textarea
  const ta = wrapper.querySelector('#notepadTextarea');
  ta?.addEventListener('input', () => {
    const cc = document.getElementById('notepadCharCount');
    if (cc) cc.textContent = ta.value.length + ' chars';
    const ind = document.getElementById('notepadSavedIndicator');
    if (ind) { ind.textContent = 'Saving…'; ind.classList.remove('saved'); }
    clearTimeout(_notepadSaveTimer);
    _notepadSaveTimer = setTimeout(() => {
      update(prev => ({ ...prev, notepadText: ta.value }));
      if (ind) { ind.textContent = '✓ Saved'; ind.classList.add('saved'); setTimeout(() => { ind.textContent = 'Auto-saved'; ind.classList.remove('saved'); }, 1600); }
    }, 600);
  });

  // Wire clear button
  const clearBtn = wrapper.querySelector('#notepadClearBtn');
  clearBtn?.addEventListener('click', () => {
    if (!confirm('Clear all notes?')) return;
    if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input')); }
  });

  // Wire delete button
  const delBtn = wrapper.querySelector('#notepadDelBtn');
  delBtn?.addEventListener('click', e => {
    e.stopPropagation();
    update(prev => {
      const next = { ...prev, notepadText: '', notepadPos: null, notepadWidth: null };
      delete next._showNotepad;
      return next;
    });
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    update(prev => ({ ...prev, notepadWidth: wrapper.offsetWidth }));
  });
  ro.observe(wrapper);

  // Drag handle
  const handle = document.getElementById('notepadDragHandle');
  if (!handle) return;
  handle.style.cursor = 'grab';

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    if (wrapper.classList.contains('snapping')) {
      const all = canvas.querySelectorAll('.widget-wrapper, .notepad-wrapper');
      const snapshots = [];
      all.forEach(w => { const r = w.getBoundingClientRect(); snapshots.push({ w, x: r.left, y: r.top }); });
      canvas.style.cssText = 'position:relative;flex:1;min-height:calc(100vh - 180px);display:block;';
      const cr = canvas.getBoundingClientRect();
      snapshots.forEach(({ w, x, y }) => {
        w.classList.remove('snapping');
        const id = w.dataset.linkId;
        if (id) {
          w.style.cssText = `position:absolute;min-width:280px;max-width:360px;width:300px;user-select:none;left:${x - cr.left}px;top:${y - cr.top}px;`;
          update(prev => ({ ...prev, widgetPositions: { ...prev.widgetPositions, [id]: { x: x - cr.left, y: y - cr.top } } }));
        } else {
          w.style.cssText += `;position:absolute;left:${x - cr.left}px;top:${y - cr.top}px;`;
        }
      });
    }

    handle.style.cursor = 'grabbing';
    const island = wrapper.querySelector('.notepad-island');
    if (island) island.style.opacity = '.88';

    const startX = e.clientX - wrapper.offsetLeft;
    const startY = e.clientY - wrapper.offsetTop;

    function onMove(ev) {
      let nx = Math.max(0, ev.clientX - startX);
      let ny = Math.max(0, ev.clientY - startY);
      wrapper.style.left = nx + 'px';
      wrapper.style.top = ny + 'px';
    }
    function onUp() {
      handle.style.cursor = 'grab';
      if (island) island.style.opacity = '';
      update(prev => ({ ...prev, notepadPos: { x: wrapper.offsetLeft, y: wrapper.offsetTop } }));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

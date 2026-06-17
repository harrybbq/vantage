import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { timeAgo } from '../utils/helpers';
import AiCoachWidget from './AiCoachWidget';
import CoachBriefPanel from './CoachBriefPanel';
import QuickLog from './QuickLog';
import HubOsLayout from './HubOsLayout';
import FriendsRail from './friends/FriendsRail';
import RatingsPanel from './RatingsPanel';
import { ovrTier } from '../lib/ratings/tiers';
import { useSubscriptionContext } from '../context/SubscriptionContext';
import { useHubModuleMenu } from './HubModuleMenu';

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

// ── YouTube helpers ──
async function resolveChannelId(handle, apiKey) {
  if (/^UC[\w-]{22}$/.test(handle)) return { id: handle, resolvedName: null };
  const h = handle.replace(/^@/, '');
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet&forHandle=${encodeURIComponent('@' + h)}&key=${apiKey}`);
    const d = await r.json();
    if (d.items?.[0]) return { id: d.items[0].id, resolvedName: d.items[0].snippet.title, thumb: d.items[0].snippet.thumbnails?.default?.url };
  } catch { /* fallthrough */ }
  const r2 = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(h)}&maxResults=1&key=${apiKey}`);
  const d2 = await r2.json();
  if (d2.error) throw new Error(d2.error.message);
  const item = d2.items?.[0];
  if (!item) throw new Error(`Channel not found: ${handle}`);
  return { id: item.id?.channelId || item.snippet?.channelId, resolvedName: item.snippet?.channelTitle, thumb: item.snippet?.thumbnails?.default?.url };
}

// ── Hub content widgets (Habits / Holidays) — imperative HTML ──
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    return `<div class="hub-habit">
      <div class="hub-habit-top"><span class="hub-habit-name">${escapeHtml(h.name)}</span><span class="hub-habit-time" data-habit-timer="${escapeHtml(h.id)}">${fmtHabitElapsed(elapsed)}</span></div>
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
    return `<div class="hub-trip${h.imageUrl ? ' has-img' : ''}"${img}><span class="hub-trip-name">${escapeHtml(h.dest || 'Trip')}</span><span class="hub-trip-when">${label}</span></div>`;
  }).join('');
}

// ── Widget canvas (DOM-based dragging) ──
function useWidgetDrag(canvasRef, S, update) {
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
      const canvasW  = canvas.offsetWidth;
      const maxX     = canvasW - wrapperW;
      const startX   = e.clientX - wrapper.offsetLeft;
      const startY   = e.clientY - wrapper.offsetTop;
      const island   = wrapper.querySelector('.link-island');
      if (island) island.classList.add('dragging-active');
      try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

      // rAF-coalesce moves so we never write style more than once per frame.
      let rafId = 0;
      let pending = null;
      function flush() {
        rafId = 0;
        if (!pending) return;
        wrapper.style.left = pending.x + 'px';
        wrapper.style.top  = pending.y + 'px';
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
        update(prev => ({ ...prev, widgetPositions: { ...prev.widgetPositions, [linkId]: { x: wrapper.offsetLeft, y: wrapper.offsetTop } } }));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
  }, [canvasRef, update]);

  return makeDraggable;
}

// ── Profile Card ──
// `children` (when provided) renders inside the same .profile-col rail
// after the action buttons — used by the cream layout to slot the
// QuickLog trackers under "Sort". The `--with-rail` modifier widens
// the column so the trackers stack vertically without being clipped.
function ProfileCard({ profile, S, update, onSaveName, onSaveTagline, onUploadPhoto, onAddWidget, onSortWidgets, onSnapFill, onNavigateSettings, visionState, children }) {
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
                <span>🖼</span><p>photo</p>
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
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}>＋ Add widget</motion.button>
      <motion.button className="hub-action-btn sort-widgets" onClick={onSortWidgets}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}>⊞ Sort</motion.button>
      {onSnapFill && (
        <motion.button className="hub-action-btn sort-widgets" onClick={onSnapFill}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}>▦ Snap to fill</motion.button>
      )}
      <motion.button className="hub-action-btn settings-mobile-btn" onClick={onNavigateSettings}
        whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}>⚙ Settings</motion.button>
      {children}
    </div>
  );
}

// ── Widget Canvas (imperative DOM approach) ──
export default function HubSection({ S, update, active, onOpenModal, onOpenWaitlist, onNavigateSettings, onNavigateTrack, onShowCoinToast, onCoachAct, visionState, userId, onUpgrade }) {
  const canvasRef = useRef(null);
  const makeDraggable = useWidgetDrag(canvasRef, S, update);
  const { hasPro } = useSubscriptionContext();

  // Right-click a hub module → toggle its background transparency.
  // syncKey re-applies after the imperative widget canvas re-renders
  // (S.links / ytWidgets change) so the attribute isn't lost.
  const moduleMenu = useHubModuleMenu({
    S, update,
    syncKey: `${S.links?.length || 0}:${S.ytWidgets?.length || 0}:${active}`,
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
  // Pro-gated: the operator-console layout (HubOsLayout) renders for
  // EITHER dark-os OR cream-pro when the user has Pro. Free users
  // never see it. The two themes share the same panel/grid structure
  // but keep their own palettes (dark for dark-os, cream for cream-pro)
  // via the data-hub-os attribute + theme-scoped token overrides.
  const isOsLayout = hasPro && (S.theme === 'dark-os' || S.theme === 'cream-pro');

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

  // Snap-to-fill: pack every widget into a balanced weighted-row grid
  // that uses the full canvas area. Heavier widgets (notepad, GitHub,
  // YouTube) take proportionally more horizontal space; row heights are
  // equal. Read-only over current S — writes positions + sizes once.
  const WIDGET_WEIGHT = {
    notepad: 2.6,
    youtube: 2.4,
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
    for (const y of (S.ytWidgets || [])) items.push({ id: y.id, weight: WIDGET_WEIGHT.youtube });
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
    wrapper.style.resize = 'both';
    wrapper.style.overflow = 'hidden';
    // The default link wrapper is clamped 280–360px wide; lift the cap
    // and set floors so resize can grow/shrink freely.
    wrapper.style.maxWidth = 'none';
    wrapper.style.minWidth = '220px';
    wrapper.style.minHeight = '90px';

    wrapper.addEventListener('pointerdown', e => {
      const r = wrapper.getBoundingClientRect();
      const inGrip = (r.right - e.clientX) < 24 && (r.bottom - e.clientY) < 24;
      if (!inGrip) return; // not the resize grip — leave drag/clicks alone
      const onUp = () => {
        const w = wrapper.offsetWidth;
        const h = wrapper.offsetHeight;
        update(prev => {
          const cur = (prev.widgetSizes || {})[id];
          if (cur && cur.w === w && cur.h === h) return prev;
          return { ...prev, widgetSizes: { ...(prev.widgetSizes || {}), [id]: { w, h } } };
        });
      };
      window.addEventListener('pointerup', onUp, { once: true });
    });
  }, [S.widgetSizes, update]);

  // Render all widgets imperatively into the canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.innerHTML = '';

    const hasPositions = Object.keys(S.widgetPositions).length > 0;

    if (hasPositions) {
      canvas.style.cssText = 'position:relative;flex:1;min-height:calc(100vh - 180px);display:block;';
    } else {
      canvas.style.cssText = 'flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;align-content:start;align-items:start;';
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
      const bodyHtml = isGH
        ? `<div class="link-island-body"><div class="gh-skeleton" id="gh-body-${link.id}"><div class="sk-stats"><div class="sk-stat"></div><div class="sk-stat"></div><div class="sk-stat"></div></div><div class="sk-repo"></div><div class="sk-repo"></div><div class="sk-repo"></div></div></div>`
        : (link.notes ? `<div class="link-island-body"><div class="link-island-notes">${link.notes}</div></div>` : '');

      island.innerHTML = `
        <div class="widget-drag-handle" data-drag="${link.id}"><span></span></div>
        <div class="link-island-header">
          <div class="link-island-icon" style="background:${c}1a;border-color:${c}55;color:${c};">${link.icon}</div>
          <div class="link-island-info">
            <span class="link-island-name">${eyebrow}</span>
            <span class="link-island-url">${handle}</span>
          </div>
        </div>
        <div class="link-island-brand">
          <div class="link-island-brand-info">
            <div class="link-island-brand-title">${link.name}</div>
            <div class="link-island-brand-host">${host}</div>
          </div>
          <div class="link-island-actions">
            <a class="link-open-btn" href="${link.url}" target="_blank" style="color:${c};">Open ↗</a>
            <button class="link-del-btn" data-del-link="${link.id}">✕</button>
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
    });

    // YouTube widgets
    (S.ytWidgets || []).forEach(yt => {
      const wrapper = document.createElement('div');
      wrapper.className = 'widget-wrapper' + (hasPositions ? '' : ' snapping');
      wrapper.id = 'yt-wrapper-' + yt.id;
      wrapper.dataset.linkId = yt.id;

      if (hasPositions) {
        const pos = S.widgetPositions[yt.id];
        wrapper.style.cssText = `position:absolute;min-width:320px;max-width:520px;width:420px;user-select:none;left:${pos ? pos.x : 60}px;top:${pos ? pos.y : 60}px;`;
      } else {
        wrapper.style.cssText = 'min-width:320px;max-width:520px;width:420px;';
      }

      const island = document.createElement('div');
      island.className = 'card link-island';
      island.id = 'yt-island-' + yt.id;

      // YouTube widget uses the shared surface; brand red is demoted to
      // the icon chip + Open ↗ pill tint rather than flooding the card.
      const YT_BRAND = '#cf5b52';
      const channelCount = yt.channels ? yt.channels.length : 0;

      island.innerHTML = `
        <div class="widget-drag-handle" data-drag="${yt.id}"><span></span></div>
        <div class="link-island-header">
          <div class="link-island-icon" style="background:${YT_BRAND}1a;border-color:${YT_BRAND}55;color:${YT_BRAND};font-size:11px;">▶</div>
          <div class="link-island-info">
            <span class="link-island-name">WIDGET · YOUTUBE</span>
            <span class="link-island-url" id="yt-sub-${yt.id}">${channelCount} CH</span>
          </div>
        </div>
        <div class="link-island-brand">
          <div class="link-island-brand-info">
            <div class="link-island-brand-title">Subscriptions</div>
            <div class="link-island-brand-host">youtube.com/feed/subscriptions</div>
          </div>
          <div class="link-island-actions">
            <a class="link-open-btn" href="https://www.youtube.com/feed/subscriptions" target="_blank" style="color:${YT_BRAND};">Open ↗</a>
            <button class="link-del-btn" data-del-yt="${yt.id}">✕</button>
          </div>
        </div>
        <div class="link-island-body" id="yt-body-${yt.id}"><div class="yt-skeleton">${[0,1,2,3].map(() => `<div class="yt-skeleton-card"><div class="sk-thumb"></div><div class="sk-info"><div class="skeleton-line" style="width:90%;height:10px;"></div><div class="skeleton-line" style="width:55%;height:9px;margin-top:4px;"></div></div></div>`).join('')}</div></div>
      `;

      island.querySelector('[data-del-yt]')?.addEventListener('click', e => {
        e.stopPropagation();
        update(prev => ({ ...prev, ytWidgets: (prev.ytWidgets || []).filter(y => y.id !== yt.id) }));
      });

      wrapper.appendChild(island);
      canvas.appendChild(wrapper);
      makeDraggable(wrapper, yt.id);
      makeResizable(wrapper, yt.id);
      loadYouTubeFeed(yt);
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
      };
      const meta = META[hw.type] || META.habits;
      const { eyebrow, icon, title, sub } = meta;
      const body = meta.body();

      island.innerHTML = `
        <div class="widget-drag-handle" data-drag="${hw.id}"><span></span></div>
        <div class="link-island-header">
          <div class="link-island-icon" style="background:rgba(var(--em-rgb),.10);border-color:rgba(var(--em-rgb),.32);color:var(--em);">${icon}</div>
          <div class="link-island-info">
            <span class="link-island-name">${eyebrow}</span>
            <span class="link-island-url">${sub}</span>
          </div>
          <div class="link-island-actions">
            <button class="link-del-btn" data-del-hw="${hw.id}">✕</button>
          </div>
        </div>
        <div class="link-island-brand">
          <div class="link-island-brand-info">
            <div class="link-island-brand-title">${title}</div>
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
    });

    // Notepad — show if text exists, position saved, or explicitly shown via _showNotepad flag
    if (S.notepadText || S.notepadPos || S._showNotepad) {
      renderNotepadInCanvas(canvas, S, update, hasPositions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.links, S.ytWidgets, S.hubWidgets, S.holidays, S.habits, S.widgetPositions, S.notepadText, S.notepadPos, S.notepadWidth, S._showNotepad]);

  useEffect(() => {
    if (active) renderCanvas();
  }, [active, renderCanvas, isOsLayout]);

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
          onSaveName={name => update(prev => ({ ...prev, profile: { ...prev.profile, name } }))}
          onSaveTagline={tagline => update(prev => ({ ...prev, profile: { ...prev.profile, tagline } }))}
          onUploadPhoto={handleUploadPhoto}
          onAddWidget={() => onOpenModal('addLinkModal')}
          onSortWidgets={handleSortWidgets}
          onSnapFill={handleSnapToFill}
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

// ── YouTube feed loader ──
// Async fetch for the Leaderboard hub widget — friends/all-time top 5,
// patched into the placeholder host span on mount. Read-only summary;
// detailed views live on the dedicated Leaderboard page.
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
    host.outerHTML = `<div class="hub-lb-list">${rows.map(r => {
      const badge = prestigeBadge(r.prestige);
      const badgeHtml = badge
        ? `<span class="prestige-badge prestige-badge-sm prestige-${badge.band.key}">${badge.text}</span>`
        : '';
      return `
      <div class="hub-lb-row${r.isSelf ? ' is-self' : ''}">
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

async function loadYouTubeFeed(yt) {
  const bodyEl = document.getElementById('yt-body-' + yt.id);
  const subEl = document.getElementById('yt-sub-' + yt.id);
  if (!bodyEl) return;

  try {
    const resolved = await Promise.all(
      (yt.channels || []).map(async ch => {
        try {
          const r = await resolveChannelId(ch, yt.apiKey);
          return { handle: ch, id: r.id, name: r.resolvedName || ch, thumb: r.thumb || '' };
        } catch (e) {
          return { handle: ch, id: null, name: ch, thumb: '', error: e.message };
        }
      })
    );

    const valid = resolved.filter(c => c.id);
    if (subEl) subEl.textContent = `${valid.length} channel${valid.length !== 1 ? 's' : ''}`;
    if (!valid.length) {
      bodyEl.innerHTML = `<div class="yt-error">⚠ No channels could be resolved.</div>`;
      return;
    }

    bodyEl.innerHTML = `<div class="yt-skeleton">${[0,1,2,3].map(() => `<div class="yt-skeleton-card"><div class="sk-thumb"></div><div class="sk-info"><div class="skeleton-line" style="width:90%;height:11px;border-radius:4px;"></div><div class="skeleton-line" style="width:60%;height:10px;margin-top:5px;border-radius:4px;"></div></div></div>`).join('')}</div>`;
    const allVideos = [];
    await Promise.all(valid.map(async ch => {
      try {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${ch.id}&type=video&order=date&maxResults=5&key=${yt.apiKey}`);
        const d = await r.json();
        if (d.error) return;
        (d.items || []).forEach(v => {
          allVideos.push({
            videoId: v.id.videoId,
            title: v.snippet.title,
            channel: ch.name || v.snippet.channelTitle,
            thumb: ch.thumb,
            vidThumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
            published: new Date(v.snippet.publishedAt),
            pubRelative: timeAgo(new Date(v.snippet.publishedAt)),
          });
        });
      } catch { /* skip */ }
    }));

    allVideos.sort((a, b) => b.published - a.published);

    if (!allVideos.length) {
      bodyEl.innerHTML = `<div class="yt-loading">No recent videos found.</div>`;
      return;
    }

    const rows = allVideos.map(v => `
      <a class="yt-video-card" href="https://www.youtube.com/watch?v=${v.videoId}" target="_blank">
        <img class="yt-thumb" src="${v.vidThumb}" alt="" loading="lazy">
        <div class="yt-video-info">
          <div class="yt-video-title">${v.title}</div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${v.thumb ? `<img src="${v.thumb}" style="width:12px;height:12px;border-radius:50%;flex-shrink:0;" alt="">` : ''}
            <span class="yt-video-channel">${v.channel} · ${v.pubRelative}</span>
          </div>
        </div>
      </a>`).join('');

    bodyEl.innerHTML = `<div class="yt-video-list">${rows}</div>`;
  } catch (err) {
    bodyEl.innerHTML = `<div class="yt-error">⚠ ${err.message}</div>`;
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
      <textarea class="notepad-textarea" id="notepadTextarea" placeholder="Quick notes, tasks for today, things to remember…">${S.notepadText || ''}</textarea>
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

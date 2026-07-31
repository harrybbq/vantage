import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import Icon from './Icon';
import { motion } from 'framer-motion';
import { fireAchievement } from '../utils/confetti';
import SectionHelp from './SectionHelp';
import SavingsList from './SavingsList';
import { SubscriptionsManager } from './widgets/LifeWidgets';

/**
 * Achievement Board — React-rendered canvas of goal nodes connected by
 * SVG bezier paths.
 *
 * Three node states:
 *   active     — unlocked + incomplete (green tint, dot glow)
 *   completed  — done (gold tint, full progress strip)
 *   locked     — has incomplete parents (desaturated grey, dashed
 *                inbound connection)
 *
 * Three connection states (matching above):
 *   parent done, child not   — green fill sweep animation, then a
 *                              one-shot arrival pulse on the child
 *   both done                — solid gold
 *   parent not done          — grey dashed
 *
 * The implementation is fully declarative (was imperative DOM in the
 * pre-redesign version). Drag handling still uses refs to avoid
 * triggering re-renders on every mouse-move; we commit to state on
 * mouse-up.
 */

const FILL_DUR = 3.5; // seconds — connection fill sweep duration
const NODE_W = 260;
const NODE_HEAD_OFFSET = 44; // y-offset to mid-icon for connection anchor

// ── helpers ───────────────────────────────────────────────────────────

function allParentsComplete(achievements, connections, targetId) {
  const parents = connections.filter(([, t]) => t === targetId).map(([f]) => f);
  if (!parents.length) return true;
  return parents.every(pid => {
    const p = achievements.find(a => a.id === pid);
    return p && p.completed;
  });
}

function recalcLocks(achievements, connections) {
  return achievements.map(a => {
    const parents = connections.filter(([, t]) => t === a.id).map(([f]) => f);
    if (parents.length === 0) return { ...a, locked: false };
    return { ...a, locked: !allParentsComplete(achievements, connections, a.id) };
  });
}

// ── SVG bezier connection ────────────────────────────────────────────

function ConnPath({ from, to, fromCompleted, toCompleted, locked, connKey, onRemove }) {
  if (!from || !to) return null;
  const x1 = from.x + NODE_W / 2;
  const y1 = from.y + NODE_HEAD_OFFSET;
  const x2 = to.x + NODE_W / 2;
  const y2 = to.y + NODE_HEAD_OFFSET;
  // Direction-aware control points: horizontal tangents when the nodes
  // are mostly side-by-side, vertical tangents when stacked. Gives a
  // natural S-curve in both orientations (the old version always used
  // horizontal tangents, which looked kinked for vertical links).
  const dx = x2 - x1, dy = y2 - y1;
  let c1x, c1y, c2x, c2y;
  if (Math.abs(dy) > Math.abs(dx)) {
    const my = (y1 + y2) / 2;
    c1x = x1; c1y = my; c2x = x2; c2y = my;
  } else {
    const mx = (x1 + x2) / 2;
    c1x = mx; c1y = y1; c2x = mx; c2y = y2;
  }
  const d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;

  // approximate path length for the fill-sweep dasharray trick
  const approxLen = Math.sqrt(dx * dx + dy * dy) * 1.25;

  const bothDone = fromCompleted && toCompleted;
  const parentDone = fromCompleted && !toCompleted;

  // Re-trigger fill animation when parent flips false → true. Don't
  // re-fire when un-completing, otherwise the animation re-runs on
  // every toggle pair.
  const prevFrom = useRef(fromCompleted);
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => {
    if (fromCompleted && !prevFrom.current) setAnimKey(k => k + 1);
    prevFrom.current = fromCompleted;
  }, [fromCompleted]);

  const arrowAt = (color, opacity = 0.9) => {
    // Angle from the curve's actual end tangent (P3 − C2) so the
    // arrowhead lines up with the bezier instead of the straight chord.
    const ang = Math.atan2(y2 - c2y, x2 - c2x);
    const ah = 9;
    const pts = [
      [x2, y2],
      [x2 - ah * Math.cos(ang - 0.45), y2 - ah * Math.sin(ang - 0.45)],
      [x2 - ah * Math.cos(ang + 0.45), y2 - ah * Math.sin(ang + 0.45)],
    ].map(p => p.join(',')).join(' ');
    return <polygon points={pts} fill={color} opacity={opacity} />;
  };

  // Transparent wide stroke sitting on top of the visible line — gives
  // a comfortable click/tap target for unlinking. The parent <svg> sets
  // pointer-events:none, so we re-enable it just on this hit path.
  const hitPath = onRemove ? (
    <path
      className="ach-conn-hit"
      d={d}
      stroke="transparent"
      strokeWidth="18"
      fill="none"
      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
      onClick={e => { e.stopPropagation(); onRemove(from.id, to.id); }}
    >
      <title>Click to unlink</title>
    </path>
  ) : null;

  let visual;
  if (locked) {
    visual = (
      <>
        <path d={d} stroke="var(--ach-conn-locked)" strokeWidth="1.5"
          fill="none" strokeDasharray="5,4" opacity=".3" />
        {arrowAt('var(--ach-conn-locked)', 0.35)}
      </>
    );
  } else if (bothDone) {
    visual = (
      <>
        <path d={d} stroke="var(--ach-conn-done)" strokeWidth="2.5"
          fill="none" opacity=".85" />
        {arrowAt('var(--ach-conn-done)', 0.9)}
      </>
    );
  } else if (parentDone) {
    visual = (
      <g key={animKey}>
        {/* grey track */}
        <path d={d} stroke="var(--ach-conn-locked)" strokeWidth="2"
          fill="none" opacity=".18" />
        {/* animated green fill — dasharray full length, offset animates to 0 */}
        <path d={d}
          stroke="var(--em-light)" strokeWidth="2.5" fill="none"
          strokeLinecap="round"
          strokeDasharray={approxLen}
          strokeDashoffset={approxLen}
          style={{ animation: `achConnFill ${FILL_DUR}s cubic-bezier(.22,1,.36,1) forwards` }}
        />
        {arrowAt('var(--em-light)', 0.95)}
      </g>
    );
  } else {
    // active but parent not done — animated dashed
    visual = (
      <>
        <path d={d} stroke="var(--ach-conn-active)" strokeWidth="2"
          fill="none" strokeDasharray="6,4" opacity=".45"
          className="ach-conn-anim" />
        {arrowAt('var(--ach-conn-active)', 0.7)}
      </>
    );
  }

  return <g className="ach-conn-group">{visual}{hitPath}</g>;
}

// ── Single achievement node ──────────────────────────────────────────

function AchNode({
  ach, conns, allAchs,
  connectingFrom, zoom = 1,
  onDragCommit, onDragMove,
  onComplete, onConnect, onDelete, onEdit,
}) {
  // rAF-coalesced live-move reporting so connection lines follow the
  // node smoothly during a drag (committed to state only on release).
  const rafRef = useRef(0);
  // Drag deltas are screen pixels; the canvas is CSS-scaled by `zoom`,
  // so divide by it to keep the node under the finger/cursor. Ref so
  // the bound move handler always sees the current zoom.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const parents = conns.filter(([, t]) => t === ach.id);
  const completedParents = parents.filter(([f]) => {
    const p = allAchs.find(a => a.id === f);
    return p && p.completed;
  });
  const status = ach.completed ? 'completed' : ach.locked ? 'locked' : 'active';
  const statusLabel =
    ach.completed
      ? '★ Completed'
      : ach.locked
        ? `🔒 ${completedParents.length}/${parents.length} required`
        : 'Achievement';
  const isTarget = connectingFrom && connectingFrom !== ach.id;

  // One-shot arrival pulse: when a parent transitions to completed,
  // the inbound connection animates for FILL_DUR; we kick the pulse
  // on this node ~150ms before that so the spark "arriving" feels
  // synchronous with the glow firing.
  const [arriving, setArriving] = useState(false);
  const prevParentDoneCount = useRef(completedParents.length);
  useEffect(() => {
    if (completedParents.length > prevParentDoneCount.current) {
      const t = setTimeout(() => {
        setArriving(true);
        setTimeout(() => setArriving(false), 1200);
      }, Math.max(0, (FILL_DUR - 0.15) * 1000));
      prevParentDoneCount.current = completedParents.length;
      return () => clearTimeout(t);
    }
    prevParentDoneCount.current = completedParents.length;
  }, [completedParents.length]);

  // Drag — refs so we never trigger React re-render mid-drag.
  const nodeRef = useRef(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const startCoords = useRef({ sx: 0, sy: 0, ox: 0, oy: 0 });
  const posRef = useRef({ x: ach.x, y: ach.y });

  // Keep posRef in sync if x/y change externally (e.g. after restore)
  useEffect(() => {
    posRef.current = { x: ach.x, y: ach.y };
    if (nodeRef.current && !dragging.current) {
      nodeRef.current.style.left = ach.x + 'px';
      nodeRef.current.style.top = ach.y + 'px';
    }
  }, [ach.x, ach.y]);

  function startDrag(cx, cy) {
    dragging.current = true;
    moved.current = false;
    startCoords.current = { sx: cx, sy: cy, ox: ach.x, oy: ach.y };
    posRef.current = { x: ach.x, y: ach.y };
  }
  function moveDrag(cx, cy) {
    if (!dragging.current) return;
    const z = zoomRef.current || 1;
    const dx = (cx - startCoords.current.sx) / z;
    const dy = (cy - startCoords.current.sy) / z;
    if (!moved.current && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved.current = true;
    const nx = Math.max(0, startCoords.current.ox + dx);
    const ny = Math.max(0, startCoords.current.oy + dy);
    posRef.current = { x: nx, y: ny };
    if (nodeRef.current) {
      nodeRef.current.style.left = nx + 'px';
      nodeRef.current.style.top = ny + 'px';
    }
    // Report the live position (one update per frame) so the parent's
    // drag hint moves the connection endpoints with the node. The node
    // itself moves via direct DOM above; we only commit to state on up.
    if (onDragMove) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => onDragMove(ach.id, posRef.current.x, posRef.current.y));
    }
  }
  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    cancelAnimationFrame(rafRef.current);
    if (moved.current) {
      onDragCommit(ach.id, posRef.current.x, posRef.current.y);
    }
    moved.current = false;
  }

  useEffect(() => {
    const onMouseMove = e => moveDrag(e.clientX, e.clientY);
    const onMouseUp = () => endDrag();
    const onTouchMove = e => {
      // Only act on a genuine single-finger node drag. Let two-finger
      // gestures through so the canvas pinch-zoom handler gets them, and
      // preventDefault while dragging so the page/canvas doesn't scroll-
      // fight the drag on touch devices.
      if (!dragging.current || e.touches.length !== 1) return;
      e.preventDefault();
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => endDrag();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ach.x, ach.y]);

  // Progress strip percentage: completed achievements are 100%; child
  // nodes show fraction-of-parents-complete so progress is meaningful
  // before they themselves are unlocked.
  const parentIds = parents.map(([f]) => f);
  const progressPct = ach.completed
    ? 100
    : parentIds.length === 0
      ? 0
      : Math.round((completedParents.length / parentIds.length) * 100);

  return (
    <div
      ref={nodeRef}
      className={`ach-node${isTarget ? ' ach-node-target' : ''}`}
      style={{ left: ach.x, top: ach.y }}
      onMouseDown={e => {
        if (e.target.tagName === 'BUTTON') return;
        startDrag(e.clientX, e.clientY);
        e.preventDefault();
      }}
      onTouchStart={e => {
        if (e.target.tagName === 'BUTTON') return;
        if (e.touches[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }}
      onClick={() => {
        if (!moved.current && connectingFrom && connectingFrom !== ach.id) {
          onConnect(ach.id);
        }
      }}
    >
      <div className={`ach-card status-${status}${arriving ? ' ach-card-arriving' : ''}`}>
        <div className="ach-card-top">
          <div className="ach-icon-wrap">{ach.icon}</div>
          <div className="ach-info">
            <div className={`ach-label status-${status}`}>
              <span className="ach-label-dot" />
              {statusLabel}
            </div>
            <div className="ach-name">{ach.name}</div>
            {ach.desc && <div className="ach-desc">{ach.desc}</div>}
            {ach.coins > 0 && (
              <div className="ach-coin-badge">⬡ {ach.coins}</div>
            )}
          </div>
        </div>

        {(parentIds.length > 0 || ach.completed) && (
          <div className="ach-progress-strip">
            <div className="ach-progress-fill" style={{ width: `${progressPct}%` }} />
            {parentIds.length > 0 && !ach.completed && (
              <div className="ach-progress-count">
                {completedParents.length}/{parentIds.length}
              </div>
            )}
          </div>
        )}

        <div className="ach-actions">
          <button
            type="button"
            className="ach-btn ach-btn-complete"
            title={ach.completed ? 'Mark as not completed' : 'Mark complete'}
            onClick={e => { e.stopPropagation(); onComplete(ach.id); }}
          ><Icon name="star" size={14} /></button>
          <button
            type="button"
            className="ach-btn ach-btn-connect"
            title="Connect to another achievement"
            onClick={e => { e.stopPropagation(); onConnect(ach.id); }}
          ><Icon name="waypoints" size={14} /></button>
          <button
            type="button"
            className="ach-btn ach-btn-edit"
            title="Edit"
            onClick={e => { e.stopPropagation(); onEdit(ach.id); }}
          ><Icon name="pencil" size={13} /></button>
          <button
            type="button"
            className="ach-btn ach-btn-delete"
            title="Delete"
            onClick={e => { e.stopPropagation(); onDelete(ach.id); }}
          ><Icon name="trash-2" size={13} /></button>
        </div>
      </div>
    </div>
  );
}

// ── Main section ─────────────────────────────────────────────────────

export default function AchievementsSection({ S, update, active, onOpenModal, onShowCoinToast }) {
  const achievements = S.achievements || [];
  const connections = S.connections || [];
  const connectingFrom = S.connectingFrom || null;

  const [zoom, setZoom] = useState(1);

  // Right-click the board → menu to toggle the section background's
  // transparency and light/dark mode. Persisted on S so it survives
  // reloads; applies only to the achievement canvas background.
  const [boardMenu, setBoardMenu] = useState(null); // { x, y } | null
  const achTransparent = !!S.achBoardTransparent;
  // Theme-aware background toggle: on a light theme it offers "Dark
  // background"; on a dark theme it offers "Light background". One
  // stored flag (achBoardInvert) = "use the opposite of the theme's
  // default board background". Migrates the old achBoardDark flag.
  const isDarkTheme = S.theme === 'dark' || S.theme === 'dark-os';
  const achInvert = (S.achBoardInvert ?? S.achBoardDark) || false;
  const invertClass = achInvert ? (isDarkTheme ? ' is-light' : ' is-dark') : '';
  function handleBoardContextMenu(e) {
    e.preventDefault();
    setBoardMenu({ x: e.clientX, y: e.clientY });
  }
  useEffect(() => {
    if (!boardMenu) return;
    const close = () => setBoardMenu(null);
    const onKey = e => { if (e.key === 'Escape') setBoardMenu(null); };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('scroll', close, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [boardMenu]);

  // Pinch-to-zoom on touch devices. zoomRef lets the (bind-once) touch
  // effect read the current zoom without re-binding every change.
  const canvasWrapRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Scroll offset to apply once a pinch’s new scale has been laid out.
  const pendingAnchor = useRef(null);
  /* ── Touch navigation ──────────────────────────────────────────────
   * One finger drags the board, two fingers pinch to zoom about the
   * point between them. The board owns every touch gesture, which is
   * safe here and NOT safe on the holiday maps: this section is exactly
   * viewport height with the canvas filling it, so there is no page
   * scroll to steal. (On the maps the page does scroll, which is why
   * they use pan-y and ask for two fingers.)
   *
   * Two things were wrong before:
   *
   *   Double-speed panning. touch-action was pan-x pan-y, so the browser
   *   scrolled natively, AND the pointer handler set scrollLeft itself.
   *   Both moved the board: a 120px finger drag travelled 211px.
   *
   *   Unanchored zoom. The transform-origin is 0 0, so pinching scaled
   *   about the content's top-left corner — whatever you had your
   *   fingers on shot off toward the bottom-right. Now the scroll offset
   *   is corrected so the pinch midpoint stays under your fingers.
   */
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const pts = new Map();
    let mode = null;          // 'pan' | 'pinch'
    let last = null;          // last pan position
    let pinch = null;         // { dist, zoom, mid }
    const dist = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
    const mid = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const onStart = e => {
      for (const t of e.changedTouches) pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      const list = [...pts.values()];

      if (list.length >= 2) {
        // Two fingers is unambiguously a pinch, wherever they landed.
        // The node guard below deliberately does NOT apply: on a dense
        // board at least one finger is usually resting on a card, and
        // bailing out meant most real pinches did nothing at all.
        mode = 'pinch';
        pinch = { dist: dist(list) || 1, zoom: zoomRef.current, mid: mid(list) };
        el.classList.remove('is-panning');
        return;
      }

      // One finger on a node is a node drag — its own gesture, left alone.
      if (e.target.closest?.('.ach-node, .ach-conn-hit, button, a, input, .ach-connect-toast')) {
        mode = null;
        return;
      }
      mode = 'pan';
      last = { ...list[0] };
      el.classList.add('is-panning');
    };

    const onMove = e => {
      if (!mode) return;
      for (const t of e.changedTouches) {
        if (pts.has(t.identifier)) pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      const list = [...pts.values()];

      if (mode === 'pan' && list.length === 1) {
        e.preventDefault();
        // 1:1 with the finger — the board tracks the fingertip exactly.
        el.scrollLeft -= list[0].x - last.x;
        el.scrollTop -= list[0].y - last.y;
        last = { ...list[0] };
        return;
      }

      if (mode === 'pinch' && list.length >= 2) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const m = mid(list);
        const z0 = zoomRef.current;
        const z1 = Math.min(2, Math.max(0.4, +(pinch.zoom * (dist(list) / pinch.dist)).toFixed(3)));

        // Content coordinate currently under the pinch midpoint, then the
        // scroll offset that keeps it there once the scale changes.
        const cx = (el.scrollLeft + (m.x - r.left)) / z0;
        const cy = (el.scrollTop + (m.y - r.top)) / z0;
        pendingAnchor.current = {
          left: cx * z1 - (m.x - r.left),
          top: cy * z1 - (m.y - r.top),
        };
        setZoom(z1);
      }
    };

    const onEnd = e => {
      for (const t of e.changedTouches) pts.delete(t.identifier);
      const list = [...pts.values()];
      if (list.length === 1) { mode = 'pan'; last = { ...list[0] }; }
      else if (list.length === 0) { mode = null; el.classList.remove('is-panning'); }
    };

    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  /* Apply the pinch anchor AFTER the new scale has been laid out —
   * setting scrollLeft before the transform updates would clamp against
   * the old, smaller scroll extent and lose the anchor. */
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const el = canvasWrapRef.current;
    if (!a || !el) return;
    pendingAnchor.current = null;
    el.scrollLeft = a.left;
    el.scrollTop = a.top;
  }, [zoom]);
  // Tab toggle (F4 Sprint 2) — 'goals' = the achievement board canvas,
  // 'savings' = monetary goals list. Sticky to component state so a
  // refresh resets to goals (canvas is the dominant surface).
  const [activeTab, setActiveTab] = useState('goals');
  // Tracks the live position of a node currently being dragged so the
  // SVG connections re-render without committing to global state on
  // every mousemove. AchNode commits position on mouseup; in between
  // we use this hint to keep connection endpoints visually attached.
  const [dragHint, setDragHint] = useState(null); // { id, x, y } | null

  // ── Board panning ──
  // Grab any empty part of the board and drag to pan — the scroll
  // container's scrollLeft/Top follow the pointer, so users never need
  // the scrollbars. Ignored when the pointerdown lands on a node, a
  // connection line, or any interactive control (those keep their own
  // drag/click behaviour).
  const panRef = useRef(null);
  function handleBoardPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.ach-node, .ach-conn-hit, button, a, input, .ach-connect-toast')) return;
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    // Touch is handled entirely by the pointer gesture layer below —
    // letting this run too was the double-speed bug: the browser scrolled
    // natively AND this handler set scrollLeft, so the board travelled
    // ~1.8x the finger.
    if (e.pointerType === 'touch') return;

    panRef.current = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
    wrap.classList.add('is-panning');
    function mv(ev) {
      const p = panRef.current;
      if (!p) return;
      wrap.scrollLeft = p.sl - (ev.clientX - p.x);
      wrap.scrollTop = p.st - (ev.clientY - p.y);
    }
    function up() {
      panRef.current = null;
      wrap.classList.remove('is-panning');
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    }
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  }

  // ── handlers ────────────────────────────────────────────────────

  function handleDragMove(id, x, y) {
    // Live hint — moves connection endpoints with the node without
    // committing to global state (and re-saving) on every frame.
    setDragHint({ id, x, y });
  }

  function handleDragCommit(id, x, y) {
    setDragHint(null);
    update(prev => ({
      ...prev,
      achievements: prev.achievements.map(a => a.id === id ? { ...a, x, y } : a),
    }));
  }

  function handleToggleComplete(id) {
    update(prev => {
      const ach = prev.achievements.find(a => a.id === id);
      if (!ach || ach.locked) return prev;
      const wasCompleted = ach.completed;
      const newCompleted = !wasCompleted;
      const reward = ach.coins || 0;
      let coins = prev.coins || 0;
      let coinHistory = [...(prev.coinHistory || [])];

      if (newCompleted) fireAchievement();
      if (newCompleted && reward > 0) {
        coins += reward;
        coinHistory.unshift({ type: 'earn', label: ach.name, amount: reward, ts: Date.now() });
        onShowCoinToast(`+${reward} ⬡ earned!`, true);
      } else if (!newCompleted && wasCompleted && reward > 0) {
        coins = Math.max(0, coins - reward);
        coinHistory.unshift({ type: 'refund', label: ach.name, amount: -reward, ts: Date.now() });
      }

      const updated = prev.achievements.map(a =>
        a.id === id ? { ...a, completed: newCompleted, completedAt: newCompleted ? Date.now() : null } : a
      );
      const recalced = recalcLocks(updated, prev.connections);
      return { ...prev, achievements: recalced, coins, coinHistory };
    });
  }

  function handleConnect(targetId) {
    if (!connectingFrom) {
      // first click → mark as source
      update(prev => ({ ...prev, connectingFrom: targetId }));
      return;
    }
    if (connectingFrom === targetId) {
      // clicked same node → cancel
      update(prev => ({ ...prev, connectingFrom: null }));
      return;
    }
    update(prev => {
      // Re-connecting two already-linked nodes toggles the link OFF.
      if (prev.connections.some(([a, b]) => a === connectingFrom && b === targetId)) {
        const newConns = prev.connections.filter(([a, b]) => !(a === connectingFrom && b === targetId));
        return {
          ...prev,
          connections: newConns,
          achievements: recalcLocks(prev.achievements, newConns),
          connectingFrom: null,
        };
      }
      const newConns = [...prev.connections, [connectingFrom, targetId]];
      const recalced = recalcLocks(prev.achievements, newConns);
      return { ...prev, connections: newConns, achievements: recalced, connectingFrom: null };
    });
  }

  function handleRemoveConnection(fId, tId) {
    update(prev => {
      const newConns = prev.connections.filter(([a, b]) => !(a === fId && b === tId));
      return {
        ...prev,
        connections: newConns,
        achievements: recalcLocks(prev.achievements, newConns),
      };
    });
  }

  function handleDelete(id) {
    update(prev => {
      const newConns = prev.connections.filter(([a, b]) => a !== id && b !== id);
      const newAchs = prev.achievements.filter(a => a.id !== id);
      return {
        ...prev,
        achievements: recalcLocks(newAchs, newConns),
        connections: newConns,
        connectingFrom: prev.connectingFrom === id ? null : prev.connectingFrom,
      };
    });
  }

  function handleCancelConnect() {
    update(prev => ({ ...prev, connectingFrom: null }));
  }

  function handleEdit(id) {
    // Defer to the existing modal pattern so all edit/delete logic
    // lives in one place (Modals.jsx → EditAchievementModal). Same
    // shape as habit edit: 'editAchievementModal:<id>'.
    onOpenModal('editAchievementModal:' + id);
  }

  // ── derived ─────────────────────────────────────────────────────

  // Extent of the actual content — where the furthest node reaches.
  const { contentW, contentH } = useMemo(() => {
    let w = 700, h = 400;
    achievements.forEach(a => {
      w = Math.max(w, a.x + NODE_W + 30);
      h = Math.max(h, a.y + 130);
    });
    return { contentW: w, contentH: h };
  }, [achievements]);

  // ── The board keeps going ──
  // There is always at least RUNWAY of empty grid past the furthest
  // node south and east, and panning to an edge adds another stretch —
  // so the board reads as open space you keep building into rather than
  // a page that stops. North and west stay pinned at the origin: the
  // board grows away from its corner, it doesn't drift.
  //
  // The ceiling is a runaway guard, not a design limit; you would have
  // to pan a very long way to meet it.
  const RUNWAY = 900;
  const RUNWAY_MAX = 40000;
  const [runway, setRunway] = useState({ south: RUNWAY, east: RUNWAY });
  const canvasW = Math.min(RUNWAY_MAX, contentW + runway.east);
  const canvasH = Math.min(RUNWAY_MAX, contentH + runway.south);

  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    // Fires on wheel, trackpad and drag-pan alike — they all move
    // scrollTop/Left, so one listener covers every way of getting there.
    const onScroll = () => {
      const downLeft = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
      const rightLeft = wrap.scrollWidth - wrap.scrollLeft - wrap.clientWidth;
      if (downLeft > 320 && rightLeft > 320) return;
      setRunway(r => {
        const south = downLeft < 320 ? Math.min(RUNWAY_MAX, r.south + RUNWAY) : r.south;
        const east = rightLeft < 320 ? Math.min(RUNWAY_MAX, r.east + RUNWAY) : r.east;
        // Same object when nothing moved, so parking at the cap doesn't
        // re-render the whole board on every scroll event.
        return south === r.south && east === r.east ? r : { south, east };
      });
    };
    wrap.addEventListener('scroll', onScroll, { passive: true });
    return () => wrap.removeEventListener('scroll', onScroll);
  }, [activeTab]);

  /** Zoom back to 1:1 and bring the nodes back into view. Panning into
   *  open space is the point, but you need a way home from it. */
  function recentre() {
    setZoom(1);
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    if (!achievements.length) { wrap.scrollTo({ top: 0, left: 0, behavior: 'smooth' }); return; }
    const minX = Math.min(...achievements.map(a => a.x));
    const minY = Math.min(...achievements.map(a => a.y));
    wrap.scrollTo({ top: Math.max(0, minY - 40), left: Math.max(0, minX - 40), behavior: 'smooth' });
  }

  const completedCount = achievements.filter(a => a.completed).length;
  const totalCount = achievements.length;
  const lockedCount = achievements.filter(a => a.locked).length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Live-positioned achievements view: while a drag hint is active, override
  // that node's position in the array so the connection lines follow.
  const liveAchievements = useMemo(() => {
    if (!dragHint) return achievements;
    return achievements.map(a => a.id === dragHint.id ? { ...a, x: dragHint.x, y: dragHint.y } : a);
  }, [achievements, dragHint]);

  return (
    <section id="achievements" className={`section${active ? ' active' : ''}`}>
      {/* Toolbar — eyebrow / title / hints / + New */}
      <div className="ach-toolbar">
        <motion.div
          className="ach-toolbar-title-wrap"
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className="eyebrow">Progress Map</div>
          <div className="sec-title">
            Achievement Board
            <SectionHelp text="Goals tab: place goals on the canvas, draw connections to map your path, and complete them for coin rewards (max 10,000 per goal) — a parent unlocks its children. Savings tab: money goals with target dates and monthly guidance, plus Subscriptions & Bills to track recurring outgoings and see your monthly burn." />
          </div>
        </motion.div>
        <div className="ach-toolbar-hints">
          <span className="ach-hint-pill"><span className="ach-hint-key">Drag</span> move</span>
          <span className="ach-hint-pill"><span className="ach-hint-key">✦</span> connect</span>
          <span className="ach-hint-pill"><span className="ach-hint-key">Tap line</span> unlink</span>
          <span className="ach-hint-pill"><span className="ach-hint-key">★</span> complete</span>
        </div>
        {activeTab === 'goals' && (
          <motion.button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenModal('addAchievementModal')}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            + New
          </motion.button>
        )}
      </div>

      {/* Tab toggle + stats. The stats strip used to sit UNDER the canvas,
          which capped how far the board could extend south. Moving it up
          here (right of the tabs) frees the board's bottom edge entirely. */}
      <div className="ach-tabs-row">
        <div className="ach-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'goals'}
            className={`ach-tab${activeTab === 'goals' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('goals')}
          >Goals</button>
          <button
            role="tab"
            aria-selected={activeTab === 'savings'}
            className={`ach-tab${activeTab === 'savings' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('savings')}
          >Savings</button>
        </div>
        {activeTab === 'goals' && (
          <div className="ach-stats">
            <div className="ach-stats-item">
              <span className="ach-stats-val ach-stats-val-em">{completedCount}</span>
              <span className="ach-stats-lbl">Done</span>
            </div>
            <div className="ach-stats-item">
              <span className="ach-stats-val">{totalCount}</span>
              <span className="ach-stats-lbl">Total</span>
            </div>
            <div className="ach-stats-item">
              <span className="ach-stats-val ach-stats-val-gold">{progressPct}%</span>
              <span className="ach-stats-lbl">Progress</span>
            </div>
            <div className="ach-stats-item">
              <span className="ach-stats-val">{lockedCount}</span>
              <span className="ach-stats-lbl">Locked</span>
            </div>
            <div className="ach-stats-divider" />
            <div className="ach-stats-item">
              <div className="ach-zoom">
                <button
                  type="button"
                  className="ach-zoom-btn"
                  onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))}
                  title="Zoom out"
                ><Icon name="minus" size={15} /></button>
                <span className="ach-zoom-val">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="ach-zoom-btn"
                  onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))}
                  title="Zoom in"
                ><Icon name="plus" size={15} /></button>
                <button
                  type="button"
                  className="ach-zoom-btn ach-zoom-reset"
                  onClick={recentre}
                  title="Recentre on your goals"
                ><Icon name="locate-fixed" size={14} /></button>
              </div>
            </div>
          </div>
        )}
      </div>

      {activeTab === 'savings' ? (
        <>
          <SavingsList S={S} update={update} onOpenModal={onOpenModal} />
          {/* Recurring outgoings — the spending counterpart to the
              savings goals above; feeds the Subscriptions hub widget. */}
          <SubscriptionsManager S={S} update={update} />
        </>
      ) : (<>

      {/* Canvas — dot grid background, draggable nodes, SVG connections.
          touchAction:none — the board owns every touch gesture (one
          finger pans, two pinch). Safe because this section is exactly
          viewport height, so there is no page scroll to steal. */}
      <div
        className={`ach-canvas-wrap${achTransparent ? ' is-transparent' : ''}${invertClass}`}
        ref={canvasWrapRef}
        style={{ touchAction: 'none' }}
        onContextMenu={handleBoardContextMenu}
        onPointerDown={handleBoardPointerDown}
      >
        <div
          className="ach-canvas-inner"
          style={{
            minWidth: canvasW,
            minHeight: canvasH,
            transform: zoom !== 1 ? `scale(${zoom})` : undefined,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className="ach-connections"
            width={canvasW}
            height={canvasH}
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {connections.map(([fId, tId], i) => {
              const f = liveAchievements.find(a => a.id === fId);
              const t = liveAchievements.find(a => a.id === tId);
              if (!f || !t) return null;
              const locked = !f.completed;
              return (
                <ConnPath
                  key={`${fId}-${tId}`}
                  connKey={`${fId}-${tId}-${i}`}
                  from={f}
                  to={t}
                  fromCompleted={f.completed}
                  toCompleted={t.completed}
                  locked={locked}
                  onRemove={handleRemoveConnection}
                />
              );
            })}
          </svg>

          {achievements.map(ach => (
            <AchNode
              key={ach.id}
              ach={ach}
              conns={connections}
              allAchs={achievements}
              connectingFrom={connectingFrom}
              zoom={zoom}
              onDragCommit={handleDragCommit}
              onDragMove={handleDragMove}
              onComplete={handleToggleComplete}
              onConnect={handleConnect}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          ))}

          {achievements.length === 0 && (
            <div className="ach-canvas-empty">
              <div className="ach-canvas-empty-icon"><Icon name="star" size={30} strokeWidth={1.5} /></div>
              <div className="ach-canvas-empty-label">No achievements yet</div>
              <div className="ach-canvas-empty-sub">Click + New to add your first goal</div>
            </div>
          )}
        </div>

        {connectingFrom && (
          <div className="ach-connect-toast">
            ✦ Now click another card to connect
            <button
              type="button"
              className="ach-connect-toast-cancel"
              onClick={handleCancelConnect}
            >Cancel</button>
          </div>
        )}
      </div>

      {boardMenu && (
        <div
          className="hub-module-menu"
          style={{
            left: Math.min(boardMenu.x, window.innerWidth - 248),
            top: Math.min(boardMenu.y, window.innerHeight - 130),
          }}
          onPointerDown={e => e.stopPropagation()}
          role="menu"
        >
          <div className="hub-module-menu-head">Achievement Board</div>
          <button
            type="button"
            className="hub-module-menu-row"
            onClick={() => update(prev => ({ ...prev, achBoardTransparent: !prev.achBoardTransparent }))}
            role="menuitemcheckbox"
            aria-checked={achTransparent}
          >
            <span className="hub-module-menu-label">Transparent background</span>
            <span className={`hub-switch${achTransparent ? ' is-on' : ''}`} aria-hidden="true">
              <span className="hub-switch-knob" />
            </span>
          </button>
          <button
            type="button"
            className="hub-module-menu-row"
            onClick={() => update(prev => {
              const cur = (prev.achBoardInvert ?? prev.achBoardDark) || false;
              return { ...prev, achBoardInvert: !cur, achBoardDark: false };
            })}
            role="menuitemcheckbox"
            aria-checked={achInvert}
          >
            <span className="hub-module-menu-label">{isDarkTheme ? 'Light background' : 'Dark background'}</span>
            <span className={`hub-switch${achInvert ? ' is-on' : ''}`} aria-hidden="true">
              <span className="hub-switch-knob" />
            </span>
          </button>
        </div>
      )}
      </>)}
    </section>
  );
}

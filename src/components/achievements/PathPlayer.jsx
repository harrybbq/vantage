/**
 * The mobile achievement board, as a player rather than a drawing.
 *
 * ── Why it replaced the tree ─────────────────────────────────────────
 * The tree rendered every path in full, one under another. That is the
 * desktop's job — the desktop has 1440px and the user's own spatial
 * memory of where they dragged each node. On a phone it produced the
 * four complaints it was reported for: you cannot tell what is next, you
 * scroll forever, unlinked goals imply a hierarchy that is not there,
 * and there is no sense of the whole.
 *
 * Same graph, same locking rule, same handlers — the completion, edit,
 * link and delete calls all route to the section's own, so the two views
 * cannot drift about what a goal is or what finishing one does.
 *
 * What changed is the arrangement, and all of it is derived in
 * lib/achievements/pathPlayer.js so it can be checked without a browser:
 *
 *   RAIL     one chip per independent path, with its completion ring.
 *            The whole picture is four chips instead of four screens.
 *   PLAYER   one step big; the step before and after are single rows.
 *            Context costs 44px, not a screenful.
 *   PEEKS    prerequisites collapse to a chip row, what a goal unlocks is
 *            a list — both tappable, so the graph stays navigable without
 *            ever being drawn in full.
 *   MAP      a button in the step row, opening the depth-laid graph where
 *            any node jumps the player. It is something you OPEN rather
 *            than a strip that sits there: as a permanent band under the
 *            card it ate the height the card needed and, on a short
 *            phone, painted over the card's own body.
 *
 * Nothing here is a second implementation of a rule. Locking, ordering
 * and cycle-refusal all live in the pure module.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import {
  pathsOf, stepIndexFor, stateOf, parentsOf, childrenOf,
  mapLayout,
} from '../../lib/achievements/pathPlayer';

const CATS = { finance: 'Finance', fitness: 'Fitness', brain: 'Brain', social: 'Social', general: 'General' };
const WORD = { completed: 'done', locked: 'locked', active: 'open' };

export default function PathPlayer({
  achievements = [],
  connections = [],
  onComplete,
  onEdit,
  onConnect,
  onDelete,
  connectingFrom = null,
  onCancelConnect,
}) {
  const [pathKey, setPathKey] = useState(null);
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [bigMap, setBigMap] = useState(false);
  const [toast, setToast] = useState(null);

  const toastTimer = useRef(null);
  const pressTimer = useRef(null);
  const swipe = useRef(null);

  // A link started elsewhere (or surviving a remount) should show its own
  // UI rather than leaving a goal highlighted with nothing explaining why.
  useEffect(() => { if (connectingFrom) setLinkMode(true); }, [connectingFrom]);
  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(pressTimer.current); }, []);

  function say(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  const paths = useMemo(() => pathsOf(achievements, connections), [achievements, connections]);

  // The path is remembered by KEY, not by index. Completing a goal can
  // reorder the rail and linking two paths merges them; an index would
  // silently move the user to a different path in both cases.
  const pathIdx = Math.max(0, paths.findIndex(p => p.key === pathKey));
  const path = paths[pathIdx] || paths[0] || null;
  const idx = stepIndexFor(path, step, touched, achievements);
  const cur = path ? path.queue[idx] : null;

  const byId = id => achievements.find(a => a.id === id);
  const st = g => stateOf(achievements, path ? path.conns : connections, g);

  function goStep(i) { setStep(i); setTouched(true); }

  function jumpTo(id) {
    const pi = paths.findIndex(p => p.ids.includes(id));
    if (pi === -1) return;
    const si = paths[pi].queue.findIndex(g => g.id === id);
    setPathKey(paths[pi].key);
    setStep(Math.max(0, si));
    setTouched(true);
    setBigMap(false);
    setMenuId(null);
  }

  // In link mode every goal is a link target, so a tap must not also open
  // the editor or jump the player somewhere else.
  const tap = id => (linkMode ? onConnect?.(id) : jumpTo(id));

  function exitLink() {
    setLinkMode(false);
    onCancelConnect?.();
  }

  function complete(g) {
    if (!g) return;
    if (st(g) === 'locked') { say('Locked — finish what it needs first'); return; }
    onComplete?.(g.id);
  }

  // Long-press opens quick actions. 480ms is the same delay the habit
  // board uses; shorter and an ordinary tap starts triggering it.
  function pressStart(id) {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMenuId(id), 480);
  }
  const pressEnd = () => clearTimeout(pressTimer.current);

  function swipeStart(e) {
    const t = e.touches ? e.touches[0] : e;
    swipe.current = { x: t.clientX, y: t.clientY };
  }
  function swipeEnd(e) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || !path) return;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    // Vertical wins ties: the card body scrolls, and a scroll that
    // occasionally changed step would be maddening.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    const to = dx < 0 ? idx + 1 : idx - 1;
    if (to < 0 || to > path.queue.length - 1) {
      say(dx < 0 ? 'End of the path' : 'Start of the path');
      return;
    }
    goStep(to);
  }

  if (!achievements.length) {
    return (
      <div className="ppl-empty">
        <div className="ppl-empty-icon"><Icon name="star" size={30} strokeWidth={1.5} /></div>
        <div className="ppl-empty-title">No achievements yet</div>
        <div className="ppl-empty-sub">Add a goal to start a path.</div>
      </div>
    );
  }

  const curState = cur ? st(cur) : 'active';
  const reqs = cur ? parentsOf(path.conns, cur.id).map(byId).filter(Boolean) : [];
  const reqsDone = reqs.filter(g => g.completed).length;
  const kids = cur ? childrenOf(path.conns, cur.id).map(byId).filter(Boolean) : [];
  const prev = path && idx > 0 ? path.queue[idx - 1] : null;
  const next = path && idx < path.queue.length - 1 ? path.queue[idx + 1] : null;

  const menuGoal = menuId ? byId(menuId) : null;
  const canLink = achievements.length >= 2;

  return (
    <div className={`ppl${linkMode ? ' is-linking' : ''}`}>

      {/* ── The rail: every path, and how far through it you are ── */}
      <div className="ppl-rail">
        {paths.map((p, i) => (
          <button
            key={p.key}
            type="button"
            className={`ppl-chip${i === pathIdx ? ' is-on' : ''}${p.pct >= 1 ? ' is-done' : ''}`}
            onClick={() => { setPathKey(p.key); setStep(0); setTouched(false); }}
            aria-pressed={i === pathIdx}
          >
            <span className="ppl-ring" style={{ '--deg': `${(p.pct * 360).toFixed(0)}deg` }}>
              <span className="ppl-ring-in">{Math.round(p.pct * 100)}</span>
            </span>
            <span className="ppl-chip-text">
              <span className="ppl-chip-title">{p.title}</span>
              <span className="ppl-chip-sub">
                {p.standalone ? 'standalone'
                  : p.pct >= 1 ? 'path complete'
                  : `${p.done}/${p.total} · ${p.nextUp ? 'next up' : 'blocked'}`}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* ── The player ── */}
      <div className="ppl-stage">

        <div className="ppl-steps">
          <span className="ppl-steps-label">Step {path ? idx + 1 : 0} of {path ? path.queue.length : 0}</span>
          <div className="ppl-pips">
            {(path ? path.queue : []).map((g, i) => (
              <button
                key={g.id}
                type="button"
                className={`ppl-pip is-${st(g)}${i === idx ? ' is-here' : ''}`}
                title={`${g.name} — ${WORD[st(g)]}`}
                aria-label={`Step ${i + 1}: ${g.name}, ${WORD[st(g)]}`}
                onClick={() => goStep(i)}
              />
            ))}
          </div>
          {/* The map is something you OPEN, not a strip that sits there.
              As a permanent 54px band under the card it both ate the
              height the card needed and, on a short phone, painted
              straight over the card's own body. */}
          <button
            type="button"
            className="ppl-mapbtn"
            onClick={() => setBigMap(true)}
            title={cur ? `Path map — you are on ${cur.name}` : 'Path map'}
            aria-label="Open the path map"
          >
            <Icon name="compass" size={13} />
          </button>
          {canLink && (
            <button
              type="button"
              className={`ppl-linkbtn${linkMode ? ' is-on' : ''}`}
              onClick={() => (linkMode ? exitLink() : setLinkMode(true))}
            >
              <Icon name={linkMode ? 'x' : 'waypoints'} size={12} />
              {linkMode ? 'Done' : 'Link'}
            </button>
          )}
        </div>

        {linkMode && (
          <div className="ppl-linkbar" role="status">
            {connectingFrom ? (
              <>
                <strong>{byId(connectingFrom)?.name}</strong> comes first. Now tap what it unlocks.
                <span className="ppl-linkbar-hint">Tap an already-linked goal to unlink, or the same goal to cancel.</span>
              </>
            ) : (
              <>
                Tap the goal that has to be done <strong>first</strong>.
                <span className="ppl-linkbar-hint">Then the one it unlocks — use the chips, the unlock rows, or the map.</span>
              </>
            )}
          </div>
        )}

        {prev && <StepRow dir="up" ach={prev} state={st(prev)} onClick={() => goStep(idx - 1)} />}

        <div
          className={`ppl-card is-${curState}`}
          onTouchStart={swipeStart}
          onTouchEnd={swipeEnd}
          onMouseDown={swipeStart}
          onMouseUp={swipeEnd}
        >
          <div className="ppl-card-head">
            <div className="ppl-card-meta">
              <span className="ppl-state-dot" aria-hidden="true" />
              <span className="ppl-state">{WORD[curState]}</span>
              <span className="ppl-meta-gap" />
              {cur?.category && <span className="ppl-cat">{CATS[cur.category] || cur.category}</span>}
              {!!cur?.coins && <span className="ppl-coins"><span aria-hidden="true">⬡</span>{cur.coins}</span>}
            </div>
            <button
              type="button"
              className="ppl-card-title"
              onClick={() => (cur ? (linkMode ? onConnect?.(cur.id) : onEdit?.(cur.id)) : null)}
              onTouchStart={() => cur && pressStart(cur.id)}
              onTouchEnd={pressEnd}
              onTouchMove={pressEnd}
              onMouseDown={() => cur && pressStart(cur.id)}
              onMouseUp={pressEnd}
              onMouseLeave={pressEnd}
            >
              <span className="ppl-name">{cur ? cur.name : 'No goals yet'}</span>
              {cur?.desc && <span className="ppl-desc">{cur.desc}</span>}
            </button>
          </div>

          <div className="ppl-card-body">
            <div className="ppl-rule">
              <span className="ppl-rule-label">Needs first</span>
              <span className="ppl-rule-line" />
              <span className={`ppl-rule-count${reqs.length && reqsDone === reqs.length ? ' is-met' : reqs.length ? ' is-short' : ''}`}>
                {reqs.length ? `${reqsDone} of ${reqs.length} done` : 'none'}
              </span>
            </div>
            {reqs.length ? (
              <div className="ppl-reqs">
                {reqs.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    className={`ppl-req${g.completed ? ' is-done' : ''}`}
                    onClick={() => tap(g.id)}
                  >
                    <span aria-hidden="true">{g.completed ? '✓' : '○'}</span>
                    <span className="ppl-req-name">{g.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ppl-none">Nothing blocks this — it&rsquo;s a starting point on the path.</p>
            )}

            <div className="ppl-rule">
              <span className="ppl-rule-label">Unlocks</span>
              <span className="ppl-rule-line" />
              <span className="ppl-rule-count">
                {kids.length ? `${kids.length} goal${kids.length > 1 ? 's' : ''}` : 'nothing'}
              </span>
            </div>
            {kids.length ? (
              <div className="ppl-unlocks">
                {kids.map(g => (
                  <StepRow key={g.id} dir="down" ach={g} state={st(g)} onClick={() => tap(g.id)} />
                ))}
              </div>
            ) : (
              <p className="ppl-end"><span aria-hidden="true">★</span> End of the path — nothing waits on this one.</p>
            )}
          </div>

          <div className="ppl-card-foot">
            <button
              type="button"
              className="ppl-nudge"
              aria-label="Previous step"
              onClick={() => (idx > 0 ? goStep(idx - 1) : say('Start of the path'))}
            ><Icon name="chevron-left" size={16} /></button>

            <button
              type="button"
              className={`ppl-cta is-${curState}${linkMode ? ' is-link' : ''}`}
              disabled={!linkMode && curState === 'locked'}
              onClick={() => (linkMode ? cur && onConnect?.(cur.id) : complete(cur))}
            >
              {linkMode
                ? (connectingFrom === cur?.id ? 'Tap what it unlocks' : 'Tap to link this')
                : curState === 'completed' ? '★ Completed — undo'
                : curState === 'locked' ? 'Locked'
                : '✓ Mark complete'}
            </button>

            <button
              type="button"
              className="ppl-nudge"
              aria-label="Next step"
              onClick={() => (path && idx < path.queue.length - 1 ? goStep(idx + 1) : say('End of the path'))}
            ><Icon name="chevron-right" size={16} /></button>
          </div>
        </div>

        {next && <StepRow dir="down" ach={next} state={st(next)} onClick={() => goStep(idx + 1)} />}
      </div>

      {menuGoal && createPortal(
        <QuickActions
          goal={menuGoal}
          state={st(menuGoal)}
          onClose={() => setMenuId(null)}
          onComplete={() => { setMenuId(null); complete(menuGoal); }}
          onEdit={() => { setMenuId(null); onEdit?.(menuGoal.id); }}
          onLink={() => { setMenuId(null); setLinkMode(true); onConnect?.(menuGoal.id); }}
          onDelete={() => { setMenuId(null); onDelete?.(menuGoal.id); }}
        />, document.body)}

      {bigMap && path && createPortal(
        <BigMap
          path={path}
          currentId={cur ? cur.id : null}
          connectingFrom={connectingFrom}
          stateOfGoal={st}
          onPick={id => tap(id)}
          onClose={() => setBigMap(false)}
        />, document.body)}

      {toast && <div className="ppl-toast" role="status">{toast}</div>}
    </div>
  );
}

/** The step above or below, and every "unlocks" row — one line each. */
function StepRow({ dir, ach, state, onClick }) {
  return (
    <button type="button" className={`ppl-row is-${state}`} onClick={onClick}>
      <Icon name={dir === 'up' ? 'arrow-up' : 'arrow-down'} size={12} />
      <span className="ppl-row-dot" aria-hidden="true" />
      <span className="ppl-row-name">{ach.name}</span>
      <span className="ppl-row-state">{WORD[state]}</span>
    </button>
  );
}

/**
 * Long-press actions. A sheet rather than a menu because the four things
 * a goal can have done to it are the same four wherever you press it, and
 * on a phone the bottom of the screen is where the thumb already is.
 */
function QuickActions({ goal, state, onClose, onComplete, onEdit, onLink, onDelete }) {
  return (
    <div className="ppl-sheet-scrim" onClick={onClose} role="presentation">
      <div className="ppl-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={`Actions for ${goal.name}`}>
        <div className="ppl-sheet-head">
          <span className="ppl-sheet-eyebrow">Quick actions</span>
          <span className="ppl-sheet-name">{goal.name}</span>
        </div>
        <div className="ppl-sheet-items">
          <button type="button" className="ppl-sheet-item" onClick={onComplete} disabled={state === 'locked'}>
            <Icon name={goal.completed ? 'repeat' : 'check'} size={15} />
            {goal.completed ? 'Mark not done' : state === 'locked' ? 'Locked — needs its prerequisites' : 'Mark complete'}
          </button>
          <button type="button" className="ppl-sheet-item" onClick={onEdit}>
            <Icon name="pencil" size={15} />Edit goal
          </button>
          <button type="button" className="ppl-sheet-item" onClick={onLink}>
            <Icon name="waypoints" size={15} />Link from this goal
          </button>
          <button type="button" className="ppl-sheet-item is-danger" onClick={onDelete}>
            <Icon name="trash-2" size={15} />Delete goal
          </button>
        </div>
        <button type="button" className="ppl-sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * The path at a readable size. Rows are dependency depth — which is worth
 * saying in words, because it is the one thing a drawn graph never
 * manages to communicate on its own.
 */
function BigMap({ path, currentId, connectingFrom, stateOfGoal, onPick, onClose }) {
  const m = useMemo(() => mapLayout(path), [path]);
  return (
    <div className="ppl-big">
      <div className="ppl-big-head">
        <div className="ppl-big-titles">
          <span className="ppl-big-eyebrow">Path map</span>
          <span className="ppl-big-title">{path.title}</span>
        </div>
        <button type="button" className="btn btn-ghost ppl-big-close" onClick={onClose}>Close</button>
      </div>
      <p className="ppl-big-sub">
        Tap any goal to jump the player to it. Rows are dependency depth — everything on a row
        can be worked in any order.
      </p>
      <div className="ppl-big-scroll">
        <div className="ppl-big-canvas">
          <svg viewBox={m.viewBox} width={m.w} height={m.h} className="ppl-big-svg" aria-hidden="true">
            {m.edges.map(e => (
              <path key={e.key} d={e.d} fill="none" strokeLinecap="round"
                className={`ppl-map-edge${e.done ? ' is-done' : ''}`} />
            ))}
          </svg>
          <div className="ppl-big-nodes" style={{ height: m.h }}>
            {m.nodes.map(nd => {
              const s = stateOfGoal(nd.ach);
              return (
                <button
                  key={nd.id}
                  type="button"
                  className={`ppl-node is-${s}${nd.id === currentId ? ' is-here' : ''}${nd.id === connectingFrom ? ' is-source' : ''}`}
                  style={{ left: nd.left, top: nd.top, width: nd.w }}
                  onClick={() => onPick(nd.id)}
                >
                  <span className="ppl-node-top">
                    <span className="ppl-node-dot" aria-hidden="true" />
                    <span className="ppl-node-name">{nd.ach.name}</span>
                  </span>
                  <span className="ppl-node-state">{WORD[s]}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

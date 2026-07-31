import { useEffect, useMemo, useState } from 'react';
import Icon from '../Icon';
import { layoutTree, edgePath, splitComponents, endGoals } from '../../lib/achievements/layout';

/**
 * The achievement graph as vertical trees — the mobile stand-in for the
 * pannable desktop canvas.
 *
 * It is the SAME graph: same nodes, same dependencies, same three
 * states and the same colour language. Only the arrangement is derived
 * rather than hand-placed, because a layout someone dragged out on a
 * 1440px board is precisely what needs pinching and panning to read on
 * a phone.
 *
 * Each independent path is laid out on its own. Sharing one layered
 * layout across the whole board meant unrelated chains interleaved and,
 * worse, that goals with no prerequisites were treated as roots of the
 * tree — so unlinked goals padded out layer 0 until it wrapped and
 * pushed the real structure down. An 11-goal board with 5 unlinked
 * rendered three layers as five rows, with "Learn guitar" apparently
 * sitting one level above "Save a house deposit". Now a row means what
 * it looks like it means, and goals on no path at all are shown as
 * exactly that rather than being dressed up as roots.
 *
 * Where a goal has more than one prerequisite, the inbound lines are
 * tied together under an explicit junction rather than being left as
 * two arrows that happen to land on the same card. Stacking them
 * vertically would have implied an order that doesn't exist; the
 * tie-bar says "all of these", and the chip counts how many are done.
 */
export default function AchievementTree({
  achievements = [],
  connections = [],
  onComplete,
  onEdit,
  onConnect,
  connectingFrom = null,
  onCancelConnect,
}) {
  const { paths, loose } = useMemo(
    () => splitComponents(achievements, connections),
    [achievements, connections],
  );

  const [linkMode, setLinkMode] = useState(false);

  // A link started elsewhere (or surviving a remount) should show its
  // own UI rather than leaving a goal highlighted with nothing on
  // screen explaining why.
  useEffect(() => { if (connectingFrom) setLinkMode(true); }, [connectingFrom]);

  const canLink = achievements.length >= 2;

  function exitLink() {
    setLinkMode(false);
    onCancelConnect?.();
  }

  // In link mode the whole card is a link target, so a tap must not
  // also open the editor.
  function tapCard(id) {
    if (linkMode) onConnect?.(id);
    else onEdit?.(id);
  }

  // What re-tapping would UNLINK, so the affordance can say so instead
  // of looking identical to making a new link.
  const wouldUnlink = useMemo(() => {
    if (!connectingFrom) return new Set();
    return new Set(
      connections.filter(([f]) => f === connectingFrom).map(([, t]) => t),
    );
  }, [connectingFrom, connections]);

  if (!achievements.length) {
    return (
      <div className="ach-tree-empty">
        <div className="ach-tree-empty-icon"><Icon name="star" size={30} strokeWidth={1.5} /></div>
        <div className="ach-tree-empty-title">No achievements yet</div>
        <div className="ach-tree-empty-sub">Add a goal to start your tree.</div>
      </div>
    );
  }

  const cardProps = { onComplete, tapCard, linkMode, connectingFrom, wouldUnlink };

  return (
    <div className={`ach-tree-wrap${linkMode ? ' is-linking' : ''}`}>
      {canLink && (
        <div className="ach-tree-toolbar">
          <button
            type="button"
            className={`ach-tree-linkbtn${linkMode ? ' is-on' : ''}`}
            onClick={() => (linkMode ? exitLink() : setLinkMode(true))}
          >
            <Icon name={linkMode ? 'x' : 'waypoints'} size={14} />
            {linkMode ? 'Done linking' : 'Link goals'}
          </button>
        </div>
      )}

      {linkMode && (
        <div className="ach-tree-linkbar" role="status">
          {connectingFrom ? (
            <>
              <strong>{achievements.find(a => a.id === connectingFrom)?.name}</strong>
              {' comes first. Now tap what it unlocks.'}
              <span className="ach-tree-linkbar-hint">
                Tap an already-linked goal to unlink. Tap the same goal to cancel.
              </span>
            </>
          ) : (
            <>
              Tap the goal that has to be done <strong>first</strong>.
              <span className="ach-tree-linkbar-hint">
                Then tap the one it unlocks — that becomes its prerequisite.
              </span>
            </>
          )}
        </div>
      )}

      {paths.map((p, i) => (
        <PathGroup
          key={`path-${p.achievements[0].id}`}
          index={i}
          path={p}
          allAchievements={achievements}
          {...cardProps}
        />
      ))}

      {loose.length > 0 && (
        <section className="ach-tree-group">
          <header className="ach-tree-group-head">
            <span className="ach-tree-group-eyebrow">Not on a path</span>
            <h4 className="ach-tree-group-title">
              {loose.length} standalone {loose.length === 1 ? 'goal' : 'goals'}
            </h4>
            <p className="ach-tree-group-sub">
              Nothing depends on these and they depend on nothing.
              {canLink && ' Use Link goals to put one on a path.'}
            </p>
          </header>
          <div className="ach-tree-loose">
            {loose.map(a => (
              <LooseCard key={a.id} ach={a} {...cardProps} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** One independent path, laid out against only its own nodes. */
function PathGroup({ path, index, allAchievements, onComplete, tapCard, linkMode, connectingFrom, wouldUnlink }) {
  const layout = useMemo(
    () => layoutTree(path.achievements, path.connections),
    [path],
  );
  const { nodes, edges, width, height, parents } = layout;
  const cards = [...nodes.values()].filter(n => n.kind === 'node');

  const ends = endGoals(path.achievements, path.connections);
  const done = path.achievements.filter(a => a.completed).length;

  // Junction bars: one per goal with 2+ prerequisites, sitting just
  // above the card so the tie is visibly what feeds it.
  const junctions = cards
    .map(n => {
      const ps = parents.get(n.id) || [];
      if (ps.length < 2) return null;
      const doneP = ps.filter(p => allAchievements.find(a => a.id === p)?.completed).length;
      return { id: n.id, x: n.x, w: n.w, y: n.top - 15, total: ps.length, done: doneP };
    })
    .filter(Boolean);

  return (
    <section className="ach-tree-group">
      <header className="ach-tree-group-head">
        <span className="ach-tree-group-eyebrow">Path {index + 1}</span>
        <h4 className="ach-tree-group-title">
          {ends.length === 1 ? `Leads to ${ends[0].name}` : `${ends.length} end goals`}
        </h4>
        <p className="ach-tree-group-sub">{done} of {path.achievements.length} done</p>
      </header>

      <div className="ach-tree" style={{ height }}>
        <svg className="ach-tree-lines" width={width} height={height} aria-hidden="true">
          {edges.map((e, i) => {
            const d = edgePath(layout, e);
            if (!d) return null;
            const from = allAchievements.find(a => a.id === e.from);
            const to = allAchievements.find(a => a.id === e.to);
            const isDone = !!from?.completed;
            const cls = isDone && to?.completed ? 'is-done' : isDone ? 'is-open' : 'is-locked';
            return (
              <g key={`${e.from}-${e.to}-${i}`} className={`ach-tree-edge ${cls}`}>
                {/* Casing first: a stroke in the canvas colour under the
                    line, so where two cross you can see which is which. */}
                <path d={d} className="ach-tree-edge-casing" />
                <path d={d} className="ach-tree-edge-line" />
              </g>
            );
          })}
        </svg>

        {junctions.map(j => (
          <div key={`j-${j.id}`} className="ach-tree-junction" style={{ left: j.x, top: j.y, width: j.w }}>
            <span className="ach-tree-junction-bar" />
            <span className="ach-tree-junction-chip">all {j.total} · {j.done} of {j.total}</span>
            <span className="ach-tree-junction-bar" />
          </div>
        ))}

        {cards.map(n => {
          const a = n.ach;
          const status = a.completed ? 'completed' : a.locked ? 'locked' : 'active';
          const ps = parents.get(n.id) || [];
          const doneParents = ps.filter(p => allAchievements.find(x => x.id === p)?.completed).length;
          const isSource = connectingFrom === a.id;
          const unlinks = wouldUnlink.has(a.id);
          return (
            <div
              key={n.id}
              className={
                `ach-tree-node is-${status}` +
                (isSource ? ' is-source' : '') +
                (linkMode && unlinks ? ' is-unlink' : '')
              }
              style={{ left: n.x, top: n.top, width: n.w, height: n.h }}
            >
              <button
                type="button"
                className="ach-tree-card"
                onClick={() => tapCard(a.id)}
                aria-label={
                  linkMode
                    ? `${a.name} — ${isSource ? 'selected, tap to cancel' : unlinks ? 'tap to unlink' : 'tap to link'}`
                    : `${a.name} — ${status}. Edit`
                }
              >
                <span className="ach-tree-name">{a.name}</span>
                {n.w >= 150 && (
                  <span className="ach-tree-meta">
                    {isSource ? 'Comes first — pick what it unlocks'
                      : linkMode && unlinks ? 'Tap to unlink'
                      : a.locked && ps.length ? `${doneParents}/${ps.length} required`
                      : a.completed ? 'Completed' : 'In progress'}
                    {!linkMode && a.coins > 0 && <em> · ⬡{a.coins}</em>}
                  </span>
                )}
              </button>
              {/* Inside the card, not beside it: a 34px button alongside
                  cost every card 40px of width, which forced a three-goal
                  layer to wrap onto two lines and made one layer look
                  like two. Hidden while linking so the whole card is one
                  unambiguous target. */}
              {!linkMode && (
                <button
                  type="button"
                  className="ach-tree-tick"
                  disabled={a.locked}
                  onClick={() => onComplete?.(a.id)}
                  aria-label={a.completed ? `Mark ${a.name} not done` : `Mark ${a.name} complete`}
                  title={a.locked ? 'Locked until its prerequisites are done' : undefined}
                >
                  <Icon name={a.completed ? 'star' : a.locked ? 'lock' : 'check'} size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A goal on no path — flowed in a plain grid, not a layout. */
function LooseCard({ ach: a, onComplete, tapCard, linkMode, connectingFrom, wouldUnlink }) {
  const status = a.completed ? 'completed' : 'active';
  const isSource = connectingFrom === a.id;
  const unlinks = wouldUnlink.has(a.id);
  return (
    <div
      className={
        `ach-tree-loose-card is-${status}` +
        (isSource ? ' is-source' : '') +
        (linkMode && unlinks ? ' is-unlink' : '')
      }
    >
      <button
        type="button"
        className="ach-tree-card"
        onClick={() => tapCard(a.id)}
        aria-label={linkMode ? `${a.name} — tap to link` : `${a.name} — ${status}. Edit`}
      >
        <span className="ach-tree-name">{a.name}</span>
        <span className="ach-tree-meta">
          {isSource ? 'Comes first' : linkMode && unlinks ? 'Tap to unlink'
            : a.completed ? 'Completed' : 'In progress'}
          {!linkMode && a.coins > 0 && <em> · ⬡{a.coins}</em>}
        </span>
      </button>
      {!linkMode && (
        <button
          type="button"
          className="ach-tree-tick"
          onClick={() => onComplete?.(a.id)}
          aria-label={a.completed ? `Mark ${a.name} not done` : `Mark ${a.name} complete`}
        >
          <Icon name={a.completed ? 'star' : 'check'} size={13} />
        </button>
      )}
    </div>
  );
}

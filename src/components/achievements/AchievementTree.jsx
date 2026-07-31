import { useMemo } from 'react';
import Icon from '../Icon';
import { layoutTree, edgePath } from '../../lib/achievements/layout';

/**
 * The achievement graph as a vertical tree — the mobile stand-in for the
 * pannable desktop canvas.
 *
 * It is the SAME graph: same nodes, same dependencies, same three states
 * and the same colour language. Only the arrangement is derived rather
 * than hand-placed, because a layout someone dragged out on a 1440px
 * board is precisely what needs pinching and panning to read on a phone.
 *
 * The one honest trade: node positions come from the graph, so this view
 * doesn't reflect a desktop arrangement and you can't rearrange from it.
 * Everything else — completing, editing, the lock rules — behaves the
 * same, because it calls the same handlers the canvas does.
 *
 * Where a goal has more than one prerequisite, the inbound lines are
 * tied together under an explicit junction rather than being left as two
 * arrows that happen to land on the same card. Stacking them vertically
 * would have implied an order that doesn't exist; the tie-bar says
 * "all of these", and the chip counts how many are done.
 */
export default function AchievementTree({
  achievements = [],
  connections = [],
  onComplete,
  onEdit,
}) {
  const layout = useMemo(
    () => layoutTree(achievements, connections),
    [achievements, connections],
  );

  if (!achievements.length) {
    return (
      <div className="ach-tree-empty">
        <div className="ach-tree-empty-icon"><Icon name="star" size={30} strokeWidth={1.5} /></div>
        <div className="ach-tree-empty-title">No achievements yet</div>
        <div className="ach-tree-empty-sub">Add a goal to start your tree.</div>
      </div>
    );
  }

  const { nodes, edges, width, height, parents } = layout;
  const cards = [...nodes.values()].filter(n => n.kind === 'node');

  // Junction bars: one per goal with 2+ prerequisites, sitting just
  // above the card so the tie is visibly what feeds it.
  const junctions = cards
    .map(n => {
      const ps = parents.get(n.id) || [];
      if (ps.length < 2) return null;
      const done = ps.filter(p => achievements.find(a => a.id === p)?.completed).length;
      return { id: n.id, x: n.x, w: n.w, y: n.top - 15, total: ps.length, done };
    })
    .filter(Boolean);

  return (
    <div className="ach-tree" style={{ height }}>
      <svg className="ach-tree-lines" width={width} height={height} aria-hidden="true">
        {edges.map((e, i) => {
          const d = edgePath(layout, e);
          if (!d) return null;
          const from = achievements.find(a => a.id === e.from);
          const to = achievements.find(a => a.id === e.to);
          const done = !!from?.completed;
          const cls = done && to?.completed ? 'is-done' : done ? 'is-open' : 'is-locked';
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
          <span className="ach-tree-junction-chip">
            all {j.total} · {j.done} of {j.total}
          </span>
          <span className="ach-tree-junction-bar" />
        </div>
      ))}

      {cards.map(n => {
        const a = n.ach;
        const status = a.completed ? 'completed' : a.locked ? 'locked' : 'active';
        const ps = parents.get(n.id) || [];
        const doneParents = ps.filter(p => achievements.find(x => x.id === p)?.completed).length;
        return (
          <div
            key={n.id}
            className={`ach-tree-node is-${status}`}
            style={{ left: n.x, top: n.top, width: n.w, height: n.h }}
          >
            <button
              type="button"
              className="ach-tree-card"
              onClick={() => onEdit?.(a.id)}
              aria-label={`${a.name} — ${status}. Edit`}
            >
              <span className="ach-tree-name">{a.name}</span>
              {n.w >= 150 && (
                <span className="ach-tree-meta">
                  {a.locked && ps.length
                    ? `${doneParents}/${ps.length} required`
                    : a.completed ? 'Completed' : 'In progress'}
                  {a.coins > 0 && <em> · ⬡{a.coins}</em>}
                </span>
              )}
            </button>
            {/* Inside the card, not beside it: a 34px button alongside
                cost every card 40px of width, which forced a three-goal
                layer to wrap onto two lines and made one layer look
                like two. */}
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
          </div>
        );
      })}
    </div>
  );
}

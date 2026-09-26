/**
 * The master timeline: one lane per stream, one column per month, items
 * placed by month and packed into sub-rows so two in the same lane and
 * month never overlap. Decision points are diamonds. Today is a line.
 *
 * The grid scrolls sideways inside its own card (never the page), and
 * opens scrolled so today sits near the left edge. On a phone it becomes
 * a list by month instead — sixteen 90px columns do not fit a thumb.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { columns, span, statusOf } from '../../../lib/career/planTimeline';
import { monthLabel, monthOf } from '../../../lib/career/money';

const LANE_W = 88;
const COL_W = 112;
const ROW_H = 50;

const STATUS_MARK = { done: '✓', at_risk: '!', in_progress: ' ', planned: '' };

export function ItemChip({ item, color, status, onOpen, full = false }) {
  return (
    <button
      type="button"
      className={`cp-it is-${status}${item.decision ? ' is-decision' : ''}${full ? ' is-full' : ''}`}
      style={{ '--s': color }}
      onClick={() => onOpen(item)}
      title={item.title}
    >
      {item.decision && <span className="cp-diamond" aria-hidden="true">◆</span>}
      <span className="cp-it-t">{item.title}</span>
      {STATUS_MARK[status] && <span className={`cp-it-s is-${status}`} aria-hidden="true">{STATUS_MARK[status]}</span>}
      <span className="cp-sr">{item.decision ? 'Decision point. ' : ''}Status: {status.replace('_', ' ')}</span>
    </button>
  );
}

/** Greedy interval packing: each item takes the first sub-row free by its start. */
function packLane(entries) {
  const ends = [];
  const items = entries.map(e => {
    let r = ends.findIndex(end => end < e.a);
    if (r < 0) { r = ends.length; ends.push(-1); }
    ends[r] = e.b;
    return { ...e, row: r };
  });
  return { items, rows: Math.max(1, ends.length) };
}

export default function Timeline({ plan, statusMap, visible, hideDone, postMonth, onOpen, isMobile, now = new Date() }) {
  const cols = useMemo(() => columns(plan.range), [plan.range]);
  const colorOf = useMemo(() => Object.fromEntries((plan.streams || []).map(s => [s.id, s.color || '#888888'])), [plan.streams]);

  const placed = useMemo(() => (plan.items || [])
    .filter(it => visible.has(it.stream))
    .map(it => ({ it, status: statusOf(it, statusMap), sp: span(it, cols, postMonth) }))
    .filter(x => x.sp && !(hideDone && x.status === 'done')), [plan.items, visible, statusMap, cols, postMonth, hideDone]);

  const lanes = useMemo(() => {
    let rowAt = 2; // grid row 1 is the header
    return (plan.streams || []).filter(s => visible.has(s.id)).map(s => {
      const entries = placed.filter(p => p.it.stream === s.id)
        .map(p => ({ ...p, a: p.sp[0], b: p.sp[1] }))
        .sort((x, y) => x.a - y.a || y.b - x.b);
      const { items, rows: n } = packLane(entries);
      const lane = { stream: s, first: rowAt, n, items: items.map(p => ({ ...p, gridRow: rowAt + p.row })) };
      rowAt += n;
      return lane;
    });
  }, [plan.streams, visible, placed]);

  const today = monthOf(now);
  const todayIdx = cols.indexOf(today);
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const todayX = todayIdx >= 0 ? LANE_W + (todayIdx + (now.getDate() - 0.5) / dim) * COL_W : null;

  const scroller = useRef(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    // Today near the left edge, with the month before it still in view.
    if (el && todayX != null) el.scrollLeft = Math.max(0, todayX - LANE_W - COL_W * 1.2);
  }, [todayX]);

  if (isMobile) {
    // By month: each item under the month it starts in.
    const byCol = cols.map((c, i) => ({ c, items: placed.filter(p => p.sp[0] === i) })).filter(g => g.items.length);
    return (
      <div className="cp-tl-list">
        {byCol.map(g => (
          <section key={g.c} className={`cp-tl-month${g.c === today ? ' is-today' : ''}`}>
            <h4 className="cp-eyebrow">// {g.c === 'after' ? 'Later' : monthLabel(g.c)}{g.c === today ? ' · today' : ''}</h4>
            {g.items.map(p => (
              <div key={p.it.id} className="cp-tl-row">
                <span className="cp-tag" style={{ '--s': colorOf[p.it.stream] }}>{p.it.stream}</span>
                <ItemChip item={p.it} color={colorOf[p.it.stream]} status={p.status} onOpen={onOpen} full />
              </div>
            ))}
          </section>
        ))}
      </div>
    );
  }

  const totalRows = lanes.reduce((n, l) => n + l.n, 0);
  return (
    <div className="cp-tl-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Master timeline, scrolls sideways">
      <div
        className="cp-tl-grid"
        style={{
          gridTemplateColumns: `${LANE_W}px repeat(${cols.length}, ${COL_W}px)`,
          gridTemplateRows: `30px repeat(${totalRows}, ${ROW_H}px)`,
          width: LANE_W + cols.length * COL_W,
        }}
      >
        <div className="cp-tl-corner" style={{ gridRow: 1, gridColumn: 1 }} />
        {cols.map((c, i) => (
          <div key={c} className={`cp-tl-mh${c === today ? ' is-today' : ''}${c.endsWith('-01') ? ' is-year' : ''}`}
               style={{ gridRow: 1, gridColumn: i + 2 }}>
            {c === 'after' ? 'Later' : monthLabel(c)}{c === today ? ' · today' : ''}
          </div>
        ))}
        {lanes.map((l, li) => (
          <div key={l.stream.id} style={{ display: 'contents' }}>
            <div className={`cp-tl-band${li % 2 ? ' is-odd' : ''}`} style={{ gridRow: `${l.first} / span ${l.n}`, gridColumn: `2 / span ${cols.length}` }} />
            <div className="cp-tl-lane" style={{ gridRow: `${l.first} / span ${l.n}`, gridColumn: 1, '--s': l.stream.color }}>
              <span>{l.stream.label || l.stream.id}</span>
            </div>
            {l.items.map(p => (
              <div key={p.it.id} className="cp-tl-cell" style={{ gridRow: p.gridRow, gridColumn: `${p.a + 2} / ${p.b + 3}` }}>
                <ItemChip item={p.it} color={l.stream.color} status={p.status} onOpen={onOpen} />
              </div>
            ))}
          </div>
        ))}
        {todayX != null && (
          <div className="cp-tl-today" style={{ left: todayX }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

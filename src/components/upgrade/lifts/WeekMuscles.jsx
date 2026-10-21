/**
 * THIS WEEK, by muscle — the adaptive-training panel on the Lifts home
 * (owner's design, 2026-10-21; mockup 04). A week is one rota block.
 *
 *   // This week · 19–26 Oct · 3 of 5 done
 *   Shoulders  ▬▬▬▬▭▭▭  12 / 30  ●○
 *   …
 *   Dots: sessions this week with 2+ sets for that muscle.
 *   [gold]  Push was missed — this week will finish below standard.
 *   [box]   Targets moved this week · Side delts 11.5 → 12.5 · why
 *
 * Tap a group → its parts, each with its own bar (one open at a time).
 * Read-only: everything comes from weekView (lib/lifts/adaptive.js),
 * worked out from the logged workouts, the rota and the programme —
 * nothing is stored. Outside a rota block it renders nothing.
 */
import { useMemo, useState } from 'react';
import Icon from '../../Icon';
import { weekView, UPPER_GROUPS, LOWER_GROUPS } from '../../../lib/lifts/adaptive';
import { blockProgress } from '../../../lib/lifts/plan';
import './week-muscles.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDER = [...UPPER_GROUPS, ...LOWER_GROUPS];

/** '2026-10-19', '2026-10-26' → '19–26 Oct'; across months '28 Oct – 4 Nov'. */
export function spanLabel(start, end) {
  const [, m1, d1] = String(start).split('-').map(Number);
  const [, m2, d2] = String(end).split('-').map(Number);
  if (!m1 || !m2) return '';
  return m1 === m2 ? `${d1}–${d2} ${MONTHS[m2 - 1]}` : `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}
const fmt = n => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1));
const pct = (done, target) => (target > 0 ? Math.min(100, (done / target) * 100) : done > 0 ? 100 : 0);
const listOf = codes => (codes.length < 2 ? codes.join('') : `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`);

function Bar({ done, target }) {
  return <span className={`wm-bar${target > 0 && done >= target ? ' is-full' : ''}`} aria-hidden="true"><i style={{ width: `${pct(done, target)}%` }} /></span>;
}
function Value({ done, target }) {
  return <span className="wm-v lf-num" aria-hidden="true">{fmt(done)} / {target > 0 ? fmt(target) : '—'}</span>;
}

export default function WeekMuscles({ S, today }) {
  const view = useMemo(() => {
    const v = weekView(S, today);
    if (!v) return null;
    const m = /^(\d+) of (\d+)/.exec(v.label || '');
    const bp = m ? null : blockProgress(S, today);
    const count = m ? { done: +m[1], total: +m[2] } : bp ? { done: bp.done.length, total: bp.total } : null;
    const rank = g => { const i = ORDER.indexOf(g); return i < 0 ? ORDER.length : i; };
    const groups = [...v.groups].sort((a, b) => rank(a.group) - rank(b.group));
    return { ...v, count, groups };
  }, [S, today]);
  const [open, setOpen] = useState(null);
  if (!view) return null;

  const cols = [
    view.groups.filter(g => !LOWER_GROUPS.includes(g.group)),
    view.groups.filter(g => LOWER_GROUPS.includes(g.group)),
  ].filter(c => c.length);
  const row = g => {
    const hits = Math.min(2, g.hits || 0);
    const isOpen = open === g.group;
    const parts = view.parts.filter(p => p.group === g.group);
    const id = `wm-parts-${g.group.replace(/\W+/g, '-').toLowerCase()}`;
    const label = `${g.group}: ${fmt(g.done)} of ${g.target > 0 ? fmt(g.target) : 'no'} sets, ${hits} of 2 sessions hit`;
    return (
      <li key={g.group} className={`wm-g${isOpen ? ' is-open' : ''}`}>
        <button type="button" className="wm-row" aria-expanded={isOpen} aria-controls={id} aria-label={label}
                onClick={() => setOpen(isOpen ? null : g.group)} data-testid="wm-row">
          <span className="wm-n" aria-hidden="true">{g.group}</span>
          <Bar done={g.done} target={g.target} />
          <Value done={g.done} target={g.target} />
          <span className="wm-dots" aria-hidden="true">{[0, 1].map(i => <i key={i} className={i < hits ? 'on' : ''} />)}</span>
          <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} className="wm-chev" />
        </button>
        {isOpen && (
          <ul className="wm-parts" id={id} aria-label={`${g.group} by part`} data-testid="wm-parts">
            {parts.map(p => (
              <li key={p.part} className="wm-p">
                <span className="wm-pn">{p.part}<span className="sr-only">: {fmt(p.done)} of {p.target > 0 ? fmt(p.target) : 'no'} sets</span></span>
                <Bar done={p.done} target={p.target} />
                <Value done={p.done} target={p.target} />
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section className="lh-card wm" aria-labelledby="lh-wm-h" data-testid="wm">
      <p className="lf-eyebrow" id="lh-wm-h">
        // This week · {spanLabel(view.start, view.end)}{view.count && <> · <span className="lf-num">{view.count.done} of {view.count.total}</span> done</>}
      </p>
      <div className="wm-cols">
        {cols.map((c, i) => <ul key={i} className="wm-list">{c.map(row)}</ul>)}
      </div>
      <p className="wm-legend">Dots: sessions this week with 2+ sets for that muscle. Goal: both filled.</p>
      {view.belowStandard && view.missed.length > 0 && (
        <p className="wm-warn" data-testid="wm-warn">
          {listOf(view.missed)} {view.missed.length > 1 ? 'were' : 'was'} missed — this week will finish below standard.
        </p>
      )}
      {view.changes && view.changes.length > 0 && (
        <div className="wm-changes" data-testid="wm-changes">
          <p className="wm-changes-h">Targets moved this week</p>
          <ul>
            {view.changes.map(c => (
              <li key={c.part}>
                <span className={`wm-chg lf-num${c.to > c.from ? ' is-up' : ''}`}>
                  {c.part} {c.to === c.from ? `held at ${fmt(c.to)}` : <>{fmt(c.from)} → {fmt(c.to)}</>}
                </span>
                {c.why && <> · {c.why}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

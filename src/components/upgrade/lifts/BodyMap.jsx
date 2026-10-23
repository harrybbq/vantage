/**
 * The body map on the Finish sheet (lib/lifts/bodymap.js): front and
 * back, each muscle filled in the accent at the share of its target the
 * work delivered — full when the sets for it are done, faint when they
 * fell short, empty when it wasn't trained. Under it, the muscles as
 * "done / target sets" rows.
 *
 * Two tabs:
 *   This workout  the workout being finished against its session's
 *                 targets — short muscles first, then anything trained
 *                 that the session doesn't ask for.
 *   This week     the rota block's tally against the week's targets,
 *                 the workout being finished included (adaptive.js
 *                 weekView). Hidden outside a block.
 * and an "All muscles" switch: off, the twelve groups; on, the muscle
 * PARTS (front / side / rear delts, upper / lower chest, the triceps
 * heads …) on the figure and in the rows, grouped under their group.
 * Both are view state — nothing here writes to S. The Finish sheet pages
 * it (`view`: 'figure' on its first page, 'rows' on the next) and holds
 * the tab and the switch itself (`tab`/`onTab`, `all`/`onAll`), so both
 * pages show the same range; left alone, BodyMap keeps them locally.
 *
 * The figure is anatomical: muscle regions from react-body-highlighter
 * (MIT — see bodyShapes.js), each tagged with a group and a part. A
 * region drawn but never filled (head, knees, forearms) gives the body
 * its shape. Regions are separated by a hairline in the card's own
 * colour, so they read apart in both themes; a region split between two
 * parts (chest, front deltoid) is cut by a clip with the same hairline.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { bodyMap, bodyMapParts } from '../../../lib/lifts/bodymap';
import { weekView, PARTS } from '../../../lib/lifts/adaptive';
import { blockProgress, sessionOfWorkout } from '../../../lib/lifts/plan';
import { FRONT, BACK, CLIPS } from './bodyShapes';

const GROUP_ORDER = [...new Set(PARTS.map(p => p[1]))];
const ratioOf = (done, target) => (target > 0 ? Math.min(1, done / target) : done > 0 ? 1 : 0);
const setsText = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** "Triceps long head" under Triceps reads "Long head". */
const partLabel = (part, group) => {
  if (part !== group && part.startsWith(`${group} `)) {
    const rest = part.slice(group.length + 1);
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return part;
};

function Figure({ shapes, ratios, parts, label, uid }) {
  const clipId = c => `${uid}-${c}`;
  const zone = (key, pts, r, clip) => (
    <g key={key} clipPath={clip ? `url(#${clipId(clip)})` : undefined}>
      <polygon points={pts} className="lw-body-zone" />
      {r > 0 && <polygon points={pts} className="lw-body-fill" style={{ fillOpacity: r }} />}
    </g>
  );
  return (
    <figure className="lw-body-fig">
      <svg viewBox="0 0 100 200" aria-hidden="true">
        {parts && (
          <defs>
            {Object.entries(CLIPS).map(([id, rects]) => (
              <clipPath key={id} id={clipId(id)}>
                {rects.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}
              </clipPath>
            ))}
          </defs>
        )}
        {shapes.map(([group, part, pts], i) => {
          if (!group) return <polygon key={i} points={pts} className="lw-body-base" />;
          if (!parts) return zone(i, pts, ratios[group] || 0);
          if (Array.isArray(part)) return <g key={i}>{part.map(([p, clip]) => zone(p, pts, ratios[p] || 0, clip))}</g>;
          return zone(i, pts, ratios[part] || 0);
        })}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Row({ label, done, target, ratio, extra = false }) {
  return (
    <li className={extra ? 'is-extra' : ratio >= 1 ? 'is-met' : ''}>
      <span>{label}</span>
      <span className="lw-body-bar"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
      {extra
        ? <span className="lf-num">{setsText(done)} <span className="lf-meta">extra</span></span>
        : <span className="lf-num">{setsText(done)} / {setsText(target)}</span>}
    </li>
  );
}

/** Part rows under group headings: [{ group, rows: [{ part, done, target, ratio, extra }] }]. */
function PartRows({ groups }) {
  return (
    <ul className="lw-body-rows is-parts">
      {groups.map(g => (
        <li key={g.group} className="lw-body-grp">
          <span className="lw-body-grph">{g.group}</span>
          <ul className="lw-body-rows" aria-label={g.group}>
            {g.rows.map(r => <Row key={r.part} label={partLabel(r.part, g.group)} done={r.done} target={r.target} ratio={r.ratio} extra={r.extra} />)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
const byGroup = rows => GROUP_ORDER
  .map(group => ({ group, rows: rows.filter(r => r.group === group) }))
  .filter(g => g.rows.length);

/** "21–28 Oct", "28 Oct – 3 Nov". */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rangeText(a, b) {
  const [, am, ad] = String(a).split('-').map(Number);
  const [, bm, bd] = String(b).split('-').map(Number);
  if (!am || !bm) return '';
  return am === bm ? `${ad}–${bd} ${MON[bm - 1]}` : `${ad} ${MON[am - 1]} – ${bd} ${MON[bm - 1]}`;
}

/** The week view, failing soft: the planner is new, and the Finish sheet must always open. */
function useWeek(S, today, session, list) {
  return useMemo(() => {
    if (!S || !today) return null;
    try {
      const view = weekView(S, today, { extra: session });
      if (!view) return null;
      const bp = blockProgress(S, today);
      const code = sessionOfWorkout(session, list);
      let done = null, total = null;
      if (bp) {
        done = bp.done.length + (code && !bp.done.includes(code) && (bp.owed.includes(code) || (bp.missed || []).includes(code)) ? 1 : 0);
        total = bp.total;
      }
      // An anchor accepted as missed is reclaimed once it is logged (plan.js);
      // the workout being finished isn't logged yet, so reclaim it here.
      const missed = view.missed.filter(c => c !== code);
      return { ...view, missed, belowStandard: missed.length > 0, done, total };
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[lifts] week view unavailable', e);
      return null;
    }
  }, [S, today, session, list]);
}

const TABS = [{ id: 'workout', label: 'This workout' }, { id: 'week', label: 'This week' }];

export default function BodyMap({ session = null, list, S = null, today = null, view = 'both', tab: tabIn, onTab, all: allIn, onAll, weekOnly = false }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [tabOwn, setTabOwn] = useState('workout');
  const [allOwn, setAllOwn] = useState(false);
  // weekOnly: the Lifts home's Week page — the week so far, no workout and no tabs.
  const tab = weekOnly ? 'week' : (tabIn || tabOwn);
  const setTab = onTab || setTabOwn;
  const all = allIn == null ? allOwn : allIn;
  const setAll = onAll || setAllOwn;
  const showFig = view !== 'rows';
  const showRows = view !== 'figure';
  const tabsRef = useRef(null);
  const map = useMemo(() => bodyMap(session, list), [session, list]);
  const mapParts = useMemo(() => (all ? bodyMapParts(session, list) : null), [all, session, list]);
  const week = useWeek(S, today, session, list);

  const planned = map.muscles.filter(m => m.planned).sort((a, b) => a.ratio - b.ratio || b.target - a.target);
  const extra = map.muscles.filter(m => !m.planned && m.done > 0).sort((a, b) => b.done - a.done);
  if (weekOnly ? !week : (!planned.length && !extra.length)) return null;
  const onWeek = tab === 'week' && !!week;

  // ── What the figure fills and the rows list ──
  let ratios, rows, partGroups = null, summary, note = null;
  if (!onWeek) {
    const short = planned.filter(m => m.ratio < 1).map(m => m.muscle);
    summary = map.session
      ? (short.length ? `${map.session}: short on ${short.join(', ')}` : `${map.session}: every muscle hit its sets`)
      : 'Not one of your five sessions — measured against the most your programme asks of each muscle';
    if (mapParts) {
      ratios = Object.fromEntries(mapParts.parts.map(p => [p.part, p.ratio]));
      partGroups = byGroup(mapParts.parts
        .filter(p => p.planned || p.done > 0)
        .map(p => ({ ...p, extra: !p.planned })));
    } else {
      ratios = Object.fromEntries(map.muscles.map(m => [m.muscle, m.ratio]));
      rows = [...planned.map(m => ({ ...m, extra: false })), ...extra.map(m => ({ ...m, extra: true }))];
    }
  } else {
    const count = week.total ? ` · ${week.done} of ${week.total} done` : '';
    summary = `Week of ${rangeText(week.start, week.end)}${count}`;
    if (week.belowStandard) {
      const m = week.missed;
      note = `${m.join(' and ')} missed — this week finishes below standard. Upper and Lower carry one extra set for each muscle ${m.length === 1 ? 'it' : 'they'} owed.`;
    }
    if (all) {
      const ps = week.parts.map(p => ({ ...p, ratio: ratioOf(p.done, p.target), extra: !(p.target > 0) }));
      ratios = Object.fromEntries(ps.map(p => [p.part, p.ratio]));
      partGroups = byGroup(ps);
    } else {
      const gs = week.groups.map(g => ({ ...g, muscle: g.group, ratio: ratioOf(g.done, g.target), extra: !(g.target > 0) }));
      ratios = Object.fromEntries(gs.map(g => [g.group, g.ratio]));
      rows = gs;
    }
  }

  const onTabKey = e => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'home', End: 'end' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = TABS.findIndex(t => t.id === tab);
    const k = keys[e.key];
    const j = k === 'home' ? 0 : k === 'end' ? TABS.length - 1 : (i + k + TABS.length) % TABS.length;
    setTab(TABS[j].id);
    const btn = tabsRef.current && tabsRef.current.querySelectorAll('[role="tab"]')[j];
    if (btn) btn.focus();
  };

  const scope = onWeek ? 'this week' : 'this workout';
  const panel = (
    <>
      {showFig && (
        <div className="lw-body-figs" role="img" aria-label={`Body map, ${scope}${all ? ', all muscles' : ''}. ${summary}.`}>
          <Figure shapes={FRONT} ratios={ratios} parts={all} label="Front" uid={`${uid}f`} />
          <Figure shapes={BACK} ratios={ratios} parts={all} label="Back" uid={`${uid}b`} />
        </div>
      )}
      {!showFig ? (
        <p className="lf-meta lw-body-sum">{summary}.</p>
      ) : onWeek ? (
        <>
          <p className="lf-meta lw-body-sum" data-testid="lw-body-week-sum">{summary}. Full colour means the week&rsquo;s sets for that muscle are done.</p>
          {note && <p className="lw-body-note" data-testid="lw-body-below">{note}</p>}
        </>
      ) : (
        <p className="lf-meta lw-body-sum">{summary}. Full colour means the session&rsquo;s sets for that muscle are done.</p>
      )}
      {showRows && (partGroups ? <PartRows groups={partGroups} /> : (
        <ul className="lw-body-rows">
          {rows.map(m => <Row key={m.muscle} label={m.muscle} done={m.done} target={m.target} ratio={m.ratio} extra={m.extra} />)}
        </ul>
      ))}
    </>
  );

  return (
    <section className={`lw-body is-${view}${weekOnly ? ' is-week-only' : ''}`} aria-label={weekOnly ? 'This week on the body' : view === 'rows' ? 'Muscle by muscle' : 'Where the work went'}
             data-testid={weekOnly ? 'lw-body-week' : view === 'rows' ? 'lw-body-rows' : 'lw-body'}>
      <p className="lf-eyebrow">{weekOnly ? '// This week on the body' : view === 'rows' ? '// Muscle by muscle' : '// Where the work went'}</p>
      <div className="lw-body-ctl">
        {week && !weekOnly && (
          <div ref={tabsRef} className="lf-segm is-sm lw-body-tabs" role="tablist" aria-label="Body map range" onKeyDown={onTabKey}>
            {TABS.map(t => {
              const on = t.id === tab;
              return (
                <button key={t.id} type="button" role="tab" id={`${uid}-tab-${t.id}`} aria-selected={on} aria-controls={`${uid}-panel`}
                        tabIndex={on ? 0 : -1} className={on ? 'is-on' : ''} onClick={() => setTab(t.id)} data-testid={`lw-body-tab-${t.id}`}>
                  <span className="lf-segm-txt">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <label className="lw-switch lw-body-switch">
          <span className="lw-switch-text"><b>All muscles</b></span>
          <input type="checkbox" role="switch" checked={all} onChange={e => setAll(e.target.checked)} data-testid="lw-body-all" />
          <span className="lw-switch-ui" aria-hidden="true" />
        </label>
      </div>
      {week && !weekOnly ? (
        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${onWeek ? 'week' : 'workout'}`} className="lw-body-panel">{panel}</div>
      ) : <div className="lw-body-panel">{panel}</div>}
    </section>
  );
}

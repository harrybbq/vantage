/**
 * The body map on the Finish sheet (lib/lifts/bodymap.js): front and
 * back, each muscle filled in the accent at the share of its target the
 * workout delivered — full when the session's sets for it are done,
 * faint when they fell short, empty when it wasn't trained. Under it,
 * the session's muscles as "done / target sets" rows, short ones first,
 * then anything trained that the session doesn't ask for.
 *
 * The figure is a plain silhouette, not anatomy: it has to say "this
 * is where the work went" at a glance on a phone, and a drawn muscle
 * chart at 140 px is noise. Regions are rounded shapes on one grid, the
 * left and right sides mirrored.
 */
import { useMemo } from 'react';
import { bodyMap } from '../../../lib/lifts/bodymap';

const W = 120, H = 236, MID = W / 2;
const mirror = d => ({ ...d, x: W - d.x - (d.w || 0), cx: d.cx != null ? W - d.cx : undefined });
const pair = d => [d, mirror(d)];

// Shared skeleton (not muscles): head, neck, forearms, hands, hips, knees, feet.
const BASE = [
  { k: 'head', cx: MID, cy: 17, rx: 10, ry: 12 },
  { k: 'neck', x: 54, y: 27, w: 12, h: 9, r: 3 },
  ...pair({ k: 'fore', x: 21, y: 85, w: 11, h: 30, r: 5 }),
  ...pair({ k: 'hand', cx: 25, cy: 122, rx: 5, ry: 6 }),
  { k: 'hips', x: 41, y: 104, w: 38, h: 15, r: 6 },
  ...pair({ k: 'knee', x: 44, y: 170, w: 13, h: 8, r: 4 }),
  ...pair({ k: 'foot', x: 43, y: 220, w: 14, h: 7, r: 3 }),
];

const FRONT = [
  ...pair({ m: 'Shoulders', cx: 35, cy: 45, rx: 9, ry: 8 }),
  ...pair({ m: 'Chest', x: 41, y: 38, w: 18, h: 22, r: 7 }),
  { m: 'Abs', x: 47, y: 62, w: 26, h: 41, r: 6 },
  ...pair({ k: 'side', x: 40, y: 61, w: 6, h: 42, r: 3 }),
  ...pair({ m: 'Biceps', x: 23, y: 54, w: 11, h: 29, r: 5 }),
  ...pair({ m: 'Quads', x: 42, y: 120, w: 17, h: 49, r: 7 }),
  ...pair({ m: 'Calves', x: 45, y: 180, w: 11, h: 38, r: 5 }),
];

const BACK = [
  { m: 'Back', path: 'M41 38 Q60 32 79 38 L77 70 Q72 84 66 86 L54 86 Q48 84 43 70 Z' },
  ...pair({ m: 'Shoulders', cx: 35, cy: 45, rx: 9, ry: 8 }),
  { m: 'Lower back', x: 48, y: 87, w: 24, h: 16, r: 5 },
  ...pair({ k: 'side', x: 40, y: 72, w: 6, h: 31, r: 3 }),
  ...pair({ m: 'Triceps', x: 23, y: 54, w: 11, h: 29, r: 5 }),
  ...pair({ m: 'Glutes', x: 42, y: 104, w: 17, h: 22, r: 8 }),
  ...pair({ m: 'Hamstrings', x: 42, y: 128, w: 17, h: 41, r: 7 }),
  ...pair({ m: 'Calves', x: 44, y: 180, w: 13, h: 34, r: 6 }),
];

function Shape({ d, className, style }) {
  if (d.path) return <path d={d.path} className={className} style={style} />;
  if (d.rx != null) return <ellipse cx={d.cx} cy={d.cy} rx={d.rx} ry={d.ry} className={className} style={style} />;
  return <rect x={d.x} y={d.y} width={d.w} height={d.h} rx={d.r || 0} className={className} style={style} />;
}

function Figure({ parts, ratios, label }) {
  return (
    <figure className="lw-body-fig">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {[...BASE, ...parts.filter(p => p.k)].map((d, i) => <Shape key={`b${i}`} d={d} className="lw-body-base" />)}
        {parts.filter(p => p.m).map((d, i) => (
          <g key={`m${i}`}>
            <Shape d={d} className="lw-body-zone" />
            <Shape d={d} className="lw-body-fill" style={{ fillOpacity: ratios[d.m] || 0 }} />
          </g>
        ))}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const setsText = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function BodyMap({ session, list }) {
  const map = useMemo(() => bodyMap(session, list), [session, list]);
  const ratios = Object.fromEntries(map.muscles.map(m => [m.muscle, m.ratio]));
  const planned = map.muscles.filter(m => m.planned).sort((a, b) => a.ratio - b.ratio || b.target - a.target);
  const extra = map.muscles.filter(m => !m.planned && m.done > 0).sort((a, b) => b.done - a.done);
  if (!planned.length && !extra.length) return null;
  const short = planned.filter(m => m.ratio < 1).map(m => m.muscle);
  const summary = map.session
    ? (short.length ? `${map.session}: short on ${short.join(', ')}` : `${map.session}: every muscle hit its sets`)
    : 'Not one of your five sessions — measured against the most your programme asks of each muscle';
  return (
    <section className="lw-body" aria-label="Where this workout went" data-testid="lw-body">
      <p className="lf-eyebrow">// Where the work went</p>
      <div className="lw-body-figs" role="img" aria-label={`Body map. ${summary}.`}>
        <Figure parts={FRONT} ratios={ratios} label="Front" />
        <Figure parts={BACK} ratios={ratios} label="Back" />
      </div>
      <p className="lf-meta lw-body-sum">{summary}. Full colour means the session&rsquo;s sets for that muscle are done.</p>
      <ul className="lw-body-rows">
        {planned.map(m => (
          <li key={m.muscle} className={m.ratio >= 1 ? 'is-met' : ''}>
            <span>{m.muscle}</span>
            <span className="lw-body-bar"><i style={{ width: `${Math.round(m.ratio * 100)}%` }} /></span>
            <span className="lf-num">{setsText(m.done)} / {setsText(m.target)}</span>
          </li>
        ))}
        {extra.map(m => (
          <li key={m.muscle} className="is-extra">
            <span>{m.muscle}</span>
            <span className="lw-body-bar"><i style={{ width: `${Math.round(m.ratio * 100)}%` }} /></span>
            <span className="lf-num">{setsText(m.done)} <span className="lf-meta">extra</span></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

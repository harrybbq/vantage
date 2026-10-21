/**
 * The body map on the Finish sheet (lib/lifts/bodymap.js): front and
 * back, each muscle filled in the accent at the share of its target the
 * workout delivered — full when the session's sets for it are done,
 * faint when they fell short, empty when it wasn't trained. Under it,
 * the session's muscles as "done / target sets" rows, short ones first,
 * then anything trained that the session doesn't ask for.
 *
 * The figure is anatomical: muscle regions from react-body-highlighter
 * (MIT — see bodyShapes.js), each tagged with one of the app's muscle
 * groups. A region drawn but never filled (head, knees, forearms) gives
 * the body its shape. Regions are separated by a hairline in the card's
 * own colour, so the groups read apart in both themes.
 */
import { useMemo } from 'react';
import { bodyMap } from '../../../lib/lifts/bodymap';
import { FRONT, BACK } from './bodyShapes';

function Figure({ shapes, ratios, label }) {
  return (
    <figure className="lw-body-fig">
      <svg viewBox="0 0 100 200" aria-hidden="true">
        {shapes.map(([m, pts], i) => (
          <g key={i}>
            <polygon points={pts} className={m ? 'lw-body-zone' : 'lw-body-base'} />
            {m && ratios[m] > 0 && <polygon points={pts} className="lw-body-fill" style={{ fillOpacity: ratios[m] }} />}
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
        <Figure shapes={FRONT} ratios={ratios} label="Front" />
        <Figure shapes={BACK} ratios={ratios} label="Back" />
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

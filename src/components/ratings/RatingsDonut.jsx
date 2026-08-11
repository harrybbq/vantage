/**
 * The OVR donut.
 *
 * Four arcs, each sized by that pillar's share of the four added
 * together, with the OVR in the hole. It answers a question four bars
 * could not: where your rating is coming from. Two people on OVR 40
 * look identical in a list of bars; one of them is a donut with a 60%
 * wedge and the other is four even quarters.
 *
 * A slice is a share of the TOTAL, not a percentage of 99 — the number
 * beside each legend row is what carries the score itself.
 *
 * Every arc is a control: tapping one opens that pillar's breakdown,
 * the same place the legend row goes. The visible arc is 13 units
 * thick; an invisible 24-unit stroke sits under it so the hit target is
 * comfortably bigger than the mark on a phone.
 */
import { useState } from 'react';
import { RATING_COLOURS, ratingShares } from '../../lib/ratings/palette';

const VB = 132;              // viewBox units
const R = 52;                // arc radius
const STROKE = 13;
const HIT_STROKE = 24;
const C = 2 * Math.PI * R;

/** 2px of surface between arcs — the spacer that stops two slices
 *  reading as one, and a second encoding channel besides hue. */
const GAP = 2.4;
/** …but a tiny pillar still has to be visible, or the donut lies by
 *  omission about how many pillars there are. */
const MIN_ARC = 3;

export function donutSegments(shares) {
  const drawn = shares.length;
  const usable = C - GAP * drawn;
  let cursor = 0;
  return shares.map(s => {
    const length = Math.max(MIN_ARC, s.share * usable);
    const seg = { ...s, length, offset: cursor };
    cursor += length + GAP;
    return seg;
  });
}

export default function RatingsDonut({
  categories, ratings, ovr, tier, prestigeLabel, dark = false,
  onSelect, size = 156,
}) {
  // Which arc is under the pointer or focus ring. The palette is a ramp
  // rather than four unrelated hues, so neighbouring arcs resemble each
  // other on purpose — with the numerals off the ring, this readout is
  // what names a slice without relying on that resemblance.
  const [active, setActive] = useState(null);
  const shares = ratingShares(ratings, categories);
  const segments = donutSegments(shares);
  const colours = RATING_COLOURS[dark ? 'dark' : 'light'];
  const byId = Object.fromEntries(categories.map(c => [c.id, c]));
  const mid = VB / 2;
  const activeSeg = active && segments.find(s => s.id === active);
  const sub = activeSeg
    ? `${byId[activeSeg.id].label.toUpperCase()} ${activeSeg.value} · ${Math.round(activeSeg.share * 100)}%`
    : prestigeLabel;

  return (
    <svg
      className="ratings-donut"
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      /* The number itself wears the tier's colour. The word used to sit
         under it as well, which meant the hole carried three lines and
         the tier was said twice — once in colour, once in text. It is
         still on the accessible name and the tooltip, so nothing is
         lost to anyone who cannot use the colour. */
      style={{ '--rt-tier': tier.color }}
    >
      <title>{`Overall rating ${ovr} of 99 — ${tier.label}`}</title>

      {/* The hole, tinted with the tier colour. */}
      <circle cx={mid} cy={mid} r={R - STROKE / 2 - 1}
              className="ratings-donut-hole" />

      {/* Track under the arcs, so the 2px gaps read as deliberate
          spacing rather than holes punched in the ring. */}
      <circle cx={mid} cy={mid} r={R} fill="none"
              className="ratings-donut-track" strokeWidth={STROKE} />

      {/* Arcs, from 12 o'clock clockwise in the fixed category order —
          the same order the legend lists. */}
      <g transform={`rotate(-90 ${mid} ${mid})`}>
        {segments.map(seg => {
          const cat = byId[seg.id];
          const pct = Math.round(seg.share * 100);
          const label = `${cat.label} ${seg.value} of 99 — ${pct}% of your rating. Open breakdown.`;
          return (
            <g key={seg.id} className={'ratings-donut-seg' + (active === seg.id ? ' is-active' : '')}>
              {/* Hit target first, so it never paints over the arc. */}
              <circle
                cx={mid} cy={mid} r={R} fill="none"
                className="ratings-donut-hit"
                strokeWidth={HIT_STROKE}
                strokeDasharray={`${seg.length + GAP} ${C - seg.length - GAP}`}
                strokeDashoffset={-(seg.offset - GAP / 2)}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => onSelect?.(seg.id)}
                onMouseEnter={() => setActive(seg.id)}
                onMouseLeave={() => setActive(a2 => (a2 === seg.id ? null : a2))}
                onFocus={() => setActive(seg.id)}
                onBlur={() => setActive(a2 => (a2 === seg.id ? null : a2))}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(seg.id); }
                }}
              />
              <circle
                cx={mid} cy={mid} r={R} fill="none"
                className="ratings-donut-arc"
                stroke={colours[seg.id]}
                strokeWidth={STROKE}
                strokeDasharray={`${seg.length} ${C - seg.length}`}
                strokeDashoffset={-seg.offset}
                strokeLinecap="butt"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </g>

      {/* Centre. The rating takes the tier colour; the only thing that
          sits under it is the prestige level, or — while an arc is being
          hovered or focused — that arc's name, which is what stands in
          for colour on a ramped palette. */}
      <text className="ratings-donut-ovr" x={mid} y={mid + (sub ? 0 : 4)}
            textAnchor="middle" dominantBaseline="middle">{ovr}</text>
      {sub && (
        <text className="ratings-donut-sub" x={mid} y={mid + 22} textAnchor="middle">{sub}</text>
      )}
    </svg>
  );
}

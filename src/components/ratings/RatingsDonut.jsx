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
  // other on purpose — this is what stops the ring from relying on that
  // resemblance to tell them apart.
  const [active, setActive] = useState(null);
  const shares = ratingShares(ratings, categories);
  const segments = donutSegments(shares);
  const colours = RATING_COLOURS[dark ? 'dark' : 'light'];
  const byId = Object.fromEntries(categories.map(c => [c.id, c]));
  const mid = VB / 2;
  const activeSeg = active && segments.find(s => s.id === active);

  return (
    <svg
      className="ratings-donut"
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      /* The glow behind the number is the tier's colour, so the band a
         user is in is legible without reading the word. The word is
         there too — colour never carries it alone. */
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
          const idx = String(segments.indexOf(seg) + 1).padStart(2, '0');
          // Where the arc's midpoint sits, for the number that rides on it.
          const a = ((seg.offset + seg.length / 2) / C) * Math.PI * 2;
          const nx = mid + Math.cos(a) * R;
          const ny = mid + Math.sin(a) * R;
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
              {/* The arc's number, rotated back upright. Colour groups
                  the ring; this is what identifies a slice on it. Only
                  drawn when the arc is wide enough to hold it. */}
              {seg.length > 16 && (
                <text
                  className="ratings-donut-idx"
                  x={nx} y={ny}
                  transform={`rotate(90 ${nx} ${ny})`}
                  textAnchor="middle" dominantBaseline="central"
                  pointerEvents="none"
                >{idx}</text>
              )}
            </g>
          );
        })}
      </g>

      {/* Centre. Text wears text tokens; only the OVR takes the tier
          colour, and that is a status colour rather than one of the
          four series. */}
      <text className="ratings-donut-ovr" x={mid} y={mid + (prestigeLabel ? 0 : 4)}
            textAnchor="middle" dominantBaseline="middle">{ovr}</text>
      <text className="ratings-donut-sub" x={mid} y={mid + 22} textAnchor="middle">
        {activeSeg
          ? `${byId[activeSeg.id].label.toUpperCase()} ${activeSeg.value} · ${Math.round(activeSeg.share * 100)}%`
          : (prestigeLabel || tier.label.toUpperCase())}
      </text>
    </svg>
  );
}

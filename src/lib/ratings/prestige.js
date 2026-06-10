/**
 * Prestige bands + badge helper.
 *
 * OVR stays 0-99; `prestige` (0-99, profiles.prestige) counts completed
 * climbs. Display = colour band + Roman numeral, e.g. "GREEN IV",
 * "YELLOW VIII". P0 renders no badge.
 *
 * Bands are pure config — retuning a colour or label is a one-entry
 * edit here plus its `.prestige-{key}` CSS block in index.css.
 *
 * The lifetime sort key used by leaderboards is
 * `prestige * 100 + ovr` (profiles.lifetime_rating, generated column).
 */

export const PRESTIGE_MAX = 99;

export const PRESTIGE_BANDS = [
  { min: 1,  max: 9,  key: 'forest',   label: 'Green'    }, // Light Forest Green
  { min: 10, max: 19, key: 'yellow',   label: 'Yellow'   },
  { min: 20, max: 29, key: 'indigo',   label: 'Indigo'   },
  { min: 30, max: 39, key: 'red',      label: 'Red'      },
  { min: 40, max: 49, key: 'burgundy', label: 'Burgundy' },
  { min: 50, max: 59, key: 'purple',   label: 'Purple'   },
  { min: 60, max: 69, key: 'ocean',    label: 'Blue'     }, // Ocean Blue
  { min: 70, max: 79, key: 'cyan',     label: 'Cyan'     },
  { min: 80, max: 89, key: 'gold',     label: 'Gold'     },
  { min: 90, max: 99, key: 'crimson',  label: 'Crimson'  },
];

/** 1-99 → Roman numeral. Returns '' outside that range. */
export function toRoman(n) {
  if (!Number.isFinite(n) || n < 1 || n > 99) return '';
  const M = [
    [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'],
    [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '', v = Math.floor(n);
  for (const [val, sym] of M) {
    while (v >= val) { out += sym; v -= val; }
  }
  return out;
}

/**
 * Badge descriptor for a prestige level.
 * Returns null for P0 (no badge). Otherwise:
 *   { band, numeral, text } — e.g. text "GREEN IV".
 */
export function prestigeBadge(prestige) {
  const p = Number(prestige);
  if (!Number.isFinite(p) || p < 1) return null;
  const clamped = Math.min(p, PRESTIGE_MAX);
  const band = PRESTIGE_BANDS.find(b => clamped >= b.min && clamped <= b.max) || PRESTIGE_BANDS[0];
  const numeral = toRoman(clamped);
  return { band, numeral, text: `${band.label.toUpperCase()} ${numeral}` };
}

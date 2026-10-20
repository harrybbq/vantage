/**
 * Colour contrast maths (WCAG 2.x relative luminance) — shared.
 *
 * Moved verbatim out of lib/lifts/ui.js (Oct 2026) so the console design
 * layer can derive the user's accent per theme without importing the
 * Lifts module graph into every bundle. lib/lifts/ui.js re-exports all of
 * it, so Lifts and its tests are unchanged. Pure: no DOM, no React.
 */


/** '#1a7a4a' / '#17a' / 'rgb(26, 122, 74)' → [r, g, b] 0–255, else null. */
export function parseColor(c) {
  const s = String(c == null ? '' : c).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split('').map(h => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s);
  if (m) return [m[1], m[2], m[3]].map(v => Math.min(255, Number(v)));
  return null;
}
const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
/** [r, g, b] → '#rrggbb'. */
export const toHex = rgb => `#${rgb.map(hex2).join('')}`.toUpperCase();

/** WCAG relative luminance 0–1, or null for an unreadable colour. */
export function luminance(c) {
  const rgb = parseColor(c);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio 1–21 between two colours (order doesn't matter), or null. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const INK_DARK = '#0E0E0C';
export const INK_LIGHT = '#FFFFFF';
/**
 * The label colour for text on an accent fill: '#0E0E0C' or '#FFFFFF',
 * whichever contrasts more (one of the two always reaches 4.5:1 unless
 * the accent is a mid grey; the better one is returned either way).
 */
export function onAccent(hex) {
  const d = contrast(hex, INK_DARK), l = contrast(hex, INK_LIGHT);
  if (d == null || l == null) return INK_LIGHT;
  return d >= l ? INK_DARK : INK_LIGHT;
}

const toHsl = ([r, g, b]) => {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
};
const fromHsl = ([h, s, l]) => {
  const S = s / 100, L = l / 100;
  const k = n => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = n => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
};
/**
 * The accent as it must be drawn on `surface` to reach `min` contrast:
 * itself when it already does, else lightened (dark surface) or darkened
 * (light surface) in 4-point HSL lightness steps until it passes (brief
 * §3.1 — "Steel" #33414f on Dark OS reads as a 1.9:1 smudge otherwise).
 */
export function accentFor(hex, surface, min = 3) {
  const rgb = parseColor(hex);
  if (!rgb || luminance(surface) == null) return hex;
  if (contrast(hex, surface) >= min) return toHex(rgb);
  const lighten = luminance(surface) < 0.2;
  let [h, s, l] = toHsl(rgb);
  for (let i = 0; i < 25; i++) {
    l = Math.max(0, Math.min(100, l + (lighten ? 4 : -4)));
    const c = toHex(fromHsl([h, s, l]));
    if (contrast(c, surface) >= min || l === 0 || l === 100) return c;
  }
  return toHex(fromHsl([h, s, l]));
}

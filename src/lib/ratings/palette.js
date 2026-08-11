/**
 * Categorical colours for the four rating pillars.
 *
 * These identify a category, so they are a CATEGORICAL palette: fixed
 * slot order, never cycled, and the colour follows the pillar rather
 * than its rank — a filter or a re-sort must never repaint them.
 *
 * Both modes are selected rather than flipped: the same four hues,
 * re-stepped for each surface.
 *
 * This is a RAMP, not four unrelated hues — gold 92° → copper 42° →
 * burgundy 2° → violet 300°, lightness falling the whole way, so the
 * ring reads as one sweep rather than four flags. That was the ask, and
 * it is worth being clear about what it costs, because a gradient and a
 * category code want opposite things: adjacent steps in a ramp are
 * SUPPOSED to resemble each other, and a category colour is supposed
 * not to.
 *
 * Validated on ALL pairs, because a donut puts every slice next to
 * every other, against the cream card #fdfaf3 and the dark panel
 * #131311:
 *
 *   light  protan ΔE 10.6 · tritan 13.9 · normal-vision 17.0  — passes
 *   dark   deutan ΔE  9.2 · tritan  9.5 · normal-vision 13.4  — under
 *
 * The dark column cannot clear the 15-point normal-vision floor for
 * copper against gold: the dark lightness band is only 0.48–0.67 wide,
 * half of light's, and a four-step ramp cannot spread far enough inside
 * it. Every arrangement of these four hues was searched — per-slot
 * lightness and chroma, both directions — and none passes. Rather than
 * quietly ship colours that some people cannot tell apart, the donut
 * stops asking colour to carry identity at all:
 *
 *   · each arc is numbered, and the legend repeats the number
 *   · hovering or focusing an arc names it, with its score and share
 *   · the legend always shows all four with name, share and score
 *   · 2px of surface between every arc
 *
 * Colour groups the ring; the numbers and words identify it. That is
 * also the relief owed for gold at 1.99:1 on cream and for burgundy and
 * violet on the dark panel, all under the 3:1 line.
 */

export const RATING_COLOURS = {
  light: { brain: '#d2b145', finance: '#c26b49', fitness: '#a72459', social: '#5d3890' },
  dark:  { brain: '#b09018', finance: '#b06244', fitness: '#b3195c', social: '#6b4c9b' },
};

/**
 * Share of the donut each pillar takes: its rating over the sum of all
 * four. Note this is a different question from the OVR, which is their
 * MEAN — the donut answers "where is my rating coming from", not "how
 * high is it". Four equal pillars give four equal quarters whether they
 * are all 5 or all 90.
 *
 * @returns [{ id, value, share }] in the given category order, share 0..1.
 */
export function ratingShares(ratings, categories) {
  const vals = categories.map(c => Math.max(0, Number(ratings?.[c.id]) || 0));
  const total = vals.reduce((a, b) => a + b, 0);
  return categories.map((c, i) => ({
    id: c.id,
    value: vals[i],
    // A brand-new account can legitimately be all zeros; an even split
    // is the honest answer there, not four empty arcs.
    share: total > 0 ? vals[i] / total : 1 / categories.length,
  }));
}

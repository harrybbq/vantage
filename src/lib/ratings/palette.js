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
 * This is a RAMP, not four unrelated hues — gold 96° → copper 40° →
 * burgundy 2° → plum 322°, lightness falling the whole way, so the ring
 * reads as one sweep. The fourth stop carries ON past burgundy in the
 * same direction rather than jumping to purple, which is what makes it
 * a neighbour of the arc beside it instead of a stranger.
 *
 * Worth being clear about the cost, because a gradient and a category
 * code want opposite things: adjacent steps in a ramp are SUPPOSED to
 * resemble each other, and a category colour is supposed not to.
 *
 * Validated on ALL pairs, since a donut puts every slice next to every
 * other, against the cream card #fdfaf3 and the dark panel #131311:
 *
 *   light  protan ΔE 8.2 · tritan 12.7 · normal-vision 12.5
 *   dark   deutan ΔE 7.2 · tritan  9.0 · normal-vision 12.4
 *
 * Both columns sit under the 15-point normal-vision floor, and dark
 * sits inside the 6–8 CVD band. This is the floor of what the shape of
 * the request allows, and it was measured rather than guessed:
 *
 *   · a violet fourth stop at 300° scores dark deutan 9.2 — the
 *     warmest fourth stop that clears the CVD target. Every hue from
 *     300° to 345° was searched at four lightnesses and three chromas
 *     per slot; none warmer holds the line.
 *   · a fully warm ramp — gold, amber, copper, burgundy, no purple at
 *     all — collapses to dark deutan 5.5. Gold and amber become the
 *     same colour to a red-green colour-blind reader. That one is not
 *     shippable; 322° is the compromise.
 *
 * So the donut does not ask colour to carry identity at all:
 *
 *   · hovering or focusing an arc names it in the hole, with its score
 *     and share — the main thing standing in for colour on the ring
 *   · tapping an arc opens its breakdown, which names it too, so touch
 *     (where there is no hover) still has a way through
 *   · the legend always shows all four with name, share and score
 *   · 2px of surface between every arc
 *
 * Colour groups the ring; the words identify it. That doubles as the
 * relief owed for gold at 2.09:1 on cream and plum at 2.72:1 on the
 * dark panel, both under the 3:1 line.
 */

export const RATING_COLOURS = {
  light: { brain: '#c6af4e', finance: '#b7684c', fitness: '#a71756', social: '#742b7f' },
  dark:  { brain: '#aa932e', finance: '#b9694d', fitness: '#be3368', social: '#863c91' },
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

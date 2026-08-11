/**
 * Categorical colours for the four rating pillars.
 *
 * These identify a category, so they are a CATEGORICAL palette: fixed
 * slot order, never cycled, and the colour follows the pillar rather
 * than its rank — a filter or a re-sort must never repaint them.
 *
 * Both modes are selected rather than flipped: the dark column is the
 * same four hues re-stepped for the dark surface.
 *
 * Muted on purpose — chroma 0.11, barely above the 0.10 floor below
 * which the validator refuses a categorical palette outright. Anything
 * greyer stops being a colour code. Fitness green (152°) and Finance
 * gold (88°) stay in Vantage's own family, deepened to forest and
 * pushed toward brass so neither reads as a highlighter.
 *
 * The separation comes from LIGHTNESS rather than saturation, which is
 * what makes a sober palette possible at all: lightness is the channel
 * colour-blind vision keeps, so spreading the four across L 0.44–0.73
 * buys back everything the low chroma gives away. It also decides which
 * hue gets the pale step — gold, because a pale ochre reads as
 * parchment where a pale green reads mint and a pale pink reads sweet.
 *
 * Validated on ALL pairs, because a donut puts every slice next to every
 * other, against the cream card #fdfaf3 and the dark-os panel #131311:
 *
 *   light  deutan ΔE 11.6 · tritan 19.1 · normal-vision 19.0
 *   dark   deutan ΔE  8.8 · tritan 11.4 · normal-vision 17.1
 *   (CVD target ≥8, normal-vision floor 15 — cleared on every axis,
 *   and clear of the 6–8 band the first attempt sat in)
 *
 * Two things the validator flagged, and how they are answered:
 *
 *   · Brass on cream is 2.3:1 against the surface, under the 3:1 line,
 *     which obliges visible labels rather than colour alone. The legend
 *     is that relief — every arc's value and share are written out.
 *   · Identity is never colour-alone anywhere: the legend pairs each
 *     swatch with a word, and every arc carries an aria-label.
 */

export const RATING_COLOURS = {
  light: { brain: '#4a8fc7', finance: '#c5a450', fitness: '#0d6332', social: '#955080' },
  dark:  { brain: '#4288bf', finance: '#ae8e38', fitness: '#267543', social: '#9b5686' },
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

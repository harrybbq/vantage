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
 * Fitness green (~156°) and Finance gold (~80°) are pinned to Vantage's
 * own accents — `--em` #1a7a4a and `--gold` #b08a3a — so the chart reads
 * as part of the app rather than a chart dropped into it. Brain and
 * Social were then searched for the best separation available around
 * them, and the set validated with the data-viz validator on ALL pairs
 * (a donut puts every slice next to every other), against the cream
 * card #fdfaf3 and the dark-os panel #131311:
 *
 *   light  protan ΔE 8.5 · tritan 12.2 · normal-vision 16.7
 *   dark   protan ΔE 8.7 · tritan  7.9 · normal-vision 15.5
 *   (CVD target ≥8, normal-vision floor 15 — both cleared)
 *
 * Those margins are honest but thin, and that is the cost of pinning two
 * of the four hues to the brand: a free search gets to ΔE 17 by reaching
 * for hues Vantage does not own. Matching the themes was the ask, so the
 * gap is closed with encoding rather than colour — see below.
 *
 * Three things the validator flagged, and how they are answered:
 *
 *   · Dark tritan 7.9 sits just inside the 6–8 floor band, which is
 *     legal only with a second encoding channel. The donut ships three:
 *     a 2px gap of surface between every arc, a legend that names each
 *     pillar, and its score printed next to it.
 *   · Mint on cream is 2.1:1 against the surface, under the 3:1 line,
 *     which obliges visible labels rather than colour alone. The legend
 *     is that relief — every arc's value and share are written out.
 *   · Identity is never colour-alone anywhere: the legend pairs each
 *     swatch with a word, and every arc carries an aria-label.
 */

export const RATING_COLOURS = {
  light: { brain: '#125a98', finance: '#b8892d', fitness: '#65c18b', social: '#a8506f' },
  dark:  { brain: '#2266a4', finance: '#aa7b19', fitness: '#4aa873', social: '#a9516f' },
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

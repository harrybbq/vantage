/**
 * Whose score is in `vitalsLog[date].recovery`, and what to call it.
 *
 * Why (item 126, gaps C6–C8 in docs/WEARABLE_APPROVALS.md): WHOOP and
 * Oura both write their headline score under the one `recovery` key —
 * WHOOP's is called Recovery, Oura's is called Readiness — and WHOOP's
 * guidelines say not to rename its metrics or show them in other
 * colours. The stored key stays exactly as it is; this only decides the
 * WORDS and the colour a surface puts beside the number.
 *
 * Provenance per value does not exist on a vitals row, so it is read off
 * what else each sync writes to the same row (the same evidence
 * lib/coach/wearableProvenance.js uses):
 *   · strain / stepsWhoop  → only the WHOOP sync writes these;
 *   · stepsOura            → only the Oura sync writes this.
 * One provider's marker → that provider. Both, or neither with both (or
 * neither) connected → null, and the surface uses NEUTRAL wording. It
 * never tie-breaks: a guess that names the wrong company is worse than
 * a label that names neither.
 *
 * Pure — no React, no DOM.
 */

/** WHOOP's fixed recovery colours, from the WHOOP Brand & Design
 *  Guidelines as quoted in docs/WEARABLE_APPROVALS.md §0 (green 67–100,
 *  yellow 34–66, red 0–33). For marks only — #FFDE00 on Cream is far
 *  below readable contrast, so numbers and words stay in theme text. */
export const WHOOP_RECOVERY_COLOURS = { green: '#16EC06', yellow: '#FFDE00', red: '#FF0026' };

/** WHOOP's band for a recovery score, banded on the rounded score
 *  shown so "34%" never reads red. Null for no score. */
export function whoopBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const s = Math.round(Number(score));
  return s >= 67 ? 'green' : s >= 34 ? 'yellow' : 'red';
}

/** The provider's own name for the score. */
export const RECOVERY_NAMES = {
  whoop: 'WHOOP Recovery',
  oura: 'Oura Readiness',
  // Neither can be told apart from the log: name both metrics, neither
  // company. The doc's own phrase for the block (§2.3 shot 5).
  none: 'Recovery / Readiness',
};

/** Short form, for a tile that names the provider in its own corner.
 *  Neutral is "Score": "Recovery / Readiness" truncates to "RECOVERY…" in
 *  a ~160px tile, which reads as WHOOP's name for a value that may be
 *  Oura's. The tile's title and the chart carry the full neutral name. */
export const RECOVERY_SHORT = { whoop: 'Recovery', oura: 'Readiness', none: 'Score' };

export const recoveryName = provider => RECOVERY_NAMES[provider] || RECOVERY_NAMES.none;
export const recoveryShort = provider => RECOVERY_SHORT[provider] || RECOVERY_SHORT.none;

/** The provider name as text — never a mark. */
export const providerText = p => (p === 'whoop' ? 'WHOOP' : p === 'oura' ? 'Oura' : p === 'both' ? 'WHOOP + Oura' : null);

function byFlags(S) {
  const w = !!(S && S.whoopConnected), o = !!(S && S.ouraConnected);
  return w && !o ? 'whoop' : o && !w ? 'oura' : null;
}

/** Which provider wrote this row, from its markers alone (null if it
 *  carries both or neither). */
function byMarkers(row) {
  const w = row.strain != null || row.stepsWhoop != null;
  const o = row.stepsOura != null;
  if (w && o) return 'both';
  return w ? 'whoop' : o ? 'oura' : null;
}

/**
 * Whose recovery score is on this day → 'whoop' | 'oura' | null.
 * Null when there is no score, or when it cannot be told.
 */
export function recoveryProviderOn(S, day) {
  const row = S && S.vitalsLog && S.vitalsLog[day];
  if (!row || typeof row !== 'object' || row.recovery == null) return null;
  const m = byMarkers(row);
  if (m === 'both') return null;
  return m || byFlags(S);
}

/**
 * Whose recovery scores fill the log as a whole → 'whoop' | 'oura' | null,
 * for labels that sit over more than one day (a chart, a picker row).
 * One provider for every scored day → it. Any day that cannot be told,
 * or days from both → null. No scores at all → the connected flags.
 */
export function recoveryProvider(S) {
  const log = (S && S.vitalsLog) || {};
  let found = null, any = false;
  for (const day of Object.keys(log)) {
    const row = log[day];
    if (!row || typeof row !== 'object' || row.recovery == null) continue;
    any = true;
    const p = recoveryProviderOn(S, day);
    if (!p) return null;
    if (found && p !== found) return null;
    found = p;
  }
  return any ? found : byFlags(S);
}

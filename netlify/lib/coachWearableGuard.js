/**
 * Server-side guard: WHOOP / Oura data never reaches the AI coach
 * unless the site says it may.
 *
 * Why (2026-10-17): Oura's and WHOOP's 2026 API terms reportedly limit
 * using their data with AI. Unverified from here; the owner is asking
 * both in writing. Until they answer, `AI_WEARABLE_DATA_ALLOWED` stays
 * unset and this strips every band-derived value from the coach
 * snapshot before it is sent to the model. Set it to exactly 'true' (Netlify →
 * Functions env) only once both providers have said yes in writing.
 *
 * The client already leaves band data out (src/lib/coach/snapshot.js +
 * wearableProvenance.js). This is the half that does not trust it: an
 * old build, a modified client or a future snapshot field all pass
 * through here first.
 *
 * What it removes, anywhere in the snapshot:
 *   · trackers flagged `wearable: true`, or holding any series cell
 *     tagged `src: 'wearable'` — withheld whole, never sent with holes
 *     (a steps tracker with its WHOOP days removed reads as a slump);
 *   · any object or array entry tagged as from a band — `wearable: true`,
 *     `src`/`source` of 'wearable' | 'whoop' | 'oura', or an `id`
 *     starting `whoop-` / `oura-` (how the syncs label device workouts
 *     in burnLog);
 *   · the keys only the band syncs write — hrv, recovery, strain,
 *     burnKcal, stepsWhoop, stepsOura — and the connection markers;
 *   · `sleep` and `rhr` on any object that also carried one of those
 *     keys. A vitals row has no per-value provenance: WHOOP, Oura, Apple
 *     Health and a hand entry all write those two under the same name,
 *     and a band sync overwrites them. On a row a band touched they are
 *     treated as the band's. `weight` is kept: neither sync writes it.
 *
 * Nothing is added in their place, and the model is told nothing about
 * what was removed — it cannot see the devices, so it says nothing
 * about them.
 *
 * Pure. CommonJS for the functions bundle.
 */

const ENV_NAME = 'AI_WEARABLE_DATA_ALLOWED';

const BAND_SOURCES = new Set(['wearable', 'whoop', 'oura']);
const BAND_ID = /^(whoop|oura)-/i;
const BAND_KEYS = new Set([
  'hrv', 'recovery', 'strain', 'burnKcal', 'stepsWhoop', 'stepsOura',
  'whoopConnected', 'ouraConnected', 'whoopLastError', 'ouraLastError',
]);
const SHARED_KEYS = ['sleep', 'rhr'];
const MAX_DEPTH = 10;

/** Exactly the string 'true' — not '1', not 'TRUE', not 'yes'. */
function wearableAllowed(env = process.env) {
  return !!env && env[ENV_NAME] === 'true';
}

function isBandTagged(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.wearable === true) return true;
  const src = String(v.src ?? v.source ?? '').toLowerCase();
  if (BAND_SOURCES.has(src)) return true;
  return BAND_ID.test(String(v.id ?? ''));
}

function scrub(v, depth) {
  if (depth > MAX_DEPTH) return v;
  if (Array.isArray(v)) return v.filter(x => !isBandTagged(x)).map(x => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    let touched = false;
    for (const [k, x] of Object.entries(v)) {
      if (BAND_KEYS.has(k)) { touched = true; continue; }
      if (isBandTagged(x)) continue;
      out[k] = scrub(x, depth + 1);
    }
    if (touched) for (const k of SHARED_KEYS) delete out[k];
    return out;
  }
  return v;
}

function trackerHasBandData(t) {
  if (!t || typeof t !== 'object') return false;
  if (isBandTagged(t)) return true;
  const series = Array.isArray(t.last_14_days) ? t.last_14_days : [];
  return series.some(isBandTagged);
}

/**
 * The snapshot with band data removed — or the snapshot untouched when
 * the env allows it. Never mutates its input.
 * @param {object} snapshot
 * @param {{ allowed?: boolean, env?: object }} [opts]
 */
function guardWearableData(snapshot, opts = {}) {
  const allowed = opts.allowed ?? wearableAllowed(opts.env || process.env);
  if (allowed || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;
  const s = { ...snapshot };
  if (Array.isArray(s.trackers)) s.trackers = s.trackers.filter(t => !trackerHasBandData(t));
  return scrub(s, 0);
}

module.exports = { guardWearableData, wearableAllowed, ENV_NAME };

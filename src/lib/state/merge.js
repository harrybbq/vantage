/**
 * Three-way merge for the single state object.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * Every save was an unconditional whole-state upsert and the load never
 * read `updated_at`, so a client had no idea which version it was
 * editing. Two devices meant the last one to write silently erased
 * whatever the other had done — a tracker logged on a phone vanishing
 * when a desktop tab that had been open for hours saved its stale copy,
 * and the same two devices showing different OVR at the same moment.
 *
 * A merge is the only honest answer. Refusing the write loses the local
 * edit; taking either side whole loses the other's. So: given the state
 * as it was LOADED (base), the state on this device now (local), and
 * the state in the cloud now (remote), work out what each side actually
 * changed and keep both.
 *
 * ── The rules, in order ──────────────────────────────────────────────
 *   1. Neither side changed a key   → keep it.
 *   2. Only one side changed it     → take that side. No contest.
 *   3. Both changed it, and both are plain objects (the date-keyed
 *      stores: logs, vitalsLog, moodLog, bodyLog…) → recurse. Two
 *      devices logging different days, or different trackers on the
 *      same day, both survive.
 *   4. Both changed it, and both are arrays whose items carry an `id`
 *      (habits, savings, trackers, shopItems…) → merge by id, recursing
 *      into an item both sides touched.
 *   5. Anything else both changed (a number, a string, a ragged array)
 *      → take LOCAL, and report it. There is no per-key timestamp to
 *      appeal to, and the user is looking at this device, so their most
 *      recent intent is the local one. It is reported rather than
 *      swallowed so the caller can say so.
 *
 * ── The rule that overrides all of them ──────────────────────────────
 * A MERGE NEVER DELETES what the other side still has. A key or an
 * array item removed on one side while the other side changed it is
 * KEPT. Losing data is the failure this whole file exists to prevent,
 * and a resurrected habit is a nuisance where a deleted one is not
 * recoverable. Deletion only survives a merge when the other side left
 * that thing alone.
 *
 * Pure. No React, no network, no clock.
 */

const isPlainObject = v =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Structural equality, enough for JSON-shaped state. */
export function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
}

/** An array every item of which is an object carrying a usable id. */
function isIdArray(v) {
  return Array.isArray(v) && v.length > 0
    && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id);
}

function mergeIdArrays(base, local, remote, path, conflicts) {
  const byId = list => new Map((list || []).map(x => [x.id, x]));
  const b = byId(base);
  const l = byId(local);
  const r = byId(remote);

  // Local ordering first, then anything only the remote has, so the
  // device doing the merge keeps the order it was showing.
  const order = [];
  const seen = new Set();
  for (const id of [...l.keys(), ...r.keys()]) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  const out = [];
  for (const id of order) {
    const bv = b.get(id);
    const lv = l.get(id);
    const rv = r.get(id);

    if (lv && rv) {
      out.push(merge(bv, lv, rv, `${path}[${id}]`, conflicts));
      continue;
    }
    // Present on one side only: either just added there, or deleted
    // here. A deletion only wins when the other side left it alone.
    const present = lv || rv;
    if (!b.has(id)) { out.push(present); continue; }       // newly added
    if (sameValue(present, bv)) continue;                  // deleted, untouched elsewhere
    out.push(present);                                     // deleted here, changed there — keep it
    conflicts.push(`${path}[${id}]: deleted on one device, changed on the other — kept`);
  }
  return out;
}

/**
 * Merge one value.
 * @param conflicts collects human-readable notes about rule 5 and about
 *   deletions that were declined; the caller decides whether to report.
 */
function merge(base, local, remote, path, conflicts) {
  // Both sides already agree. Nothing to reconcile whatever the base
  // was, and reporting it as a conflict would cry wolf on the common
  // case of two devices being handed the same edit.
  if (sameValue(local, remote)) return local;

  const localChanged = !sameValue(local, base);
  const remoteChanged = !sameValue(remote, base);

  if (!localChanged && !remoteChanged) return local;
  if (localChanged && !remoteChanged) return local;
  if (!localChanged && remoteChanged) return remote;

  // Both changed.
  if (isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : {};
    const out = {};
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const k of keys) {
      const inL = Object.prototype.hasOwnProperty.call(local, k);
      const inR = Object.prototype.hasOwnProperty.call(remote, k);
      const inB = Object.prototype.hasOwnProperty.call(b, k);

      if (inL && inR) { out[k] = merge(b[k], local[k], remote[k], `${path}.${k}`, conflicts); continue; }

      const value = inL ? local[k] : remote[k];
      if (!inB) { out[k] = value; continue; }              // newly added on one side
      if (sameValue(value, b[k])) continue;                // deleted on one side, untouched on the other
      out[k] = value;                                      // deleted here, changed there — keep it
      conflicts.push(`${path}.${k}: removed on one device, changed on the other — kept`);
    }
    return out;
  }

  if (isIdArray(local) && isIdArray(remote)) {
    return mergeIdArrays(base, local, remote, path, conflicts);
  }

  conflicts.push(`${path}: changed on both devices — kept this device's value`);
  return local;
}

/**
 * Merge two versions of the whole state against the version both came
 * from.
 *
 * @param {object|null} base   the state as this client loaded it. Null
 *   or missing means no common ancestor is known, in which case every
 *   key looks changed on both sides and the deep-merge rules apply —
 *   which errs toward keeping everything, the safe direction.
 * @returns {{state: object, conflicts: string[]}}
 */
export function mergeState(base, local, remote) {
  const conflicts = [];
  const b = isPlainObject(base) ? base : {};
  const l = isPlainObject(local) ? local : {};
  const r = isPlainObject(remote) ? remote : {};
  const state = merge(b, l, r, '', conflicts);
  return { state, conflicts };
}

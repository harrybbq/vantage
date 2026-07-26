/**
 * Travel policy — the user's own country clearance lists.
 *
 * Deliberately USER-DEFINED, not shipped. Restriction lists come from
 * an employer (security clearance, work travel policy) or a passport's
 * visa requirements; they differ per person and they change. A list
 * baked into the app would be wrong for everybody else and would go
 * stale with no way to correct it short of a deploy.
 *
 * PRIVACY: S.travelPolicy is sensitive — it can imply someone holds a
 * security clearance. It must never leave the user's own synced state:
 * not to the leaderboard, not to trending (shareTrending), not to
 * friends, and not into any AI prompt. Nothing in this module reads or
 * writes anything outside S.travelPolicy.
 *
 * Shape (all optional, absent = no policy configured):
 *   S.travelPolicy = {
 *     enabled: true,
 *     restricted: ['RU','CN'],   // red   — do not travel
 *     notify:     ['TR','EG'],   // amber — clear it with vetting first
 *     cleared:    ['FR','ES'],   // green — no permission needed
 *     note: 'Per vetting brief 2026-03',
 *   }
 */

export const POLICY_LEVELS = {
  restricted: { key: 'restricted', label: 'Restricted', short: 'No travel',    tone: 'red' },
  notify:     { key: 'notify',     label: 'Ask first',  short: 'Needs approval', tone: 'amber' },
  cleared:    { key: 'cleared',    label: 'Cleared',    short: 'No approval needed', tone: 'green' },
};

const EMPTY = { enabled: false, restricted: [], notify: [], cleared: [], note: '' };

/** Normalised policy, safe on a state that has never had one. */
export function getPolicy(S) {
  const p = (S && S.travelPolicy) || null;
  if (!p) return EMPTY;
  const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
  return {
    enabled: p.enabled !== false,
    restricted: list(p.restricted),
    notify: list(p.notify),
    cleared: list(p.cleared),
    note: typeof p.note === 'string' ? p.note : '',
  };
}

export function hasAnyPolicy(S) {
  const p = getPolicy(S);
  return p.restricted.length + p.notify.length + p.cleared.length > 0;
}

/**
 * Level for one ISO2 code, or null when unclassified. Restricted wins
 * over notify wins over cleared, so a country listed twice by mistake
 * always resolves to the MORE cautious answer.
 */
export function levelFor(policy, iso2) {
  if (!iso2 || !policy || !policy.enabled) return null;
  const code = iso2.toUpperCase();
  if (policy.restricted.includes(code)) return 'restricted';
  if (policy.notify.includes(code)) return 'notify';
  if (policy.cleared.includes(code)) return 'cleared';
  return null;
}

/** iso2 → level map for the whole policy, for fast map fills. */
export function levelMap(policy) {
  const m = {};
  if (!policy || !policy.enabled) return m;
  for (const c of policy.cleared) m[c.toUpperCase()] = 'cleared';
  for (const c of policy.notify) m[c.toUpperCase()] = 'notify';
  for (const c of policy.restricted) m[c.toUpperCase()] = 'restricted';
  return m;
}

/**
 * Toggle one country to a level (passing its current level clears it).
 * Returns a NEW policy object — callers merge it into state additively.
 */
export function setCountryLevel(policy, iso2, level) {
  const code = (iso2 || '').toUpperCase();
  if (!code) return policy;
  const next = {
    enabled: true,
    note: policy.note || '',
    restricted: policy.restricted.filter(c => c !== code),
    notify: policy.notify.filter(c => c !== code),
    cleared: policy.cleared.filter(c => c !== code),
  };
  if (level && next[level]) next[level] = [...next[level], code].sort();
  return next;
}

/**
 * Countries a trip or rail route touches that need attention.
 * Returns [{ iso2, level }] for restricted/notify only — green needs
 * no shouting about.
 */
export function flagsFor(policy, iso2List) {
  const out = [];
  for (const iso2 of iso2List || []) {
    const level = levelFor(policy, iso2);
    if (level === 'restricted' || level === 'notify') out.push({ iso2, level });
  }
  return out;
}

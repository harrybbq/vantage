/**
 * Explicit consent (UK GDPR Art. 9) — the rules, with no React in them.
 *
 * Stored in state as one additive key:
 *
 *   S.consent = {
 *     health:  '2026-09-30T…Z' | null,   // granted at | declined/withdrawn
 *     ai:      '2026-09-30T…Z' | null,
 *     askedAt: '2026-09-30T…Z',          // the one-time sheet was answered
 *   }
 *
 * A kind that is ABSENT (undefined) has never been asked. `null` means
 * the person said no, or said yes and later withdrew it. Only an ISO
 * string is consent — "they logged it" and "they're Pro" are not.
 *
 * Every write goes through consentPatch, which spreads the previous
 * object: a grant for one kind can never clear another, and nothing
 * outside `consent` is touched.
 */

export const KINDS = ['health', 'ai'];

/** 'granted' | 'declined' | 'unasked' */
export function consentStatus(consent, kind) {
  const v = consent?.[kind];
  if (typeof v === 'string' && v) return 'granted';
  if (v === null || v === false) return 'declined';
  return 'unasked';
}

export function isGranted(consent, kind) {
  return consentStatus(consent, kind) === 'granted';
}

/**
 * The next value of S.consent after the person answers.
 *   choices — { health?: boolean, ai?: boolean } (kinds left out are
 *             left exactly as they were)
 * Re-granting keeps the ORIGINAL timestamp: the record should say when
 * consent was first given, not when a prompt last reappeared.
 */
export function consentPatch(prev, choices, nowIso) {
  const next = { ...(prev || {}) };
  for (const kind of KINDS) {
    if (!(kind in (choices || {}))) continue;
    if (choices[kind]) next[kind] = isGranted(prev, kind) ? prev[kind] : nowIso;
    else next[kind] = null;
  }
  if (!next.askedAt) next.askedAt = nowIso;
  return next;
}

/**
 * Whether to show the one-time sheet: once the cloud copy is in (never
 * against a local or default seed), once the tutorial is out of the way
 * (two overlays stacked is how a first run gets abandoned), and only
 * until it has been answered once.
 */
export function shouldAskOnce(S, hydrated) {
  if (!hydrated || !S) return false;
  if (!S.tutorialCompleted) return false;
  return !S.consent?.askedAt;
}

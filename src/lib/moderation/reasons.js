/**
 * Report reasons — what the report sheet offers, what gets stored, and
 * how urgent each is (STARTUP_REQUIREMENTS item 110d; Online Safety Act
 * draft G6, H3, C2).
 *
 * STORED VALUE = the label, exactly as before. `reports.reason` is free
 * text and the first five labels below are what every existing report
 * holds, so they never change spelling; new reasons are new labels.
 * reasonInfo() reads any stored string — old, new, or something an old
 * client sent — and unknown text reads as "Something else".
 *
 * Priority: 0 urgent (a child's safety, threats, self-harm — first in
 * the owner's queue, as the proposed Terms promise), 1 serious, 2 normal.
 * `signpost` is crisis/help text the sheet shows the moment the reason
 * is picked — before the report is even sent.
 *
 * netlify/lib/reportReasons.js holds the URGENT labels for the server's
 * queue ordering; safety.test.mjs checks the two agree.
 *
 * Pure.
 */

export const SIGNPOSTS = {
  selfHarm: 'If someone is in danger right now, call 999. Samaritans are there any time on 116 123 (free). Under 19? Childline: 0800 1111.',
  child: 'If a child is in immediate danger, call 999. You can also report to CEOP, the National Crime Agency\'s child protection team, at ceop.police.uk.',
  threat: 'If someone is in immediate danger, call 999. For a threat that isn\'t urgent, you can also tell the police on 101.',
};

export const REASONS = [
  { id: 'harassment', label: 'Harassment or bullying', priority: 1 },
  { id: 'threat', label: 'Threats or violence', priority: 0, signpost: SIGNPOSTS.threat },
  { id: 'hate', label: 'Hate or slurs', priority: 1 },
  { id: 'sexual', label: 'Sexual content', priority: 1 },
  { id: 'child', label: 'Child safety', priority: 0, signpost: SIGNPOSTS.child,
    hint: 'Sexual messages to someone under 18, or asking a young person to meet up or move to another app.' },
  { id: 'selfharm', label: 'Self-harm or suicide risk', priority: 0, signpost: SIGNPOSTS.selfHarm },
  { id: 'scam', label: 'Scam or fraud', priority: 1 },
  { id: 'spam', label: 'Spam', priority: 2 },
  { id: 'impersonation', label: 'Impersonation', priority: 2 },
  { id: 'name', label: 'Inappropriate handle or display name', priority: 2 },
  { id: 'other', label: 'Something else', priority: 2 },
];

const BY_LABEL = new Map(REASONS.map(r => [r.label.toLowerCase(), r]));
const BY_ID = new Map(REASONS.map(r => [r.id, r]));
const OTHER = BY_ID.get('other');

/** Any stored reason → its REASONS entry. Unknown / empty → "Something else". */
export function reasonInfo(stored) {
  const s = String(stored || '').trim().toLowerCase();
  if (!s) return OTHER;
  return BY_LABEL.get(s) || BY_ID.get(s) || OTHER;
}

/** Labels the server treats as urgent (queue order). */
export const URGENT_LABELS = REASONS.filter(r => r.priority === 0).map(r => r.label);

export const isUrgent = stored => reasonInfo(stored).priority === 0;

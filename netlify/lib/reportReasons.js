/**
 * Server copy of the report reasons the queue needs: which are urgent
 * (queue first) and which must never trigger a notice to the reported
 * user. The labels are what reports.reason stores — see
 * src/lib/moderation/reasons.js, the source of truth; Vite can't bundle
 * this CommonJS file, so it's copied, and src/lib/moderation/safety.test.mjs
 * fails the build if the two drift.
 */

// Priority 0 in reasons.js: a child's safety, threats, self-harm.
const URGENT_LABELS = ['Threats or violence', 'Child safety', 'Self-harm or suicide risk'];

// Telling the reported person about action on these could tip off
// someone a referral to CEOP / the NCA is about, or put the reporter at
// risk (proposed Terms §15: "We may not give notice where that would put
// someone at risk or hinder a police investigation").
const NO_NOTICE_LABELS = ['Child safety'];

const norm = s => String(s || '').trim().toLowerCase();
const isUrgent = reason => URGENT_LABELS.some(l => norm(l) === norm(reason));
const quietToReported = reason => NO_NOTICE_LABELS.some(l => norm(l) === norm(reason));

module.exports = { URGENT_LABELS, NO_NOTICE_LABELS, isUrgent, quietToReported };

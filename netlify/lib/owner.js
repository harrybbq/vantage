/**
 * Is this verified email one of the site owners?
 *
 * The same check admin-set-rating, trading-summary and the crest review
 * queue each spelled out inline; new owner-only endpoints use this one.
 * `email` must come from the auth server (requireUser's `email`), never
 * from anything the client said about itself — `useIsOwner` is a UI
 * gate, not an access control.
 *
 * Fails CLOSED: with OWNER_EMAIL unset nobody is an owner.
 */
function ownerEmails() {
  return (process.env.OWNER_EMAIL || process.env.VITE_OWNER_EMAIL || '')
    .split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

function isOwnerEmail(email) {
  const owners = ownerEmails();
  const e = String(email || '').trim().toLowerCase();
  return !!e && owners.length > 0 && owners.includes(e);
}

module.exports = { isOwnerEmail, ownerEmails };

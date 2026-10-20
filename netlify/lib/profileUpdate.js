/**
 * The rules for profile-update (item 84), with no I/O in them.
 *
 * handle / display_name / avatar_url are what strangers see — handle
 * search, the global board, group boards, invite previews. The client
 * already filters them, but a client check binds honest clients only;
 * once supabase/privacy_lockdown_2026_10b.sql revokes the client's UPDATE
 * on those three columns, this is the only way they change.
 *
 * planProfileUpdate(body) → { ok: false, status, error, field }
 *                         | { ok: true, fields }
 * where `fields` holds only the keys the caller sent:
 *   handle:       string (format + public-text filter checked)
 *   display_name: string | null (trimmed, ≤ 40, filtered; '' → null)
 *   avatar:       { clear: true } | { dataUrl, base64, mediaType }
 */
const { checkPublicText } = require('./nameFilter');
const { parseDataUrl } = require('./imageModeration');

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;   // = profiles_handle_format
const NAME_MAX = 40;                        // = profiles_display_name_len
// Control characters and bidi overrides have no business in a name
// other people read (they reorder or hide text around them).
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;

const bad = (field, error, status = 400) => ({ ok: false, status, field, error });

function filterMessage(what, reason) {
  return reason === 'contact'
    ? `That ${what} can't include links, email addresses or phone numbers — other people see it.`
    : `That ${what} isn't allowed — other people see it. Please pick another.`;
}

function planProfileUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(null, 'Nothing to save.');
  const fields = {};

  if ('handle' in body) {
    const h = typeof body.handle === 'string' ? body.handle.trim() : '';
    if (!HANDLE_RE.test(h)) return bad('handle', 'Letters, numbers, and underscores only (3–20 chars).');
    const r = checkPublicText(h);
    if (!r.ok) return bad('handle', filterMessage('handle', r.reason));
    fields.handle = h;
  }

  if ('display_name' in body) {
    const v = body.display_name;
    if (v !== null && typeof v !== 'string') return bad('display_name', 'That name can\'t be saved.');
    const name = v === null ? '' : v.replace(INVISIBLE, '').trim().slice(0, NAME_MAX).trim();
    if (name) {
      const r = checkPublicText(name);
      if (!r.ok) return bad('display_name', filterMessage('name', r.reason));
    }
    fields.display_name = name || null;
  }

  if ('avatar_url' in body) {
    const v = body.avatar_url;
    if (v === null || v === '') fields.avatar = { clear: true };
    else {
      const img = parseDataUrl(v);
      if (!img.ok) return bad('avatar_url', img.error);
      fields.avatar = { dataUrl: img.dataUrl, base64: img.base64, mediaType: img.mediaType };
    }
  }

  if (Object.keys(fields).length === 0) return bad(null, 'Nothing to save.');
  return { ok: true, fields };
}

/**
 * Drop what already matches the stored row, so a no-op costs no write
 * and an unchanged avatar is never re-screened (a picture can only be
 * stored by passing screening, so an exact match was already approved).
 * → { handle?, display_name?, avatar? } — only real changes.
 */
function diffAgainst(fields, current) {
  const cur = current || {};
  const out = {};
  if ('handle' in fields && fields.handle !== (cur.handle ?? null)) out.handle = fields.handle;
  if ('display_name' in fields && fields.display_name !== (cur.display_name ?? null)) out.display_name = fields.display_name;
  if (fields.avatar) {
    if (fields.avatar.clear) { if (cur.avatar_url) out.avatar = fields.avatar; }
    else if (fields.avatar.dataUrl !== cur.avatar_url) out.avatar = fields.avatar;
  }
  return out;
}

/** A PostgREST error body → the user-facing line (never the raw text). */
function writeError(status, body) {
  const code = String(body?.code || '');
  const msg = String(body?.message || '') + ' ' + String(body?.details || '');
  if (code === '23505' || status === 409) {
    return /handle/i.test(msg) || code === '23505'
      ? { status: 409, field: 'handle', error: 'That handle is taken.' }
      : { status: 409, field: null, error: 'Could not save — try again.' };
  }
  if (code === '23514') {
    if (/handle/i.test(msg)) return { status: 400, field: 'handle', error: 'Letters, numbers, and underscores only (3–20 chars).' };
    if (/display_name/i.test(msg)) return { status: 400, field: 'display_name', error: 'That name is too long.' };
    if (/avatar/i.test(msg)) return { status: 400, field: 'avatar_url', error: 'That picture can\'t be used.' };
    return { status: 400, field: null, error: 'That can\'t be saved.' };
  }
  return { status: 502, field: null, error: 'Could not save your profile — try again.' };
}

module.exports = { planProfileUpdate, diffAgainst, writeError, HANDLE_RE, NAME_MAX };

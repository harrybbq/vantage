/**
 * Supportive information — who to talk to, where to report (STARTUP_
 * REQUIREMENTS item 113; ABUSE_HANDLING "G-2. Supportive information for
 * child users"; OSA draft ICU F2 "Supportive information for child
 * users", G5 "at key moments: … when blocking, and when reporting (who
 * to talk to; Childline)", and the children's Codes' "support
 * information when restricting or reporting").
 *
 * ── Who sees it ──────────────────────────────────────────────────────
 * Everyone. The app has no age signal (item 114): sign-up asks only for
 * a "13 or older" tick, and nothing records it. G-2: "Until it can, show
 * it to everyone — it costs adults nothing." So the copy is written for
 * a 13-year-old to read and still makes sense to an adult ("Under 19?").
 *
 * ── Where ────────────────────────────────────────────────────────────
 * The report sheet's confirmation, the notice after a block, one line on
 * incoming friend requests, and Settings › Privacy › Staying safe.
 *
 * Numbers match lib/moderation/reasons.js SIGNPOSTS and the coach's
 * HELPLINES (lib/coach/safety.js); support.test.mjs fails if they drift.
 * Calm, short and factual: no red, no alarm words, nothing to dismiss
 * before you can carry on.
 *
 * Each line is a list of parts — plain strings, or { href, text } for a
 * tel: or https link — so the component can render real links while
 * plainText() gives the same words for tests and screen readers.
 *
 * Pure.
 */

export const HELP = {
  childline: { phone: '0800 1111', tel: 'tel:08001111', site: 'childline.org.uk', url: 'https://www.childline.org.uk' },
  ceop: { site: 'ceop.police.uk', url: 'https://www.ceop.police.uk' },
  samaritans: { phone: '116 123', tel: 'tel:116123' },
  emergency: { phone: '999', tel: 'tel:999' },
};

const link = (href, text) => ({ href, text });

const LINES = {
  childline: {
    id: 'childline',
    covers: HELP.childline.phone,
    parts: ['Under 19 and want to talk? Childline is free and private, any time: ',
      link(HELP.childline.tel, HELP.childline.phone), ' or ', link(HELP.childline.url, HELP.childline.site), '.'],
  },
  ceop: {
    id: 'ceop',
    covers: 'ceop',
    parts: ['Someone asking for pictures, sending sexual messages or asking to meet up? You can report it to CEOP, the National Crime Agency’s child protection team: ',
      link(HELP.ceop.url, HELP.ceop.site), '.'],
  },
  samaritans: {
    id: 'samaritans',
    covers: HELP.samaritans.phone,
    parts: ['Samaritans listen any time, free: ', link(HELP.samaritans.tel, HELP.samaritans.phone), '.'],
  },
  emergency: {
    id: 'emergency',
    covers: HELP.emergency.phone,
    parts: ['In danger right now? Call ', link(HELP.emergency.tel, HELP.emergency.phone), '.'],
  },
};

/** Short set (after a report or a block) and the full set (Settings). */
const SHORT = ['childline', 'ceop', 'emergency'];
const FULL = ['childline', 'ceop', 'samaritans', 'emergency'];

/**
 * The lines to show. `already` is text already on screen — a report
 * reason's signpost — and any line whose number or site it carries is
 * left out, so the sheet never says the same number twice.
 */
export function supportLines({ full = false, already = '' } = {}) {
  const seen = String(already || '').toLowerCase();
  return (full ? FULL : SHORT)
    .map(k => LINES[k])
    .filter(l => !seen || !seen.includes(l.covers.toLowerCase()));
}

/** A line as plain text. */
export const plainText = line => (line?.parts || []).map(p => (typeof p === 'string' ? p : p.text)).join('');

/** Every link in a set of lines. */
export const linksIn = lines => (lines || []).flatMap(l => l.parts.filter(p => typeof p !== 'string'));

export const SUPPORT_TITLE = 'Staying safe';

/** Under an incoming friend request (G-2 point 2). */
export const REQUEST_LINE = 'Only accept people you know. Not sure? Decline it, or report it with the flag.';

/** After a block. */
export const BLOCKED_BODY = name =>
  `${name || 'They'} can’t message you or send you friend requests any more, and they won’t be told. Blocking is always OK — you don’t need a reason.`;

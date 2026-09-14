/**
 * The group picture's client-side rules.
 *
 * `toCrestDataUrl` needs a canvas and is exercised in the browser
 * harness. What is testable here — and what actually decides whether a
 * bad file gets as far as the server — is the refusal logic and the
 * size arithmetic.
 *
 * Note what these tests are NOT: they are not the security. The server
 * checks type and size again in netlify/lib/imageModeration.js, because
 * anyone can POST to a function and a check that only runs in a browser
 * is a suggestion.
 */
import assert from 'node:assert/strict';
import {
  rejectReason, base64Chars, crestStatusNote, MAX_BASE64_CHARS, CREST_PX, CREST_ACCEPT,
} from './crestImage.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const file = (type, size) => ({ type, size });

// ── What gets refused before anything is read ──
{
  eq(rejectReason(file('image/jpeg', 200_000)), null, 'a normal JPEG is fine');
  eq(rejectReason(file('image/png', 200_000)), null, 'so is a PNG');
  eq(rejectReason(file('image/webp', 200_000)), null, 'and a WebP');

  ok(rejectReason(file('image/gif', 1000)), 'a GIF is not — an animation in a 40px circle is not a picture');
  ok(rejectReason(file('image/svg+xml', 1000)), 'and SVG least of all: it is a document that can carry script');
  ok(rejectReason(file('application/pdf', 1000)), 'nor a PDF someone renamed');
  ok(rejectReason(file('', 1000)), 'a file with no type at all is refused rather than guessed at');
  ok(rejectReason(null), 'and no file is a reason, not a crash');

  ok(rejectReason(file('image/jpeg', 40 * 1024 * 1024)),
    'a 40MB camera original is refused before it is decoded — decoding one on a phone to make a 160px square is how you run out of memory');
  eq(rejectReason(file('image/jpeg', 11 * 1024 * 1024)), null, 'but 11MB is still allowed through');
}

// ── Every accepted type is one the picker offers, and vice versa ──
{
  const offered = CREST_ACCEPT.split(',');
  for (const t of offered) {
    eq(rejectReason(file(t, 1000)), null, `${t} is offered by the picker, so it must be accepted`);
  }
  ok(!offered.includes('image/gif'), 'and the picker does not offer anything the checker refuses');
}

// ── Measuring the payload ──
{
  eq(base64Chars('data:image/jpeg;base64,AAAA'), 4, 'counts the base64, not the header');
  eq(base64Chars(''), 0, 'an empty string measures zero rather than -1');
  eq(base64Chars('not a data url'), 0, 'and so does something that is not a data URL');
  eq(base64Chars(null), 0, 'and null');
  ok(MAX_BASE64_CHARS > 100_000, 'the ceiling leaves room for a real picture');
  ok(MAX_BASE64_CHARS < 1_000_000,
    'and is nowhere near a megabyte — this column is read on every board draw, twenty rows at a time');
  ok(CREST_PX >= 80 && CREST_PX <= 256, 'the stored square is drawn at 40-72px, so it is sized for retina and no more');
}

// ── What the leader is told ──
{
  eq(crestStatusNote('approved'), null, 'an approved picture needs no label');
  eq(crestStatusNote('none'), null, 'and neither does no picture');
  eq(crestStatusNote(undefined), null, 'nor a status nobody set');

  const waiting = crestStatusNote('pending');
  ok(waiting && /only your group/i.test(waiting.text),
    'while it waits, the leader is told WHO can see it — otherwise "pending" reads as "broken"');

  const refusedWithReason = crestStatusNote('rejected', 'sexual content');
  ok(refusedWithReason.text.includes('sexual content'), 'a refusal says why');
  eq(refusedWithReason.tone, 'bad', 'and is styled as the bad news it is');

  const refusedBlank = crestStatusNote('rejected', '');
  ok(refusedBlank.text.length > 0, 'a refusal with no reason recorded still says something');
  ok(!refusedBlank.text.endsWith(': '), 'and does not trail off into an empty colon');
}

console.log(`group crest image: ${n} assertions passed`);

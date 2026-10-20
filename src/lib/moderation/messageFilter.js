/**
 * The DM text filter (STARTUP_REQUIREMENTS item 118, Apple 1.2: "a
 * method for filtering objectionable material").
 *
 * It reads text exactly the way the public-name filter does
 * (./nameFilter.js — accents stripped, l33t digits mapped, s.p.a.c.e.d
 * letters joined, stretched letters collapsed, whole words only) but
 * checks a much NARROWER list, on purpose:
 *
 *   - A DM goes to one accepted friend, not to strangers. Swearing
 *     between friends is not what the filter is for, and refusing
 *     "fuck" or "shit" would make DMs feel broken.
 *   - Links, emails and phone numbers are allowed. Friends share
 *     recipes and Strava links; a name filter's contact rule would
 *     refuse them all.
 *   - Words people need in order to ASK FOR HELP are never refused:
 *     "rape", "paedo", "nudes", "nonce", "porn". A teenager telling a
 *     friend "a pedo messaged me" must get through. Reporting is the
 *     tool for those conversations, not the filter.
 *   - Everyday British words that collide with slurs are left out:
 *     "fag" (cigarette), "chink" (in the armour), "spic" (and span),
 *     "coon", "dyke", "xxx" (kisses), "tits" (the bird), "anal".
 *
 * What is left: unambiguous slurs and a few unambiguous explicit terms.
 * The database applies the SAME list on insert (vb_message_text_blocked
 * in supabase/safety_2026_10b.sql), so a modified client can't skip it;
 * messageFilter.test.mjs checks the two lists are identical.
 *
 * Pure.
 */
import { candidateWords } from './nameFilter.js';

// Whole-word matches. Every entry must also be in nameFilter's EXACT
// list (the test enforces it) — this is a subset, never a new list.
export const DM_EXACT = [
  // slurs
  'nigger', 'nigga', 'niggas', 'niggers', 'nigg', 'faggot', 'faggots',
  'tranny', 'trannies', 'kike', 'kikes', 'paki', 'pakis', 'wetback',
  'gook', 'gooks', 'raghead', 'towelhead', 'beaner', 'gypo', 'gyppo', 'pikey',
  // explicit
  'blowjob', 'handjob', 'rimjob', 'jizz', 'dildo', 'dildos', 'hentai', 'milf',
];

// Prefix stems. Every entry must also be in nameFilter's STEMS.
export const DM_STEMS = ['nigger', 'faggot', 'blowjob'];

const EXACT = new Set(DM_EXACT);

/** → { ok: true } | { ok: false, reason: 'language' } */
export function checkMessageText(text) {
  for (const w of candidateWords(text)) {
    if (EXACT.has(w) || DM_STEMS.some(s => w.startsWith(s))) return { ok: false, reason: 'language' };
  }
  return { ok: true };
}

export const MESSAGE_FILTERED_TEXT =
  'That message includes a word we don\'t allow in messages — slurs and explicit terms. Edit it and try again.';

/** The inline composer error, or null when the text is fine. Never
 *  repeats the matched word back. */
export function messageTextProblem(text) {
  return checkMessageText(text).ok ? null : MESSAGE_FILTERED_TEXT;
}

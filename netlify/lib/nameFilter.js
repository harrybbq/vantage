/**
 * A small, deliberately blunt filter for text other people will see:
 * group names and the item names that surface on everyone's global
 * trending board (Apple 1.2 — user-generated content needs a filter,
 * a report path and a way to act on reports; this is the filter).
 *
 * It is not a moderation system and does not pretend to be. It catches
 * the obvious — slurs, explicit sexual terms, links, phone numbers and
 * email addresses — including the usual disguises (l33t digits,
 * s.p.a.c.e.d letters, stretched vowels). Anything subtler is what the
 * report queue (functions/moderation.js) is for.
 *
 * Matching is per WORD of the normalised text, never substring, so
 * "Scunthorpe", "Essex" and "cocktail" pass. Short terms must match a
 * whole word exactly; only STEMS (safe as prefixes) match the start of
 * a word, so "fucking" is caught but "spicy" is not.
 *
 * Pure. Tested by netlify/lib/nameFilter.test.mjs (npm run check:names).
 */

// Whole-word matches.
const EXACT = new Set([
  // slurs
  'nigger', 'nigga', 'niggas', 'niggers', 'nigg', 'faggot', 'faggots', 'fag', 'fags', 'dyke', 'dykes',
  'tranny', 'trannies', 'retard', 'retards', 'retarded', 'spic', 'spics', 'chink', 'chinks',
  'kike', 'kikes', 'paki', 'pakis', 'wetback', 'gook', 'gooks', 'coon', 'coons', 'raghead',
  'towelhead', 'beaner', 'gypo', 'gyppo', 'pikey',
  // sexual / explicit
  'cunt', 'cunts', 'porn', 'porno', 'xxx', 'dick', 'dicks', 'cock', 'cocks', 'pussy', 'pussies',
  'tits', 'titties', 'boobs', 'cum', 'jizz', 'blowjob', 'handjob', 'rimjob', 'anal', 'dildo',
  'dildos', 'milf', 'hentai', 'nudes', 'onlyfans', 'rape', 'rapist', 'raping', 'paedo', 'pedo',
  'paedophile', 'pedophile', 'incest', 'bestiality', 'slut', 'sluts', 'whore', 'whores', 'wank',
  'wanker', 'wankers', 'twat', 'twats', 'bellend', 'nonce', 'nazi', 'nazis', 'hitler',
  'fuck', 'shit', 'shite', 'bitch', 'bitches', 'bastard', 'motherfucker',
]);

// Prefix stems: safe to match the start of any word.
const STEMS = ['nigger', 'faggot', 'fuck', 'motherfuck', 'cunt', 'wanker', 'blowjob', 'paedophil', 'pedophil', 'bestialit'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' };

function normalise(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[013457890@$!|+]/g, ch => LEET[ch] || ch);
}

const collapse = w => w.replace(/(.)\1+/g, '$1');

/** Words of the normalised text, plus runs of single letters joined up
 *  ("f u c k", "f.u.c.k" → "fuck"). */
function words(norm) {
  const parts = norm.split(/[^a-z]+/).filter(Boolean);
  const out = [...parts];
  let run = '';
  for (const p of parts) {
    if (p.length === 1) run += p;
    else { if (run.length >= 3) out.push(run); run = ''; }
  }
  if (run.length >= 3) out.push(run);
  return out;
}

function hitsBlocklist(text) {
  for (const w of words(normalise(text))) {
    for (const v of new Set([w, collapse(w)])) {
      if (EXACT.has(v)) return true;
      if (STEMS.some(s => v.startsWith(s))) return true;
    }
  }
  return false;
}

// Contact details and links, read on the raw text (before l33t mapping,
// which would turn digits into letters).
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}(\.(?=[a-z0-9])|\s+dot\s+)(com|net|org|io|co|uk|xyz|ru|gg|me|app|link|ly|shop|store|site|info|biz|tk|tv|cc|to)\b)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

function hasContact(text) {
  const s = String(text || '');
  if (URL_RE.test(s) || EMAIL_RE.test(s)) return true;
  const m = s.match(PHONE_RE);
  return !!m && m[0].replace(/\D/g, '').length >= 9;
}

/**
 * → { ok: true } or { ok: false, reason: 'language' | 'contact' }.
 * `reason` is for the caller's log and error copy; never echo the match.
 */
function checkPublicText(text) {
  if (hitsBlocklist(text)) return { ok: false, reason: 'language' };
  if (hasContact(text)) return { ok: false, reason: 'contact' };
  return { ok: true };
}

module.exports = { checkPublicText, normalise };

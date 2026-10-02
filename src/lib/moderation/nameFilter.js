/**
 * The public-text filter, client side: display names and handles.
 *
 * A port of netlify/lib/nameFilter.js (which screens group names and
 * trending items on the server). That file is CommonJS and Vite will not
 * bundle CommonJS from outside node_modules, so the rules are copied
 * here rather than imported. The two MUST stay identical —
 * nameFilter.test.mjs (npm run check:namesclient) compares the word
 * lists of both files and runs the same cases through each, so an edit
 * to one without the other fails the build.
 *
 * What it is for: a display name and a handle are shown to strangers
 * (handle search, the global leaderboard, group boards), and Apple 1.2
 * wants a filter on text other people see. It catches the obvious —
 * slurs, explicit terms, links, phone numbers, email addresses — with
 * the usual disguises. It is not a moderation system; reports are.
 *
 * Per WORD of the normalised text, never substring, so "Scunthorpe",
 * "Dickens" and "Cocktail" pass. Pure.
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

export function normalise(text) {
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
 * Same contract as the server's checkPublicText.
 */
export function checkPublicText(text) {
  if (hitsBlocklist(text)) return { ok: false, reason: 'language' };
  if (hasContact(text)) return { ok: false, reason: 'contact' };
  return { ok: true };
}

/**
 * The inline message for a name or handle other people would see, or
 * null when it is fine. Says what kind of thing is wrong without
 * repeating the match back.
 */
export function publicNameProblem(text, what = 'name') {
  const r = checkPublicText(text);
  if (r.ok) return null;
  return r.reason === 'contact'
    ? `That ${what} can't include links, email addresses or phone numbers — other people see it.`
    : `That ${what} isn't allowed — other people see it. Please pick another.`;
}

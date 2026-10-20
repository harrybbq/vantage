/**
 * AI coach safe mode — the client's half.
 *
 * ESM twin of netlify/lib/coachSafety.js (read that file's header for
 * the why: crisis / ed / relapse / exercise / minor, what each does, and
 * the output policy). Everything above the "Client only" line below is
 * the same code; netlify/lib/coachSafety.test.mjs runs both on the same
 * fixtures and fails if they drift. Duplicated rather than imported
 * because the functions bundle is CommonJS and the client is Vite ESM —
 * the same arrangement as lib/push/handlers.js and push-dispatch.js.
 *
 * What the client adds (assessState): things the coach snapshot never
 * carries — the food diary totals (S.macroHistory), weight readings
 * (S.vitalsLog), the profile tagline, and trackers the snapshot leaves
 * out (band-fed ones). The result goes to the server as a hint
 * (`snapshot.safety.modes`) that can only make the coach SAFER, and
 * drives the local briefs and tips (heuristicBrief, heuristics,
 * patterns) so they go gentle too.
 *
 * Pure. No imports.
 */

/** Priority order: the first present mode picks the signpost. */
const MODES = ['crisis', 'ed', 'relapse', 'exercise', 'minor'];

const HELPLINES = {
  emergency: '999',
  samaritans: '116 123',
  beat: '0808 801 0677',
  nhs111: 'NHS 111',
  childline: '0800 1111',
};

// ── Text normalisation ────────────────────────────────────────────────────

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const toNum = s => (s in WORD_NUM ? WORD_NUM[s] : parseFloat(String(s).replace(',', '.')));

// ── Function rules (things a regex alone can't judge) ─────────────────────

/** "under 500 cals", "eat 600 calories", "400kcal a day" — a stated
 *  intake below 800 kcal (the NHS line for a very-low-calorie diet). */
function lowCalText(t) {
  const re = /\b(?:under|below|max|maximum|less\s+than|no\s+more\s+than|eat|only|<)\s*(\d{2,4})\s*(?:k?cals?|kcal|calories)\b|\b(\d{2,4})\s*(?:k?cals?|kcal|calories)\s*(?:a|per|\/)\s*day\b/g;
  let m;
  while ((m = re.exec(t))) {
    const n = Number(m[1] || m[2]);
    if (n > 0 && n < 800) return true;
  }
  return false;
}

/** "lose 10kg in 3 weeks", "drop 2 stone in a month" — faster than
 *  1 kg a week, the top of the NHS's safe range. */
function rapidLossGoal(t) {
  const re = /\b(?:lose|drop|shed|lost|losing|dropping)\s+(\d+(?:[.,]\d+)?|a|one|two|three|four|five|six|ten)\s*(kg|kgs|kilos?|lbs?|pounds?|stone|st)\b[^.]{0,30}?\b(?:in|by|within|over)\s+(?:the\s+next\s+)?(\d+|a|one|two|three|four|five|six|seven|eight|ten|twelve)\s*(days?|weeks?|wks?|months?)\b/g;
  let m;
  while ((m = re.exec(t))) {
    let kg = toNum(m[1]);
    const unit = m[2];
    if (/^(lb|lbs|pound|pounds)$/.test(unit)) kg *= 0.4536;
    else if (/^(stone|st)$/.test(unit)) kg *= 6.35;
    let weeks = toNum(m[3]);
    if (/^day/.test(m[4])) weeks /= 7;
    else if (/^month/.test(m[4])) weeks *= 4.345;
    if (kg > 0 && weeks > 0 && kg / weeks > 1) return true;
  }
  return false;
}

/** "72 hour fast", "3 day fast" — 36 hours or more. */
function longFast(t) {
  const h = /\b(\d{2,3})\s*(?:h|hr|hrs|hour|hours)\s*(?:water\s+|dry\s+)?fast/.exec(t);
  if (h && Number(h[1]) >= 36) return true;
  const d = /\b(\d|two|three|four|five|seven)\s*(?:-\s*)?days?\s+(?:water\s+|dry\s+)?fast/.exec(t);
  return !!(d && toNum(d[1]) >= 2);
}

/** "train 5 hours a day", "3 workouts a day". */
function hoursADay(t) {
  const h = /\b(?:train\w*|exercis\w*|gym|work\s*out\w*|run\w*|cardio)\b[^.]{0,20}?\b(\d+(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s+(?:a|per|every)\s+day\b/.exec(t);
  if (h && Number(h[1]) >= 4) return true;
  const w = /\b(\d|three|four|five)\s+(?:workouts|sessions|gym\s+sessions|runs)\s+(?:a|per|every)\s+day\b/.exec(t);
  return !!(w && toNum(w[1]) >= 3);
}

const AGE_WORDS = '1[0-7]|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen';
/** "I'm 15", "age 14", "16 years old", "my 17th birthday". */
function ageStated(t) {
  const notUnit = '(?!\\s*(?:days?|weeks?|months?|kg|kgs|lbs?|st\\b|stone|km|k\\b|mins?|minutes|hours?|%|pounds|miles|reps|sets|times))';
  if (new RegExp(`\\b(?:i'?m|i\\s+am|im|aged?|turning|turn)\\s+(?:${AGE_WORDS})\\b${notUnit}`).test(t)) return true;
  if (new RegExp(`\\b(?:${AGE_WORDS})\\s*(?:yo|y\\/o|yrs?\\s+old|years?\\s+old)\\b`).test(t)) return true;
  return /\bmy\s+(?:1[0-8])(?:st|nd|rd|th)?\s+birthday\b/.test(t);
}

// ── Text rules ────────────────────────────────────────────────────────────
// `weak` rules don't switch the mode on their own: two DIFFERENT weak
// categories do (so "Intermittent fasting 16:8" alone is just a habit).
// `habitOnly` rules apply to habit names — habits here are things the
// user is staying away from, so a bare "Cutting" is not a gym phase.

const TEXT_RULES = [
  // crisis — self-harm, suicidal ideation
  { id: 'suicide', mode: 'crisis', re: /\bsuicid(?:e|al)\b/ },
  { id: 'kill-self', mode: 'crisis', re: /\bkill(?:ing)?\s*my\s*self\b|\bkms\b/ },
  { id: 'end-life', mode: 'crisis', re: /\bend(?:ing)?\s+(?:it\s+all|my\s+life)\b/ },
  { id: 'want-to-die', mode: 'crisis', re: /\b(?:want(?:ing)?\s+to|wanna)\s+die\b/ },
  { id: 'not-be-here', mode: 'crisis', re: /\b(?:don'?t|do\s+not)\s+want\s+to\s+(?:be\s+here|be\s+alive|live|exist|wake\s+up)\b/ },
  { id: 'no-reason-to-live', mode: 'crisis', re: /\bno\s+(?:reason|point)\s+(?:to|in)\s+liv(?:e|ing)\b|\bbetter\s+off\s+(?:dead|without\s+me)\b/ },
  { id: 'self-harm', mode: 'crisis', re: /\bself[\s-]?harm(?:ing|ed)?\b|\b(?:sh)[\s-](?:free|clean)\b|\bclean\s+from\s+sh\b/ },
  { id: 'hurt-self', mode: 'crisis', re: /\b(?:hurt|harm|cut|burn|hang)(?:ing|s)?\s+my\s*self\b|\bcut(?:ting|s)?\s+my\s+(?:arms?|legs?|wrists?|thighs?|skin)\b/ },
  { id: 'cutting-abstain', mode: 'crisis', re: /\b(?:without|from|since|no|stop|quit)\s+(?:cutting|burning)$/ },
  { id: 'cutting-habit', mode: 'crisis', habitOnly: true, re: /^(?:no\s+)?cutting$/ },
  { id: 'overdose', mode: 'crisis', re: /\boverdos(?:e|ed|es|ing)\b/ },
  { id: 'euphemism', mode: 'crisis', re: /\bunaliv(?:e|ing)\b|\bsewer\s*slide\b/ },

  // ed — eating-disorder signals
  { id: 'purge', mode: 'ed', re: /\bpurg(?:e|es|ed|ing)\b/ },
  { id: 'vomit', mode: 'ed', re: /\bvomit(?:ing|ed)?\b|\bthrow(?:ing)?\s+up\b|\bmake\s+my\s*self\s+(?:sick|throw\s+up)\b/ },
  { id: 'laxative', mode: 'ed', re: /\b(?:laxatives?|diuretics?|diet\s+pills?|slimming\s+pills?)\b/ },
  { id: 'binge-eating', mode: 'ed', re: /\bbing(?:e|eing|ing|ed)\s*(?:eat(?:ing)?|food|and\s+purg)/ },
  { id: 'binge-alone', mode: 'ed', re: /^(?:no\s+|stop\s+|quit\s+)?bing(?:e|eing|ing)$/ },
  { id: 'starve', mode: 'ed', re: /\bstarv(?:e|es|ed|ing|ation)\b/ },
  { id: 'pro-ana', mode: 'ed', re: /\bpro[\s-]?(?:ana|mia)\b|\b(?:thin|bone|mean)spo\b|\bthinspiration\b/ },
  { id: 'chew-spit', mode: 'ed', re: /\bchew\s*(?:and|&|n)\s*spit\b/ },
  { id: 'body-checking', mode: 'ed', re: /\bthigh\s+gap\b|\bsee\s+my\s+(?:ribs|bones|hip\s*bones)\b|\bcollar\s*bones?\s+show\b/ },
  { id: 'earn-food', mode: 'ed', re: /\b(?:earn|deserve)\s+(?:my\s+)?(?:food|meals?|dinner|lunch|breakfast|to\s+eat)\b|\bburn\s+off\s+(?:what|everything|every|all|my\s+(?:food|meals?|dinner|lunch|breakfast))\b/ },
  { id: 'extended-fast', mode: 'ed', re: /\b(?:water|dry|juice)\s+fast(?:ing)?\b/ },
  { id: 'long-fast', mode: 'ed', test: longFast },
  { id: 'very-low-calorie-goal', mode: 'ed', test: lowCalText },
  { id: 'rapid-loss-goal', mode: 'ed', test: rapidLossGoal },
  { id: 'fasting', mode: 'ed', weak: 'fasting', re: /\b(?:fasting|fasted|intermittent\s+fast|\d+\s*[:/]\s*\d+\s+fast|\d+\s*(?:h|hrs?|hours?)\s+fast|fast\s+(?:days?|until|till|til)|omad|one\s+meal\s+a\s+day|skip(?:ping|ped)?\s+(?:meals?|breakfast|lunch|dinner))\b/ },
  { id: 'restriction', mode: 'ed', weak: 'restriction', re: /\b(?:no|not|stop|don'?t)\s+eat(?:ing)?$|\blow[\s-]?cal(?:orie)?s?\b|\bcalorie\s+(?:deficit|restrict\w*)\b|\beat\s+less\b|\bsmaller\s+portions\b/ },
  { id: 'ed-shorthand', mode: 'ed', weak: 'shorthand', re: /\bugw\b|\bbody\s+check(?:ing|s)?\b/ },

  // exercise — over-training
  { id: 'no-rest', mode: 'exercise', re: /\bno\s+rest\s+days?\b|\bnever\s+(?:take\s+a\s+)?rest\s+day\b|\bno\s+days?\s+off\b/ },
  { id: 'through-pain', mode: 'exercise', re: /\b(?:train|run|lift|exercise|work\s*out|push)(?:ing)?\s+through\s+(?:(?:the|my|a|an)\s+)?(?:[a-z]+\s+)?(?:pain|injury|injuries|illness|sickness)\b/ },
  { id: 'hours-a-day', mode: 'exercise', test: hoursADay },

  // minor — under-18 hints (no age is stored; the minimum is 13)
  { id: 'school-exams', mode: 'minor', re: /\b(?:gcses?|ks[34]|11\s*plus|eleven\s+plus|sixth\s+form|a[\s-]?levels?|year\s*(?:7|8|9|10|11|12|13)\s+(?:exams?|mocks?|options|report))\b/ },
  { id: 'age-stated', mode: 'minor', test: ageStated },
  { id: 'school-life', mode: 'minor', re: /\bdetention\b|\bhead\s+of\s+year\b|\bmy\s+form\s+tutor\b/ },
];

// ── Relapse categories (habit names) ──────────────────────────────────────

const RELAPSE_CATS = [
  { cat: 'alcohol', re: /\b(?:alcohol|booze|drink(?:ing|s)?|beers?|wine|vodka|gin|whisk(?:e)?y|spirits|pints?|sober|sobriety|hangovers?)\b/, not: /\b(?:water|tea|coffee|fizzy|energy\s+drinks?|soft\s+drinks?|juice|sugary|squash|smoothies?)\b/ },
  { cat: 'gambling', re: /\b(?:gambl\w*|betting|bets?|casino|slots?|poker|roulette|blackjack|scratch\s*cards?|lottery|sports?\s*book|bookies?|fruit\s+machines?)\b/ },
  { cat: 'drugs', re: /\b(?:drugs?|cocaine|coke|weed|cannabis|marijuana|spliffs?|heroin|ketamine|ket|mdma|ecstasy|opioids?|opiates?|codeine|meth|spice|benzos?|xanax|crack|lsd|shrooms|nitrous)\b/, not: /\b(?:diet\s+coke|coke\s+zero|cola)\b/ },
];
const RELAPSE_WINDOW_DAYS = 7;

function relapseCategory(name) {
  const t = norm(name);
  for (const c of RELAPSE_CATS) {
    if (c.re.test(t) && !(c.not && c.not.test(t))) return c.cat;
  }
  return null;
}

// ── Tracker classification ────────────────────────────────────────────────

const LIFT_WORDS = /\b(?:bench|squat|deadlift|press|curl|row|lift|lifts|pull[\s-]?ups?|clean\s+and\s+jerk|snatch|1rm|pr)\b/;

function classifyTracker(t) {
  const name = norm(t && t.name);
  const unit = norm(t && t.unit);
  const burn = /\b(?:burn\w*|active|exercise|workout|steps)\b/.test(name);
  if (!burn && (/\b(?:calor\w*|kcal|cals?|food|intake|eaten|eating|meals?|snacks?|macros?|protein|carbs?|fat|sugar|energy\s+in)\b/.test(name) || /^(?:k?cals?|kcal|calories)$/.test(unit))) {
    return 'food';
  }
  if (!LIFT_WORDS.test(name) && /\b(?:weight|weigh[\s-]?ins?|body\s*weight|bmi|body\s*fat|waist|hips?|thighs?|measurements?|dress\s+size|jeans\s+size)\b/.test(name)) {
    return 'weight';
  }
  if (/\b(?:run|runs|running|jog\w*|gym|workouts?|work\s*outs?|training|exercis\w*|cardio|steps|cycl\w*|bike|swim\w*|hiit|lifting|walk\w*|spin|yoga|pilates|sport|rowing|miles|km)\b/.test(name)
    || /^(?:steps|workouts)$/.test(unit)) {
    return 'exercise';
  }
  return null;
}

function isCalorieTracker(t) {
  const name = norm(t && t.name);
  const unit = norm(t && t.unit);
  return classifyTracker(t) === 'food'
    && !/\b(?:protein|carbs?|fat|sugar|macros?|meals?|snacks?)\b/.test(name)
    && (/\b(?:calor\w*|kcal|cals?|intake|energy\s+in|food)\b/.test(name) || /^(?:k?cals?|kcal|calories)$/.test(unit));
}

/** Newest-first numeric values from a snapshot tracker's series. */
function seriesValues(t) {
  const s = Array.isArray(t && t.last_14_days) ? t.last_14_days : [];
  return s.map(c => Number(c && c.value) || 0);
}

/** ≥3 of the last 7 days logged above zero and below 800 kcal. */
function veryLowIntake(values) {
  return values.slice(0, 7).filter(v => v > 0 && v < 800).length >= 3;
}

/** ≥4% down between the oldest and newest of ≥3 readings (≤14 days). */
function rapidWeightDrop(valuesNewestFirst) {
  const v = valuesNewestFirst.filter(x => x >= 20 && x <= 400);
  if (v.length < 3) return false;
  const newest = v[0], oldest = v[v.length - 1];
  return (oldest - newest) / oldest >= 0.04;
}

/** ≥5 of the last 7 days above an extreme daily volume for the unit. */
function extremeVolume(t) {
  if (t.type === 'boolean') return false;
  const name = norm(t.name);
  const unit = norm(t.unit);
  const cycling = /\b(?:cycl\w*|bike|spin)\b/.test(name);
  let limit = null;
  if (/^(?:min|mins|minutes?)$/.test(unit)) limit = 180;
  else if (/^(?:h|hr|hrs|hours?)$/.test(unit)) limit = 3;
  else if (unit === 'steps' || /\bsteps\b/.test(name)) limit = 40000;
  else if (unit === 'km') limit = cycling ? 150 : 30;
  else if (/^(?:mi|miles?)$/.test(unit)) limit = cycling ? 100 : 20;
  else if (/^(?:sessions|workouts)$/.test(unit) || /\b(?:sessions|workouts)\b/.test(name)) limit = 3;
  if (limit == null) return false;
  return seriesValues(t).slice(0, 7).filter(v => v >= limit).length >= 5;
}

// ── Assessment ────────────────────────────────────────────────────────────

/** Every user-written string the snapshot carries, with where it was. */
function textFields(snap) {
  const out = [];
  const push = (where, text, kind) => { if (typeof text === 'string' && text.trim()) out.push({ where, text, kind }); };
  const arr = k => (Array.isArray(snap[k]) ? snap[k] : []);
  arr('habits').forEach((h, i) => push(`habits.${i}`, h && h.name, 'habit'));
  arr('trackers').forEach((t, i) => {
    push(`trackers.${i}`, t && t.name, 'tracker');
    if (t && typeof t.goal === 'string') push(`trackers.${i}`, t.goal, 'tracker');
  });
  arr('achievements').forEach((a, i) => push(`achievements.${i}`, a && a.name, 'achievement'));
  arr('recent_completions').forEach((a, i) => push(`recent_completions.${i}`, a && a.name, 'achievement'));
  arr('holidays').forEach((h, i) => push(`holidays.${i}`, h && h.destination, 'holiday'));
  const shop = snap.shop && Array.isArray(snap.shop.can_afford) ? snap.shop.can_afford : [];
  shop.forEach((s, i) => push(`shop.can_afford.${i}`, s && s.name, 'shop'));
  if (typeof snap.notes === 'string') push('notes', snap.notes, 'note');
  else if (Array.isArray(snap.notes)) snap.notes.forEach((n, i) => push(`notes.${i}`, typeof n === 'string' ? n : n && n.text, 'note'));
  return out;
}

/**
 * Assess a coach snapshot. Returns
 *   { modes: [...in priority order], signals: [{ mode, rule, where }], weak: [...] }
 * `extra` ({ texts: [{ where, text, kind }], signals: [...] }) is how the
 * client adds what only it can see (src/lib/coach/safety.js assessState).
 * `snapshot.safety.modes` (a hint from the client, which can see more
 * than the snapshot carries) can only ADD modes, never remove them.
 */
function assessSnapshot(snap, extra = {}) {
  const s = snap && typeof snap === 'object' ? snap : {};
  const signals = (Array.isArray(extra.signals) ? extra.signals : [])
    .filter(x => x && MODES.includes(x.mode));
  const add = (mode, rule, where) => signals.push({ mode, rule, where });
  const weak = new Map();
  const texts = textFields(s).concat(Array.isArray(extra.texts) ? extra.texts : []);

  for (const f of texts) {
    const t = norm(f.text);
    for (const r of TEXT_RULES) {
      if (r.habitOnly && f.kind !== 'habit') continue;
      if (!(r.re ? r.re.test(t) : r.test(t))) continue;
      if (r.weak) { if (!weak.has(r.weak)) weak.set(r.weak, f.where); }
      else add(r.mode, r.id, f.where);
    }
  }

  (Array.isArray(s.trackers) ? s.trackers : []).forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    const kind = classifyTracker(t);
    const values = seriesValues(t);
    if (isCalorieTracker(t) && t.type !== 'boolean' && veryLowIntake(values)) add('ed', 'very-low-intake', `trackers.${i}`);
    if (kind === 'weight' && t.type !== 'boolean' && rapidWeightDrop(values)) add('ed', 'rapid-weight-drop', `trackers.${i}`);
    if (kind === 'exercise' && extremeVolume(t)) add('exercise', 'extreme-volume', `trackers.${i}`);
  });

  (Array.isArray(s.habits) ? s.habits : []).forEach((h, i) => {
    if (!h || typeof h !== 'object') return;
    const cat = relapseCategory(h.name);
    const days = Number(h.days_clean);
    if (cat && Number(h.relapse_count) >= 1 && Number.isFinite(days) && days <= RELAPSE_WINDOW_DAYS) {
      add('relapse', `relapse:${cat}`, `habits.${i}`);
    }
  });

  const hint = s.safety && Array.isArray(s.safety.modes) ? s.safety.modes : [];
  for (const m of hint) if (MODES.includes(m)) add(m, 'client-hint', 'safety');

  const has = m => signals.some(x => x.mode === m);
  if (!has('ed') && weak.size >= 2) add('ed', `weak:${[...weak.keys()].sort().join('+')}`, [...weak.values()][0]);
  // A young person who is fasting or restricting gets the gentle
  // treatment on one weak signal, not two.
  if (!has('ed') && has('minor') && weak.size >= 1) add('ed', 'minor+weak', [...weak.values()][0]);

  return { modes: MODES.filter(has), signals, weak: [...weak.keys()].sort() };
}

// ── What the model may see in gentle mode ─────────────────────────────────

const BODY_TERMS = /\b(?:weigh\w*|kg|kgs|kilos?|lbs?|pounds|stone|bmi|body\s*fat|calor\w*|kcal|cals?|diet\w*|slim\w*|thin\w*|skinny|abs|six[\s-]?pack|lose|losing|lost|shed|bikini|beach\s+body|waist|thighs?|toned?|fast\w*|macros?|protein|carbs?|food|meals?|eat\w*|snack\w*|sugar|size\s+\d+|recipes?|cook\w*)\b/;
const EXERCISE_TERMS = /\b(?:run|runs|running|marathon|half\s+marathon|[0-9]+k|jog\w*|gym|workouts?|training|exercis\w*|cardio|steps|cycl\w*|swim\w*|hiit|lifting|triathlon|ironman|pull[\s-]?ups?|push[\s-]?ups?|squats?|bench|deadlift)\b/;

/**
 * The snapshot the model gets in gentle mode: nothing about food, weight,
 * body or exercise (goals included), no day counts or relapse counts, nothing a
 * rule flagged, and no previous briefs (their lines could be exactly the
 * kind of thing gentle mode exists to stop).
 */
function sanitizeForModel(snap, assessment) {
  const flagged = new Set((assessment && assessment.signals || []).map(x => x.where));
  const keep = (k, i, name) => !flagged.has(`${k}.${i}`) && !BODY_TERMS.test(norm(name)) && !EXERCISE_TERMS.test(norm(name));
  const out = { ...snap };
  delete out.safety;
  delete out.notes;
  out.recent_briefs = [];
  out.recent_dismissed_topics = [];
  out.habits = (Array.isArray(snap.habits) ? snap.habits : [])
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h && keep('habits', i, h.name))
    .map(({ h }) => ({ id: h.id, name: h.name }));
  out.trackers = (Array.isArray(snap.trackers) ? snap.trackers : [])
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t && !classifyTracker(t) && keep('trackers', i, t.name))
    .map(({ t }) => ({ id: t.id, name: t.name, type: t.type, last_7_total: t.last_7_total, prior_7_total: t.prior_7_total }));
  out.achievements = (Array.isArray(snap.achievements) ? snap.achievements : [])
    .filter((a, i) => a && keep('achievements', i, a.name));
  out.recent_completions = (Array.isArray(snap.recent_completions) ? snap.recent_completions : [])
    .filter((a, i) => a && keep('recent_completions', i, a.name));
  if (snap.shop && typeof snap.shop === 'object') {
    const ca = Array.isArray(snap.shop.can_afford) ? snap.shop.can_afford : [];
    out.shop = { ...snap.shop, can_afford: ca.filter((x, i) => x && keep('shop.can_afford', i, x.name)) };
  }
  return out;
}

/**
 * Normal mode: the client hint never goes to the model either, and nor do
 * earlier briefs that were safe-mode ones. `recent_briefs` comes back from
 * the user's own history, so the day after a crisis or eating-disorder
 * brief it would carry "Samaritans… 116 123" or "Beat…" to the model as a
 * line not to repeat — telling it what the gentle block is careful not to.
 */
function stripHints(snap) {
  const out = { ...snap };
  delete out.safety;
  if (Array.isArray(out.recent_briefs)) {
    out.recent_briefs = out.recent_briefs.filter(b => !wasSafeBrief(b));
  }
  return out;
}

/** Fragments only the fixed safe-mode briefs contain (besides helplines). */
const SAFE_MARKERS = ["today isn't about goals", 'something away from numbers', "one hard day doesn't undo", 'rest is part of getting fitter'];

function wasSafeBrief(b) {
  if (!b || typeof b !== 'object') return false;
  const t = norm([b.focus, b.watch, b.micro].filter(x => typeof x === 'string').join(' '));
  const numbers = Object.values(HELPLINES).map(norm);
  return numbers.some(x => t.includes(x)) || SAFE_MARKERS.some(x => t.includes(x)) || /\b(?:beat|samaritans|childline)\b/.test(t);
}

// ── Fixed, reviewed text ──────────────────────────────────────────────────

const SIGNPOST = {
  crisis: `If you're thinking about harming yourself or you feel unsafe, you don't have to cope alone: Samaritans are free on ${HELPLINES.samaritans}, day or night. In danger right now, call ${HELPLINES.emergency}.`,
  ed: `If food or your body feel hard to think about right now, Beat's helpline is free on ${HELPLINES.beat}, or you can talk to your GP. ${HELPLINES.nhs111} is there too.`,
  exercise: `If a rest day feels impossible, or you're training through pain or illness, have a chat with your GP or call ${HELPLINES.nhs111}.`,
  minorExtra: `Under 19? Childline is free and confidential on ${HELPLINES.childline}.`,
};
const RELAPSE_THING = { alcohol: 'drinking', gambling: 'gambling', drugs: 'drug use' };
function relapseSignpost(cats) {
  const thing = cats.length === 1 ? RELAPSE_THING[cats[0]] : 'this';
  return `If ${thing} feels hard to manage right now, you don't have to do it alone: your GP or ${HELPLINES.nhs111} can point you to free, confidential support.`;
}

/** Every fixed signpost sentence (the checker ignores these). */
function allSignposts() {
  const list = [SIGNPOST.crisis, SIGNPOST.ed, SIGNPOST.exercise, SIGNPOST.minorExtra, relapseSignpost(['x'])];
  for (const c of Object.keys(RELAPSE_THING)) list.push(relapseSignpost([c]));
  return list;
}

function relapseCats(assessment) {
  return [...new Set((assessment.signals || [])
    .filter(s => s.mode === 'relapse' && s.rule.startsWith('relapse:'))
    .map(s => s.rule.slice('relapse:'.length)))].sort();
}

/** The fixed `watch` line for these modes, or null when none is due. */
function signpostFor(assessment) {
  const modes = assessment.modes || [];
  let line = null;
  if (modes.includes('crisis')) line = SIGNPOST.crisis;
  else if (modes.includes('ed')) line = SIGNPOST.ed;
  else if (modes.includes('relapse')) line = relapseSignpost(relapseCats(assessment));
  else if (modes.includes('exercise')) line = SIGNPOST.exercise;
  if (modes.includes('minor')) line = line ? `${line} ${SIGNPOST.minorExtra}` : null;
  return line;
}

function safeName(name) {
  const n = String(name || '').trim();
  return /^[\p{L}][\p{L}'-]{0,19}$/u.test(n) && n !== 'You' ? n : '';
}
const lead = (name, rest) => (name ? `${name}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1));

const SAFE_WEEKLY = 'This week counts for more than any single number. Think of one moment you handled well, however small, and one thing that would make next week a little easier. Keep it small and kind — that is enough.';

/**
 * The fixed brief for these modes. Used for crisis (always), as the
 * client's local brief in any safe mode, and whenever a model brief
 * fails the policy. `modes` empty → a neutral brief (normal-mode
 * fallback when the model broke the rules).
 */
function safeBrief(assessment, opts = {}) {
  const modes = (assessment && assessment.modes) || [];
  const name = safeName(opts.name);
  const sunday = !!opts.isSunday;
  let focus, watch, micro;
  if (modes.includes('crisis')) {
    focus = lead(name, "today isn't about goals. Go gently, and do one small, kind thing for yourself.");
    micro = `Save Samaritans' number, ${HELPLINES.samaritans}, in your phone, or message someone you trust.`;
  } else if (modes.includes('ed')) {
    focus = lead(name, "today's focus is something away from numbers. Pick one thing on your board you enjoy.");
    micro = 'Message someone you trust, or spend five minutes on something calming you like.';
  } else if (modes.includes('relapse')) {
    focus = lead(name, "one hard day doesn't undo what you've learned. Today is just today, so be kind to yourself.");
    micro = 'Write one line about what was going on just before it happened. No judgement, it helps to know.';
  } else if (modes.includes('exercise')) {
    focus = lead(name, 'rest is part of getting fitter. Today, let yourself recover.');
    micro = 'Pick one proper rest day this week and put it in your calendar.';
  } else if (modes.includes('minor')) {
    focus = lead(name, "pick one small thing on your board that you'd enjoy moving forward today.");
    micro = 'Tell a friend or someone at home about one good thing from today.';
  } else {
    focus = lead(name, 'pick one thing on your board and move it forward a little today.');
    micro = 'Open Track and log one thing you did today.';
  }
  watch = signpostFor({ ...assessment, modes })
    || (modes.includes('minor')
      ? "Busy weeks can feel like a lot. It's fine to go at your own pace."
      : 'Busy days crowd out small habits. Notice which one slips first, without judging it.');
  const brief = {
    focus, watch, micro,
    weekly_review: sunday ? SAFE_WEEKLY : '',
    verbs: [],
  };
  if (modes.length) brief.safe_mode = true;
  return brief;
}

// ── Gentle-mode instruction for the model ─────────────────────────────────
// Deliberately one generic block for every safe mode: it does not tell
// the model (or its provider) WHY the coach is in gentle mode.

const GENTLE_MODE_INSTRUCTIONS = `

GENTLE MODE — the app has switched this user's coach to gentle mode. These rules override the tone, variety and specificity rules above:
- Do not mention food, eating, calories, weight, body shape or size, or amounts of exercise. Do not use numbers as targets.
- Do not mention streaks, chains, day counts, resets or starting over, and never suggest the user has failed or slipped.
- Do not set or suggest goals, targets or challenges, and do not suggest new habits.
- Keep every line short, warm and low-pressure: rest, connection with people, small kind actions, or goals in the snapshot that have nothing to do with the body (saving, reading, trips, projects).
- Do not name or hint at any health or mental-health condition, and do not guess why the app is in gentle mode.
- "watch" is one gentle sentence; the app adds support details itself.
- "verbs": at most one, and only {"action":"navigate"} to hub, achievements, holiday or settings.`;

// ── Output policy ─────────────────────────────────────────────────────────

const ALWAYS_RULES = [
  { id: 'calorie-prescription', re: /\b(?:eat|aim\s+for|target|stick\s+to|limit|cap|keep\s+(?:it\s+)?(?:under|below|to)|cut\s+(?:down\s+)?to|reduce\s+to|no\s+more\s+than|stay\s+(?:under|below))\b[^.!?]{0,30}?\d[\d,.]*\s*(?:k?cals?|calories|kcal)\b/ },
  { id: 'deficit-number', re: /\b\d[\d,]*\s*(?:k?cal|calorie)s?\s+deficit\b/ },
  { id: 'loss-rate', re: /\b(?:lose|drop|shed|cut)\s+\d+(?:\.\d+)?\s*(?:kg|kilos?|lbs?|pounds|stone)\s+(?:a|per|each|every|in\s+a)\s+(?:day|week)\b/ },
  { id: 'dose', re: /\b(?:take|have|try|add)\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|grams?|ml|iu|tablets?|pills?|capsules?)\b/ },
  { id: 'medication-change', re: /\b(?:stop|start|increase|reduce|change|skip|double)\s+(?:taking\s+)?(?:your\s+)?(?:medication|meds|tablets|dose|antidepressants?|insulin|prescription)\b/ },
  { id: 'diagnosis', re: /\b(?:you\s+(?:may|might|could|probably|clearly)\s+(?:have|be\s+suffering\s+from)|sounds\s+like|signs?\s+of|symptoms?\s+of)\s+(?:an?\s+)?(?:eating\s+disorder|anorexi\w*|bulimi\w*|depress\w*|anxiety\s+disorder|adhd|ocd|bipolar|alcoholi\w*|addict\w*|insomnia|diabet\w*|sleep\s+apno?ea)\b/ },
  { id: 'label', re: /\b(?:alcoholic|junkie|addict)\b/ },
  { id: 'shame', re: /\b(?:pathetic|lazy|disgusting|disgrace(?:ful)?|shameful|should\s+be\s+ashamed|no\s+excuses?|no\s+willpower|weak[\s-]willed|undisciplined|let\s+yourself\s+(?:down|go)|blew\s+it|threw\s+it\s+(?:all\s+)?away|ruined\s+(?:it|everything|your)|you\s+failed|cheat\s+(?:day|meal)|greedy)\b/ },
  { id: 'restriction-encouragement', re: /\b(?:skip|cut\s+out)\s+(?:a\s+)?(?:meals?|breakfast|lunch|dinner|eating)\b|\b(?:try|start|extend|do)\s+(?:a\s+)?(?:longer\s+)?(?:water\s+)?fast(?:ing)?\b|\bburn\s+(?:it\s+)?off\b|\bearn\s+(?:your\s+)?(?:food|meals?|dinner)\b/ },
  { id: 'overtraining', re: /\b(?:push|train|work|run)\s+through\s+(?:the\s+)?(?:pain|injury|illness)\b|\bno\s+rest\s+days?\b|\bno\s+days?\s+off\b/ },
];

const GENTLE_RULES = [
  { id: 'body-talk', re: /\b(?:calor\w*|kcal|cals?|weigh\w*|kg|kgs|kilos?|lbs|bmi|body\s*fat|diet\w*|slim\w*|skinny|thinner|deficit|fasting|macros?|portion\w*|weight\s+loss|lose\s+weight|burn\s+off|beach\s+body|bikini\s+body|six[\s-]?pack)\b/ },
  { id: 'streak-pressure', re: /\b(?:streaks?|chain|unbroken|don'?t\s+break|back\s+to\s+(?:zero|day\s+(?:one|1)|square\s+one)|start(?:ing)?\s+(?:over|from\s+(?:zero|scratch))|reset|days?\s+clean|clean\s+for\s+\d+|lost\s+(?:all\s+)?(?:your\s+)?progress|wasted|relapse\w*)\b/ },
  { id: 'exercise-push', re: /\b(?:more|extra|another|double|increase|add)\s+(?:a\s+)?(?:sessions?|workouts?|miles|km|reps|sets|training|runs?|cardio|steps)\b|\bpush\s+(?:harder|further|yourself)\b|\b(?:go|train|run)\s+harder\b/ },
  { id: 'condition-name', re: /\b(?:eating\s+disorder|anorexi\w*|bulimi\w*|depress\w*|suicid\w*|self[\s-]?harm\w*|addiction|alcoholi\w*)\b/ },
];

const VERB_ACTIONS = ['split-achievement', 'add-habit', 'open-modal', 'navigate'];
const GENTLE_SECTIONS = ['hub', 'achievements', 'holiday', 'settings'];

/** Signposts the FINAL brief must contain for these modes (any-of groups). */
function requiredSignposts(modes) {
  const req = [];
  if (modes.includes('crisis')) req.push([HELPLINES.samaritans], [HELPLINES.emergency]);
  else if (modes.includes('ed')) req.push([HELPLINES.beat]);
  else if (modes.includes('relapse') || modes.includes('exercise')) req.push(['GP', HELPLINES.nhs111]);
  if (modes.includes('minor') && (modes.includes('crisis') || modes.includes('ed') || modes.includes('relapse') || modes.includes('exercise'))) {
    req.push([HELPLINES.childline]);
  }
  return req;
}

/**
 * Check a brief against the output policy for these modes.
 *   opts.requireSignpost  default true — the final brief must carry the
 *                         helplines the modes call for.
 * Returns { ok, violations: [ruleId, ...] }.
 */
function checkBriefPolicy(brief, modes = [], opts = {}) {
  const violations = [];
  const b = brief && typeof brief === 'object' ? brief : {};
  const verbs = Array.isArray(b.verbs) ? b.verbs : [];
  const gentle = modes.length > 0;
  const parts = [b.focus, b.watch, b.micro, b.weekly_review]
    .concat(verbs.map(v => v && v.label), verbs.map(v => v && v.args && v.args.name))
    .filter(x => typeof x === 'string');
  const full = norm(parts.join('\n'));
  let text = full;
  for (const s of allSignposts()) text = text.split(norm(s)).join(' ');

  for (const r of ALWAYS_RULES) if (r.re.test(text)) violations.push(r.id);
  if (gentle) for (const r of GENTLE_RULES) if (r.re.test(text)) violations.push(r.id);

  verbs.forEach(v => {
    const action = v && v.action;
    if (!VERB_ACTIONS.includes(action)) { violations.push('verb-unknown'); return; }
    if (gentle && (action !== 'navigate' || !GENTLE_SECTIONS.includes(v.args && v.args.section))) violations.push('verb-gentle');
    if (action === 'add-habit') {
      const n = norm(v.args && v.args.name);
      const risky = TEXT_RULES.some(r => (r.mode === 'ed' || r.mode === 'crisis') && (r.re ? r.re.test(n) : r.test(n)));
      if (risky || /\b(?:fast\w*|skip\w*\s+meals?|calor\w*|kcal|weigh\w*)\b/.test(n)) violations.push('verb-risky-habit');
    }
  });

  if (opts.requireSignpost !== false) {
    for (const group of requiredSignposts(modes)) {
      if (!group.some(g => full.includes(norm(g)))) violations.push(`missing-signpost:${group[0]}`);
    }
  }
  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

// ── Client only ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayKey = t => new Date(t).toISOString().slice(0, 10);

/** Newest-first values of `pick(row)` over the last `n` days of a day-keyed log. */
function recentValues(log, n, pick, now = Date.now()) {
  const out = [];
  if (!log || typeof log !== 'object') return out;
  for (let i = 0; i < n; i++) {
    const row = log[dayKey(now - i * DAY_MS)];
    const v = row && typeof row === 'object' ? Number(pick(row)) : NaN;
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

/**
 * Assess the whole state: the snapshot plus what only the device holds.
 * `snap` is buildSnapshot(S) (passed in to avoid a circular import).
 * Same return shape as assessSnapshot.
 */
function assessState(S, snap, now = Date.now()) {
  const st = S && typeof S === 'object' ? S : {};
  const texts = [];
  const signals = [];
  if (st.profile && typeof st.profile.tagline === 'string') {
    texts.push({ where: 'profile.tagline', text: st.profile.tagline, kind: 'note' });
  }
  // Trackers the snapshot leaves out (band-fed) still have names.
  const sent = new Set((snap && Array.isArray(snap.trackers) ? snap.trackers : []).map(t => t && t.id));
  (Array.isArray(st.trackers) ? st.trackers : []).forEach((t, i) => {
    if (t && !sent.has(t.id)) texts.push({ where: `state.trackers.${i}`, text: t.name, kind: 'tracker' });
  });
  (Array.isArray(st.holidays) ? st.holidays : []).forEach((h, i) => {
    if (h && typeof h.name === 'string') texts.push({ where: `state.holidays.${i}`, text: h.name, kind: 'holiday' });
  });

  // Food diary totals: 3+ of the last 7 days logged under 800 kcal.
  const cals = [];
  for (let i = 0; i < 7; i++) {
    const row = (st.macroHistory || {})[dayKey(now - i * DAY_MS)];
    const v = row && typeof row === 'object' ? Number(row.cal) : NaN;
    cals.push(Number.isFinite(v) ? v : 0);
  }
  if (veryLowIntake(cals)) signals.push({ mode: 'ed', rule: 'very-low-intake', where: 'macroHistory' });

  // Weight readings: 4%+ down across the last 14 days.
  const weights = recentValues(st.vitalsLog, 14, row => row.weight, now);
  if (rapidWeightDrop(weights)) signals.push({ mode: 'ed', rule: 'rapid-weight-drop', where: 'vitalsLog' });

  return assessSnapshot(snap || {}, { texts, signals });
}

export {
  assessState,
  MODES,
  HELPLINES,
  TEXT_RULES,
  RELAPSE_CATS,
  GENTLE_MODE_INSTRUCTIONS,
  norm,
  classifyTracker,
  relapseCategory,
  veryLowIntake,
  rapidWeightDrop,
  assessSnapshot,
  sanitizeForModel,
  stripHints,
  signpostFor,
  safeBrief,
  checkBriefPolicy,
  requiredSignposts,
  allSignposts,
};

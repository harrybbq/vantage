/**
 * Event memory — "you've typed this before".
 *
 * When someone starts typing an event name, the calendar should
 * recognise it ("gy…" → "Gym session") and offer to finish the name,
 * the location and the time from how that event usually goes.
 *
 * ── Privacy ──────────────────────────────────────────────────────────
 * Everything here is computed on the device from the user's own
 * `S.calendarEvents`. Nothing is sent anywhere and NOTHING IS STORED:
 * the index is rebuilt in memory when the event form opens and thrown
 * away when it closes. That is deliberate — a learned index written back
 * into the synced state would be a second copy of the calendar in a
 * blob that is already too big (startup checklist items 25–26), and one
 * that could drift from the events it was learned from.
 *
 * ── How an index entry is built ──────────────────────────────────────
 * Events are grouped by NORMALISED title — lower-cased, accents folded,
 * punctuation turned into spaces, whitespace collapsed — so "Gym
 * session", "gym  session" and "GYM SESSION!" are one thing. Genuine
 * typos ("Gym sesion") stay separate groups; they are rare, so they rank
 * below the real one by frequency and fall out of the list on their own.
 *
 * Every occurrence is weighted by recency: weight = 0.5^(age / 90 days),
 * with events on or after `now` counting as weight 1. So a routine that
 * changed in spring (gym moved from 18:00 to 07:00) is remembered the
 * new way after a few weeks, without forgetting the event exists.
 *
 * Per group:
 *   title       the spelling used most recently (latest createdAt,
 *               falling back to the date) — a corrected spelling wins
 *   count       raw occurrences;  weight  sum of recency weights
 *   lastUsed    latest date it appears on (ISO)
 *   location    weighted most-common non-empty location (+ count)
 *   start/end   weighted most-common (start, end) PAIR, untimed counted
 *               as its own pair — a birthday that is always all-day
 *               remembers "no time" rather than a stray 19:00 (+ count,
 *               + duration in minutes when both ends are known)
 *   weekday     weighted most-common weekday (0 = Sun) and its share;
 *               only claimed as "usually Mon" when share ≥ 0.5 and the
 *               event has happened at least twice
 *   byWeekday   per-weekday time pairs for weekdays that are a pattern
 *               of their own (≥2 uses, ≥25% of the weight): gym at 07:00
 *               on Mondays and 18:00 on Thursdays. `suggest` uses the
 *               one for the date being added.
 *   colour/kind weighted most-common, when present
 *
 * ── Cost ─────────────────────────────────────────────────────────────
 * Learning reads at most MAX_EVENTS (5,000) events, newest dates first.
 * Anything older than that has a recency weight of practically zero
 * anyway on any real calendar. Measured in eventMemory.test.mjs: a
 * 20,000-event calendar learns in a few milliseconds, and `suggest` on
 * the resulting index runs well under a millisecond per keystroke.
 *
 * Pure — no React, no DOM, no network.
 */

const DAY_MS = 86400000;
export const HALF_LIFE_DAYS = 90;
export const MAX_EVENTS = 5000;
/** Below this many characters (after normalising) nothing is suggested. */
export const MIN_QUERY = 2;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isTime = v => typeof v === 'string' && TIME_RE.test(v);

/** Case/accent/punctuation/whitespace-insensitive key for a title. */
export function normalise(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')              // "Nonna's" → "nonnas", not "nonna s"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Local-midnight epoch ms for an ISO date (no UTC drift). */
function isoMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Weighted tally: key → { w, n, value }. */
function tally(map, key, w, value) {
  const cur = map.get(key);
  if (cur) { cur.w += w; cur.n += 1; }
  else map.set(key, { w, n: 1, value: value === undefined ? key : value });
}
function top(map) {
  let best = null;
  for (const v of map.values()) if (!best || v.w > best.w) best = v;
  return best;
}

/**
 * Learn an index from `S.calendarEvents` ({ iso: [event] }).
 * @param {object} calendarEvents
 * @param {{ now?: number|Date, excludeId?: string }} opts
 */
export function learnEvents(calendarEvents, { now = Date.now(), excludeId } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const all = calendarEvents && typeof calendarEvents === 'object' ? calendarEvents : {};
  const dates = Object.keys(all).filter(k => ISO_RE.test(k) && Array.isArray(all[k]));
  dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));   // newest first

  const groups = new Map();
  const places = new Map();
  let seen = 0;
  let truncated = false;

  outer:
  for (const iso of dates) {
    const dayMs = isoMs(iso);
    const ageDays = Math.max(0, (nowMs - dayMs) / DAY_MS);
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const wd = weekdayOf(iso);
    for (const ev of all[iso]) {
      if (seen >= MAX_EVENTS) { truncated = true; break outer; }
      if (!ev || typeof ev !== 'object') continue;
      if (typeof ev.id === 'string' && (ev.id.startsWith('hol:') || ev.id === excludeId)) continue;
      const raw = typeof ev.title === 'string' ? ev.title.trim() : '';
      const key = normalise(raw);
      if (!key) continue;
      seen++;

      let g = groups.get(key);
      if (!g) {
        g = { key, words: key.split(' '), spellings: null, best: -1, title: raw, count: 0, weight: 0,
          lastUsed: iso, locs: new Map(), times: new Map(), days: new Map(), dayTimes: new Map(),
          colours: new Map(), kinds: new Map() };
        groups.set(key, g);
      }
      g.count++;
      g.weight += w;
      if (iso > g.lastUsed) g.lastUsed = iso;
      // Most recent spelling: createdAt when the event has one, else the
      // day it sits on. A later correction of "Dentsit" to "Dentist" wins.
      const stamp = Number(ev.createdAt) || dayMs;
      if (stamp > g.best) { g.best = stamp; g.title = raw; }

      const loc = typeof ev.location === 'string' ? ev.location.trim() : '';
      if (loc) {
        const lk = normalise(loc);
        if (lk) {
          tally(g.locs, lk, w, loc);
          let p = places.get(lk);
          if (!p) { p = { key: lk, words: lk.split(' '), location: loc, best: -1, count: 0, weight: 0 }; places.set(lk, p); }
          p.count++; p.weight += w;
          if (stamp > p.best) { p.best = stamp; p.location = loc; }
        }
      }
      const start = isTime(ev.time) ? ev.time : '';
      const end = start && isTime(ev.end) && ev.end > start ? ev.end : '';
      tally(g.times, `${start}|${end}`, w, { start, end });
      tally(g.days, wd, w);
      let dt = g.dayTimes.get(wd);
      if (!dt) { dt = new Map(); g.dayTimes.set(wd, dt); }
      tally(dt, `${start}|${end}`, w, { start, end });
      if (typeof ev.colour === 'string' && ev.colour) tally(g.colours, ev.colour, w);
      if (typeof ev.kind === 'string' && ev.kind) tally(g.kinds, ev.kind, w);
    }
  }

  const entries = [];
  for (const g of groups.values()) {
    const loc = top(g.locs);
    // Locations ranked, kept so a location field can favour the places
    // THIS event usually happens at.
    const locList = [...g.locs.values()].sort((a, b) => b.w - a.w).slice(0, 3).map(v => normalise(v.value));
    const tm = top(g.times);
    const day = top(g.days);
    const daysTotal = [...g.days.values()].reduce((s, v) => s + v.w, 0) || 1;
    const col = top(g.colours);
    const kind = top(g.kinds);
    const start = tm ? tm.value.start : '';
    const end = tm ? tm.value.end : '';
    // Per-weekday habits: "gym" can be 07:00 on Mondays and 18:00 on
    // Thursdays. Kept only for weekdays seen at least twice that carry at
    // least a quarter of the event's weight — enough to be a pattern.
    const byWeekday = {};
    for (const [d, m] of g.dayTimes) {
      const dw = g.days.get(d);
      if (!dw || dw.n < 2 || dw.w / daysTotal < 0.25) continue;
      const b = top(m);
      byWeekday[d] = { start: b.value.start, end: b.value.end, count: dw.n, share: dw.w / daysTotal };
    }
    entries.push({
      key: g.key,
      words: g.words,
      title: g.title,
      count: g.count,
      weight: g.weight,
      lastUsed: g.lastUsed,
      location: loc ? loc.value : '',
      locationCount: loc ? loc.n : 0,
      locations: locList,
      start, end,
      timeCount: tm ? tm.n : 0,
      duration: start && end ? toMin(end) - toMin(start) : null,
      weekday: day ? day.value : null,
      weekdayShare: day ? day.w / daysTotal : 0,
      byWeekday,
      colour: col ? col.value : '',
      kind: kind ? kind.value : '',
    });
  }
  entries.sort((a, b) => b.weight - a.weight);

  const locations = [...places.values()]
    .map(p => ({ key: p.key, words: p.words, location: p.location, count: p.count, weight: p.weight }))
    .sort((a, b) => b.weight - a.weight);

  return { entries, locations, size: seen, truncated };
}

/** "usually Mon", only when the habit is real. */
export function usualWeekday(entry) {
  if (!entry || entry.weekday == null || entry.count < 2 || entry.weekdayShare < 0.5) return null;
  return WEEKDAYS[entry.weekday];
}

/**
 * How well `q` (normalised) matches a key/words pair.
 *   2 — the whole title starts with it, or a word does ("gy" → "Gym session",
 *       "ses" → "Gym session")
 *   1 — it appears somewhere inside ("ym" → "Gym session")
 *   0 — no match
 * `start` is true when the match is at the very start of the title, which
 * is the only case an inline completion can be offered for.
 */
function matchOf(key, q) {
  if (key.startsWith(q)) return { tier: 2, start: true };
  if (key.includes(' ' + q)) return { tier: 2, start: false };
  if (key.includes(q)) return { tier: 1, start: false };
  return null;
}

/**
 * True when a and b differ by at most one edit — an insertion, deletion,
 * substitution, or swap of two neighbouring letters. Linear, no matrix.
 */
export function oneEditApart(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;                      // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** A group that is a one-letter slip of a much heavier one is a typo. */
const TYPO_MIN_LEN = 5;
const TYPO_RATIO = 2;
const isTypoOf = (s, kept) => s.key.length >= TYPO_MIN_LEN
  && kept.weight >= s.weight * TYPO_RATIO && oneEditApart(s.key, kept.key);

const START_BOOST = 1.5;     // whole-title prefix over mid-title word prefix
const WEEKDAY_BOOST = 1.3;   // usual weekday matches the date being added

/**
 * Ranked suggestions for a partly typed title.
 *
 * Rules, in order:
 *   1. Fewer than MIN_QUERY (2) characters after normalising → nothing.
 *      That includes an empty, focused field: the form opens with the
 *      name focused, and a list appearing before anyone has typed would
 *      cover the form on a phone and answer a question nobody asked.
 *   2. Word-prefix matches (tier 2) always rank above substring matches
 *      (tier 1).
 *   3. Within a tier: score = weight (frequency × recency) × 1.5 if the
 *      match is at the start of the title × 1.3 if the event has a habit
 *      on `date`'s weekday (its usual weekday, or a per-weekday pattern).
 *   4. Ties break on raw count, then on the most recent use.
 *   5. A one-letter slip of a suggestion already in the list that is at
 *      least twice as heavy ("Gym sesion" under "Gym session") is left
 *      out — it is the same event, and offering it would invite the typo
 *      again. Titles under 5 characters are exempt ("Gym" vs "Gem").
 *
 * When `date`'s weekday has its own pattern, the suggestion carries THAT
 * day's times (`onDay` is set): adding "Gym" on a Monday offers the
 * Monday 07:00, on a Thursday the Thursday 18:00.
 *
 * @returns {Array<entry & { score, tier, atStart, usual }>}
 */
export function suggest(index, typed, { limit = 4, date } = {}) {
  const q = normalise(typed);
  if (!index || q.length < MIN_QUERY) return [];
  const wd = typeof date === 'string' && ISO_RE.test(date) ? weekdayOf(date) : null;
  const out = [];
  for (const e of index.entries) {
    const m = matchOf(e.key, q);
    if (!m) continue;
    const usual = usualWeekday(e);
    const habit = wd != null ? e.byWeekday[wd] : null;
    let score = e.weight;
    if (m.start) score *= START_BOOST;
    if (wd != null && ((usual && e.weekday === wd) || habit)) score *= WEEKDAY_BOOST;
    const s = { ...e, score, tier: m.tier, atStart: m.start, usual, onDay: null };
    if (habit) {
      s.start = habit.start;
      s.end = habit.end;
      s.duration = habit.start && habit.end ? toMin(habit.end) - toMin(habit.start) : null;
      s.onDay = WEEKDAYS[wd];
    }
    out.push(s);
  }
  out.sort((a, b) => b.tier - a.tier || b.score - a.score || b.count - a.count
    || (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0));
  const max = Math.max(0, limit);
  const kept = [];
  for (const s of out) {
    if (kept.length >= max) break;
    if (kept.some(k => isTypoOf(s, k))) continue;
    kept.push(s);
  }
  return kept;
}

/**
 * The rest of the title to show greyed after the caret, or null.
 *
 * Only offered when the top suggestion is a CONFIDENT prefix match:
 *   - it matches from the start of the title,
 *   - what was typed is literally (case-insensitively) the start of its
 *     spelling — otherwise "gym-s" would complete into a string that
 *     does not begin with what is on screen,
 *   - something is actually left to add, and
 *   - it scores at least 1.5× the runner-up (or there is none), so two
 *     similar "Dinner at …" places do not get a coin-flip completion.
 */
export function completion(index, typed, { date } = {}) {
  const raw = String(typed || '');
  const list = suggest(index, raw, { limit: 2, date });
  const best = list[0];
  if (!best || !best.atStart) return null;
  if (list[1] && best.score < list[1].score * 1.5) return null;
  return restOf(best.title, raw);
}

function restOf(full, raw) {
  if (!raw || raw.length >= full.length) return null;
  if (full.slice(0, raw.length).toLowerCase() !== raw.toLowerCase()) return null;
  return full.slice(raw.length);
}

/**
 * Location suggestions — same rules as titles, from past locations.
 * Places the current title usually happens at (`title`) get a 3× boost,
 * so "Dentist" + "Ca" offers "Castle St Surgery" ahead of "Café Nero".
 */
export function suggestLocations(index, typed, { limit = 4, title } = {}) {
  const q = normalise(typed);
  if (!index || q.length < MIN_QUERY) return [];
  const tk = normalise(title);
  const entry = tk ? index.entries.find(e => e.key === tk) : null;
  const usual = new Set(entry ? entry.locations : []);
  const out = [];
  for (const p of index.locations) {
    const m = matchOf(p.key, q);
    if (!m) continue;
    let score = p.weight;
    if (m.start) score *= START_BOOST;
    if (usual.has(p.key)) score *= 3;
    out.push({ ...p, score, tier: m.tier, atStart: m.start });
  }
  out.sort((a, b) => b.tier - a.tier || b.score - a.score || b.count - a.count);
  return out.slice(0, Math.max(0, limit));
}

/** Inline completion for the location field — same confidence rule. */
export function locationCompletion(index, typed, { title } = {}) {
  const raw = String(typed || '');
  const list = suggestLocations(index, raw, { limit: 2, title });
  const best = list[0];
  if (!best || !best.atStart) return null;
  if (list[1] && best.score < list[1].score * 1.5) return null;
  return restOf(best.location, raw);
}

/** The muted second line of a suggestion row. */
export function describe(entry) {
  if (!entry) return '';
  const bits = [];
  if (entry.location) bits.push(entry.location);
  if (entry.start) bits.push(entry.end ? `${entry.start}–${entry.end}` : entry.start);
  else if (entry.timeCount) bits.push('all day');
  const usual = usualWeekday(entry);
  if (entry.onDay && entry.onDay !== usual) bits.push(WEEKDAYS_LONG[WEEKDAYS.indexOf(entry.onDay)]);
  else if (usual) bits.push(`usually ${usual}`);
  if (!bits.length) bits.push(entry.count === 1 ? 'Used once' : `Used ${entry.count} times`);
  return bits.join(' · ');
}

/**
 * What picking `entry` would change, given the form's current values and
 * the fields the user has typed into themselves (`touched`).
 *
 * The one rule: a field the user has touched is NEVER overwritten. The
 * title is the exception by design — picking a suggestion is choosing
 * that title.
 *
 * Times are filled as a pair where possible. If only one end was typed,
 * the other is derived from the remembered duration, so typing 09:00 and
 * then picking "Gym session" (usually 07:00–08:00) gives 09:00–10:00
 * rather than an end time before the start.
 *
 * @param entry   an index entry (or a suggestion)
 * @param current { title, start, end, location, colour }
 * @param touched Set or array of field names
 * @returns patch — only the fields that would actually change
 */
export function fillPlan(entry, current = {}, touched = []) {
  if (!entry) return {};
  const t = touched instanceof Set ? touched : new Set(touched);
  const patch = {};
  const set = (k, v) => { if (v !== undefined && v !== (current[k] ?? '')) patch[k] = v; };

  set('title', entry.title);
  if (!t.has('location') && entry.location) set('location', entry.location);

  const hasStart = t.has('start'), hasEnd = t.has('end');
  if (!hasStart && !hasEnd) {
    if (entry.start) { set('start', entry.start); set('end', entry.end || ''); }
  } else if (hasStart && !hasEnd && entry.duration && isTime(current.start)) {
    const m = toMin(current.start) + entry.duration;
    if (m < 24 * 60) set('end', fromMin(m));
  } else if (!hasStart && hasEnd && entry.duration && isTime(current.end)) {
    const m = toMin(current.end) - entry.duration;
    if (m >= 0) set('start', fromMin(m));
  }

  if (!t.has('colour') && entry.colour) set('colour', entry.colour);
  return patch;
}

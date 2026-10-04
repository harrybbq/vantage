/**
 * Multi-day events — holidays, festivals, a week away with work.
 *
 * ── Ranges, not copies ───────────────────────────────────────────────
 * A thing that covers five days is ONE thing, so it is stored once:
 *
 *   S.calendarSpans = [
 *     { id: 'sp_…', title: 'Lisbon', start: '2026-10-05', end: '2026-10-09',
 *       colour: '#3aa79b', location: '', note: '', kind: 'other', createdAt: 1759… },
 *   ]
 *
 * NOT five events in `S.calendarEvents`. The header of holidayEvents.js
 * has the long version of why copies are wrong — move the dates and the
 * old days stay marked, delete it and four orphans stay behind, rename
 * it and the calendar keeps the old name on the days you did not edit.
 * A short list of ranges (the same shape as S.rotation.holidayBlocks)
 * has none of those failure modes, and it costs a handful of bytes per
 * holiday instead of a handful per DAY of holiday — which matters in a
 * state blob that is already ~967 kB.
 *
 * The days a span covers are computed on read (`spanEventsOn`,
 * `spanEventsInMonth`) and merged into `eventsOn`/`eventsInMonth` in
 * events.js next to the trips, so every surface that reads through those
 * seams — the grid, the day menu, the hub's agenda — sees them without
 * knowing they exist.
 *
 * ── Editable, unlike trips ───────────────────────────────────────────
 * Trips are a VIEW of S.holidays and are read-only here. Spans are owned
 * by this store, so their per-day events carry `derived: false` and a
 * `spanId`; the calendar edits them through the span writers below,
 * never through the single-day writers in events.js (which refuse `sp:`
 * ids, the same way they refuse `hol:` ones — a per-day edit of a span
 * would have to fork it into copies, which is the thing this file
 * exists to avoid).
 *
 * ── Normalisation ────────────────────────────────────────────────────
 * Owned here (makeSpan / cleanSpanPatch), like makeEvent/cleanPatch own
 * it for events, so the form and anything that ever imports spans obey
 * the same rules:
 *   · start must be a real calendar date, or there is no span;
 *   · a missing or unreal end means a one-day span;
 *   · dates entered backwards are swapped — unlike a backwards END TIME
 *     (a typo, dropped by makeEvent), "9th to 5th" names a perfectly
 *     good range and swapping it invents nothing;
 *   · at most MAX_SPAN_DAYS days inclusive — the end is pulled in, so a
 *     typo'd year cannot draw a bar across the next decade.
 *
 * Pure — no React, no DOM, no network.
 */

export const MAX_SPAN_DAYS = 366;

/** Kinds a span may carry: the event kinds plus `holiday`. Display
 *  colour always comes from `colour`; kind is kept for a future filter. */
export const SPAN_KINDS = ['holiday', 'appointment', 'social', 'work', 'training', 'admin', 'other'];
export const DEFAULT_SPAN_KIND = 'other';

const DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Local midday — see holidayEvents.js for why not midnight. */
const at = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const isoOf = dt => {
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

/** A string that is an ISO date AND a real one — '2026-02-30' is not. */
export function isRealDate(v) {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  return isoOf(new Date(y, m - 1, d, 12)) === v;
}

/** Whole days from a to b (b later → positive). */
export const daysBetween = (a, b) => Math.round((at(b) - at(a)) / DAY);

export function addDays(iso, n) {
  const dt = at(iso);
  dt.setDate(dt.getDate() + n);
  return isoOf(dt);
}

/** Inclusive length of a range. */
export const spanLength = (start, end) => daysBetween(start, end) + 1;

/**
 * Put a start/end pair into shape, or null when there is no start.
 * Shared by makeSpan and updateSpan so a create and an edit cannot
 * disagree about what a valid range is.
 */
export function normaliseRange(start, end) {
  if (!isRealDate(start)) return null;
  let s = start;
  let e = isRealDate(end) ? end : start;
  if (e < s) [s, e] = [e, s];
  if (spanLength(s, e) > MAX_SPAN_DAYS) e = addDays(s, MAX_SPAN_DAYS - 1);
  return { start: s, end: e };
}

const text = (v, n) => String(v == null ? '' : v).slice(0, n);

/**
 * A new span object, or null when it cannot be one (no real start date).
 * Not persisted — the caller decides that.
 */
export function makeSpan({
  title, start, end, colour = '', location = '', note = '', kind = DEFAULT_SPAN_KIND,
} = {}) {
  const range = normaliseRange(start, end);
  if (!range) return null;
  return {
    id: 'sp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    title: text(title, 120).trim(),
    start: range.start,
    end: range.end,
    colour: HEX_RE.test(colour) ? colour : '',
    location: text(location, 120).trim(),
    note: text(note, 500),
    kind: SPAN_KINDS.includes(kind) ? kind : DEFAULT_SPAN_KIND,
    createdAt: Date.now(),
  };
}

/**
 * The same normalisation for an edit. Returns only the touched keys.
 * A date that is not a real date is DROPPED from the patch rather than
 * blanked — blanking a span's start would delete the span by accident.
 * The pair is re-checked after the merge, in updateSpan.
 */
export function cleanSpanPatch(patch = {}) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  if ('title' in patch) out.title = text(patch.title, 120).trim();
  if ('start' in patch && isRealDate(patch.start)) out.start = patch.start;
  if ('end' in patch && isRealDate(patch.end)) out.end = patch.end;
  if ('colour' in patch) out.colour = HEX_RE.test(patch.colour) ? patch.colour : '';
  if ('location' in patch) out.location = text(patch.location, 120).trim();
  if ('note' in patch) out.note = text(patch.note, 500);
  if ('kind' in patch) out.kind = SPAN_KINDS.includes(patch.kind) ? patch.kind : DEFAULT_SPAN_KIND;
  return out;
}

/**
 * The spans array, defensively: anything that is not an object with an
 * id and a usable range is skipped on READ (never deleted — a malformed
 * entry is left exactly where it is, it just draws nothing).
 */
export function spansOf(S) {
  const raw = S && Array.isArray(S.calendarSpans) ? S.calendarSpans : [];
  const out = [];
  for (const sp of raw) {
    if (!sp || typeof sp !== 'object' || !sp.id) continue;
    const range = normaliseRange(sp.start, sp.end);
    if (!range) continue;
    out.push(range.start === sp.start && range.end === sp.end ? sp : { ...sp, ...range });
  }
  return out;
}

/** Order spans the way they stack on a day: earliest start first, then
 *  the longer one (it frames the shorter), then oldest-created. */
export function compareSpans(a, b) {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const la = spanLength(a.start, a.end), lb = spanLength(b.start, b.end);
  if (la !== lb) return lb - la;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 5 Oct → Fri 9 Oct · 5 days" — the modal header and tooltips. */
export function rangeLabel(start, end) {
  const range = normaliseRange(start, end);
  if (!range) return '';
  // Fixed names rather than toLocaleDateString: engines disagree on the
  // comma ("Mon, 5 Oct") and on "Sep" vs "Sept", and this string is tested.
  const f = iso => { const d = at(iso); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
  const n = spanLength(range.start, range.end);
  if (n === 1) return `${f(range.start)} · 1 day`;
  return `${f(range.start)} → ${f(range.end)} · ${n} days`;
}

/**
 * One day of one span, in the calendar's event shape.
 *
 * `end` stays the END TIME field of the event shape (empty — spans are
 * all-day); the span's own dates travel as `spanStart`/`spanEnd` so
 * nothing that reads `ev.end` as a clock time is handed a date.
 */
function eventFor(sp, iso) {
  const of = spanLength(sp.start, sp.end);
  const n = daysBetween(sp.start, iso) + 1;
  return {
    id: `sp:${sp.id}:${iso}`,
    derived: false,
    source: 'span',
    spanId: sp.id,
    title: sp.title || 'Untitled',
    kind: sp.kind || DEFAULT_SPAN_KIND,
    colour: HEX_RE.test(sp.colour || '') ? sp.colour : '',
    time: '',
    end: '',
    location: sp.location || '',
    note: sp.note || '',
    spanStart: sp.start,
    spanEnd: sp.end,
    span: of === 1 ? 'All day' : `Day ${n} of ${of}`,
    dayIndex: n,
    dayCount: of,
    isStart: iso === sp.start,
    isEnd: iso === sp.end,
    createdAt: sp.createdAt || 0,
  };
}

/** Span events on one date, in stacking order. */
export function spanEventsOn(S, iso) {
  if (!isRealDate(iso)) return [];
  return spansOf(S)
    .filter(sp => sp.start <= iso && iso <= sp.end)
    .sort(compareSpans)
    .map(sp => eventFor(sp, iso));
}

/**
 * Span events across a month, as { iso: [event] }, each date's list in
 * stacking order. Walks only the part of each span inside the month —
 * a 30-day span crossing in from September contributes its October days
 * without the loop touching September.
 *
 * @param year full year, @param month 0-based
 */
export function spanEventsInMonth(S, year, month) {
  const p = n => String(n).padStart(2, '0');
  const first = `${year}-${p(month + 1)}-01`;
  const last = `${year}-${p(month + 1)}-${p(new Date(year, month + 1, 0).getDate())}`;
  const out = {};
  for (const sp of spansOf(S).sort(compareSpans)) {
    if (sp.end < first || sp.start > last) continue;
    const from = sp.start > first ? sp.start : first;
    const to = sp.end < last ? sp.end : last;
    for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
      (out[iso] = out[iso] || []).push(eventFor(sp, iso));
    }
  }
  return out;
}

/** Is an id one of the per-day ids above? The single-day writers in
 *  events.js refuse these. */
export const isSpanEventId = id => typeof id === 'string' && id.startsWith('sp:');

/*
 * Writers — STATE UPDATERS, like the ones in events.js: each takes the
 * previous state and returns the next, touches only `calendarSpans`, and
 * returns `prev` itself when there is nothing valid to do (so a bad call
 * cannot even cause a save). Removing the last span leaves `[]`; no
 * other key is ever deleted or rewritten.
 */

export function addSpan(prev, span) {
  if (!span || typeof span !== 'object' || !span.id || !String(span.title || '').trim()) return prev;
  const range = normaliseRange(span.start, span.end);
  if (!range) return prev;
  const list = prev && Array.isArray(prev.calendarSpans) ? prev.calendarSpans : [];
  if (list.some(s => s && s.id === span.id)) return prev;
  return { ...prev, calendarSpans: [...list, { ...span, ...range }] };
}

export function updateSpan(prev, id, patch) {
  const list = prev && Array.isArray(prev.calendarSpans) ? prev.calendarSpans : [];
  if (!id || !list.some(s => s && s.id === id)) return prev;
  const clean = cleanSpanPatch(patch);
  return {
    ...prev,
    calendarSpans: list.map(s => {
      if (!s || s.id !== id) return s;
      const merged = { ...s, ...clean, id: s.id, createdAt: s.createdAt };  // id and birth are not patchable
      // Re-check the PAIR after the merge: moving the start past the old
      // end is fine on its own key and backwards as a range.
      const range = normaliseRange(merged.start, merged.end);
      return range ? { ...merged, ...range } : s;
    }),
  };
}

export function removeSpan(prev, id) {
  const list = prev && Array.isArray(prev.calendarSpans) ? prev.calendarSpans : [];
  if (!id || !list.some(s => s && s.id === id)) return prev;
  return { ...prev, calendarSpans: list.filter(s => !s || s.id !== id) };
}

/** Look a span up by id (for the editor). */
export function findSpan(S, id) {
  return spansOf(S).find(s => s.id === id) || null;
}

/** Are these ISO dates one unbroken run? (multi-select → one span) */
export function isContiguous(dates) {
  if (!Array.isArray(dates) || dates.length < 2 || !dates.every(isRealDate)) return false;
  const sorted = [...new Set(dates)].sort();
  if (sorted.length !== dates.length) return false;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) !== 1) return false;
  }
  return true;
}

/* ── Bars on the month grid ───────────────────────────────────────────
 *
 * A multi-day thing draws as one bar across the cells it covers. The
 * grid is cells, so each cell draws its own SEGMENT; what makes them
 * read as one bar is that a span keeps the same vertical slot (lane) on
 * every day of a week row. Lanes are assigned per week row — earliest
 * start first, longest first on a tie — the lowest lane free across the
 * whole of the segment. Per week, not per month, so a span that starts
 * in week 1 does not push every bar under it down for four more weeks.
 */

/** Anything that draws as a bar: spans and trips. */
export const isBarEvent = ev => !!ev && (ev.source === 'span' || ev.source === 'holiday');

/** The thing a bar belongs to — one per span/trip, shared by its days. */
export const barKey = ev => (ev.source === 'span' ? 'sp:' + ev.spanId : 'hol:' + ev.tripId);

/**
 * Lane layout for a month grid.
 *
 * @param monthEvents { iso: [event] } — eventsInMonth's output
 * @param year, month — the grid's month (0-based)
 * @returns { [iso]: { lanes: [{ ev, key, isStart, isEnd, showTitle, run }|null…],
 *                     bars: number (bar events that day), week: n } }
 *   `isStart`/`isEnd` say whether this segment has the bar's rounded
 *   ends (the span's real first/last day); `showTitle` is true on the
 *   first day of the bar and the first cell of each week row it crosses
 *   (and on the 1st of the month for one crossing in); `run` is how many
 *   cells the bar continues for from here within the row, for the title.
 */
export function barLayout(monthEvents, year, month) {
  const p = n => String(n).padStart(2, '0');
  const dim = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;   // Monday-first
  const out = {};
  const weeks = [];
  for (let day = 1; day <= dim; day++) {
    const iso = `${year}-${p(month + 1)}-${p(day)}`;
    const slot = offset + day - 1;
    const w = Math.floor(slot / 7);
    (weeks[w] = weeks[w] || []).push({ iso, col: slot % 7, day });
    out[iso] = { lanes: [], bars: 0, week: w };
  }

  for (const days of weeks) {
    if (!days) continue;
    // Segments in this row: one per bar, its first/last column here.
    const segs = new Map();
    for (const { iso, col } of days) {
      for (const ev of (monthEvents && monthEvents[iso]) || []) {
        if (!isBarEvent(ev)) continue;
        out[iso].bars++;
        const k = barKey(ev);
        const seg = segs.get(k);
        if (seg) { seg.to = col; seg.evs.push({ iso, ev }); }
        else segs.set(k, { key: k, from: col, to: col, evs: [{ iso, ev }], first: ev });
      }
    }
    const ordered = [...segs.values()].sort((a, b) => {
      // Start date of the BAR (not of this row), then longest, then key.
      const sa = a.first.spanStart || startOf(a.first), sb = b.first.spanStart || startOf(b.first);
      if (sa !== sb) return sa < sb ? -1 : 1;
      if (a.first.dayCount !== b.first.dayCount) return (b.first.dayCount || 0) - (a.first.dayCount || 0);
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    const taken = [];   // taken[lane] = Set of columns
    for (const seg of ordered) {
      let lane = 0;
      for (;;) {
        const t = taken[lane] || (taken[lane] = new Set());
        let free = true;
        for (let c = seg.from; c <= seg.to; c++) if (t.has(c)) { free = false; break; }
        if (free) { for (let c = seg.from; c <= seg.to; c++) t.add(c); break; }
        lane++;
      }
      seg.evs.forEach(({ iso, ev }, i) => {
        const dayNum = Number(iso.slice(8));
        const isStart = ev.dayIndex === 1;
        const isEnd = ev.dayIndex === ev.dayCount;
        out[iso].lanes[lane] = {
          ev, key: seg.key, isStart, isEnd,
          showTitle: i === 0 || isStart || dayNum === 1,
          run: seg.evs.length - i,
        };
      });
    }
    // Holes (a lane free on this day but used elsewhere in the row) stay
    // as explicit nulls so the cell can hold the slot open.
    for (const { iso } of days) {
      const l = out[iso].lanes;
      for (let i = 0; i < l.length; i++) if (!l[i]) l[i] = null;
    }
  }
  return out;
}

/** A trip's first day, recovered from its per-day event (trips carry
 *  dayIndex but not their start date). */
function startOf(ev) {
  const iso = typeof ev.id === 'string' ? ev.id.slice(-10) : '';
  return isRealDate(iso) && ev.dayIndex ? addDays(iso, -(ev.dayIndex - 1)) : '';
}

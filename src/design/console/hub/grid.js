/**
 * The console hub grid: one shared widget order for phone and desktop,
 * three fixed size families, and the packing that places them.
 *
 * ── Storage ─────────────────────────────────────────────────────────
 *   S.hubGrid = { v: 1, items: [{ id, type, size, ...own }] }
 *
 * A NEW additive key (src/design/console/README.md §0). The classic
 * layout keys — S.hubWidgets, S.mobileWidgets, S.widgetPositions,
 * S.widgetSizes — are read here to SEED the grid and are never written by
 * anything in the console hub, so switching back to classic finds every
 * old layout exactly where it was.
 *
 * `own` is whatever per-widget settings the source widget carried
 * (`picks`, `count`, `blocks`, `title`) so a Savings card keeps its pots
 * and a prime keeps its blocks. Console edits to those go to the hubGrid
 * item only.
 *
 * The seed is DERIVED while S.hubGrid is absent and persisted on the
 * first change the user makes (move, resize, add, remove, a widget
 * setting) — viewing the hub writes nothing.
 *
 * ── Sizes ───────────────────────────────────────────────────────────
 *   small  1×1   medium 2×1   large 2×2   on a 4-column desktop grid
 *   phone: 2 columns; small = half width, medium and large = full width
 *
 * Every type declares the sizes it allows, its default, and the largest
 * size a FREE account can choose. Anything above that is Pro while
 * PRO_SIZES_GATED is true — the one switch for the whole rule (CLAUDE.md
 * tier line: looks are free, *more* is paid; a bigger widget is more).
 *
 * Pure: no React, no DOM, no clock. Ids come from an injectable maker.
 */

/** The one switch for "larger widget sizes are Pro". */
export const PRO_SIZES_GATED = true;

export const SIZES = ['small', 'medium', 'large'];
const RANK = { small: 0, medium: 1, large: 2 };

export const SIZE_LABEL = { small: 'Small', medium: 'Medium', large: 'Large' };
export const SIZE_DIMS = { small: '1×1', medium: '2×1', large: '2×2' };

/** Cells each size takes: [w, h] on desktop (4 cols) and phone (2 cols). */
export function spanOf(size, cols = 4) {
  if (cols <= 2) return size === 'small' ? [1, 1] : [2, 1];
  if (size === 'small') return [1, 1];
  if (size === 'large') return [2, 2];
  return [2, 1];
}

const T = (sizes, def, free = def) => Object.freeze({ sizes: Object.freeze(sizes), def, free });

/**
 * type → { sizes, def, free }.
 *
 * `def ≤ free` for every type, so a seeded or newly added widget never
 * starts at a Pro size.
 */
export const WIDGET_SIZES = Object.freeze({
  // Console widgets (no classic counterpart in hubWidgets/mobileWidgets).
  today:      T(['medium', 'large'], 'large'),
  league:     T(['medium', 'large'], 'medium'),
  friends:    T(['medium', 'large'], 'medium'),
  upnext:     T(['small', 'medium'], 'medium'),
  coins:      T(['small', 'medium'], 'small'),
  // Classic widget types, rendered with their existing bodies.
  vitals:     T(['small', 'medium', 'large'], 'small'),
  body:       T(['small', 'medium'], 'small'),
  macros:     T(['medium', 'large'], 'medium'),
  calories:   T(['small', 'medium'], 'medium'),
  goals:      T(['medium', 'large'], 'medium'),
  'body-goal': T(['medium', 'large'], 'medium'),
  market:     T(['medium', 'large'], 'medium'),
  news:       T(['medium', 'large'], 'medium'),
  habits:     T(['medium', 'large'], 'medium'),
  holidays:   T(['small', 'medium'], 'medium'),
  'recent-wins': T(['small', 'medium'], 'small'),
  'coin-history': T(['small', 'medium'], 'small'),
  'savings-pots': T(['small', 'medium', 'large'], 'medium'),
  'savings-projection': T(['small', 'medium', 'large'], 'medium'),
  subscriptions: T(['small', 'medium', 'large'], 'medium'),
  github:     T(['small', 'medium'], 'small'),
  linkedin:   T(['small', 'medium'], 'small'),
  trading:    T(['medium', 'large'], 'medium'),
});

/** Every prime card (prime:savings, prime:habits …) and every app preset. */
const PRIME_SIZES = T(['small', 'medium', 'large'], 'medium');
const PRESET_SIZES = T(['small', 'medium'], 'small');

/**
 * Size rules for a type. `presetIds` lets the caller say which bare ids
 * are app presets (the list lives in data/appPresets.js, which this pure
 * module does not import). Unknown types get null — they are not placed.
 */
export function sizesFor(type, { presetIds = null } = {}) {
  if (typeof type !== 'string') return null;
  if (type.startsWith('prime:')) return PRIME_SIZES;
  if (Object.prototype.hasOwnProperty.call(WIDGET_SIZES, type)) return WIDGET_SIZES[type];
  if (presetIds && presetIds.has && presetIds.has(type)) return PRESET_SIZES;
  return null;
}

/** Is `size` above what a free account may choose for this type? */
export function isProSize(type, size, opts) {
  if (!PRO_SIZES_GATED) return false;
  const t = sizesFor(type, opts);
  if (!t || !RANK.hasOwnProperty(size)) return false;
  return RANK[size] > RANK[t.free];
}

/**
 * Can this account set `size` on `type`? → { ok, reason }
 * reason: 'unknown-type' | 'not-allowed' | 'pro'
 */
export function validateSize(type, size, { hasPro = false, ...opts } = {}) {
  const t = sizesFor(type, opts);
  if (!t) return { ok: false, reason: 'unknown-type' };
  if (!t.sizes.includes(size)) return { ok: false, reason: 'not-allowed' };
  if (!hasPro && isProSize(type, size, opts)) return { ok: false, reason: 'pro' };
  return { ok: true, reason: null };
}

/**
 * The size an item is DRAWN at. A stored size the type no longer allows
 * falls back to the default; a Pro size on an account that is not Pro
 * (a lapsed subscription) is drawn at the free size. The stored value is
 * left alone either way, so renewing restores it.
 */
export function effectiveSize(item, { hasPro = false, ...opts } = {}) {
  const t = sizesFor(item && item.type, opts);
  if (!t) return 'medium';
  let s = t.sizes.includes(item.size) ? item.size : t.def;
  if (!hasPro && isProSize(item.type, s, opts)) {
    s = t.sizes.filter(x => RANK[x] <= RANK[t.free]).pop() || t.def;
  }
  return s;
}

// ── Seeding ─────────────────────────────────────────────────────────

/** Types that are never seeded: retired, coming-soon stubs. */
const NEVER_SEED = new Set(['mood', 'notepad', 'rotation', 'mail']);
/** Classic types that ARE a console widget. */
const ALIASES = { leaderboard: 'league' };
/** Per-widget settings carried from the source widget. */
const OWN_KEYS = ['picks', 'count', 'blocks', 'title'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);

/** Two primes are the same card when type AND chosen blocks match. */
function dedupKey(w) {
  if (w.type.startsWith('prime:')) {
    const b = Array.isArray(w.blocks) ? w.blocks.map(x => (typeof x === 'string' ? x : x && x.id)).join(',') : '';
    return `${w.type}|${b}|${w.title || ''}`;
  }
  return w.type;
}

function carry(w) {
  const out = {};
  for (const k of OWN_KEYS) if (w[k] !== undefined) out[k] = w[k];
  return out;
}

/**
 * The first-use grid, derived from both classic lists.
 *
 *   1. Console widgets lead, in the mockup's hierarchy: Today, League,
 *      Friends, Up next. Today is skipped when a Trackers prime is
 *      already in either list (it would show the same ticks twice), and
 *      Up next when there is nothing upcoming to show (`hasUpcoming`).
 *   2. Then every desktop widget (S.hubWidgets) in its order, then every
 *      phone widget (S.mobileWidgets) not already placed — so a widget
 *      present in only one list still appears.
 *   3. De-duplicated by type; primes are instanceable, so two primes are
 *      only duplicates when their type, blocks and title all match.
 *      `leaderboard` is the League widget. Retired types, coming-soon
 *      stubs and types this grid does not know are skipped (not deleted:
 *      the classic lists are never touched).
 *
 * `opts.presetIds` (Set of app-preset ids), `opts.allow(type)` (owner-
 * only / build gates), `opts.hasUpcoming`, `opts.makeId` (unused for
 * seeded items, whose ids are derived — kept for symmetry).
 */
export function seedHubGrid(S, opts = {}) {
  const { presetIds = null, allow = () => true, hasUpcoming = true } = opts;
  const desk = list(S && S.hubWidgets).filter(isObj);
  const phone = list(S && S.mobileWidgets).filter(isObj);
  const items = [];
  const seen = new Set();
  const usedIds = new Set();
  const uid = base => {
    let id = String(base || 'w');
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };
  const push = (type, size, own, idBase) => {
    const key = dedupKey({ type, ...own });
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ id: uid(idBase), type, size, ...own });
  };

  const hasTrackersPrime = [...desk, ...phone].some(w => w.type === 'prime:trackers');
  if (!hasTrackersPrime) push('today', WIDGET_SIZES.today.def, {}, 'cx-today');
  push('league', WIDGET_SIZES.league.def, {}, 'cx-league');
  push('friends', WIDGET_SIZES.friends.def, {}, 'cx-friends');
  if (hasUpcoming) push('upnext', WIDGET_SIZES.upnext.def, {}, 'cx-upnext');

  for (const w of [...desk, ...phone]) {
    if (typeof w.type !== 'string' || NEVER_SEED.has(w.type)) continue;
    const type = ALIASES[w.type] || w.type;
    const t = sizesFor(type, { presetIds });
    if (!t || !allow(type)) continue;
    push(type, t.def, ALIASES[w.type] ? {} : carry(w), w.id);
  }
  return { v: 1, items };
}

/**
 * The grid to render: S.hubGrid when it is a valid v1 grid, else the
 * seed. `{ grid, seeded }` — `seeded` true means nothing is stored yet.
 */
export function readHubGrid(S, opts = {}) {
  const g = S && S.hubGrid;
  if (isObj(g) && g.v === 1 && Array.isArray(g.items)) {
    return { grid: { v: 1, items: g.items.filter(it => isObj(it) && typeof it.id === 'string' && typeof it.type === 'string') }, seeded: false };
  }
  return { grid: seedHubGrid(S, opts), seeded: true };
}

/**
 * Write a grid into state. Changes ONE key; everything else in `prev` is
 * passed through by reference. This is the only writer of hubGrid.
 */
export function withHubGrid(prev, grid) {
  return { ...prev, hubGrid: { v: 1, items: grid.items } };
}

// ── Order and size edits (all pure, all return a new grid) ───────────

/** Move the item at `from` so it ends up at index `to`. */
export function moveItem(grid, from, to) {
  const items = grid.items.slice();
  if (from < 0 || from >= items.length) return grid;
  const t = Math.max(0, Math.min(items.length - 1, to));
  if (t === from) return grid;
  const [it] = items.splice(from, 1);
  items.splice(t, 0, it);
  return { ...grid, items };
}

/** Move by id, `delta` places (keyboard: −1 earlier, +1 later). */
export function nudgeItem(grid, id, delta) {
  const i = grid.items.findIndex(it => it.id === id);
  if (i < 0) return grid;
  return moveItem(grid, i, i + delta);
}

/** Set an item's size, if the account may. Returns the same grid otherwise. */
export function setItemSize(grid, id, size, opts = {}) {
  const it = grid.items.find(x => x.id === id);
  if (!it || !validateSize(it.type, size, opts).ok || it.size === size) return grid;
  return { ...grid, items: grid.items.map(x => (x.id === id ? { ...x, size } : x)) };
}

/** Patch one item's own settings (picks, blocks …). Never touches id/type. */
export function patchItem(grid, id, fn) {
  let hit = false;
  const items = grid.items.map(x => {
    if (x.id !== id) return x;
    hit = true;
    const next = fn(x);
    return { ...next, id: x.id, type: x.type };
  });
  return hit ? { ...grid, items } : grid;
}

export function removeItem(grid, id) {
  const items = grid.items.filter(x => x.id !== id);
  return items.length === grid.items.length ? grid : { ...grid, items };
}

/** Append a new item at its default size. `spec` = type string or { type, blocks, … }. */
export function addItem(grid, spec, { makeId, presetIds = null } = {}) {
  const w = typeof spec === 'string' ? { type: spec } : (spec || {});
  const t = sizesFor(w.type, { presetIds });
  if (!t || typeof makeId !== 'function') return grid;
  const taken = new Set(grid.items.map(x => x.id));
  let id = makeId();
  while (taken.has(id)) id = makeId();
  return { ...grid, items: [...grid.items, { id, type: w.type, size: t.def, ...carry(w) }] };
}

// ── Packing ─────────────────────────────────────────────────────────

/**
 * Place items, in order, on a `cols`-wide grid of cells. First fit: each
 * item takes the earliest row-major spot its span fits (2-wide items on
 * a half: column 1 or 3), so a small
 * widget can fill a hole left before a large one and the grid never
 * shows a gap it could have filled. The browser is given these exact
 * cells (grid-column / grid-row), never `grid-auto-flow: dense`, so what
 * the drag preview computes is what renders.
 *
 * `sizeOf(item)` → 'small' | 'medium' | 'large'.
 * Returns [{ id, col, row, w, h }] (1-based col/row) and `rows`.
 */
export function packGrid(items, cols = 4, sizeOf = it => it.size) {
  const occ = []; // occ[row][col] = true
  const free = (r, c, w, h) => {
    if (c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (occ[y] && occ[y][x]) return false;
    return true;
  };
  const take = (r, c, w, h) => {
    for (let y = r; y < r + h; y++) { occ[y] = occ[y] || []; for (let x = c; x < c + w; x++) occ[y][x] = true; }
  };
  const out = [];
  for (const it of items) {
    let [w, h] = spanOf(sizeOf(it), cols);
    w = Math.min(w, cols);
    let placed = false;
    for (let r = 0; !placed; r++) {
      // Wide items start on their own width (a 2-wide card sits on the
      // left or right half, never straddling the middle line).
      for (let c = 0; c + w <= cols; c += (cols % w === 0 ? w : 1)) {
        if (free(r, c, w, h)) { take(r, c, w, h); out.push({ id: it.id, col: c + 1, row: r + 1, w, h }); placed = true; break; }
      }
    }
  }
  const rows = out.reduce((m, p) => Math.max(m, p.row + p.h - 1), 0);
  return { cells: out, rows };
}

/**
 * Where should the dragged item go? Tries every insertion index, packs
 * each candidate order, and returns the index whose placement of the
 * dragged item lands nearest `target` (a point in CELL units: x in
 * columns, y in rows, measured from the grid's top-left).
 *
 * Choosing by the packed RESULT rather than by list position is what
 * makes the drop feel right on a packed grid, where list order and
 * screen order are not the same thing.
 */
export function dropIndex(items, fromIdx, target, cols = 4, sizeOf = it => it.size) {
  if (fromIdx < 0 || fromIdx >= items.length) return fromIdx;
  const moving = items[fromIdx];
  const rest = items.filter((_, i) => i !== fromIdx);
  const dist = to => {
    const order = rest.slice(0, to).concat([moving], rest.slice(to));
    const p = packGrid(order, cols, sizeOf).cells.find(c => c.id === moving.id);
    const cx = p.col - 1 + p.w / 2, cy = p.row - 1 + p.h / 2;
    return (cx - target.x) ** 2 + (cy - target.y) ** 2;
  };
  // Staying put wins every tie, so a pick-up-and-drop changes nothing.
  let best = fromIdx, bestD = dist(fromIdx);
  for (let to = 0; to <= rest.length; to++) {
    if (to === fromIdx) continue;
    const d = dist(to);
    if (d < bestD - 1e-9) { bestD = d; best = to; }
  }
  return best;
}

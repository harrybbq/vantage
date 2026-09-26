/**
 * The prime widget registry: which sections have a card, and which
 * blocks each card can show.
 *
 * ── Why one card per section ─────────────────────────────────────────
 * There were nineteen widget types and they were one-per-datum: to see
 * your money you added Savings pots, Savings projection AND Subscriptions
 * as three separate cards. The picker was a wall, the hub filled with
 * near-duplicates, and adding a facet meant adding a whole card.
 *
 * A prime is one card per section whose CONTENTS are chosen. It is still
 * instanceable — two Savings cards showing different blocks is a valid
 * hub, and that matters, because consolidation must not reduce what
 * anyone can build.
 *
 * ── What is in here, and what is not ─────────────────────────────────
 * This file is SHAPE only: how tall each block wants to be, how it
 * degrades, whether it grows. No user data, no React. That is what lets
 * pack.js stay a pure function and be tested without a browser.
 *
 * The numbers that produce the actual content live in primeData.js; the
 * components that draw it live in components/widgets/prime/.
 *
 * ── The contract every block signs ───────────────────────────────────
 *   L      px it wants at full detail
 *   M      px at compact
 *   (fact) always S_H — one line, fixed. Every block MUST have one:
 *          it is what guarantees a ticked block is never hidden.
 *   views  [fullView, compactView] — the renderer's view ids
 *   grow   share of spare height at full detail; 0 = fixed
 *   max    ceiling when growing (a list stops when it runs out of rows)
 *   row    row step, so a list snaps to whole rows rather than 1.4 of one
 */

/** kind is used by the packer for one decision only: a `hero` in first
 *  place on a wide card becomes a full-width header. */
const B = (name, kind, L, M, views, extra = {}) => ({
  name, kind, L, M, views, grow: 0, ...extra,
});

export const PRIMES = {
  savings: {
    name: 'Savings',
    icon: 'piggy-bank',
    glyph: '◒',
    col: '#1a7a4a',
    section: 'achievements',
    def: ['total', 'pots', 'projection'],
    presets: [
      ['Overview', ['total', 'pots', 'projection']],
      ['Pots first', ['pots', 'total', 'plan']],
      ['Runway', ['projection', 'month', 'bills']],
      ['Bills', ['bills', 'accounts', 'total']],
    ],
    blocks: {
      total:      B('Total saved', 'hero', 66, 42, ['heroL', 'heroM']),
      pots:       B('Pots', 'gauge', 118, 76, ['vesselsL', 'barsM'], { grow: 2, options: 'pots' }),
      projection: B('Projection', 'chart', 104, 50, ['chartL', 'sparkM'], { grow: 3 }),
      accounts:   B('Account balances', 'list', 70, 44, ['listL', 'tilesM'], { grow: 1, max: 70, row: 24 }),
      bills:      B('Bills & renewals', 'list', 94, 44, ['listL', 'statM'], { grow: 1, max: 142, row: 24 }),
      month:      B('Where the month goes', 'row', 76, 34, ['segL', 'segM']),
      plan:       B('Monthly plan', 'row', 76, 40, ['cardL', 'cardM']),
    },
  },

  trackers: {
    name: 'Trackers',
    icon: 'square-check-big',
    glyph: '☑',
    col: '#5b8cff',
    section: 'track',
    def: ['today', 'streaks', 'targets'],
    presets: [
      ['Today', ['today', 'streaks', 'targets']],
      ['Week', ['nodes', 'targets', 'today']],
      ['Streaks', ['streaks', 'nodes']],
    ],
    blocks: {
      today:   B("Today's checks", 'list', 118, 40, ['checksL', 'dotsM'], { grow: 1, max: 166, row: 24 }),
      streaks: B('Streaks', 'hero', 66, 42, ['heroL', 'heroM']),
      targets: B('Weekly targets', 'list', 102, 76, ['barsL', 'barsM'], { grow: 1, max: 136, row: 34 }),
      nodes:   B('Completion nodes', 'gauge', 88, 40, ['heatL', 'dotsM'], { grow: 1, max: 154, row: 22 }),
    },
  },

  achievements: {
    name: 'Achievements',
    icon: 'star',
    glyph: '★',
    col: '#c8970a',
    section: 'achievements',
    def: ['next', 'coins', 'recent'],
    presets: [
      ['Next up', ['next', 'coins', 'recent']],
      ['Coins', ['coins', 'recent', 'visions']],
      ['Visions', ['visions', 'next']],
    ],
    blocks: {
      next:    B('Next up', 'list', 102, 76, ['barsL', 'barsM'], { grow: 1, max: 136, row: 34 }),
      coins:   B('Coin ledger', 'hero', 66, 42, ['heroL', 'heroM']),
      recent:  B('Recent wins', 'list', 94, 44, ['listL', 'statM'], { grow: 1, max: 142, row: 24 }),
      visions: B('Visions', 'gauge', 118, 76, ['vesselsL', 'barsM'], { grow: 2 }),
    },
  },

  holidays: {
    name: 'Holidays',
    icon: 'plane',
    glyph: '✈',
    col: '#12a5a5',
    section: 'holiday',
    def: ['countdown', 'itinerary', 'budget'],
    presets: [
      ['Countdown', ['countdown', 'itinerary', 'budget']],
      ['Budget', ['budget', 'countdown', 'trips']],
      ['All trips', ['trips', 'countdown']],
      ['Passport', ['visited', 'countdown', 'trips']],
    ],
    blocks: {
      countdown: B('Countdown', 'hero', 66, 42, ['heroL', 'heroM']),
      itinerary: B('Itinerary', 'list', 94, 44, ['listL', 'statM'], { grow: 1, max: 142, row: 24 }),
      budget:    B('Budget vs saved', 'list', 102, 76, ['barsL', 'barsM'], { grow: 1, max: 136, row: 34 }),
      trips:     B('All trips', 'list', 94, 44, ['listL', 'statM'], { grow: 1, max: 118, row: 24 }),
      visited:   B('Countries visited', 'chart', 112, 42, ['mapL', 'heroM'], { grow: 2, max: 190 }),
    },
  },

  habits: {
    name: 'Habits',
    icon: 'flame',
    glyph: '◷',
    col: '#d0498f',
    section: 'habits',
    def: ['timers', 'next', 'strikes'],
    presets: [
      ['Timers', ['timers', 'next', 'strikes']],
      ['Milestone', ['next', 'timers', 'relapses']],
      ['Accountability', ['relapses', 'strikes', 'timers']],
    ],
    blocks: {
      timers:   B('Streak timers', 'list', 130, 76, ['barsL', 'barsM'], { grow: 1, max: 192, row: 48 }),
      next:     B('Next milestone', 'hero', 66, 42, ['heroL', 'heroM']),
      strikes:  B('Strikes left', 'list', 94, 44, ['listL', 'statM'], { grow: 1, max: 118, row: 24 }),
      relapses: B('Relapses', 'chart', 104, 50, ['chartL', 'sparkM'], { grow: 3 }),
    },
  },
  /* Nutrition reads two places: today's totals and goals come from the
     nutrition tables (the host passes them in as `ext`, fetched once and
     shared — see lib/diet/daySummary), and the day-by-day history from
     S.macroHistory, which the Track page already keeps. With no fetch
     (the picker preview, a signed-out session) the rings fall back to
     today's history entry, so they still draw. */
  nutrition: {
    name: 'Nutrition',
    icon: 'utensils',
    glyph: '◑',
    col: '#e07a2f',
    section: 'diet',
    def: ['rings', 'net', 'week'],
    presets: [
      ['Today', ['rings', 'net', 'burned']],
      ['Rings', ['rings']],
      ['Trend', ['week', 'rings']],
      ['Energy', ['net', 'burned', 'week']],
      ['Body', ['rings', 'weight', 'vitals']],
    ],
    blocks: {
      rings:  B('Macro rings', 'gauge', 96, 62, ['ringsL', 'ringsM'], { grow: 1, max: 176 }),
      net:    B('Net calories', 'hero', 66, 42, ['heroL', 'heroM']),
      burned: B('Calories burned', 'list', 84, 44, ['listL', 'statM'], { grow: 1, max: 120, row: 24 }),
      week:   B('Last 14 days', 'chart', 104, 50, ['chartL', 'sparkM'], { grow: 3 }),
      // Vitals sit here because they are what the food is FOR — weight
      // moves with intake, sleep and recovery with how you fuel.
      weight: B('Weight trend', 'chart', 104, 50, ['chartL', 'sparkM'], { grow: 3 }),
      vitals: B('Vitals', 'list', 94, 44, ['listL', 'tilesM'], { grow: 1, max: 142, row: 24 }),
    },
  },
};

export const PRIME_IDS = Object.keys(PRIMES);

/* Stored widget types are namespaced — `prime:savings`, `prime:habits`.
   Bare `habits` and `holidays` have been standalone widget types for a
   long time and are in people's saved hubs; a prime sharing the id
   would take those cards over the moment this shipped. */
const PREFIX = 'prime:';
export const primeType = key => PREFIX + key;
export const isPrime = type => typeof type === 'string'
  && type.startsWith(PREFIX)
  && Object.prototype.hasOwnProperty.call(PRIMES, type.slice(PREFIX.length));

/**
 * Widget types that a prime replaces, mapped to the blocks that say the
 * same thing.
 *
 * Read-time only. A card the user has never edited keeps `type:
 * 'savings-pots'` in state forever and is simply RENDERED as a Savings
 * prime showing the pots block — exactly the contract `picks` already
 * set ("a widget with no picks behaves as before"). Nothing is migrated,
 * nothing is rewritten, and a rollback leaves every hub intact.
 */
export const LEGACY = {
  'savings-pots':       { prime: 'savings', blocks: w => [{ id: 'pots', picks: w.picks, count: w.count }] },
  'savings-projection': { prime: 'savings', blocks: () => [{ id: 'projection' }] },
  'subscriptions':      { prime: 'savings', blocks: () => [{ id: 'bills' }] },
  /* Habits and Holidays are deliberately NOT here. Their standalone
     widgets carry things a block does not: tap-through to the page, and
     for Habits the two-tap relapse that exists precisely so a slip gets
     logged the moment it happens. Mapping them forward would take those
     away from every hub that already has one. They keep rendering as
     they always have; the prime versions are there for new cards. */
};

/**
 * Standalone widget types a prime now covers, and which prime.
 *
 * The Add Widget pickers HIDE these — they are not deleted, and a hub
 * that already has one keeps rendering it exactly as before. The ones
 * also in LEGACY are additionally drawn as their prime; the rest keep
 * their own body, because they carry things a block does not (the
 * Macros widget's tap-through, Calories Burned's activity entry, the
 * habit widget's live timers).
 */
export const SUPERSEDED = {
  'savings-pots': 'savings',
  'savings-projection': 'savings',
  'subscriptions': 'savings',
  'habits': 'habits',
  'holidays': 'holidays',
  'recent-wins': 'achievements',
  'coin-history': 'achievements',
  'macros': 'nutrition',
  'calories': 'nutrition',
  'vitals': 'nutrition',
};
export const isSuperseded = type => Object.prototype.hasOwnProperty.call(SUPERSEDED, type);

/** The prime a stored widget renders as, or null if it is not one. */
export function primeOf(widget) {
  if (!widget) return null;
  if (isPrime(widget.type)) return widget.type.slice(PREFIX.length);
  return LEGACY[widget.type] ? LEGACY[widget.type].prime : null;
}

/**
 * The block list a stored widget should render, normalised to ids.
 *
 * Accepts a bare string (`'total'`) or an object (`{ id, picks }`), drops
 * anything the prime does not define — a block removed in a later
 * release must not blank somebody's card — and falls back to the prime's
 * default rather than rendering nothing.
 */
export function blocksOf(widget) {
  const key = primeOf(widget);
  if (!key) return [];
  const P = PRIMES[key];
  const raw = widget.blocks
    || (LEGACY[widget.type] ? LEGACY[widget.type].blocks(widget) : null)
    || P.def;
  const ids = raw
    .map(b => (typeof b === 'string' ? b : b && b.id))
    .filter(id => P.blocks[id]);
  return ids.length ? ids : P.def;
}

/** Per-block options (`picks`, `count`) for one stored widget. */
export function blockOpts(widget, id) {
  const raw = widget?.blocks
    || (widget && LEGACY[widget.type] ? LEGACY[widget.type].blocks(widget) : null)
    || [];
  const hit = raw.find(b => b && typeof b === 'object' && b.id === id);
  return hit || {};
}

/**
 * A widget with its block list replaced — keeping each block's options.
 *
 * Options (`picks`, `count`) ride on the block entry, so a reorder that
 * wrote bare ids would silently drop which pots somebody chose. A legacy
 * widget's options come from its old top-level fields the first time.
 * `type` is never touched: a `savings-pots` card stays `savings-pots` in
 * storage forever and is read as a prime.
 */
export function withBlocks(widget, ids) {
  return { ...widget, blocks: ids.map(id => ({ ...blockOpts(widget, id), id })) };
}

/** A widget with one block's options patched. */
export function withBlockOpts(widget, blockId, patch) {
  const ids = blocksOf(widget);
  return {
    ...widget,
    blocks: ids.map(id => (id === blockId
      ? { ...blockOpts(widget, id), ...patch, id }
      : { ...blockOpts(widget, id), id })),
  };
}

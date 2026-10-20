/**
 * What each hub widget type is called and which icon it wears, for the
 * console frames and the Add widget sheet.
 *
 * Classic types read the ONE existing registry (MobileWidget's
 * WIDGET_META) and primes read PRIMES — nothing is restated here except
 * the console's own widgets, which have no classic entry. Icons are
 * Lucide names only (no emoji in chrome); a classic entry without an
 * `svg` falls back to a neutral glyph.
 */
import { WIDGET_META } from '../../../components/mobile/MobileWidget';
import { PRIMES, PRIME_IDS, primeOf, primeType } from '../../../lib/hub/primeBlocks';
import { APP_PRESETS, visibleAppPresets } from '../../../data/appPresets';
import { tradingWidgetAvailable } from '../../../lib/trading/enabled';

export const CONSOLE_META = {
  today:   { title: 'Today', icon: 'square-check-big', blurb: 'Today’s trackers, tick and step from here' },
  league:  { title: 'League', icon: 'trophy', blurb: 'You against your friends, every rating band-coloured' },
  friends: { title: 'Friends', icon: 'users', blurb: 'Who is online, requests and unread messages' },
  upnext:  { title: 'Up next', icon: 'calendar-days', blurb: 'Your next trip, then the next three things on the calendar' },
  coins:   { title: 'Coins', icon: 'coin', blurb: 'Balance, this week and the next reward' },
};

/** Sentence-case titles for classic types whose labels were Title Case. */
const TITLE = {
  'recent-wins': 'Recent wins', 'coin-history': 'Coin activity', calories: 'Calories burned',
  'body-goal': 'Body goal', 'savings-pots': 'Savings pots', mail: 'Recent mail',
};

export const PRESET_IDS = new Set(APP_PRESETS.map(p => p.id));

/** Pro widget TYPES (the widget itself, not its size) — same rule as the classic pickers. */
const PRO_TYPES = new Set(['body-goal']);
export const isProWidget = type => PRESET_IDS.has(type) || PRO_TYPES.has(type);

/** { title, icon } for a stored item. */
export function metaOf(item) {
  const type = item && item.type;
  if (CONSOLE_META[type]) return CONSOLE_META[type];
  const pk = primeOf(item);
  if (pk) {
    const P = PRIMES[pk];
    return { title: item.title ? `${P.name} · ${item.title}` : P.name, icon: P.icon };
  }
  const m = WIDGET_META[type];
  if (m) return { title: TITLE[type] || m.label, icon: m.svg || 'square' };
  return { title: 'Widget', icon: 'square' };
}

/** Owner-only / build gates for a type. */
export function allowType(type, { isOwner = false } = {}) {
  if (type === 'trading') return tradingWidgetAvailable() && !!isOwner;
  if (type === 'rotation' || type === 'mail') return false;
  if (PRESET_IDS.has(type)) return visibleAppPresets().some(p => p.id === type);
  return true;
}

/** The classic types offered in the Add sheet, in the classic pickers' order. */
export function classicPickerTypes({ isOwner = false } = {}) {
  return [
    'github', 'linkedin',
    ...visibleAppPresets().map(p => p.id),
    'vitals', 'goals', 'body-goal', 'macros', 'calories', 'market', 'news',
    ...(allowType('trading', { isOwner }) ? ['trading'] : []),
  ];
}

export { PRIMES, PRIME_IDS, primeType, WIDGET_META };

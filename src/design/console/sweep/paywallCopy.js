/**
 * What the console paywall says, as pure functions of FREE_CAPS.
 *
 * Pure on purpose (no React, no hooks): FREE_CAPS lives in
 * hooks/useTierLimits.js, which imports React context, so the caller
 * passes the caps in and paywallCopy.test.mjs pins the wording with a
 * fixture. Nothing here quotes a price — prices come from the store
 * product only (lib/billing/renewalWording.js).
 *
 * The tier line (CLAUDE.md): both themes are free; Pro is limits,
 * customisation and the wider widget set. The table says exactly that.
 */

/** Feature entries with their own wording that are not FREE_CAPS keys. */
export const FEATURE_KEYS = ['widgetSizes', 'widgets', 'friends'];

/** Which cap the sheet is about. Unknown ids (a bare `paywall:`) read as the generic entry. */
export function resolveCapKey(openId, caps) {
  if (typeof openId !== 'string' || !openId.startsWith('paywall:')) return null;
  const key = openId.slice('paywall:'.length);
  return (caps && caps[key]) || FEATURE_KEYS.includes(key) ? key : 'generic';
}

/** Is the sheet open at all? */
export const isPaywallId = openId => typeof openId === 'string' && openId.startsWith('paywall:');

const cap1 = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Singular of a cap label for the headline ("habit", "tracker"). */
function noun(label) {
  return String(label || '').replace(/^active /, '').replace(/ widgets$/, ' widget').replace(/s$/, '');
}

// Numeric caps whose Pro side is NOT unlimited. AI scans keep a fair
// daily limit on Pro (netlify/lib/aiQuota) — never claim "Unlimited".
const PRO_SIDE = { aiScans: 'Fair daily limit' };

// Row labels where the cap's own label reads wrong in a table.
const ROW_LABEL = { holidays: 'Holidays', aiScans: 'AI food scans a week' };

// Table order: the caps people hit most, first.
const ORDER = ['trackers', 'habits', 'achievements', 'shopItems', 'links', 'holidays', 'aiScans'];

/**
 * The free-vs-Pro rows. Every numeric cap in FREE_CAPS becomes a row
 * (feature gates like ourApps/generic do not); then the three
 * customisation lines that aren't caps. Themes are listed as free on
 * both sides on purpose.
 *   [{ key, label, free, pro, hit }]
 */
export function compareRows(caps, hitKey = null) {
  const numeric = Object.entries(caps || {})
    .filter(([, c]) => c && !c.feature && Number.isFinite(c.limit))
    .sort(([a], [b]) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map(([key, c]) => ({
      key,
      label: ROW_LABEL[key] || cap1(c.label),
      free: String(c.limit),
      pro: PRO_SIDE[key] || 'Unlimited',
      hit: key === hitKey,
    }));
  return [
    ...numeric,
    { key: 'widgets', label: 'Widget set and sizes', free: 'Core, standard size', pro: 'Full, all sizes', hit: hitKey === 'widgets' || hitKey === 'widgetSizes' },
    // Accents: 3 free + 6 earned by prestige; Pro has 12 (incl. the 3 that
    // used to be honour-earned) + its own. Prestige-only accents are never Pro.
    { key: 'accents', label: 'Accent colours', free: '3 + 6 by prestige', pro: '12 + your own', hit: false },
    { key: 'brief', label: "Today's brief", free: '–', pro: 'Every morning', hit: false },
    { key: 'themes', label: 'Themes', free: 'Both', pro: 'Both', hit: false },
  ];
}

/**
 * The top of the sheet for the cap that opened it:
 *   { tag, title, sub }
 * `tag` is the line beside the Pro mark ("You've used all 5 free habits").
 * `count` (App passes it alongside the id) is how many exist now. Exactly
 * at the cap it says "5 of 5"; without a count, or over the cap (a lapsed
 * Pro account keeps what it made), it says "all N", which is true either way.
 */
export function headline(capKey, caps, { hasPro = false, count = null } = {}) {
  const cap = (caps && caps[capKey]) || null;
  if (hasPro) {
    return { tag: 'Pro is active', title: "You're already on Pro", sub: 'Manage your subscription in Settings.' };
  }
  if (!cap || cap.feature) {
    if (capKey === 'widgetSizes') {
      return { tag: 'A Pro extra', title: 'Bigger widgets are part of Pro', sub: 'Every widget works at its standard size for free. Pro lets you make them wider and taller. Both themes stay free.' };
    }
    if (capKey === 'widgets') {
      return { tag: 'A Pro extra', title: 'This widget is part of Pro', sub: 'The core widget set stays free. Pro adds the wider set and bigger sizes. Both themes stay free.' };
    }
    if (capKey === 'friends') {
      return { tag: 'Vantage Pro', title: 'More with your friends', sub: 'Friends, messages and your league stay free. Pro raises the limits and opens customisation.' };
    }
    if (capKey === 'ourApps') {
      return { tag: 'A Pro extra', title: 'Our Apps are part of Pro', sub: 'Add FloorplanStudio and the rest to your hub. Both themes and every core feature stay free.' };
    }
    return { tag: 'Vantage Pro', title: 'More room, more colour', sub: 'Both themes and every core feature stay free. Pro raises the limits and opens customisation.' };
  }
  const n = cap.limit;
  if (capKey === 'aiScans') {
    return { tag: `You've used ${n} of ${n} this week`, title: 'Scan more plates with AI', sub: 'Barcode and text search are never limited. Pro lifts the weekly AI scan limit to a fair daily one.' };
  }
  const one = noun(cap.label);
  const title = n === 1 ? `Plan more than one ${one}` : `Add more than ${numberWord(n)} ${cap.label}`;
  return {
    tag: n === 1 ? `You've used your free ${one}`
      : count === n ? `You've used ${n} of ${n} free ${cap.label}`
      : `You've used all ${n} free ${cap.label}`,
    title: capKey === 'trackers' ? `Track more than ${numberWord(n)} things` : title,
    sub: 'Both themes and every core feature stay free. Pro raises the limits and opens customisation.',
  };
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "five" for 5; numerals from 11 up. */
export function numberWord(n) {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n] : String(n);
}

/**
 * Prestige rewards — what each prestige unlocks. ONE pure module, read by
 * both designs (classic and console). No React, no DOM, no clock.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * Level/XP was retired (2026-10). Prestige took over as the long-term
 * goal: OVR climbs to 99, you prestige, OVR resets, the count goes up.
 * A committed user reaches one roughly every three months, so each one
 * has to be worth something you can SEE. The rewards are looks, never
 * "more": accents, how your avatar and badge appear to other people,
 * and finishes for your hub cards. That keeps them on the free side of
 * the tier line (CLAUDE.md: looks are free, *more* is paid). They are
 * earned status, so Pro does not buy the prestige-only ones.
 *
 * ── The pieces ───────────────────────────────────────────────────────
 *   REWARDS          the ladder, one reward per step, in plain English
 *   STANDING_REWARD  what every prestige (P1+) carries: the badge next to
 *                    your name and a ring round your avatar in your band
 *   accentAccess()   whether an accent scheme is usable, and why not
 *   frameFor()       how someone's avatar frame and badge are drawn, from
 *                    their prestige number alone (so friends' clients can
 *                    draw it without any extra public field)
 *   CARD_STYLES / resolveCardStyle() / withCardStyle()
 *                    hub card finishes (console only), S.cardStyle
 *   prestigeProgress()  "N OVR to Prestige II" for the player strip
 *
 * ── Grandfathering (accents) ─────────────────────────────────────────
 * Purple, Sunset and Rose used to be earned by an honour (ach-3,
 * streak-7, log-7). They now come at Prestige I, III and V. Nobody loses
 * one they had:
 *   - an honour stamped before LEGACY_ACCENT_CUTOFF (or stamped with no
 *     date at all) still unlocks its old accent;
 *   - the accent you have selected is always usable (never stranded);
 *   - Pro keeps these three, as it always had them.
 * The accents added for prestige (Moss, Lagoon, Ultramarine) are NOT
 * given to Pro: they are status.
 */
import { PRESTIGE_BANDS, PRESTIGE_MAX, prestigeBadge, toRoman } from './prestige.js';
import { onAccent, accentFor, contrast } from '../design/contrast.js';

/** Honour stamps dated before this still unlock their old accent.
 *  Set a little after the release; the owner confirms it at deploy. */
export const LEGACY_ACCENT_CUTOFF = '2026-11-01T00:00:00.000Z';

/** The band colours, mirrored from index.css `.prestige-{key}` (a test
 *  keeps the two equal). Used for avatar rings and solid badges. */
export const PRESTIGE_BAND_COLOURS = Object.freeze({
  forest: '#5dbb7a', yellow: '#d6b80e', indigo: '#5a55e0', red: '#d64545', burgundy: '#8e1f3a',
  purple: '#8e44ad', ocean: '#2a629e', cyan: '#0891b2', gold: '#c8970a', crimson: '#dc143c',
});

/**
 * Accents that exist only as prestige rewards. Same shape as a scheme in
 * SettingsSection SCHEMES (em = darkest, used as text on light themes and
 * as a fill under white; light = text on dark themes). Each passes
 * contrast on classic Cream and Dark OS and on console Paper and Dark OS
 * (prestigeRewards.test.mjs).
 */
export const PRESTIGE_ACCENTS = Object.freeze([
  Object.freeze({ id: 'moss',        name: 'Moss',        em: '#4a5a14', mid: '#6b7f22', light: '#a3b84f' }),
  Object.freeze({ id: 'lagoon',      name: 'Lagoon',      em: '#006d8f', mid: '#0089b0', light: '#4cc3e0' }),
  Object.freeze({ id: 'ultramarine', name: 'Ultramarine', em: '#2a3fa8', mid: '#3d55c9', light: '#8a9cf2' }),
]);

/**
 * The ladder. `at` is the prestige that unlocks it; `kind` is one of
 * accent | card | frame | badge. Frame and badge rewards change how
 * OTHER people see you; card styles are for your own hub.
 */
export const REWARDS = Object.freeze([
  { at: 1,  kind: 'accent', id: 'purple',      name: 'Purple accent',
    desc: 'A deep violet accent across the whole app. It used to come from an honour.' },
  { at: 2,  kind: 'card',   id: 'rule',        name: 'Accent rule card style',
    desc: 'A thin line in your accent along the top of every hub card.' },
  { at: 3,  kind: 'accent', id: 'orange',      name: 'Sunset accent',
    desc: 'A warm burnt-orange accent. It used to come from an honour.' },
  { at: 4,  kind: 'frame',  id: 'double',      name: 'Double ring',
    desc: 'A second, finer ring round your avatar, wherever friends and leagues show it.' },
  { at: 5,  kind: 'accent', id: 'pink',        name: 'Rose accent',
    desc: 'A dusky rose accent. It used to come from an honour.' },
  { at: 6,  kind: 'card',   id: 'ticks',       name: 'Corner ticks card style',
    desc: 'Small marks at the corners of your hub cards, like a camera viewfinder.' },
  { at: 7,  kind: 'badge',  id: 'solid',       name: 'Solid badge',
    desc: 'Your prestige badge filled with its colour instead of outlined, for everyone who sees it.' },
  { at: 8,  kind: 'accent', id: 'moss',        name: 'Moss accent',
    desc: 'An olive green that only prestige unlocks. Pro does not include it.' },
  { at: 9,  kind: 'card',   id: 'gilt',        name: 'Gilt edge card style',
    desc: 'A fine gold border round every hub card.' },
  { at: 10, kind: 'frame',  id: 'segmented',   name: 'Segmented ring',
    desc: 'Your avatar ring broken into twelve segments. Prestige X also moves you into the Yellow band.' },
  { at: 11, kind: 'accent', id: 'lagoon',      name: 'Lagoon accent',
    desc: 'A deep blue-green that only prestige unlocks. Pro does not include it.' },
  { at: 12, kind: 'card',   id: 'engraved',    name: 'Engraved card style',
    desc: 'Hub cards look pressed into the page, with a stronger edge and a soft inner shadow.' },
  { at: 15, kind: 'frame',  id: 'halo',        name: 'Halo',
    desc: 'A soft glow in your band colour behind your avatar.' },
  { at: 20, kind: 'accent', id: 'ultramarine', name: 'Ultramarine accent',
    desc: 'A vivid deep blue that only prestige unlocks. Prestige XX also moves you into the Indigo band.' },
].map(r => Object.freeze(r)));

/** What reaching any prestige gives you, before the ladder. */
export const STANDING_REWARD = Object.freeze({
  name: 'Badge and ring',
  desc: 'Your prestige badge next to your name and a ring in your band colour round your avatar, everywhere friends and leagues see you.',
});

export const KIND_LABEL = Object.freeze({ accent: 'Accent', card: 'Card style', frame: 'Avatar frame', badge: 'Badge' });

const clampP = p => {
  const n = Math.floor(Number(p));
  return Number.isFinite(n) && n > 0 ? Math.min(n, PRESTIGE_MAX) : 0;
};

/** "Prestige III". Absolute numerals (RatingsPanel's convention). '' for P0. */
export function prestigeName(p) {
  const n = clampP(p);
  return n ? `Prestige ${toRoman(n)}` : '';
}

/** Rewards unlocked at prestige `p` (ladder order). */
export function unlockedRewards(p) {
  const n = clampP(p);
  return REWARDS.filter(r => r.at <= n);
}

/** The next reward above `p`, or null when the ladder is done. */
export function nextReward(p) {
  const n = clampP(p);
  return REWARDS.find(r => r.at > n) || null;
}

/**
 * Progress towards the next prestige, from the existing ratings shape
 * (OVR 1-99; prestige unlocks at OVR 99 via prestige-up).
 *   ovr null (ratings still loading) → toGo null, pct 0.
 */
export function prestigeProgress(ovr, prestige) {
  const p = clampP(prestige);
  const o = Number.isFinite(Number(ovr)) && ovr != null ? Math.max(0, Math.min(99, Math.round(Number(ovr)))) : null;
  const maxed = p >= PRESTIGE_MAX;
  return {
    prestige: p,
    next: maxed ? null : p + 1,
    nextName: maxed ? '' : prestigeName(p + 1),
    toGo: o == null ? null : 99 - o,
    pct: o == null ? 0 : Math.round((o / 99) * 100),
    ready: o === 99 && !maxed,
    reward: nextReward(p),
  };
}

// ── Accents ─────────────────────────────────────────────────────────

/** Accent id → how it unlocks. `legacyVision` grandfathers the old
 *  honour; `pro` says Pro also unlocks it (only the original three). */
export const ACCENT_UNLOCKS = Object.freeze({
  purple:      Object.freeze({ at: 1,  legacyVision: 'ach-3',    pro: true }),
  orange:      Object.freeze({ at: 3,  legacyVision: 'streak-7', pro: true }),
  pink:        Object.freeze({ at: 5,  legacyVision: 'log-7',    pro: true }),
  moss:        Object.freeze({ at: 8,  legacyVision: null,       pro: false }),
  lagoon:      Object.freeze({ at: 11, legacyVision: null,       pro: false }),
  ultramarine: Object.freeze({ at: 20, legacyVision: null,       pro: false }),
});

/** True when an honour stamp predates the move to prestige. */
export function isLegacyStamp(stamp, cutoff = LEGACY_ACCENT_CUTOFF) {
  if (!stamp) return false;
  const at = stamp.unlockedAt ? Date.parse(stamp.unlockedAt) : NaN;
  if (!Number.isFinite(at)) return true;          // no date: it predates dates
  return at < Date.parse(cutoff);
}

/**
 * Can this accent be picked? `scheme` is a SCHEMES entry ({ id, pro? }).
 * → { locked, by: null | 'pro' | 'prestige', at, why, hint, title }
 *   why: 'free' | 'pro' | 'prestige' | 'grandfathered' | 'active' | 'locked'
 * The active scheme is never locked, so nobody is stranded on a colour
 * the picker would refuse.
 */
export function accentAccess(scheme, { visions = {}, prestige = 0, hasPro = false, active = false } = {}) {
  const id = scheme && scheme.id;
  const rule = id ? ACCENT_UNLOCKS[id] : null;
  const p = clampP(prestige);
  const open = why => ({ locked: false, by: null, at: rule ? rule.at : null, why, hint: '', title: '' });
  if (rule) {
    if (p >= rule.at) return open('prestige');
    if (rule.pro && hasPro) return open('pro');
    if (rule.legacyVision && isLegacyStamp((visions || {})[rule.legacyVision])) return open('grandfathered');
    if (active) return open('active');
    const name = prestigeName(rule.at);
    return { locked: true, by: 'prestige', at: rule.at, why: 'locked', hint: name, title: `Unlocks at ${name}` };
  }
  if (scheme && scheme.pro) {
    if (hasPro) return open('pro');
    if (active) return open('active');
    return { locked: true, by: 'pro', at: null, why: 'locked', hint: 'Pro', title: 'Upgrade to Pro to unlock this accent' };
  }
  return open('free');
}

// ── Avatar frame and badge ──────────────────────────────────────────

/**
 * How a user's avatar frame and badge are drawn, from their prestige
 * number. null at P0 (no frame, no badge).
 *   { p, band, bandLabel, colour, ring: 'single'|'double'|'segmented',
 *     halo: bool, badge: 'outline'|'solid', name: 'Prestige IV' }
 */
export function frameFor(prestige) {
  const p = clampP(prestige);
  if (!p) return null;
  const b = prestigeBadge(p);
  const got = unlockedRewards(p);
  const has = id => got.some(r => r.id === id);
  return {
    p,
    band: b.band.key,
    bandLabel: b.band.label,
    colour: PRESTIGE_BAND_COLOURS[b.band.key] || PRESTIGE_BAND_COLOURS.forest,
    ring: has('segmented') ? 'segmented' : has('double') ? 'double' : 'single',
    halo: has('halo'),
    badge: has('solid') ? 'solid' : 'outline',
    name: prestigeName(p),
  };
}

/**
 * DOM attributes for an avatar frame, for both designs (the classes are
 * styled by src/components/prestige-frame.css). null at P0, so a P0 avatar
 * renders exactly as it did before prestige rewards existed.
 *   { className: 'pf pf-double pf-halo', style: { '--pf-c': '#5dbb7a' }, title }
 * A segmented ring keeps the outer ring of the double one under it.
 */
export function frameAttrs(prestige) {
  const f = frameFor(prestige);
  if (!f) return null;
  const cls = ['pf', `pf-${f.ring}`];
  if (f.ring === 'segmented') cls.push('pf-double');
  if (f.halo) cls.push('pf-halo');
  return { className: cls.join(' '), style: { '--pf-c': f.colour }, title: f.name };
}

/** Inline colours for a SOLID badge (P7+), else null (outline badge).
 *  The text is whichever of near-black / white reads better on the band;
 *  a band neither reaches 4.5:1 on (mid red) is deepened until it does. */
export function solidBadgeStyle(prestige) {
  const f = frameFor(prestige);
  if (!f || f.badge !== 'solid') return null;
  const ink = onAccent(f.colour);
  const bg = contrast(ink, f.colour) >= 4.5 ? f.colour : accentFor(f.colour, ink, 4.5);
  return { background: bg, color: ink, borderColor: bg };
}

// ── Hub card styles (console) ───────────────────────────────────────

export const CARD_STYLES = Object.freeze([
  Object.freeze({ id: 'plain', at: 0, name: 'Plain', desc: 'The standard hub card.' }),
  ...REWARDS.filter(r => r.kind === 'card').map(r => Object.freeze({ id: r.id, at: r.at, name: r.name.replace(/ card style$/, ''), desc: r.desc })),
]);

/** The card style to draw: S.cardStyle when it is unlocked, else plain. */
export function resolveCardStyle(S) {
  const id = S && S.cardStyle;
  const style = CARD_STYLES.find(c => c.id === id);
  return style && style.at <= clampP(S && S.prestige) ? style.id : 'plain';
}

/** Additive updater for S.cardStyle. Returns `prev` itself when the
 *  style is unknown, locked or already chosen (no write). */
export function withCardStyle(prev, id) {
  const style = CARD_STYLES.find(c => c.id === id);
  if (!prev || !style || style.at > clampP(prev.prestige)) return prev;
  if (prev.cardStyle === id) return prev;
  return { ...prev, cardStyle: id };
}

export { PRESTIGE_BANDS };

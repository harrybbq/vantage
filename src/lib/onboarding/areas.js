/**
 * The smaller app — "hide what you haven't chosen" (owner, Nov 2026;
 * mockup A approved).
 *
 * The onboarding asks what Vantage is for. For an account whose
 * onboarding is `scoped` (S.onboarding.scoped === true, only ever set
 * for accounts created from the cut-over on — lib/account/cohort.js) the
 * navigation holds what they asked for, and everything else sits behind
 * one "Add an area" row.
 *
 * A destination shows when ANY of these is true:
 *   · it is always there: Hub, Track, Settings (trips, subscriptions and
 *     pay all live on Track's calendar, so every pick uses it);
 *   · an area that was picked, or added later, turns it on (AREA_NAV);
 *   · it has something in it (USED) — so nothing a person has put data
 *     into can drop out of reach, and an area appears by itself the
 *     moment it is used from a widget, search or a link.
 *
 * It is a VIEW. Nothing is deleted or switched off: routes, shortcuts,
 * search and widgets reach every section whatever this says. The only
 * state is S.onboarding.added (onboarding.js addArea).
 *
 * Pure (no React, no DOM). areas.test.mjs pins it.
 */
import { PICKS, areasOf } from './onboarding.js';

/** The navigation ids each pick turns on (ids as in design/console/shell/nav.js). */
export const AREA_NAV = Object.freeze({
  fitness: Object.freeze([]),                         // Track is always there
  money:   Object.freeze(['achievements']),           // savings live in Achievements
  habits:  Object.freeze(['habits']),
  goals:   Object.freeze(['achievements']),
  friends: Object.freeze(['leaderboard', 'friends']),
  trips:   Object.freeze(['shop']),                   // trips themselves are on Track's calendar
});

/** Never hidden. Upgrade is the owner's and is gated elsewhere. */
export const ALWAYS_NAV = Object.freeze(['hub', 'track', 'settings', 'upgrade']);

/** The default state ships example goals; only your own count as use. */
const SEEDED_GOALS = new Set(['a1', 'a2', 'a3', 'a4']);
const len = v => (Array.isArray(v) ? v.length : 0);
const friendsOf = (S, ctx) => {
  if (ctx && typeof ctx.friends === 'number') return ctx.friends;
  const n = S && S.ratingInputs && Number(S.ratingInputs.friends);   // the server's count, cached (ratings/derive.js)
  return Number.isFinite(n) ? n : 0;
};

/** Does a destination have something of the user's in it? */
const USED = {
  achievements: S => len(S && S.savings) > 0
    || (Array.isArray(S && S.achievements) ? S.achievements : []).some(a => a && (!SEEDED_GOALS.has(a.id) || a.completed)),
  habits: S => len(S && S.habits) > 0,
  shop: S => len(S && S.shopItems) > 0,
  leaderboard: (S, ctx) => friendsOf(S, ctx) > 0,
  friends: (S, ctx) => friendsOf(S, ctx) > 0,
};

/** Is this account's navigation following its picks? */
export function isScoped(S) {
  return !!(S && S.onboarding && S.onboarding.scoped === true) && areasOf(S).length > 0;
}

/**
 * The destinations to show → a Set of nav ids, or null for "everything"
 * (every account that is not scoped: nothing changes for them).
 * `ctx.friends`: the live friend count where the host has it.
 */
export function navScope(S, ctx = {}) {
  if (!isScoped(S)) return null;
  const show = new Set(ALWAYS_NAV);
  for (const id of areasOf(S)) for (const nav of AREA_NAV[id] || []) show.add(nav);
  for (const nav of Object.keys(USED)) if (!show.has(nav) && USED[nav](S, ctx)) show.add(nav);
  return show;
}

/** Is one destination shown? (null scope = everything.) */
export const inScope = (scope, navId) => !scope || scope.has(navId);

/**
 * What "Add an area" offers: the picks not asked for yet, as
 * [{ id, label, icon, line, section }]. Fitness is never offered — it
 * turns nothing on that is not already there. [] when not scoped or
 * nothing is left, and the row goes.
 */
export function addableAreas(S) {
  if (!isScoped(S)) return [];
  const have = areasOf(S);
  return PICKS
    .filter(p => !have.includes(p.id) && (AREA_NAV[p.id] || []).length > 0)
    .map(p => ({ id: p.id, label: p.label, icon: p.icon, line: p.line, section: p.first.section }));
}

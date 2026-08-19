/**
 * App presets — F4 Sprint 4 follow-up.
 *
 * One-click widget presets for the user's own apps. Adding one drops a
 * pre-branded link widget onto the hub (desktop) or a brand card into
 * the mobile widget stack — no typing required.
 *
 * Single source of truth for BOTH surfaces:
 *   - desktop  → AddLinkModal "Our Apps" row (src/components/Modals.jsx)
 *   - mobile   → MobileWidget brand cards + picker
 *
 * Planned: gate these behind Pro (bonus tools for subscribers). Not
 * gated yet — see the `pro` flag note below when wiring that up.
 *
 * To add another app later: append one entry here. A preset with a
 * null `url` renders as a disabled "deploy first" slot until a URL is
 * filled in, so an app that is not live yet can show intent without a
 * dead link. To remove one, delete its entry and name it in
 * RETIRED_PRESETS at the bottom.
 *
 * Fields:
 *   id       stable key (also the mobile widget `type`)
 *   name     display title
 *   url      destination — null = not deployed yet (disabled slot)
 *   icon     emoji glyph for the chip
 *   color    brand accent (chip tint + Open ↗ pill)
 *   tagline  one-line description (becomes the link's notes)
 *   requires when url is null, the hint shown explaining how to enable
 *   live     true → mobile widget body fetches a richer preview (og
 *            image + title + snippet) via /.netlify/functions/shop-autofill,
 *            cached 24h in localStorage. Falls back to the static
 *            brand card if the fetch fails. Cheap, no API key needed.
 */
export const APP_PRESETS = [
  {
    id: 'floorplanstudio',
    name: 'FloorplanStudio',
    url: 'https://harrybbq.github.io/FloorplanStudio/',
    icon: '📐',
    color: '#2d6cdf',
    tagline: 'Design floor plans',
    live: true,
  },
];

/**
 * Presets that used to be here.
 *
 * A widget already on someone's hub keeps its `type` after the preset
 * behind it goes, and an unknown type renders as a card labelled with a
 * raw id and nothing inside it. Naming the retired ones lets that card
 * say what happened instead — see MobileWidget's stub. Removing a line
 * from here does not delete anyone's widget; it only takes away the
 * explanation.
 */
export const RETIRED_PRESETS = {
  // Never deployed — it only ever rendered a "deploy first" slot, and
  // owner-only at that. Removed 2026-08-19.
  tubelube: 'TubeLube',
};

/** Look up a preset by its id. */
export function getAppPreset(id) {
  return APP_PRESETS.find(p => p.id === id) || null;
}

/** Presets the current account may add. Owner-only presets are
 *  filtered out for everyone else. `isOwner` defaults to the global
 *  flag App.jsx maintains (window.__vantageOwner) so pickers deep in
 *  the tree don't need owner state threaded through props. */
export function visibleAppPresets(isOwner = typeof window !== 'undefined' && !!window.__vantageOwner) {
  return APP_PRESETS.filter(p => !p.ownerOnly || isOwner);
}

/** Build a hub link-widget object from a preset (desktop hub).
 *  Stamps presetId so the renderer can detect preset-sourced links
 *  and opt them into the live-data treatment (og:image hero, etc). */
export function appPresetToLink(preset) {
  return {
    id: 'l' + Date.now(),
    name: preset.name,
    url: preset.url,
    icon: preset.icon || '🔗',
    color: preset.color || '#1a7a4a',
    notes: preset.tagline || '',
    ghUser: null,
    presetId: preset.id,
  };
}

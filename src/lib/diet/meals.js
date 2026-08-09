/**
 * Meal library — recipes and saved videos.
 *
 * Pure: URL parsing, macro arithmetic, filtering. No DOM, no network,
 * no React, so the fiddly parts (which are all in the URL parsing) can
 * be asserted directly.
 *
 * Stores, both new keys in S:
 *   S.recipes     [{ id, title, image, servings, kcal, protein, carbs,
 *                    fat, minutes, tags, ingredients[], method,
 *                    sourceUrl, createdAt }]
 *   S.mealVideos  [{ id, url, platform, videoId, title, note, tags,
 *                    watched, savedAt }]
 *
 * Photos are the one thing NOT in S — see lib/diet/recipeImages.js.
 */

/* ══ Videos ═══════════════════════════════════════════════════════════ */

/**
 * Work out the platform and video id from a pasted URL.
 *
 * YouTube ids are extractable from every URL shape they use, which is
 * what makes a free thumbnail possible. TikTok's canonical URLs carry a
 * numeric id, but their short links (vm.tiktok.com/…) do not resolve
 * without a network round trip — so those come back with a null id and
 * the UI generates a tile instead of chasing a redirect.
 */
export function parseVideoUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return { platform: null, videoId: null, url: '', valid: false };

  let u;
  try {
    u = new URL(url.startsWith('http') ? url : 'https://' + url);
  } catch {
    return { platform: null, videoId: null, url, valid: false };
  }
  const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();

  // ── YouTube ──
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return { platform: 'youtube', videoId: id || null, url: u.href, valid: !!id };
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    if (v) return { platform: 'youtube', videoId: v, url: u.href, valid: true };
    // /shorts/ID, /embed/ID, /live/ID all put the id in the path.
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]+)/);
    if (m) return { platform: 'youtube', videoId: m[1], url: u.href, valid: true };
    return { platform: 'youtube', videoId: null, url: u.href, valid: true };
  }

  // ── TikTok ──
  if (host.endsWith('tiktok.com')) {
    const m = u.pathname.match(/\/video\/(\d+)/);
    return { platform: 'tiktok', videoId: m ? m[1] : null, url: u.href, valid: true };
  }

  // ── Instagram: food content lives there too, and the cost of
  //    recognising it is one branch. ──
  if (host.endsWith('instagram.com')) {
    const m = u.pathname.match(/^\/(?:reel|reels|p)\/([\w-]+)/);
    return { platform: 'instagram', videoId: m ? m[1] : null, url: u.href, valid: true };
  }

  return { platform: 'link', videoId: null, url: u.href, valid: true };
}

export const PLATFORM_LABEL = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', link: 'Link',
};

/**
 * A thumbnail URL, or null when the platform doesn't hand one over for
 * free. YouTube derives from the id with no key and no account; nobody
 * else does without a per-video lookup that breaks when they change
 * their embed, which is not a dependency worth taking for a thumbnail.
 */
export function videoThumb(video) {
  if (video && video.image) return video.image;          // user attached their own
  if (video && video.platform === 'youtube' && video.videoId) {
    return `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`;
  }
  return null;
}

/** Portrait platforms want a portrait tile. */
export const isPortrait = platform => platform === 'tiktok' || platform === 'instagram';

/* ══ Recipes ══════════════════════════════════════════════════════════ */

export const EMPTY_RECIPE = () => ({
  id: '', title: '', image: null, servings: 1,
  kcal: 0, protein: 0, carbs: 0, fat: 0,
  minutes: 0, tags: [], ingredients: [], method: '', sourceUrl: '',
});

/** Recipe figures are per serving; this is what a whole batch comes to. */
export function batchTotals(r) {
  const n = Math.max(1, Number(r.servings) || 1);
  return {
    kcal: Math.round((r.kcal || 0) * n),
    protein: Math.round((r.protein || 0) * n),
    carbs: Math.round((r.carbs || 0) * n),
    fat: Math.round((r.fat || 0) * n),
  };
}

/**
 * A serving as a share of the day's targets, so a card can say what it
 * costs you rather than just what it contains. Null when there is no
 * target to measure against — a percentage of nothing is a lie.
 */
export function shareOfTarget(r, targets) {
  if (!targets || !targets.kcal) return null;
  const pct = (v, t) => (t ? Math.round((v / t) * 100) : null);
  return {
    kcal: pct(r.kcal, targets.kcal),
    protein: pct(r.protein, targets.protein),
  };
}

/** Tags offered by default. The user can type anything; these are the
 *  ones worth one tap, and they mirror how the rotation actually runs. */
export const RECIPE_TAGS = [
  'Training day', 'Rest day', 'Night shift', 'High protein',
  'Meal prep', 'Under 20 min', 'No cook', 'One pan',
];

export const VIDEO_TAGS = ['To try', 'Made it', 'High protein', 'Meal prep', 'Technique'];

/**
 * Search + filter, shared by both libraries so they behave identically.
 * Matching is over everything a person might half-remember — the title,
 * the tags, and for a recipe its ingredients too, because "the one with
 * gochujang" is how you actually look for it.
 */
export function filterItems(items, { q = '', tag = '' } = {}) {
  const needle = q.trim().toLowerCase();
  return (items || []).filter(it => {
    if (tag && !(it.tags || []).includes(tag)) return false;
    if (!needle) return true;
    const hay = [
      it.title, it.note, it.method,
      ...(it.tags || []),
      ...(it.ingredients || []).map(i => (typeof i === 'string' ? i : i.text)),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

/** Every tag in use, with counts, for the filter row. */
export function tagCounts(items) {
  const out = {};
  (items || []).forEach(it => (it.tags || []).forEach(t => { out[t] = (out[t] || 0) + 1; }));
  return Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * A recipe serving as a nutrition_log row.
 *
 * Kept here rather than in the component so the shape sits next to the
 * recipe model it comes from, and so it can be asserted without a
 * database. `source` marks where it came from — the column is free text
 * and the existing writer uses 'manual'.
 */
export function servingToLogRow(recipe, { userId, logDate, mealType = 'lunch', servings = 1 }) {
  const n = Math.max(0.25, Number(servings) || 1);
  const r = v => Math.round((Number(v) || 0) * n);
  return {
    user_id: userId,
    log_date: logDate,
    meal_type: mealType,
    food_name: recipe.title || 'Recipe',
    brand: null,
    serving_g: 0,
    calories: r(recipe.kcal),
    protein_g: r(recipe.protein),
    carbs_g: r(recipe.carbs),
    fat_g: r(recipe.fat),
    fibre_g: 0, sugar_g: 0, sodium_mg: 0,
    additional_nutrients: { recipe_id: recipe.id, servings: n },
    source: 'recipe',
  };
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

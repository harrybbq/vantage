/**
 * Turning a food somebody typed into one other people can find.
 *
 * ── What is worth keeping ────────────────────────────────────────────
 * Not everything logged by hand. A row called "lunch" with 600 calories
 * and no macros helps nobody search for anything, and a database full of
 * those is worse than one with a gap in it — the gap at least sends you
 * to the packet. So an entry has to carry a name that reads like a food
 * and enough of a panel to be worth finding.
 *
 * ── Why the ceilings ────────────────────────────────────────────────
 * Per 100g, no real food has 900 calories (pure fat is 900, and that is
 * the ceiling rather than a target) or 200g of protein. A number past
 * those is a typo or a joke, and either way it is not something to hand
 * to the next person as fact. The database has the same checks; this one
 * exists so the person who typed it finds out now, while they are
 * looking at the field.
 *
 * Pure. No React, no network.
 */

/** Per 100g/100ml, the most a real food can plausibly carry. */
export const LIMITS = {
  calories: 900,
  protein_g: 100,
  carbs_g: 100,
  fat_g: 100,
  fibre_g: 100,
  sugar_g: 100,
  sodium_mg: 40_000,
};

const NUM_KEYS = Object.keys(LIMITS);

const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Is this worth adding to a shared database?
 *
 * Returns null when it is, or a sentence saying why not — written for
 * the person who typed it, not for a log.
 */
export function contributionProblem(form) {
  const name = clean(form?.food_name, 80);
  if (name.length < 2) return 'Give it a name first.';
  if (name.length > 80) return 'That name is too long to share.';
  // A name that is all digits is a barcode or a weight, not a food.
  if (!/[a-z]/i.test(name)) return 'Give it a name people would search for.';

  const serving = num(form?.serving_g);
  if (!(serving > 0)) return 'Set the serving size first.';

  const per100 = perHundred(form);
  if (per100.calories <= 0
      && per100.protein_g <= 0 && per100.carbs_g <= 0 && per100.fat_g <= 0) {
    return 'Fill in the calories or macros — an empty entry helps nobody.';
  }
  for (const k of NUM_KEYS) {
    if (per100[k] > LIMITS[k]) return 'Those numbers look wrong for 100g — check them before sharing.';
    if (per100[k] < 0) return 'Those numbers look wrong — check them before sharing.';
  }
  return null;
}

/**
 * The form's numbers, restated per 100g.
 *
 * Everything in the shared table is per 100 so entries are comparable;
 * the form is per SERVING, because that is how a packet is read and how
 * a person logs. Converting here rather than at the database means one
 * definition of the conversion instead of one per caller.
 */
export function perHundred(form) {
  const serving = num(form?.serving_g) || 100;
  const factor = serving > 0 ? 100 / serving : 1;
  const out = {};
  for (const k of NUM_KEYS) out[k] = round(num(form?.[k]) * factor, k);
  return out;
}

function round(v, key) {
  if (key === 'calories' || key === 'sodium_mg') return Math.round(v);
  return Math.round(v * 10) / 10;
}

/**
 * The row to insert, or null when the form should not be shared.
 *
 * `contributed_by` is set by the caller from the session — never from
 * anything the form said about who it is.
 */
export function toContribution(form, userId) {
  if (!userId) return null;
  if (contributionProblem(form)) return null;
  const brand = clean(form?.brand, 60);
  return {
    name: clean(form?.food_name, 80),
    brand: brand || null,
    serving_g: 100,
    serving_unit: form?.serving_unit === 'ml' ? 'ml' : 'g',
    ...perHundred(form),
    contributed_by: userId,
  };
}

/**
 * A community row, in the shape the food search returns everywhere else.
 *
 * Deliberately NOT carrying who added it. What a person eats, and what
 * they were prepared to type in at 9pm, is not a thing to publish beside
 * their name — the column exists so an entry can be moderated and
 * rate-limited, not so it can be attributed.
 */
export function fromContribution(row) {
  if (!row) return null;
  return {
    food_name: row.name || '',
    brand: row.brand || '',
    barcode: '',
    image: '',
    serving_g: num(row.serving_g) || 100,
    serving_unit: row.serving_unit === 'ml' ? 'ml' : 'g',
    calories: num(row.calories),
    protein_g: num(row.protein_g),
    carbs_g: num(row.carbs_g),
    fat_g: num(row.fat_g),
    fibre_g: num(row.fibre_g),
    sugar_g: num(row.sugar_g),
    sodium_mg: num(row.sodium_mg),
    source: 'community',
    contributionId: row.id,
  };
}

/**
 * Foods people add to the shared database.
 *
 * Two things can go wrong and both are somebody else's problem rather
 * than the contributor's: rubbish gets in, or the conversion is wrong
 * and the next person logs a number that is off by the serving size.
 * The second is the quieter one — nobody notices a food that is 2.5×
 * out, they just eat by it.
 */
import assert from 'node:assert/strict';
import { contributionProblem, perHundred, toContribution, fromContribution, LIMITS } from './contribute.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.05, `${m} — got ${a}, wanted ~${b}`); n++; };

const bar = () => ({
  food_name: 'Protein Flapjack',
  brand: 'Gym Kitchen',
  serving_g: '60',
  serving_unit: 'g',
  calories: '240', protein_g: '12', carbs_g: '24', fat_g: '9',
  fibre_g: '3', sugar_g: '11', sodium_mg: '180',
});

// ── The conversion ──
{
  const p = perHundred(bar());
  near(p.calories, 400, '240 kcal in a 60g bar is 400 per 100g');
  near(p.protein_g, 20, 'and 12g of protein is 20');
  near(p.sodium_mg, 300, 'sodium too');
  eq(perHundred({ serving_g: '100', calories: '95' }).calories, 95, 'a 100g serving converts to itself');
  eq(perHundred({ calories: '95' }).calories, 95, 'and a missing serving size is treated as 100, not as zero');
  eq(perHundred({ serving_g: '0', calories: '95' }).calories, 95, 'nor does a zero serving divide by zero');
}

{
  // Rounding: calories and sodium whole, macros to a decimal. A stored
  // 20.666666666 is noise in every list it ever appears in.
  const p = perHundred({ serving_g: '30', calories: '100', protein_g: '6.2', sodium_mg: '55' });
  eq(p.calories, 333, 'calories are whole');
  eq(p.sodium_mg, 183, 'and so is sodium');
  eq(p.protein_g, 20.7, 'macros keep one decimal');
}

// ── What is worth keeping ──
{
  eq(contributionProblem(bar()), null, 'a real food with a real panel is fine');

  ok(contributionProblem({ ...bar(), food_name: '' }), 'no name, no entry');
  ok(contributionProblem({ ...bar(), food_name: 'x' }), 'and one character is not a name');
  ok(contributionProblem({ ...bar(), food_name: '  ' }), 'nor is whitespace');
  ok(contributionProblem({ ...bar(), food_name: '5000159407236' }),
    'a barcode is not something the next person searches for');
  ok(contributionProblem({ ...bar(), food_name: '250' }), 'and neither is a weight');

  const empty = { ...bar(), calories: '0', protein_g: '0', carbs_g: '0', fat_g: '0' };
  ok(contributionProblem(empty),
    'an entry with no panel at all is worse than the gap — the gap sends you to the packet');

  eq(contributionProblem({ ...bar(), fibre_g: '0', sugar_g: '0', sodium_mg: '0' }), null,
    'but missing the optional ones is fine — most packets do not print fibre');
}

// ── Numbers that cannot be right ──
{
  // Pure fat is 900 kcal/100g. Anything past it is a typo.
  ok(contributionProblem({ ...bar(), serving_g: '100', calories: '4000' }),
    'four thousand calories per 100g is a typo, not a food');
  ok(contributionProblem({ ...bar(), serving_g: '100', protein_g: '400' }),
    'and so is 400g of protein in 100g');
  ok(contributionProblem({ ...bar(), calories: '-100' }), 'negative calories are refused');

  // The check is per 100g, so a small serving with a big number is the
  // case that matters: 90 kcal in a 1g serving is 9,000 per 100g.
  ok(contributionProblem({ ...bar(), serving_g: '1', calories: '90' }),
    'the ceiling is applied AFTER converting — this is the case a per-serving check would miss');
  eq(contributionProblem({
    food_name: 'Stock cube', serving_g: '1', calories: '9',
    protein_g: '0.2', carbs_g: '0.5', fat_g: '0.3',
    fibre_g: '0', sugar_g: '0.1', sodium_mg: '300',
  }), null, 'while a 1g serving with a plausible density is allowed');

  for (const k of Object.keys(LIMITS)) {
    ok(LIMITS[k] > 0, `${k} has a ceiling`);
  }
}

// ── The row that gets written ──
{
  const row = toContribution(bar(), 'user-1');
  eq(row.name, 'Protein Flapjack', 'the name is trimmed and kept');
  eq(row.brand, 'Gym Kitchen', 'and the brand');
  eq(row.serving_g, 100, 'stored per 100 so entries are comparable');
  near(row.calories, 400, 'with the numbers converted to match');
  eq(row.contributed_by, 'user-1', 'attributed to the session, not to anything the form said');

  eq(toContribution({ ...bar(), brand: '   ' }, 'u').brand, null, 'a blank brand is null, not an empty string');
  eq(toContribution(bar(), null), null, 'no session, no row — this is a write on somebody\'s behalf');
  eq(toContribution({ food_name: 'lunch' }, 'u'), null, 'and nothing that would not pass the check is built at all');

  eq(toContribution({ ...bar(), serving_unit: 'ml' }, 'u').serving_unit, 'ml', 'liquids keep their unit');
  eq(toContribution({ ...bar(), serving_unit: 'oz' }, 'u').serving_unit, 'g', 'and anything else is grams');
}

// ── Reading one back ──
{
  const result = fromContribution({
    id: 12, name: 'Protein Flapjack', brand: 'Gym Kitchen',
    serving_g: 100, serving_unit: 'g', calories: 400, protein_g: 20,
    carbs_g: 40, fat_g: 15, fibre_g: 5, sugar_g: 18, sodium_mg: 300,
  });
  eq(result.food_name, 'Protein Flapjack', 'comes back in the shape every other source uses');
  eq(result.source, 'community', 'badged as community so the list can say where it came from');
  eq(result.contributionId, 12, 'carrying its id, so it can be reported');
  ok(!('contributed_by' in result),
    'and NOT who added it — what somebody eats is not published beside their name');
  eq(fromContribution(null), null, 'a missing row is not a crash');
}

console.log(`food contributions: ${n} assertions passed`);

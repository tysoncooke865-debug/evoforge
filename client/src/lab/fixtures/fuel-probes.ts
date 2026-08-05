/**
 * FUEL MODEL DUEL probes (Page Lab, 2026-08): known-answer meal descriptions
 * for judging describe/recipe accuracy across models. Each probe carries an
 * expected total-kcal band; `dbAnchor` marks the ones the deterministic USDA
 * table must own — for those, fuel-probes.test.ts recomputes the expectation
 * through matchFood, so a FOOD_DB edit that invalidates a band fails vitest
 * instead of silently mis-grading a model.
 *
 * Bands are deliberately asymmetric in tightness: db-anchored probes get a
 * narrow band (the table's number is THE number, grams come verbatim from the
 * text), free-estimate probes get a wide one (gram guesses legitimately vary).
 */

export interface FuelProbe {
  /** url-safe slug, unique. */
  id: string;
  /** Chip text in the bench UI. */
  label: string;
  /** What gets submitted, verbatim. */
  text: string;
  mode: 'describe' | 'recipe';
  /** Expected TOTAL kcal band for a correct parse. */
  kcal: { min: number; max: number };
  /** When set, the deterministic table owns this probe's number:
   *  round(matchFood(name).per100.kcal * grams / 100) must land inside the
   *  band. Single-food probes only — the table prices items, not meals. */
  dbAnchor?: { name: string; grams: number };
}

export const FUEL_PROBES: readonly FuelProbe[] = [
  {
    // THE headline bug (NUTRITION_PLAN_2.md): the cooked base row (250/100g)
    // used to win over the raw-10% variant (176/100g) → 1250 instead of 880.
    id: 'raw-mince',
    label: 'RAW 10% MINCE',
    text: '500g raw 10% beef mince',
    mode: 'describe',
    kcal: { min: 850, max: 920 },
    dbAnchor: { name: 'raw 10% beef mince', grams: 500 },
  },
  {
    // The contrast case: same words minus "raw" — cooked 10% row, 217/100g.
    id: 'cooked-mince',
    label: 'COOKED 10% MINCE',
    text: '500g cooked 10% beef mince',
    mode: 'describe',
    kcal: { min: 1050, max: 1120 },
    dbAnchor: { name: 'cooked 10% beef mince', grams: 500 },
  },
  {
    id: 'dry-pasta',
    label: 'DRY PASTA',
    text: '100g dry pasta',
    mode: 'describe',
    kcal: { min: 355, max: 390 },
    dbAnchor: { name: 'dry pasta', grams: 100 },
  },
  {
    // Qualifier echo through the raw chicken variant (120/100g, not 165).
    id: 'raw-chicken',
    label: 'RAW CHICKEN',
    text: '300g raw chicken breast',
    mode: 'describe',
    kcal: { min: 340, max: 380 },
    dbAnchor: { name: 'raw chicken breast', grams: 300 },
  },
  {
    // Multi-item: qualifier fallback from user text is OFF (>1 item), so the
    // model must echo "grilled" itself; rice cup→grams conversion in play.
    id: 'chicken-rice',
    label: 'CHICKEN + RICE',
    text: '200g grilled chicken breast and 1 cup cooked white rice',
    mode: 'describe',
    kcal: { min: 500, max: 700 },
  },
  {
    // Household measures only — grams are all estimate.
    id: 'eggs-toast',
    label: 'EGGS + TOAST',
    text: 'two scrambled eggs and a slice of toast with butter',
    mode: 'describe',
    kcal: { min: 250, max: 450 },
  },
  {
    // Recipe mode: divide by the stated servings (4).
    id: 'recipe-serves-4',
    label: 'RECIPE ÷ 4',
    text: '500g raw chicken breast, 2 cups cooked white rice, 1 tbsp olive oil and 1 onion. Serves 4.',
    mode: 'recipe',
    kcal: { min: 250, max: 420 },
  },
  {
    // Branded food with no table row — pure AI per-100g estimate path.
    id: 'branded',
    label: 'SNICKERS',
    text: 'a Snickers bar',
    mode: 'describe',
    kcal: { min: 200, max: 300 },
  },
];

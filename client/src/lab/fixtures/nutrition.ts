import type { NutritionEntry, NutritionTargetRow, SavedMeal } from '@/data/nutrition';

// Relative runtime imports on purpose: the vitest suite loads these fixtures
// and the test runner resolves no '@/' alias (the domain/ rule). Type-only
// imports above are erased before it ever runs, so they can stay aliased.
import { addDaysIso } from '../../domain/today';
import {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  dualRateTargets,
} from '../variants/fuel/calculator/model';

/**
 * The lab athlete's FUEL day: a believable mid-cut afternoon — target set
 * 12 days ago, two scanned meals and a quick-add logged, a cardio burn in
 * the bank, a nine-day logging streak. Consistent with LAB_PROFILE (male,
 * 82 kg, 180 cm) so the recalculate sheet's prefill and the stored target
 * describe the same athlete.
 *
 * The stored triple is COMPUTED from LAB_NUTRITION_INPUTS via the dual-rate
 * model — fixture and math cannot disagree, and the lab.test.ts pin makes
 * that structural.
 */

export const LAB_NUTRITION_INPUTS = {
  sex: 'male',
  weightKg: 82,
  heightCm: 180,
  age: 28,
  activity: 'moderate',
  goal: 'lose',
  ratePerWeekKg: 0.5,
  rateGainKgPerWeek: DEFAULT_GAIN_RATE_KG_PER_WEEK,
} as const;

/** The asymmetric triple behind the seeded target row. */
export function labNutritionTriple() {
  return dualRateTargets({
    sex: LAB_NUTRITION_INPUTS.sex,
    weightKg: LAB_NUTRITION_INPUTS.weightKg,
    heightCm: LAB_NUTRITION_INPUTS.heightCm,
    age: LAB_NUTRITION_INPUTS.age,
    activity: LAB_NUTRITION_INPUTS.activity,
    rateLossKgPerWeek: LAB_NUTRITION_INPUTS.ratePerWeekKg,
    rateGainKgPerWeek: LAB_NUTRITION_INPUTS.rateGainKgPerWeek,
  });
}

export function labNutritionTargets(todayIso: string): NutritionTargetRow[] {
  const triple = labNutritionTriple();
  return [
    {
      id: 'lab-target-1',
      effective_from: addDaysIso(todayIso, -12),
      daily_kcal: triple.lose,
      goal: 'lose',
      inputs: { ...LAB_NUTRITION_INPUTS },
      kcal_lose: triple.lose,
      kcal_maintain: triple.maintain,
      kcal_gain: triple.gain,
    },
  ];
}

/** Two scanned meals plus one absolute quick-add, all today — the meter sits
 *  mid-day with room left in the budget. */
export function labNutritionLog(todayIso: string): NutritionEntry[] {
  return [
    {
      id: 'lab-nl-1',
      date: todayIso,
      kcal: 520,
      label: 'Oats, whey, banana',
      source: 'photo',
      meal_no: 1,
      protein_g: 42,
      carbs_g: 68,
      fat_g: 11,
      timestamp: `${todayIso}T07:40:00Z`,
    },
    {
      id: 'lab-nl-2',
      date: todayIso,
      kcal: 640,
      label: 'Chicken, rice, broccoli',
      source: 'photo',
      meal_no: 2,
      protein_g: 52,
      carbs_g: 70,
      fat_g: 14,
      timestamp: `${todayIso}T12:30:00Z`,
    },
    {
      id: 'lab-nl-3',
      date: todayIso,
      kcal: 180,
      label: 'Flat white',
      source: 'manual',
      meal_no: null,
      timestamp: `${todayIso}T09:15:00Z`,
    },
  ];
}

/** Nine consecutive logged days ending today — an honest streak the strip
 *  can count without inventing history. */
export function labNutritionDates(todayIso: string): string[] {
  const dates: string[] = [];
  for (let back = 8; back >= 0; back -= 1) dates.push(addDaysIso(todayIso, -back));
  return dates;
}

/** Calories burned today (cardio_log budget rows) — exercises the hero's
 *  "+N burned" budget line. */
export const LAB_CARDIO_BURN = 180;

/** Empty = every meal slot keeps its built-in name. */
export const LAB_MEAL_NAMES: (string | null)[] = [];

export const LAB_SAVED_MEALS: SavedMeal[] = [
  {
    id: 'lab-sm-1',
    name: 'Cut breakfast',
    items: [
      {
        name: 'Oats',
        grams: 80,
        per100: { kcal: 379, p: 13, c: 68, f: 7 },
        source: 'db',
        matched: 'oats',
      },
      {
        name: 'Whey scoop',
        grams: 30,
        per100: { kcal: 400, p: 80, c: 8, f: 7 },
        source: 'db',
        matched: 'whey protein',
      },
    ],
    kcal: 423,
    protein_g: 34,
    carbs_g: 57,
    fat_g: 8,
    created_at: '2026-08-02T08:00:00Z',
  },
  {
    id: 'lab-sm-2',
    name: 'Post-gym bowl',
    items: [
      {
        name: 'Chicken breast',
        grams: 180,
        per100: { kcal: 165, p: 31, c: 0, f: 4 },
        source: 'db',
        matched: 'chicken breast',
      },
      {
        name: 'White rice',
        grams: 200,
        per100: { kcal: 130, p: 2.7, c: 28, f: 0.3 },
        source: 'db',
        matched: 'white rice cooked',
      },
    ],
    kcal: 557,
    protein_g: 61,
    carbs_g: 56,
    fat_g: 8,
    created_at: '2026-08-05T13:00:00Z',
  },
];

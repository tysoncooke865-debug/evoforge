// Relative runtime imports on purpose: the vitest suite loads these fixtures
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).
import {
  dailyTarget,
  type Activity,
  type BodyInputs,
  type GoalTargets,
} from '../../domain/nutrition';

/**
 * THE DUAL-RATE MODEL — the one idea the retired CALCULATOR variant proved.
 *
 * Live `goalTargets` spreads ONE `ratePerWeekKg` into all three legs, so an
 * athlete cutting at 1 kg/wk is quoted a bulk at +1 kg/wk — a rate nobody
 * chose and standard advice warns against. Here the lose leg and the gain
 * leg carry INDEPENDENT rates; maintain ignores both, and each leg keeps
 * dailyTarget's sex floor and rounding by construction (it IS dailyTarget).
 *
 * It lives under fixtures/ rather than beside a variant because the lab
 * athlete's seeded FUEL target is COMPUTED from it — fixture and math cannot
 * disagree, and lab.test.ts makes that structural. A variant may be culled at
 * any time; the fixtures may not depend on one that can vanish.
 *
 * The variant's UI-side helpers (stored-row parsing, the DB range mirror)
 * retired with it: `git show d120681:client/src/lab/variants/fuel/calculator/model.ts`.
 * Promotion folds this into domain/nutrition.ts and updates its pinned
 * symmetric-triple test.
 */

/** The default bulk surplus when a stored row predates the dual-rate model:
 *  0.25 kg/wk (~275 kcal) — the standard lean-bulk figure, deliberately NOT
 *  the athlete's cut rate (mirroring it is the bug this model exists to fix).
 *  Owner-confirmed 2026-08-21. */
export const DEFAULT_GAIN_RATE_KG_PER_WEEK = 0.25;

export interface DualRateInputs extends BodyInputs {
  activity: Activity;
  /** kg per week LOST on the cut leg. */
  rateLossKgPerWeek: number;
  /** kg per week GAINED on the bulk leg. */
  rateGainKgPerWeek: number;
}

/** The asymmetric triple: lose from the cut rate, gain from the bulk rate. */
export function dualRateTargets(i: DualRateInputs): GoalTargets {
  const base = {
    sex: i.sex,
    weightKg: i.weightKg,
    heightCm: i.heightCm,
    age: i.age,
    activity: i.activity,
  };
  return {
    lose: dailyTarget({ ...base, goal: 'lose', ratePerWeekKg: i.rateLossKgPerWeek }),
    maintain: dailyTarget({ ...base, goal: 'maintain', ratePerWeekKg: 0 }),
    gain: dailyTarget({ ...base, goal: 'gain', ratePerWeekKg: i.rateGainKgPerWeek }),
  };
}

// Relative runtime imports on purpose: the vitest suite drives this model
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).
import {
  ACTIVITY_FACTORS,
  dailyTarget,
  intakeError,
  MAX_RATE_KG_PER_WEEK,
  type Activity,
  type BodyInputs,
  type GoalTargets,
  type TargetInputs,
} from '../../../../domain/nutrition';
import type { NutritionTargetRow } from '../../../../data/nutrition';

/**
 * THE DUAL-RATE MODEL — the CALCULATOR variant's one real idea.
 *
 * Live `goalTargets` spreads ONE `ratePerWeekKg` into all three legs, so an
 * athlete cutting at 1 kg/wk is quoted a bulk at +1 kg/wk — a rate nobody
 * chose and standard advice warns against. Here the lose leg and the gain
 * leg carry INDEPENDENT rates; maintain ignores both, and each leg keeps
 * dailyTarget's sex floor and rounding by construction (it IS dailyTarget).
 *
 * Storage: `rateGainKgPerWeek` rides the target row's `inputs` jsonb next to
 * the existing `ratePerWeekKg` (the cut rate) — no migration, and rows saved
 * before this variant simply lack the key. Promotion folds all of this into
 * domain/nutrition.ts and updates its pinned symmetric-triple test.
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

/** One reason the dual inputs are unusable, or null — intakeError run per
 *  rated leg, so BOTH rates get the 0–MAX range check and the body fields
 *  are checked exactly once with the live wording. */
export function dualIntakeError(i: DualRateInputs): string | null {
  const base = {
    sex: i.sex,
    weightKg: i.weightKg,
    heightCm: i.heightCm,
    age: i.age,
    activity: i.activity,
  };
  const loseLeg = intakeError({ ...base, goal: 'lose', ratePerWeekKg: i.rateLossKgPerWeek });
  if (loseLeg !== null) return loseLeg;
  return intakeError({ ...base, goal: 'gain', ratePerWeekKg: i.rateGainKgPerWeek });
}

/**
 * A stored inputs blob → DualRateInputs, or null when the row cannot carry
 * the model (manual targets store `{}`; garbage stays garbage — a rate is
 * never invented for an unusable row). A row from BEFORE this model, valid
 * but without `rateGainKgPerWeek`, gets the 0.25 default — that is the one
 * value this function is allowed to supply.
 */
export function dualRateInputsFromStored(
  inputs: (Partial<TargetInputs> & { rateGainKgPerWeek?: unknown }) | null | undefined
): DualRateInputs | null {
  if (!inputs) return null;
  if (inputs.sex !== 'male' && inputs.sex !== 'female') return null;
  if (typeof inputs.activity !== 'string' || !(inputs.activity in ACTIVITY_FACTORS)) return null;
  const storedGain = Number(inputs.rateGainKgPerWeek);
  const candidate: DualRateInputs = {
    sex: inputs.sex,
    weightKg: Number(inputs.weightKg),
    heightCm: Number(inputs.heightCm),
    age: Number(inputs.age),
    activity: inputs.activity,
    rateLossKgPerWeek: Number(inputs.ratePerWeekKg),
    rateGainKgPerWeek:
      Number.isFinite(storedGain) && storedGain >= 0 && storedGain <= MAX_RATE_KG_PER_WEEK
        ? storedGain
        : DEFAULT_GAIN_RATE_KG_PER_WEEK,
  };
  return dualIntakeError(candidate) === null ? candidate : null;
}

/** The switch-path resolver: the stored triple columns are the truth when
 *  present (081's contract — switching goals never re-runs a model), else
 *  derive asymmetrically from the stored inputs. */
export function dualTripleFromStored(row: NutritionTargetRow | null | undefined): GoalTargets | null {
  if (!row) return null;
  if (row.kcal_lose != null && row.kcal_maintain != null && row.kcal_gain != null) {
    return { lose: row.kcal_lose, maintain: row.kcal_maintain, gain: row.kcal_gain };
  }
  const inputs = dualRateInputsFromStored(row.inputs);
  return inputs === null ? null : dualRateTargets(inputs);
}

/** Mirror of 037's daily_kcal CHECK — a leg outside this range cannot be
 *  APPLIED, and the sheet says so instead of letting Postgres refuse. */
export function legWithinDb(kcal: number): boolean {
  return Number.isFinite(kcal) && kcal >= 1000 && kcal <= 6000;
}

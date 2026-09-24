// Relative runtime imports on purpose: the vitest suite drives this model
// and the test runner resolves no '@/' alias (the domain/ and fixtures rule).
import {
  ACTIVITY_FACTORS,
  INTAKE_LIMITS,
  MAX_RATE_KG_PER_WEEK,
  intakeError,
  type Goal,
  type GoalTargets,
  type TargetInputs,
} from '../../../../domain/nutrition';
import type { NutritionTargetRow } from '../../../../data/nutrition';
import {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  dualRateTargets,
  type DualRateInputs,
} from '../../../fixtures/nutrition-model';

/**
 * COUNTERWEIGHT's model — the retired CALCULATOR variant's UI-side helpers
 * (`git show d120681:client/src/lab/variants/fuel/calculator/model.ts`),
 * resurrected on top of the dual-rate core that survived the cull in
 * fixtures/nutrition-model.ts, plus the two SAVE PAYLOAD builders this
 * batch adds so the exact mutation shape is pinned by tests rather than
 * assembled inline in a component.
 *
 * Storage: `rateGainKgPerWeek` rides the target row's `inputs` jsonb next to
 * the existing `ratePerWeekKg` (the cut rate) — no migration, and rows saved
 * before this model simply lack the key. Promotion folds this into
 * domain/nutrition.ts and updates its pinned symmetric-triple test.
 */

export { DEFAULT_GAIN_RATE_KG_PER_WEEK, dualRateTargets };
export type { DualRateInputs };

/** The cut-rate seed when no stored row carries one — the moderate-cut
 *  convention, NOT tied to the bulk default (independence is the point). */
export const DEFAULT_LOSS_RATE_KG_PER_WEEK = 0.5;

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

/** The display-path resolver: the stored triple columns are the truth when
 *  present (081's contract), else derive asymmetrically from the stored
 *  inputs. Null = unknowable (manual target) — the maintain box shows it. */
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

/** Exactly what useSaveTarget.mutate takes — built here so tests pin the
 *  shape the DB receives instead of a component assembling it ad hoc. */
export interface SaveTargetPayload {
  effectiveFrom: string;
  dailyKcal: number;
  goal: Goal;
  inputs: Partial<TargetInputs> & { rateGainKgPerWeek?: number };
  triple: GoalTargets | null;
}

/**
 * The RECALCULATE payload: one upsert carrying the chosen goal's leg as
 * daily_kcal, the full input audit trail (BOTH rates ride the jsonb —
 * `ratePerWeekKg` stays the cut rate so live readers keep working), and the
 * asymmetric triple for the columns. Null when the inputs are unusable or
 * the chosen leg falls outside the DB's 1,000–6,000 CHECK.
 */
export function buildSavePayload(
  i: DualRateInputs,
  goal: Goal,
  todayIso: string
): SaveTargetPayload | null {
  if (dualIntakeError(i) !== null) return null;
  const triple = dualRateTargets(i);
  if (!legWithinDb(triple[goal])) return null;
  return {
    effectiveFrom: todayIso,
    dailyKcal: triple[goal],
    goal,
    inputs: {
      sex: i.sex,
      weightKg: i.weightKg,
      heightCm: i.heightCm,
      age: i.age,
      activity: i.activity,
      goal,
      ratePerWeekKg: i.rateLossKgPerWeek,
      rateGainKgPerWeek: i.rateGainKgPerWeek,
    },
    triple,
  };
}

/**
 * The SET MANUALLY payload: a hand-typed number with no goal question asked —
 * the in-force goal carries forward (a manual number changes the budget, not
 * the plan), defaulting to maintain when no target exists yet. `triple: null`
 * EXPLICITLY clears the stored columns (a manual number carries no model),
 * and the ONE input that survives is a plausible stored weightKg, so
 * macroTargetsFor keeps its 2 g/kg protein target instead of silently
 * degrading to the 150 g fallback. Null when the number fails the DB range.
 */
export function manualSavePayload(
  kcal: number | null,
  inForceGoal: Goal | null | undefined,
  storedInputs: Partial<TargetInputs> | null | undefined,
  todayIso: string
): SaveTargetPayload | null {
  if (kcal === null) return null;
  const rounded = Math.round(kcal);
  if (!legWithinDb(rounded)) return null;
  const w = Number(storedInputs?.weightKg);
  const carryWeight =
    Number.isFinite(w) && w >= INTAKE_LIMITS.weightKg.min && w <= INTAKE_LIMITS.weightKg.max;
  return {
    effectiveFrom: todayIso,
    dailyKcal: rounded,
    goal: inForceGoal ?? 'maintain',
    inputs: carryWeight ? { weightKg: w } : {},
    triple: null,
  };
}

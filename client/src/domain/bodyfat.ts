/** Port of the pure functions of `domain/bodyfat.py`. */

import { pyFloat } from './py';

/** US Navy male body fat estimate. Uses inches internally. Null for invalid inputs. */
export function navyBodyFatMale(
  heightCm: unknown,
  waistCm: unknown,
  neckCm: unknown
): number | null {
  const h = pyFloat(heightCm);
  const w = pyFloat(waistCm);
  const n = pyFloat(neckCm);
  if (h === null || w === null || n === null) {
    return null;
  }
  const heightIn = h / 2.54;
  const waistIn = w / 2.54;
  const neckIn = n / 2.54;
  if (heightIn <= 0 || neckIn <= 0 || waistIn <= neckIn) {
    return null;
  }
  const result = 86.01 * Math.log10(waistIn - neckIn) - 70.041 * Math.log10(heightIn) + 36.76;
  // Python's `except Exception` also swallows math domain errors; log10 of a
  // negative is NaN here rather than a raise, so map non-finite to null.
  return Number.isFinite(result) ? result : null;
}

export type BodyfatOutputs = [
  fatMass: number | null,
  leanMass: number | null,
  targetWeight: number | null,
  fatToLose: number | null,
];

export function bodyfatOutputs(
  weightKg: unknown,
  bfPercent: unknown,
  targetBf: unknown = 10.0
): BodyfatOutputs {
  const weight = pyFloat(weightKg);
  const bf = pyFloat(bfPercent);
  const target = pyFloat(targetBf);
  if (weight === null || bf === null || target === null) {
    return [null, null, null, null];
  }
  if (weight <= 0 || bf <= 0 || target <= 0 || target >= 100) {
    return [null, null, null, null];
  }
  const fatMass = weight * (bf / 100);
  const leanMass = weight - fatMass;
  const targetWeight = leanMass / (1 - target / 100);
  const fatToLose = Math.max(weight - targetWeight, 0);
  return [fatMass, leanMass, targetWeight, fatToLose];
}

/** "80.4kg" or "No data". Python's f"{v:.1f}" and toFixed(1) agree on doubles. */
export function safeKg(value: unknown): string {
  if (value === null || value === undefined) {
    return 'No data';
  }
  const v = pyFloat(value);
  if (v === null || !Number.isFinite(v)) {
    return 'No data';
  }
  return `${v.toFixed(1)}kg`;
}

/** Port of the pure helpers of `domain/physique_ratings.py`. */

import { pyFloat } from './py';

/** Linear 0-100 score of `value` between `low` and `high`. Never throws. */
export function score0100(value: unknown, low: number, high: number): number {
  const v = pyFloat(value);
  if (v === null || Number.isNaN(v)) {
    return 0; // float() raised, or NaN arithmetic below would poison the clamp
  }
  if (high <= low) {
    return 0;
  }
  const scaled = ((v - low) / (high - low)) * 100;
  const clamped = Math.max(0, Math.min(scaled, 100));
  return Number.isFinite(clamped) ? Math.trunc(clamped) : 0;
}

/** Python safe_num: default for None/unparseable/NaN/Inf, else the float. */
export function safeNum(value: unknown, defaultValue = 0.0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const v = pyFloat(value);
  if (v === null || Number.isNaN(v) || !Number.isFinite(v)) {
    return defaultValue;
  }
  return v;
}

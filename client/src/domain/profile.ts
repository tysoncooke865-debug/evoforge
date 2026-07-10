/** Port of the pure part of `domain/profile.py`. */

import { RANK_TIERS } from './catalogs';
import { pyInt } from './py';

export function rankName(level: unknown): string {
  const lv = pyInt(level);
  if (lv === null) {
    throw new TypeError(`rank_name: unparseable level ${String(level)}`);
  }
  for (const [threshold, name] of RANK_TIERS) {
    if (lv >= threshold) {
      return name;
    }
  }
  return RANK_TIERS[RANK_TIERS.length - 1][1];
}

export const MAX_RANK_LEVEL = 100;

/** `(low, high, name)` for every rank, ascending. Derived, never restated. */
export function rankLadder(): [number, number, string][] {
  const ascending = [...RANK_TIERS].sort((a, b) => a[0] - b[0]);
  return ascending.map(([low, name], index) => {
    const high = index + 1 < ascending.length ? ascending[index + 1][0] - 1 : MAX_RANK_LEVEL;
    return [low, high, name];
  });
}

/**
 * Onboarding's placement formula: where a new athlete starts on the curve.
 * Band edges and point values are a contract with the Python side, pinned by
 * the calculate_starting_level goldens. Self-ratings add through int()
 * truncation; the sum clamps to 1..100.
 */
export function calculateStartingLevel(
  benchE1rm: number,
  squatE1rm: number,
  trainingYears: number,
  physiqueScore: number,
  leannessScore: number
): number {
  let level = 1;

  if (benchE1rm >= 120) level += 28;
  else if (benchE1rm >= 100) level += 22;
  else if (benchE1rm >= 90) level += 18;
  else if (benchE1rm >= 80) level += 14;
  else if (benchE1rm >= 60) level += 8;

  if (squatE1rm >= 180) level += 18;
  else if (squatE1rm >= 140) level += 14;
  else if (squatE1rm >= 100) level += 9;

  if (trainingYears >= 5) level += 16;
  else if (trainingYears >= 3) level += 12;
  else if (trainingYears >= 1) level += 7;

  level += Math.trunc(physiqueScore);
  level += Math.trunc(leannessScore);

  return Math.max(1, Math.min(Math.trunc(level), 100));
}

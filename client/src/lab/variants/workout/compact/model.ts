// Relative imports on purpose: this module is pure (no React, no RN) so the
// vitest suite can pin it without dragging the component graph into node —
// the same convention domain/ modules follow.
import type { LastPerformance } from '../../../../domain/last-performance';
import { displayWeight, type WeightUnit } from '../../../../domain/units';

/**
 * COMPACT variant — the pure decisions behind the redesigned card.
 *
 * The live page has no per-set cursor: "current" exists only at card level
 * (isNext). The redesign's three-state LOG button needs one — exactly one
 * set page-wide may carry the strongest glow (req 13/20: the brightest cyan
 * element identifies the next action).
 */

/** Lowest unlogged set number in 1..targetSets, or null when all banked.
 *  Skips holes: logged [1,3] of 3 → the answer is 2. */
export function activeSetNo(loggedSetNos: readonly number[], targetSets: number): number | null {
  const logged = new Set(loggedSetNos);
  for (let setNo = 1; setNo <= targetSets; setNo++) {
    if (!logged.has(setNo)) return setNo;
  }
  return null;
}

export type LogState = 'next' | 'idle' | 'logged';

/** 'next' at most once per exercise, and only in the isNext exercise —
 *  so at most once per PAGE, because the page has one isNext. */
export function logButtonState(
  setNo: number,
  loggedSetNos: readonly number[],
  targetSets: number,
  isNextExercise: boolean
): LogState {
  if (loggedSetNos.includes(setNo)) return 'logged';
  if (isNextExercise && activeSetNo(loggedSetNos, targetSets) === setNo) return 'next';
  return 'idle';
}

const LAST_SEGMENT_CAP = 4;

/** 'LAST · 14 KG × 12 · 14 KG × 10' from the most recent prior session.
 *  Weights arrive in kg (LastPerformance contract) and are painted in the
 *  exercise's unit lens. Capped so a 10-set history cannot blow the row. */
export function lastSummary(last: LastPerformance | null, unit: WeightUnit): string | null {
  if (!last || last.sets.length === 0) return null;
  const segments = last.sets
    .slice(0, LAST_SEGMENT_CAP)
    .map((s) => `${displayWeight(s.weight, unit).toUpperCase()} ${unit.toUpperCase()} × ${s.reps}`);
  const suffix = last.sets.length > LAST_SEGMENT_CAP ? ' · …' : '';
  return segments.join(' · ') + suffix;
}

/** '01', '02', … — the two-digit exercise badge (1-based position). */
export function badgeText(position: number): string {
  return String(Math.max(0, Math.trunc(position))).padStart(2, '0');
}

/** '0/2 SETS' — the collapsed row's progress fragment. */
export function collapsedSummary(done: number, target: number): string {
  return `${done}/${target} SETS`;
}

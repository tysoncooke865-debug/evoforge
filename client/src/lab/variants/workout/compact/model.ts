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

/** '01', '02', … — the two-digit exercise badge (1-based position). */
export function badgeText(position: number): string {
  return String(Math.max(0, Math.trunc(position))).padStart(2, '0');
}

/** '0/2 SETS' — the collapsed row's progress fragment. */
export function collapsedSummary(done: number, target: number): string {
  return `${done}/${target} SETS`;
}

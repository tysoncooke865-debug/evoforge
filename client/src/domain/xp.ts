/**
 * The XP contract. One curve, one place. Line-by-line port of `domain/xp.py`,
 * which remains the source of truth until cutover -- if the two ever disagree,
 * the parity fixtures in contracts/fixtures/ decide, and the Python side wins.
 *
 * THE CURVE
 *     Advancing FROM level L costs `500 + (L-1) * 25` XP.
 *     L1 -> 2 costs 500. L42 -> 43 costs 1525. L99 -> 100 costs 2950.
 *
 * EARNING
 *     A working set is 10 XP, a cardio minute is 2. `activityXp()` is the only
 *     place XP is minted. A character starts AT `base_level` with 0 XP toward
 *     the next, not at level 1.
 *
 * TWO SOURCES, ONE CURVE
 *     DERIVED recounts the logs; LEDGER sums xp_events server-side.
 *     `resolveXp()` picks what to DISPLAY: the ledger wins only at-or-ahead of
 *     derived, and floors at derived -- a failed grant must never drag a user
 *     below what they earned. Ranking is different: a leaderboard reads the
 *     ledger and refuses accounts with non-zero drift. Do not rank on this.
 */

import { pyFloat, pyInt } from './py';

export const XP_PER_SET = 10;
export const XP_PER_CARDIO_MINUTE = 2;

export const FIRST_LEVEL_COST = 500;
export const LEVEL_COST_STEP = 25;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 100;

function clampLevel(level: unknown): number {
  const n = pyInt(level);
  if (n === null) {
    return MIN_LEVEL;
  }
  return Math.max(MIN_LEVEL, Math.min(n, MAX_LEVEL));
}

/** Total XP earned from logged activity. The only place XP is minted. */
export function activityXp(totalSets: unknown = 0, cardioMinutes: unknown = 0): number {
  const sets = Math.max(0, pyInt(totalSets) ?? 0);
  const minutes = Math.max(0.0, pyFloat(cardioMinutes) ?? 0.0);
  return Math.trunc(sets * XP_PER_SET + minutes * XP_PER_CARDIO_MINUTE);
}

/**
 * XP needed to advance FROM `level` to `level + 1`.
 *
 * At MAX_LEVEL there is no next level, but callers divide by this to draw a
 * progress bar, so it must never be 0. Returns the cost of the final level.
 */
export function xpForLevel(level: unknown): number {
  let lv = clampLevel(level);
  if (lv >= MAX_LEVEL) {
    lv = MAX_LEVEL - 1;
  }
  return FIRST_LEVEL_COST + (lv - 1) * LEVEL_COST_STEP;
}

/** Kept for the name used across the UI. Same number as `xpForLevel`. */
export function xpToNextLevel(level: unknown): number {
  return xpForLevel(level);
}

/** Total XP to get from `fromLevel` all the way to `toLevel`. */
export function cumulativeXp(fromLevel: unknown, toLevel: unknown): number {
  const from = clampLevel(fromLevel);
  const to = clampLevel(toLevel);
  let total = 0;
  for (let lv = from; lv < to; lv++) {
    total += xpForLevel(lv);
  }
  return total;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
}

/**
 * Resolve (level, xp_into_level, xp_needed) from a base level and total XP.
 *
 * `xpIntoLevel < xpNeeded` always, below MAX_LEVEL -- so the bar fills to
 * exactly 100% at the instant the level is granted, and never past it. At
 * MAX_LEVEL the bar pins full: `xpIntoLevel === xpNeeded`.
 */
export function levelAndProgress(baseLevel: unknown, totalXp: unknown): LevelProgress {
  let level = clampLevel(baseLevel);
  let remaining = Math.max(0, pyInt(totalXp) ?? 0);

  while (level < MAX_LEVEL) {
    const cost = xpForLevel(level);
    if (remaining < cost) {
      return { level, xpIntoLevel: remaining, xpNeeded: cost };
    }
    remaining -= cost;
    level += 1;
  }

  const needed = xpForLevel(MAX_LEVEL);
  return { level: MAX_LEVEL, xpIntoLevel: needed, xpNeeded: needed };
}

/**
 * The same curve as `levelAndProgress`, fed the xp_events sum. A named
 * function so the ledger path is greppable: if a ledger sum and a derived
 * total are equal they MUST produce the identical level, or migrations/002
 * STEP 4 reconciliation means nothing.
 */
export function levelFromLedger(baseLevel: unknown, ledgerSum: unknown): LevelProgress {
  return levelAndProgress(baseLevel, ledgerSum);
}

export interface ResolvedXp {
  xp: number;
  source: string;
  drift: number;
}

/**
 * Choose which XP total to DISPLAY, and report any disagreement.
 *
 *   * ledger null/unreadable -- migrations/002 not applied or the read failed.
 *     Use derived; nothing to compare, drift 0.
 *   * ledger < derived -- grants are MISSING. Use derived, report the negative.
 *   * otherwise -- the ledger is the source of truth.
 *
 * THE LEDGER FLOORS AT THE DERIVED TOTAL; IT NEVER DRAGS A USER BELOW IT.
 * A single failed grant once turned a real 10 XP into a displayed 0, and RLS
 * makes the ledger append-only, so the app could not repair it. Losing XP a
 * user earned is worse than briefly over-crediting an unreconciled one.
 */
export function resolveXp(derivedXp: unknown, ledgerXp: unknown): ResolvedXp {
  const derived = Math.max(0, pyInt(derivedXp) ?? 0);

  if (ledgerXp === null || ledgerXp === undefined) {
    return { xp: derived, source: 'derived', drift: 0 };
  }

  const ledgerParsed = pyInt(ledgerXp);
  if (ledgerParsed === null) {
    return { xp: derived, source: 'derived', drift: 0 };
  }
  const ledger = Math.max(0, ledgerParsed);

  const drift = ledger - derived;
  if (drift < 0) {
    // Grants are missing. Show what they earned, and say the ledger is behind.
    return { xp: derived, source: 'derived (ledger behind)', drift };
  }

  return { xp: ledger, source: 'ledger', drift };
}

/** 0.0 - 100.0, never NaN, never above 100, never dividing by zero. */
export function progressPercent(xpIntoLevel: unknown, xpNeeded: unknown): number {
  const needed = pyInt(xpNeeded);
  const into = pyInt(xpIntoLevel);
  if (needed === null || into === null) {
    return 0.0;
  }
  if (needed <= 0) {
    return 100.0;
  }
  return Math.max(0.0, Math.min(100.0, (into / needed) * 100.0));
}

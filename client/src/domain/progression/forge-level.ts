/**
 * PROGRESSION_OVERHAUL — the Forge Level curve (spec §20), THE one place
 * it exists in TypeScript. migrations/023's forge_level_for_xp() is its
 * SQL twin: the vitest fixture table below pins them to each other — a
 * curve change edits BOTH files and the fixture in one commit, or CI
 * refuses.
 *
 * Forge Level starts at 1, never decreases (the ledger is append-only and
 * the cache takes greatest()), and cannot be purchased (the 023 guard only
 * mints evidence-backed kinds).
 */

export const FORGE_XP_BASE = 250;
export const FORGE_XP_EXPONENT = 1.65;

/** Total lifetime XP required to HOLD `level`. Level 1 is free. */
export function totalXpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(FORGE_XP_BASE * Math.pow(level - 1, FORGE_XP_EXPONENT));
}

export interface ForgeProgress {
  level: number;
  lifetimeXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  percentToNext: number;
}

/** Derive everything a screen needs from lifetime XP. */
export function forgeProgressFor(lifetimeXp: number): ForgeProgress {
  const xp = Number.isFinite(lifetimeXp) ? Math.max(0, Math.floor(lifetimeXp)) : 0;
  let level = 1;
  // The SQL twin caps at 500 the same way — an unreachable runaway stop.
  while (totalXpRequiredForLevel(level + 1) <= xp && level < 500) level += 1;
  const floor = totalXpRequiredForLevel(level);
  const ceil = totalXpRequiredForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  return {
    level,
    lifetimeXp: xp,
    xpIntoLevel: xp - floor,
    xpForNextLevel: ceil - floor,
    percentToNext: Math.min(100, Math.max(0, ((xp - floor) / span) * 100)),
  };
}

/**
 * THE SQL PARITY FIXTURE — sampled values both implementations must agree
 * on. forge-level.test.ts asserts the TS side; the falsification run for
 * migration 023 checked the SQL side against these same numbers.
 */
export const FORGE_CURVE_FIXTURE: readonly (readonly [xp: number, level: number])[] = [
  // Verified against BOTH implementations on 2026-07-16 (SQL via the
  // management API, TS via node) — do not hand-edit, re-verify.
  [0, 1],
  [249, 1],
  [250, 2],
  [784, 2],
  [785, 3],
  [1531, 3],
  [1532, 4],
  [10000, 10],
  [100000, 38],
  [1000000, 153],
];

/**
 * Arena Rating tier resolution (Milestone 7; presented as "Arena Rating" in
 * all UI copy since P11 — audit MEDIUM #6 — to avoid collision with
 * EvoForge's Rival Rank). Arena Rating represents competitive battle
 * performance only — fully separate from Evo Rating (physique) and Forge
 * Level (consistency), Arena-local and cosmetic: it never grants Forge XP
 * or changes any EvoForge progression.
 */
import type { BalanceConfig } from '../../content/balance';

/** Battle modes that can finish with an outcome (mirrors the battle store). */
export type RatedBattleMode = 'standard' | 'ranked' | 'tutorial' | 'ghost' | 'gym-war' | 'dev-stress';

/**
 * Arena Rating movement for a finished battle — the single source both the
 * battle store's result recording and the result overlay display use (P11),
 * so the number shown IS the number applied.
 *  - tutorial: 0 (a guided lesson never moves the ladder)
 *  - ghost: 0 (offline; the store never records ghosts to the provider)
 *  - everything else: the BALANCE.rank table.
 */
export function ratingDeltaForOutcome(
  mode: RatedBattleMode,
  winner: 'player' | 'opponent' | 'draw',
  balance: BalanceConfig
): number {
  if (mode === 'tutorial' || mode === 'ghost' || mode === 'dev-stress') return 0;
  return winner === 'player'
    ? balance.rank.pointsPerWin
    : winner === 'opponent'
      ? balance.rank.pointsPerLoss
      : balance.rank.pointsPerDraw;
}

/** The result overlay's Arena Rating line (P11) — pure so it is testable
 *  headless; tutorial/ghost battles say explicitly that nothing moved. */
export function ratingLineFor(mode: RatedBattleMode, ratingDelta: number): string {
  if (mode === 'tutorial') return 'Tutorial — Arena Rating unchanged';
  if (mode === 'ghost') return 'Ghost battle — Arena Rating unchanged';
  if (mode === 'dev-stress') return 'Stress battle — Arena Rating unchanged';
  const sign = ratingDelta > 0 ? '+' : '';
  return `Arena Rating ${sign}${ratingDelta}`;
}

export interface RankTierInfo {
  name: string;
  minPoints: number;
  /** Next tier, or null at the top. */
  next: { name: string; minPoints: number } | null;
  /** Progress toward the next tier, 0..1 (1 at the top tier). */
  progress: number;
}

export function rankTierForPoints(points: number, balance: BalanceConfig): RankTierInfo {
  const tiers = balance.rank.tiers;
  const safePoints = Number.isFinite(points) ? Math.max(0, points) : 0;
  let current = tiers[0];
  let next: { name: string; minPoints: number } | null = null;
  for (let i = 0; i < tiers.length; i++) {
    if (safePoints >= tiers[i].minPoints) {
      current = tiers[i];
      next = i + 1 < tiers.length ? tiers[i + 1] : null;
    }
  }
  const progress = next
    ? Math.min(
        1,
        (safePoints - current.minPoints) / Math.max(1, next.minPoints - current.minPoints)
      )
    : 1;
  return { name: current.name, minPoints: current.minPoints, next, progress };
}

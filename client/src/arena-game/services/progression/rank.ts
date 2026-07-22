/**
 * Rank tier resolution (Milestone 7). Rank represents competitive battle
 * performance only — fully separate from Evo Rating (physique) and Forge
 * Level (consistency).
 */
import type { BalanceConfig } from '../../content/balance';

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

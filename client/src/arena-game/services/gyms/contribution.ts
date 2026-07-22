/**
 * Gym War contribution stats (M9) — pure helpers applied to the save's gym
 * block after a gym-war battle. The contribution score is a simple
 * deterministic damage PROXY (per-war participation + win bonus, tunables in
 * BALANCE.gym), not real damage attribution — see KNOWN_ISSUES.
 */
import type { BalanceConfig } from '../../content/balance';
import type { GymMemberStats, GymSaveState } from '../persistence/save';

/**
 * Returns a NEW gym state with one war's results applied: every fielded
 * member gains an appearance (+a win on victory) and contribution points;
 * warsPlayed/warsWon advance. Never mutates the input.
 */
export function applyGymWarResult(
  gym: GymSaveState,
  fieldedMemberIds: readonly string[],
  won: boolean,
  balance: BalanceConfig
): GymSaveState {
  const championStats: Record<string, GymMemberStats> = { ...gym.championStats };
  const contribution =
    balance.gym.contributionPerWar + (won ? balance.gym.contributionWinBonus : 0);
  for (const memberId of fieldedMemberIds) {
    const prev = championStats[memberId] ?? { appearances: 0, wins: 0, warContribution: 0 };
    championStats[memberId] = {
      appearances: prev.appearances + 1,
      wins: prev.wins + (won ? 1 : 0),
      warContribution: prev.warContribution + contribution,
    };
  }
  return {
    ...gym,
    championStats,
    warsPlayed: gym.warsPlayed + 1,
    warsWon: gym.warsWon + (won ? 1 : 0),
  };
}

/** Member id with the highest warContribution (MVP); null when no stats yet.
 *  Ties break by first-seen key order (deterministic for our updates). */
export function gymMvpMemberId(gym: GymSaveState): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [id, stats] of Object.entries(gym.championStats)) {
    if (stats.warContribution > bestScore) {
      best = id;
      bestScore = stats.warContribution;
    }
  }
  return best;
}

/** Member id with the most appearances (most-used); null when no stats yet. */
export function gymMostUsedMemberId(gym: GymSaveState): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [id, stats] of Object.entries(gym.championStats)) {
    if (stats.appearances > bestScore) {
      best = id;
      bestScore = stats.appearances;
    }
  }
  return best;
}

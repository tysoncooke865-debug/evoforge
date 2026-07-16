import { GYMS } from './gyms';
import type { BattleMode, BattleRewards, GymDefinition } from './types';

/**
 * BATTLE REWARDS — pure calculators. The engine/service decides WHEN to grant;
 * this decides HOW MUCH, and enforces anti-farm rules:
 *   - Training: no farmable currency (a token XP trickle only).
 *   - Rival: modest coins + XP.
 *   - Gym: full reward on FIRST clear (+bonus), reduced on repeats.
 */

export function trainingReward(): BattleRewards {
  return { coins: 0, forgeXp: 5 };
}

export function rivalReward(won: boolean): BattleRewards {
  return won ? { coins: 20, forgeXp: 25 } : { coins: 5, forgeXp: 8 };
}

export function gymReward(gym: GymDefinition, won: boolean, alreadyCleared: boolean): BattleRewards {
  if (!won) return { coins: 0, forgeXp: 6 };
  if (!alreadyCleared) {
    return {
      coins: gym.reward.coins,
      forgeXp: gym.reward.forgeXp,
      badgeId: gym.badgeId,
      firstClear: true,
    };
  }
  // Repeat clear — reduced, no repeat badge, no first-clear bonus.
  return { coins: Math.round(gym.reward.coins * 0.25), forgeXp: Math.round(gym.reward.forgeXp * 0.4) };
}

export function rewardsFor(
  mode: BattleMode,
  won: boolean,
  ctx: { gymId?: string; gymAlreadyCleared?: boolean }
): BattleRewards {
  if (mode === 'versus' || mode === 'challenge') return { coins: 0, forgeXp: 0 }; // casual friend duels — bragging rights only
  if (mode === 'training') return trainingReward();
  if (mode === 'rival') return rivalReward(won);
  const gym = GYMS.find((g) => g.id === ctx.gymId);
  if (!gym) return { coins: 0, forgeXp: 0 };
  return gymReward(gym, won, ctx.gymAlreadyCleared ?? false);
}

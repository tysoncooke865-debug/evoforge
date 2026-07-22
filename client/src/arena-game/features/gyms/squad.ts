/**
 * Gym squads (M9) — pure builders that turn gym member data (obtained by the
 * SCREENS through the EvoForgePlayerProvider boundary) into engine
 * BattleTeamConfig squads and display metadata.
 *
 * Fitness build rule ('simplified fitness-derived build'): a borrowed
 * member's champion is their Avatar Path's champion
 * (getChampionByPath(member.fitness.avatarPath)) and its scaling is
 * computeFitnessScaling over the member's own sub-ratings — the same capped
 * mapping the player's captain uses. Borrowing is a PURE READ: nothing here
 * mutates the owning member's data (asserted by test).
 *
 * Screens must not import services/gyms/gym-data directly; the role helpers
 * here re-export what they need on top of provider data.
 */
import type { BalanceConfig } from '../../content/balance';
import { getChampionByPath } from '../../content/champions';
import {
  ChampionFitnessScaling,
  computeFitnessScaling,
} from '../../game-engine/balance/fitness-scaling';
import type {
  BorrowedChampionConfig,
  TeamSquadConfig,
} from '../../game-engine/simulation/state';
import type { LaneId } from '../../game-engine/types';
import type { FitnessProfile, GymMemberInfo } from '../../integration/evoforge/types';
import {
  computeGymChampions,
  GYM_CHAMPION_ROLES,
  GYM_ROLE_LABELS,
  GymChampionRole,
} from '../../services/gyms/gym-data';

export { GYM_ROLE_LABELS };
export type { GymChampionRole };

/** The champion id a member's fitness profile maps to (their Avatar Path). */
export function memberChampionId(member: GymMemberInfo): string {
  const champion = getChampionByPath(member.fitness.avatarPath);
  if (!champion) {
    throw new Error(`no champion for avatar path '${member.fitness.avatarPath}'`);
  }
  return champion.id;
}

/** Capped fitness scaling from a member's sub-ratings (pure read). */
export function memberScaling(
  fitness: FitnessProfile,
  balance: BalanceConfig
): ChampionFitnessScaling {
  return computeFitnessScaling(
    {
      strength: fitness.strengthRating,
      cardio: fitness.cardioRating,
      muscularity: fitness.muscularityRating,
      leanness: fitness.leannessRating,
      aesthetics: fitness.aestheticsRating,
    },
    balance
  );
}

/**
 * Deterministic lane assignment for borrowed champions: first borrowed
 * covers the lane the captain is NOT in, then alternate — so a full squad
 * always spreads across both lanes.
 */
export function borrowedLane(index: number, captainLane: LaneId): LaneId {
  const other: LaneId = captainLane === 0 ? 1 : 0;
  return index % 2 === 0 ? other : captainLane;
}

/** One borrowed member → engine borrowed-champion config (pure read). */
export function buildBorrowedConfig(
  member: GymMemberInfo,
  lane: LaneId,
  balance: BalanceConfig
): BorrowedChampionConfig {
  return {
    championId: memberChampionId(member),
    scaling: memberScaling(member.fitness, balance),
    lane,
    displayName: member.displayName,
    sourcePlayerId: member.playerId,
  };
}

/**
 * The player's Gym War squad: their own champion + provider fitness scaling
 * as captain, plus up to BALANCE.gym.maxBorrowed selected gym members'
 * champions borrowed. Throws on over-limit selections (the squad builder UI
 * enforces the cap first).
 */
export function buildPlayerSquad(
  captainChampionId: string,
  captainScaling: ChampionFitnessScaling,
  borrowedMembers: readonly GymMemberInfo[],
  balance: BalanceConfig,
  captainLane: LaneId = 0
): TeamSquadConfig {
  if (borrowedMembers.length > balance.gym.maxBorrowed) {
    throw new Error(
      `too many borrowed members (${borrowedMembers.length} > ${balance.gym.maxBorrowed})`
    );
  }
  return {
    captain: { championId: captainChampionId, scaling: captainScaling },
    borrowed: borrowedMembers.map((member, index) =>
      buildBorrowedConfig(member, borrowedLane(index, captainLane), balance)
    ),
  };
}

/**
 * Champion role titles per member playerId, computed from provider member
 * data via the same computeGymChampions the seeded gym system uses. A member
 * may hold several titles; most members hold none.
 */
export function computeMemberRoles(
  members: readonly GymMemberInfo[]
): Record<string, GymChampionRole[]> {
  const roles: Record<string, GymChampionRole[]> = {};
  if (members.length === 0) return roles;
  const champions = computeGymChampions({
    gymId: 'roster',
    name: 'roster',
    members: members.map((m) => ({
      playerId: m.playerId,
      displayName: m.displayName,
      fitness: m.fitness,
    })),
  });
  for (const role of GYM_CHAMPION_ROLES) {
    const holder = champions[role];
    (roles[holder.playerId] ??= []).push(role);
  }
  return roles;
}

/** Display labels for a member's role titles ('Strength Champion', …). */
export function roleLabelsFor(
  playerId: string,
  roles: Record<string, GymChampionRole[]>
): string[] {
  return (roles[playerId] ?? []).map((role) => GYM_ROLE_LABELS[role]);
}

/**
 * Gym War (M9) — async, local. A Gym War battle is the player's squad vs a
 * seeded enemy gym's auto-squad, driven by the existing opponent AI at the
 * saved difficulty, in battle mode 'gym-war'.
 *
 * Enemy squad rule: the enemy captain is that gym's OVERALL Champion
 * (path-champion + fitness scaling from THEIR profile); its Strength and
 * Cardio Champions fight as borrowed champions (each fitness-scaled from
 * their own profiles). When one member holds several of those titles they
 * are fielded once — a person cannot fight twice (deduped by playerId,
 * deterministic).
 */
import type { BalanceConfig } from '../../content/balance';
import type { TeamSquadConfig } from '../../game-engine/simulation/state';
import type { GymMemberInfo } from '../../integration/evoforge/types';
import {
  borrowedLane,
  buildBorrowedConfig,
  memberChampionId,
  memberScaling,
} from './squad';

/** Roles fielded by an enemy gym, in fixed order: captain first. */
const ENEMY_CAPTAIN_METRIC = (m: GymMemberInfo) => m.fitness.evoRating;
const ENEMY_BORROWED_METRICS: ((m: GymMemberInfo) => number)[] = [
  (m) => m.fitness.strengthRating,
  (m) => m.fitness.cardioRating,
];

function topMember(
  members: readonly GymMemberInfo[],
  metric: (m: GymMemberInfo) => number
): GymMemberInfo {
  let best = members[0];
  let bestScore = -Infinity;
  for (const member of members) {
    const s = metric(member);
    if (s > bestScore) {
      best = member;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Builds the enemy gym's auto-squad from its roster (obtained through the
 * provider boundary). Pure read — never mutates member data. Throws on an
 * empty roster (seeded gyms always have members).
 */
export function buildEnemyGymSquad(
  members: readonly GymMemberInfo[],
  balance: BalanceConfig
): TeamSquadConfig {
  if (members.length === 0) throw new Error('enemy gym has no members');
  const captain = topMember(members, ENEMY_CAPTAIN_METRIC);
  const fielded = new Set<string>([captain.playerId]);
  const borrowed: GymMemberInfo[] = [];
  for (const metric of ENEMY_BORROWED_METRICS) {
    const member = topMember(members, metric);
    if (fielded.has(member.playerId)) continue; // one person fights once
    fielded.add(member.playerId);
    borrowed.push(member);
  }
  const captainLane = 0;
  return {
    captain: {
      championId: memberChampionId(captain),
      scaling: memberScaling(captain.fitness, balance),
    },
    borrowed: borrowed.map((member, index) =>
      buildBorrowedConfig(member, borrowedLane(index, captainLane), balance)
    ),
  };
}

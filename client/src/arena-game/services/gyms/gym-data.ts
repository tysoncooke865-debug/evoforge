/**
 * Seeded gym data (Milestone 9 foundation). The standalone beta simulates
 * gyms locally: every gym, member and fitness profile is generated
 * deterministically from string seeds, so the same gym always has the same
 * roster — and gym data flows to screens through the provider boundary, not
 * from here directly.
 */
import { SeededRng, seedFromString } from '../../game-engine/random/rng';
import { ALL_AVATAR_PATHS } from '../../game-engine/types';
import type { FitnessProfile, GymProfile } from '../../integration/evoforge/types';

export interface GymMember {
  playerId: string;
  displayName: string;
  fitness: FitnessProfile;
}

export interface GymData {
  gymId: string;
  name: string;
  members: GymMember[];
}

/** Champion positions on a gym roster. */
export type GymChampionRole =
  | 'strength'
  | 'cardio'
  | 'aesthetic'
  | 'overall'
  | 'consistency'
  | 'rising';

export const GYM_CHAMPION_ROLES: readonly GymChampionRole[] = [
  'strength',
  'cardio',
  'aesthetic',
  'overall',
  'consistency',
  'rising',
];

export const GYM_ROLE_LABELS: Record<GymChampionRole, string> = {
  strength: 'Strength Champion',
  cardio: 'Cardio Champion',
  aesthetic: 'Aesthetic Champion',
  overall: 'Overall Champion',
  consistency: 'Consistency Champion',
  rising: 'Rising Champion',
};

const FIRST_NAMES = [
  'Aria', 'Blake', 'Casey', 'Dev', 'Emery', 'Finn', 'Gia', 'Harper',
  'Indy', 'Jules', 'Kai', 'Lena', 'Marlow', 'Nico', 'Onyx', 'Pia',
  'Quinn', 'Reese', 'Sasha', 'Tate',
];
const LAST_NAMES = [
  'Steele', 'Volt', 'Iron', 'Cruz', 'Stone', 'Blaze', 'Frost', 'Vega',
  'Knight', 'Storm', 'Rhodes', 'Fox', 'Grayson', 'Pierce', 'Ash', 'Wilder',
];

/** The seeded gyms available in the beta. */
export const SEED_GYM_IDS = ['forge-district', 'neon-iron-club', 'apex-performance'] as const;

const GYM_NAMES: Record<string, string> = {
  'forge-district': 'Forge District Gym',
  'neon-iron-club': 'Neon Iron Club',
  'apex-performance': 'Apex Performance Lab',
};

function generateMember(gymId: string, index: number): GymMember {
  const playerId = `${gymId}-member-${index}`;
  const rng = new SeededRng(seedFromString(playerId));
  const displayName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
  const rating = () => rng.nextInt(25, 95);
  const fitness: FitnessProfile = {
    playerId,
    strengthRating: rating(),
    cardioRating: rating(),
    muscularityRating: rating(),
    leannessRating: rating(),
    aestheticsRating: rating(),
    evoRating: 0, // derived below
    forgeLevel: rng.nextInt(1, 40),
    avatarPath: rng.pick(ALL_AVATAR_PATHS),
    avatarStage: rng.nextInt(1, 4),
  };
  fitness.evoRating = Math.round(
    (fitness.strengthRating +
      fitness.cardioRating +
      fitness.muscularityRating +
      fitness.leannessRating +
      fitness.aestheticsRating) /
      5
  );
  return { playerId, displayName, fitness };
}

/** Deterministically generates a seeded gym roster (10 members). */
export function generateGym(gymId: string): GymData {
  const memberCount = 10;
  const members: GymMember[] = [];
  for (let i = 0; i < memberCount; i++) {
    members.push(generateMember(gymId, i));
  }
  return { gymId, name: GYM_NAMES[gymId] ?? gymId, members };
}

export function gymProfileOf(gym: GymData): GymProfile {
  return { gymId: gym.gymId, name: gym.name, memberIds: gym.members.map((m) => m.playerId) };
}

/**
 * Champion role calculation. A member may hold multiple titles. Ties break
 * by member order (deterministic).
 *
 * 'rising' = fastest riser: highest Evo Rating relative to Forge Level
 * (big rating on a young account = improving fast).
 */
export function computeGymChampions(gym: GymData): Record<GymChampionRole, GymMember> {
  const byMax = (score: (m: GymMember) => number): GymMember => {
    let best = gym.members[0];
    let bestScore = -Infinity;
    for (const member of gym.members) {
      const s = score(member);
      if (s > bestScore) {
        best = member;
        bestScore = s;
      }
    }
    return best;
  };

  return {
    strength: byMax((m) => m.fitness.strengthRating),
    cardio: byMax((m) => m.fitness.cardioRating),
    aesthetic: byMax((m) => m.fitness.aestheticsRating),
    overall: byMax((m) => m.fitness.evoRating),
    consistency: byMax((m) => m.fitness.forgeLevel),
    rising: byMax((m) => m.fitness.evoRating / Math.max(1, m.fitness.forgeLevel)),
  };
}

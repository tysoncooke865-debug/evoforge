import type { GymDefinition } from './types';

/**
 * GYM DEFINITIONS — data-driven so more gyms are a config change, not a new
 * screen. Tonight ships one: the Iron Foundry.
 */
export const GYMS: GymDefinition[] = [
  {
    id: 'iron_foundry',
    name: 'Iron Foundry',
    leaderName: 'Brax',
    leaderTitle: 'The Iron Warden',
    championId: 'titan',
    ai: 'defensive',
    theme: 'Strength, defence and heavy attacks.',
    description: 'A wall of iron — outlast the guard, then break it.',
    recommendedRating: 1450,
    badgeId: 'iron_foundry_badge',
    reward: { coins: 60, forgeXp: 80 },
  },
  {
    id: 'velocity_lab',
    name: 'Velocity Lab',
    leaderName: 'Rhea',
    leaderTitle: 'The Redline',
    championId: 'apex',
    ai: 'aggressive',
    theme: 'Speed, endurance and relentless pressure.',
    description: 'She never slows down — punish the openings between rushes.',
    recommendedRating: 1500,
    badgeId: 'velocity_lab_badge',
    reward: { coins: 65, forgeXp: 85 },
  },
  {
    id: 'mirror_hall',
    name: 'Mirror Hall',
    leaderName: 'Cass',
    leaderTitle: 'The Mirror',
    championId: 'aesthetic',
    ai: 'balanced',
    theme: 'Precision, counters and perfect form.',
    description: 'Every mistake is countered — patience beats the reflection.',
    recommendedRating: 1550,
    badgeId: 'mirror_hall_badge',
    reward: { coins: 70, forgeXp: 90 },
  },
];

export function gymById(id: string): GymDefinition | undefined {
  return GYMS.find((g) => g.id === id);
}

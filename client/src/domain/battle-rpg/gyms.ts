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
    description: 'Challenge specialised trainers and earn Forge Badges.',
    recommendedRating: 1450,
    badgeId: 'iron_foundry_badge',
    reward: { coins: 60, forgeXp: 80 },
  },
];

export function gymById(id: string): GymDefinition | undefined {
  return GYMS.find((g) => g.id === id);
}

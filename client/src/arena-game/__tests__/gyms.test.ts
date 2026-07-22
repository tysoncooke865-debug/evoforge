import { describe, expect, it } from 'vitest';
import {
  computeGymChampions,
  generateGym,
  GYM_CHAMPION_ROLES,
  gymProfileOf,
  SEED_GYM_IDS,
} from '../services/gyms/gym-data';

describe('seeded gyms', () => {
  it('generates deterministic rosters', () => {
    const a = generateGym('forge-district');
    const b = generateGym('forge-district');
    expect(a).toEqual(b);
    expect(a.members.length).toBe(10);
  });

  it('different gyms have different rosters', () => {
    const a = generateGym('forge-district');
    const b = generateGym('neon-iron-club');
    expect(a.members.map((m) => m.displayName)).not.toEqual(b.members.map((m) => m.displayName));
  });

  it('member fitness values are valid and evoRating is the sub-rating mean', () => {
    for (const gymId of SEED_GYM_IDS) {
      for (const m of generateGym(gymId).members) {
        const f = m.fitness;
        const expectedEvo = Math.round(
          (f.strengthRating +
            f.cardioRating +
            f.muscularityRating +
            f.leannessRating +
            f.aestheticsRating) /
            5
        );
        expect(f.evoRating).toBe(expectedEvo);
        expect(f.forgeLevel).toBeGreaterThanOrEqual(1);
        expect(['titan', 'speedster', 'shredder', 'hybrid']).toContain(f.avatarPath);
      }
    }
  });

  it('every champion role resolves to a roster member and tops its metric', () => {
    const gym = generateGym('apex-performance');
    const champions = computeGymChampions(gym);
    for (const role of GYM_CHAMPION_ROLES) {
      expect(gym.members).toContain(champions[role]);
    }
    const maxStrength = Math.max(...gym.members.map((m) => m.fitness.strengthRating));
    expect(champions.strength.fitness.strengthRating).toBe(maxStrength);
    const maxEvo = Math.max(...gym.members.map((m) => m.fitness.evoRating));
    expect(champions.overall.fitness.evoRating).toBe(maxEvo);
    const maxForge = Math.max(...gym.members.map((m) => m.fitness.forgeLevel));
    expect(champions.consistency.fitness.forgeLevel).toBe(maxForge);
  });

  it('gymProfileOf matches the provider interface shape', () => {
    const gym = generateGym('forge-district');
    const profile = gymProfileOf(gym);
    expect(profile.gymId).toBe('forge-district');
    expect(profile.memberIds.length).toBe(gym.members.length);
  });
});

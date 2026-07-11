import { describe, expect, it } from 'vitest';

import { nameError, rankLeaderboard } from '../leaderboard';

describe('rankLeaderboard', () => {
  it('ranks by LEVEL through the curve, not raw XP', () => {
    // Same XP, different base levels: the higher base level must rank first
    // even though XP ties. This is the exact bug class the Streamlit page
    // fixed ("Leaderboard ranks by avatar level, not raw XP").
    const ranked = rankLeaderboard([
      { display_name: 'grinder', xp: 1000, base_level: 1 }, // level 2
      { display_name: 'veteran', xp: 1000, base_level: 50 }, // level 50
    ]);
    expect(ranked.map((e) => e.displayName)).toEqual(['veteran', 'grinder']);
    expect(ranked[0].level).toBe(50);
  });

  it('XP breaks level ties, then name', () => {
    const ranked = rankLeaderboard([
      { display_name: 'beta', xp: 100, base_level: 10 },
      { display_name: 'alpha', xp: 100, base_level: 10 },
      { display_name: 'zeta', xp: 400, base_level: 10 },
    ]);
    expect(ranked.map((e) => e.displayName)).toEqual(['zeta', 'alpha', 'beta']);
    expect(ranked.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  it('garbage fields degrade to defaults, never throw', () => {
    const ranked = rankLeaderboard([{ display_name: null, xp: 'abc', base_level: null }]);
    expect(ranked[0]).toMatchObject({ level: 1, xp: 0 });
  });
});

describe('nameError', () => {
  it('clearing is allowed, bounds are enforced', () => {
    expect(nameError(null)).toBeNull();
    expect(nameError('')).toBeNull();
    expect(nameError('  ')).toBeNull();
    expect(nameError('ab')).toMatch(/3–24/);
    expect(nameError('a'.repeat(25))).toMatch(/3–24/);
    expect(nameError('abc')).toBeNull();
    expect(nameError('a'.repeat(24))).toBeNull();
  });
});

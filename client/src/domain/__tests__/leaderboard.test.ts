import { describe, expect, it } from 'vitest';

import { nameError, rankByMetric, rankLeaderboard } from '../leaderboard';

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

describe('rankByMetric', () => {
  it('PRESERVES the server order (rank_position) — never re-sorts', () => {
    // The RPC already ordered by the metric; the client must trust it. Rows
    // arrive out of position order on purpose here.
    const ranked = rankByMetric([
      { display_name: 'b', xp: 10, base_level: 1, forge_level: 2, evo_rating: 60, momentum_weeks: 3, rank_position: 1 },
      { display_name: 'a', xp: 999, base_level: 40, forge_level: 9, evo_rating: 40, momentum_weeks: 1, rank_position: 2 },
    ]);
    expect(ranked.map((e) => e.displayName)).toEqual(['b', 'a']);
    expect(ranked.map((e) => e.position)).toEqual([1, 2]);
  });

  it('carries every metric through, and a hidden Evo Rating stays null', () => {
    const [e] = rankByMetric([
      { display_name: 'x', xp: 50, base_level: 1, forge_level: 4, evo_rating: null, momentum_weeks: 7, rank_position: 1 },
    ]);
    expect(e.forgeLevel).toBe(4);
    expect(e.evoRating).toBeNull();
    expect(e.momentumWeeks).toBe(7);
  });

  it('falls back to array order when rank_position is missing', () => {
    const ranked = rankByMetric([
      { display_name: 'first', xp: 1, base_level: 1 },
      { display_name: 'second', xp: 1, base_level: 1 },
    ]);
    expect(ranked.map((e) => e.position)).toEqual([1, 2]);
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

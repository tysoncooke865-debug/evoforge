import { describe, expect, it } from 'vitest';

import { checkMatchup, rankStandingFor, PLACEMENT_MATCHES_REQUIRED } from '../rank-tiers';

describe('Rival Rank standings (spec §22)', () => {
  it('under five placements is UNRANKED with progress, whatever the rating', () => {
    const s = rankStandingFor({ rating: 1900, rd: 90, placementsCompleted: 3 });
    expect(s.provisional).toBe(true);
    expect(s.label).toBe(`UNRANKED · 3/${PLACEMENT_MATCHES_REQUIRED} PLACEMENTS`);
  });

  it('tiers and divisions land sensibly across the ladder', () => {
    expect(rankStandingFor({ rating: 1100, rd: 70, placementsCompleted: 9 }).tier).toBe('Iron');
    const cobalt = rankStandingFor({ rating: 1420, rd: 70, placementsCompleted: 9 });
    expect(cobalt.tier).toBe('Cobalt');
    expect(['III', 'II', 'I']).toContain(cobalt.division);
    expect(rankStandingFor({ rating: 2300, rd: 70, placementsCompleted: 9 }).label).toContain('APEX');
  });

  it('division I sits above III within one tier', () => {
    const low = rankStandingFor({ rating: 1355, rd: 70, placementsCompleted: 9 });
    const high = rankStandingFor({ rating: 1495, rd: 70, placementsCompleted: 9 });
    expect(low.tier).toBe('Cobalt');
    expect(high.tier).toBe('Cobalt');
    expect(low.division).toBe('III');
    expect(high.division).toBe('I');
  });

  it('confidence follows the rating deviation', () => {
    expect(rankStandingFor({ rating: 1500, rd: 60, placementsCompleted: 9 }).confidence).toBe('high');
    expect(rankStandingFor({ rating: 1500, rd: 250, placementsCompleted: 9 }).confidence).toBe('low');
  });
});

describe('matchmaking constraints (spec §24)', () => {
  const base = { ratingA: 1500, ratingB: 1520, evoA: 60, evoB: 62, recentMeetings: 0 };
  it('a fair matchup passes', () => {
    expect(checkMatchup(base).allowed).toBe(true);
  });
  it('never rank-only: a huge Evo gap blocks even at equal rating', () => {
    const v = checkMatchup({ ...base, evoB: 90 });
    expect(v.allowed).toBe(false);
    expect(v.reasons[0]).toContain('Evo Ratings');
  });
  it('never evo-only: a huge rating gap blocks even at equal Evo', () => {
    expect(checkMatchup({ ...base, ratingB: 1900 }).allowed).toBe(false);
  });
  it('rating farming blocks after repeated meetings', () => {
    expect(checkMatchup({ ...base, recentMeetings: 2 }).allowed).toBe(false);
  });
  it('missing Evo evidence does not block (provisional players can place)', () => {
    expect(checkMatchup({ ...base, evoA: null, evoB: null }).allowed).toBe(true);
  });
});

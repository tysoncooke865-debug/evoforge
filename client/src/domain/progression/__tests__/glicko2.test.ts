import { describe, expect, it } from 'vitest';

import { GLICKO_DEFAULT, glicko2Update, glickoWinProbability } from '../glicko2';

describe('Glicko-2 — pinned to the paper’s worked example', () => {
  it('Glickman’s example: 1500/200/0.06 vs three opponents → 1464.06 / 151.52 / ~0.05999', () => {
    const r = glicko2Update(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [
        { opponentRating: 1400, opponentRd: 30, score: 1 },
        { opponentRating: 1550, opponentRd: 100, score: 0 },
        { opponentRating: 1700, opponentRd: 300, score: 0 },
      ],
      0.5
    );
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it('an idle period raises uncertainty, never the rating', () => {
    const r = glicko2Update({ rating: 1600, rd: 80, volatility: 0.06 }, []);
    expect(r.rating).toBe(1600);
    expect(r.rd).toBeGreaterThan(80);
    expect(r.rd).toBeLessThanOrEqual(350);
  });

  it('a provisional newcomer moves far; an established player moves little', () => {
    const win = { opponentRating: 1500, opponentRd: 100, score: 1 };
    const newcomer = glicko2Update(GLICKO_DEFAULT, [win]);
    const veteran = glicko2Update({ rating: 1500, rd: 50, volatility: 0.06 }, [win]);
    expect(newcomer.rating - 1500).toBeGreaterThan((veteran.rating - 1500) * 3);
  });

  it('win probability is symmetric around equal ratings', () => {
    const p = glickoWinProbability(GLICKO_DEFAULT, GLICKO_DEFAULT);
    expect(p).toBeCloseTo(0.5, 5);
    expect(
      glickoWinProbability({ rating: 1700, rd: 60, volatility: 0.06 }, { rating: 1400, rd: 60, volatility: 0.06 })
    ).toBeGreaterThan(0.8);
  });
});

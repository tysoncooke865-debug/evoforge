import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DROP_TIERS,
  canAfford,
  clampStake,
  columnsFor,
  formatMultiplier,
  laneDistribution,
  laneRtp,
  effectiveRtp,
  payoutFor,
  quickStakes,
  tierForRating,
  tierOdds,
  validateTier,
} from '../forge-drop';
import { buildTrajectory, pegPositions, puckAt } from '../forge-drop-physics';

describe('the board that ships is a board that cannot be farmed', () => {
  it('every tier passes its own validator', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      expect(validateTier(tier), `tier ${tier.tier}`).toEqual([]);
    }
  });

  /**
   * THE INVARIANT THE WHOLE FEATURE RESTS ON. Not "on average", not "usually":
   * every lane of every tier returns less than it takes. A board that could be
   * farmed would turn training-earned coins into a printing press and make
   * every other coin in the app meaningless.
   */
  it('EVERY LANE of EVERY tier returns less than it takes', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      for (const { lane, rtp } of tierOdds(tier)) {
        expect(rtp, `tier ${tier.tier} lane ${lane}`).toBeLessThan(1);
        expect(rtp, `tier ${tier.tier} lane ${lane}`).toBeLessThan(0.95);
      }
    }
  });

  /**
   * THE TARGET IS A CEILING, NOT AN AVERAGE. Every lane returns at most what
   * the tier advertises, and the UI publishes each lane's own exact figure. A
   * ceiling can be checked; an average can hide a lane that pays too well.
   */
  it('no lane of any tier returns more than the tier advertises', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      for (const { lane, rtp } of tierOdds(tier)) {
        expect(rtp, `tier ${tier.tier} lane ${lane}`).toBeLessThanOrEqual(tier.target_rtp + 1e-9);
      }
    }
  });

  it('and the advertised number is not far above what the best lane pays', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      const best = Math.max(...tierOdds(tier).map((o) => o.rtp));
      expect(tier.target_rtp - best, `tier ${tier.tier}`).toBeLessThan(0.02);
    }
  });

  it('the maximum payout on the tin is the one the board can actually pay', () => {
    const expected = [15, 35, 60, 100, 150];
    DEFAULT_DROP_TIERS.forEach((tier, i) => {
      const best = Math.max(...tier.multipliers);
      expect(payoutFor(tier.max_stake, best), `tier ${tier.tier}`).toBe(expected[i]);
      expect(tier.max_payout).toBe(expected[i]);
    });
  });

  it('the stake ceilings are the ones the brief specified', () => {
    expect(DEFAULT_DROP_TIERS.map((t) => t.max_stake)).toEqual([5, 10, 15, 20, 25]);
  });

  it('a rebalance that breaks the economy is REFUSED, not shipped', () => {
    const greedy = {
      ...DEFAULT_DROP_TIERS[0],
      multipliers: [9, 4, 3, 2, 2, 2, 2, 2, 2, 2, 3, 4, 9],
      max_payout: 45,
    };
    const problems = validateTier(greedy);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((p) => p.problem).join(' ')).toMatch(/pays out more than it takes|ceiling/);
  });

  it('and so is a payout promise the board cannot keep', () => {
    const lying = { ...DEFAULT_DROP_TIERS[0], max_payout: 500 };
    expect(validateTier(lying).map((p) => p.problem).join(' ')).toMatch(/max_payout says 500/);
  });
});

describe('every Evo Rating boundary lands on the right board', () => {
  const cases: [number, number][] = [
    [0, 1], [1, 1], [19, 1], [20, 1],
    [21, 2], [40, 2],
    [41, 3], [60, 3],
    [61, 4], [80, 4],
    [81, 5], [100, 5], [999, 5],
  ];
  for (const [rating, tier] of cases) {
    it(`Evo ${rating} → tier ${tier}`, () => {
      expect(tierForRating(rating).tier).toBe(tier);
    });
  }

  it('an athlete no review has ever rated gets the lowest board, not an error', () => {
    expect(tierForRating(null).tier).toBe(1);
    expect(tierForRating(undefined).tier).toBe(1);
  });

  it('a negative or absurd rating is clamped rather than trusted', () => {
    expect(tierForRating(-50).tier).toBe(1);
    expect(tierForRating(99999).tier).toBe(5);
  });

  it('the bands are contiguous — no rating falls between two boards', () => {
    for (let r = 0; r <= 120; r += 1) expect(tierForRating(r)).toBeDefined();
    for (let i = 1; i < DEFAULT_DROP_TIERS.length; i += 1) {
      expect(DEFAULT_DROP_TIERS[i].evo_min).toBe(DEFAULT_DROP_TIERS[i - 1].evo_max + 1);
    }
  });
});

describe('the walk reflects at the walls, and that is the economy', () => {
  it('a distribution is a distribution', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      for (const lane of tier.lanes) {
        const d = laneDistribution(tier.rows, lane);
        expect(d).toHaveLength(tier.rows + 1);
        expect(d.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
        expect(d.every((p) => p >= 0)).toBe(true);
      }
    }
  });

  it('the centre lane is the plain binomial — C(12,k)/4096', () => {
    const d = laneDistribution(12, 6);
    const binomial = [1, 12, 66, 220, 495, 792, 924, 792, 495, 220, 66, 12, 1].map((c) => c / 4096);
    d.forEach((p, i) => expect(p).toBeCloseTo(binomial[i], 10));
  });

  it('every slot is REACHABLE from the centre — the parity bug that killed half the board', () => {
    // Stepping WHOLE columns left only same-parity slots reachable: half the
    // board was dead, and the artefact piled the walk onto the rim where the 3x
    // lives. A peg deflects by HALF a column, so every slot has weight.
    expect(laneDistribution(12, 6).every((p) => p > 0)).toBe(true);
  });

  it('a side lane cannot reach the FAR rim, which is honest and published', () => {
    // Twelve half-steps from one column over cannot cross the whole board, so
    // the far 3x is genuinely 0% from a side lane. The payout table shows it.
    expect(laneDistribution(12, 5)[12]).toBe(0);
    expect(laneDistribution(12, 7)[0]).toBe(0);
    expect(laneDistribution(12, 5)[0]).toBeGreaterThan(0);
  });

  it('the side lanes really are different odds — the choice is not decoration', () => {
    const left = laneDistribution(12, 5);
    const centre = laneDistribution(12, 6);
    expect(left).not.toEqual(centre);
    // Entering left leaves the puck likelier to finish left of the middle.
    const leftMass = (d: number[]) => d.slice(0, 6).reduce((s, p) => s + p, 0);
    expect(leftMass(left)).toBeGreaterThan(leftMass(centre));
  });

  it('CLAMPING instead of reflecting would break the board — the bug this avoids', () => {
    // Clamping parks probability against the rim, where the biggest multiplier
    // is. Modelled here so the reason the server reflects is written down.
    const clamped = (rows: number, lane: number) => {
      let dist = new Array<number>(rows + 1).fill(0);
      dist[lane] = 1;
      for (let s = 0; s < rows; s += 1) {
        const next = new Array<number>(rows + 1).fill(0);
        dist.forEach((p, col) => {
          if (!p) return;
          for (const dir of [-1, 1]) {
            next[Math.max(0, Math.min(rows, col + dir))] += p / 2;
          }
        });
        dist = next;
      }
      return dist;
    };
    const tier = DEFAULT_DROP_TIERS[4];
    const honest = laneRtp(tier.multipliers, laneDistribution(12, 6));
    const broken = laneRtp(tier.multipliers, clamped(12, 6));
    expect(broken).toBeGreaterThan(honest);
  });
});

/**
 * THE STATISTICAL TEST. A large deterministic sample walked with a seeded PRNG
 * — the same reflecting walk the server takes — held against the exact
 * distribution this file publishes. It answers the question a table of numbers
 * cannot: does the thing that RUNS agree with the thing that is PRINTED?
 *
 * Deterministic on purpose. A flaky economy test gets muted, and a muted
 * economy test is worse than none.
 */
describe('a hundred thousand drops behave like the published table', () => {
  /** mulberry32 — small, fast, and identical on every machine and every run. */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Exactly 155's loop. If this and the migration ever disagree, one of them
   *  is paying the wrong slot. */
  function walk(random: () => number, rows: number, lane: number): number {
    const H = 2 * rows;
    let h = 2 * lane;
    for (let i = 0; i < rows; i += 1) {
      let step = random() < 0.5 ? -1 : 1;
      if (h + step < 0 || h + step > H) step = -step;
      h += step;
    }
    return h / 2;
  }

  /** Exactly 155's payout rule, including the fraction paid as a probability.
   *  Uses the SAME rng stream as the walk, so the sample is reproducible. */
  function settle(random: () => number, stake: number, multiplier: number): number {
    const exact = stake * multiplier;
    return Math.floor(exact) + (random() < exact - Math.floor(exact) ? 1 : 0);
  }

  const SAMPLES = 100_000;

  for (const tier of DEFAULT_DROP_TIERS) {
    for (const lane of tier.lanes) {
      it(`tier ${tier.tier} lane ${lane}: slots and return match the table`, () => {
        const random = rng(0x5eed + tier.tier * 31 + lane);
        const counts = new Array<number>(tier.rows + 1).fill(0);
        let returned = 0;
        const stake = tier.max_stake;
        for (let i = 0; i < SAMPLES; i += 1) {
          const slot = walk(random, tier.rows, lane);
          counts[slot] += 1;
          returned += settle(random, stake, tier.multipliers[slot]);
        }

        const expected = laneDistribution(tier.rows, lane);
        counts.forEach((n, slot) => {
          const observed = n / SAMPLES;
          // Three sigma on a binomial proportion, plus a floor for the rare
          // rim slots where sigma is tiny.
          const sigma = Math.sqrt(Math.max(expected[slot], 1e-6) * (1 - expected[slot]) / SAMPLES);
          expect(Math.abs(observed - expected[slot]), `slot ${slot}`).toBeLessThan(3 * sigma + 0.002);
        });

        // Measured against the EFFECTIVE return — the number the screen shows
        // for this stake. Sampling the rounding rule rather than assuming it is
        // exactly what caught the flooring loss: the screen said 86% and the
        // board paid 15%.
        const measured = returned / (SAMPLES * stake);
        const published = effectiveRtp(tier.multipliers, expected, stake);
        expect(measured).toBeLessThan(1);
        expect(Math.abs(measured - published)).toBeLessThan(0.01);
        // Paying the fraction as a probability is UNBIASED, so the published
        // figure now agrees with the theoretical one instead of sitting below
        // it. Asserted both ways: still no better than theory (the house edge
        // survives), and no longer measurably worse (the athlete is paid it).
        const theory = laneRtp(tier.multipliers, expected);
        expect(published).toBeLessThanOrEqual(theory + 1e-9);
        expect(published).toBeGreaterThan(theory - 1e-9);
      });
    }
  }

  /**
   * THE REGRESSION. Payouts were floored, and flooring loses up to a whole coin
   * per drop no matter how small the stake — so the SMALLEST stake lost the
   * most. A 1-coin stake on a board published at 86% returned 15%, because
   * every slot under 1x floored to nothing. The published figure was true only
   * of a continuous game nobody was playing.
   *
   * This walks EVERY legal stake on every lane of every tier, not just the
   * maximum, because the maximum was the one stake where the old bug looked
   * nearly acceptable.
   */
  it('every legal stake returns what its board advertises — not just the biggest', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      for (const lane of tier.lanes) {
        const expected = laneDistribution(tier.rows, lane);
        const theory = laneRtp(tier.multipliers, expected);
        for (let stake = tier.min_stake; stake <= tier.max_stake; stake += 1) {
          const published = effectiveRtp(tier.multipliers, expected, stake);
          expect(
            Math.abs(published - theory),
            `tier ${tier.tier} lane ${lane} stake ${stake}`
          ).toBeLessThan(1e-9);
          // Still a house edge at every single stake. An unbiased rounding rule
          // must not become a way to beat the board at some awkward stake.
          expect(published, `tier ${tier.tier} lane ${lane} stake ${stake}`).toBeLessThan(1);
        }
      }
    }
  });

  /** The ceiling is a promise. The top multiplier of every tier lands on a whole
   *  number at max stake, so the fraction can never round a payout past what was
   *  advertised — asserted, not assumed. */
  it('no rounding can pay more than the tier advertises', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      const top = Math.max(...tier.multipliers);
      const exact = top * tier.max_stake;
      expect(exact, `tier ${tier.tier} top payout is whole`).toBe(Math.floor(exact));
      expect(exact).toBeLessThanOrEqual(tier.max_payout);
    }
  });

  it('the house edge is real at every tier — nobody grinds this to a profit', () => {
    for (const tier of DEFAULT_DROP_TIERS) {
      const random = rng(0xf00d + tier.tier);
      let staked = 0;
      let returned = 0;
      for (let i = 0; i < 60_000; i += 1) {
        const lane = tier.lanes[i % tier.lanes.length];
        const slot = walk(random, tier.rows, lane);
        staked += tier.max_stake;
        returned += settle(random, tier.max_stake, tier.multipliers[slot]);
      }
      expect(returned, `tier ${tier.tier}`).toBeLessThan(staked);
    }
  });
});

describe('stake limits cannot be talked past', () => {
  const tier = DEFAULT_DROP_TIERS[2]; // 15-coin ceiling

  it('clamps to the tier ceiling', () => {
    expect(clampStake(999, tier, 10_000)).toBe(15);
  });

  it('clamps to the wallet, which is usually the real limit', () => {
    expect(clampStake(15, tier, 7)).toBe(7);
  });

  it('never returns a stake below the floor', () => {
    expect(clampStake(0, tier, 10_000)).toBe(1);
    expect(clampStake(-5, tier, 10_000)).toBe(1);
  });

  it('the quick buttons are minimum, half and maximum — and all affordable', () => {
    expect(quickStakes(tier, 10_000)).toEqual([1, 7, 15]);
    expect(quickStakes(tier, 8)).toEqual([1, 4, 8]);
    expect(quickStakes(tier, 1)).toEqual([1]);
  });

  it('an athlete who cannot afford the floor is offered nothing at all', () => {
    expect(quickStakes(tier, 0)).toEqual([]);
    expect(canAfford(tier, 0)).toBe(false);
    expect(canAfford(tier, 1)).toBe(true);
  });

  it('a fractional balance never buys a fractional stake', () => {
    expect(quickStakes(tier, 5.9)).toEqual([1, 2, 5]);
  });
});

describe('the payout is exact, like the ledger', () => {
  /**
   * Coins carry two decimal places since migration 158, so a payout is simply
   * `stake x multiplier`. Both of the rounding schemes this replaced are gone:
   * flooring (which paid 15% on a board advertised at 86%) and the
   * probabilistic rounding that fixed flooring's bias. There is nothing left to
   * round, so each tier's published RTP is now true by construction rather than
   * in expectation.
   */
  it('pays the exact product, to the cent', () => {
    expect(payoutFor(5, 0.65)).toBe(3.25);
    expect(payoutFor(1, 0.9)).toBe(0.9);
    expect(payoutFor(1, 0.89)).toBe(0.89);
    expect(payoutFor(10, 3.5)).toBe(35);
  });

  it('never carries more than two decimal places', () => {
    for (const [stake, mult] of [[3, 0.7], [7, 1.26], [13, 0.89], [1, 1.08]] as const) {
      const p = payoutFor(stake, mult);
      expect(Math.round(p * 100) / 100).toBe(p);
    }
  });

  it('formats the way an athlete reads it', () => {
    expect(formatMultiplier(3)).toBe('×3');
    expect(formatMultiplier(0.65)).toBe('×0.65');
    expect(formatMultiplier(1.5)).toBe('×1.5');
  });
});

describe('the animation replays the server, or refuses to', () => {
  /** Twelve half-steps whose net displacement is `net` half-columns. */
  const pathTo = (net: number): number[] => {
    const rights = (12 + net) / 2;
    return [...new Array(rights).fill(1), ...new Array(12 - rights).fill(-1)];
  };

  it('walks the path to exactly the slot that was paid', () => {
    // From lane 6, a net of +4 half-columns lands on slot 8.
    const cols = columnsFor({ lane: 6, path: pathTo(4), slot: 8 }, 12);
    expect(cols).not.toBeNull();
    expect((cols as number[])[0]).toBe(6);
    expect((cols as number[])[12]).toBe(8);
    expect(cols).toHaveLength(13);
  });

  it('refuses a path that disagrees with the paid slot — the ledger wins', () => {
    expect(columnsFor({ lane: 6, path: new Array(12).fill(1), slot: 0 }, 12)).toBeNull();
  });

  it('refuses a path of the wrong length', () => {
    expect(columnsFor({ lane: 6, path: [1, 1, 1], slot: 6 }, 12)).toBeNull();
  });

  it('refuses a step that is not a step', () => {
    expect(columnsFor({ lane: 6, path: [2, ...new Array(11).fill(1)], slot: 12 }, 12)).toBeNull();
  });

  it('builds a fall that starts at the lane and ends in the slot', () => {
    const cols = columnsFor({ lane: 6, path: pathTo(4), slot: 8 }, 12) as number[];
    const traj = buildTrajectory(cols);
    expect(traj.slot).toBe(8);
    expect(puckAt(traj, 0).x).toBe(6);
    expect(puckAt(traj, traj.duration).x).toBe(8);
    expect(traj.duration).toBeGreaterThan(1);
    expect(traj.duration).toBeLessThan(5);
  });

  it('falls DOWNWARD the whole way — no frame ever rises', () => {
    const cols = columnsFor({ lane: 6, path: pathTo(4), slot: 8 }, 12) as number[];
    const traj = buildTrajectory(cols);
    for (let i = 1; i < traj.frames.length - 2; i += 1) {
      expect(traj.frames[i].y).toBeGreaterThanOrEqual(traj.frames[i - 1].y);
    }
  });

  it('holds the final position past the end — a late frame cannot move the puck', () => {
    const cols = columnsFor({ lane: 6, path: pathTo(4), slot: 8 }, 12) as number[];
    const traj = buildTrajectory(cols);
    expect(puckAt(traj, traj.duration + 10).x).toBe(puckAt(traj, traj.duration).x);
  });

  it('stays within the board at every instant', () => {
    const cols = columnsFor({ lane: 6, path: pathTo(4), slot: 8 }, 12) as number[];
    const traj = buildTrajectory(cols);
    for (let t = 0; t <= traj.duration; t += 0.02) {
      const p = puckAt(traj, t);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(12);
    }
  });

  it('the pegs form a lattice inside the board', () => {
    const pegs = pegPositions(12);
    expect(pegs.length).toBeGreaterThan(20);
    for (const peg of pegs) {
      expect(peg.x).toBeGreaterThanOrEqual(0);
      expect(peg.x).toBeLessThanOrEqual(12);
      expect(peg.y).toBeGreaterThan(0);
      expect(peg.y).toBeLessThan(12);
    }
  });
});

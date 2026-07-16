import { describe, expect, it } from 'vitest';

import {
  FORGE_CURVE_FIXTURE,
  forgeProgressFor,
  totalXpRequiredForLevel,
} from '../forge-level';

describe('the Forge Level curve — 250·(L−1)^1.65, one implementation, one SQL twin', () => {
  it('level 1 is free; the spec anchors hold', () => {
    expect(totalXpRequiredForLevel(1)).toBe(0);
    expect(totalXpRequiredForLevel(0)).toBe(0);
    expect(totalXpRequiredForLevel(2)).toBe(250);
    expect(totalXpRequiredForLevel(3)).toBe(785);
  });

  it('matches the SQL parity fixture at every sampled point', () => {
    expect(FORGE_CURVE_FIXTURE.length).toBeGreaterThan(0); // a guard that cannot fail is not a guard
    for (const [xp, level] of FORGE_CURVE_FIXTURE) {
      expect(forgeProgressFor(xp).level, `xp=${xp}`).toBe(level);
    }
  });

  it('progress derivations are internally consistent at a boundary', () => {
    const atBoundary = forgeProgressFor(250);
    expect(atBoundary.level).toBe(2);
    expect(atBoundary.xpIntoLevel).toBe(0);
    expect(atBoundary.xpForNextLevel).toBe(785 - 250);
    const nearNext = forgeProgressFor(784);
    expect(nearNext.level).toBe(2);
    expect(nearNext.percentToNext).toBeGreaterThan(99);
    expect(nearNext.percentToNext).toBeLessThanOrEqual(100);
  });

  it('the curve is strictly increasing (no level is free after 1)', () => {
    for (let l = 2; l <= 60; l++) {
      expect(totalXpRequiredForLevel(l)).toBeGreaterThan(totalXpRequiredForLevel(l - 1));
    }
  });

  it('garbage in, floor out — negatives and NaN read as level 1', () => {
    expect(forgeProgressFor(-50).level).toBe(1);
    expect(forgeProgressFor(Number.NaN).lifetimeXp).toBe(0);
  });
});

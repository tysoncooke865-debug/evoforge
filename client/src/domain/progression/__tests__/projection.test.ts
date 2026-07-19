import { describe, expect, it } from 'vitest';

import {
  consistencyFromMomentum,
  projectPillars,
  type PillarScores,
} from '../projection';

const CURRENT: PillarScores = { size: 40, aesthetics: 40, strength: 40, cardio: 40 };

describe('projectPillars', () => {
  it('zero weeks projects to exactly the current scores', () => {
    expect(projectPillars(CURRENT, 0)).toEqual(CURRENT);
  });

  it('every pillar grows toward 100 and never past it', () => {
    const p = projectPillars(CURRENT, 12);
    for (const k of ['size', 'aesthetics', 'strength', 'cardio'] as const) {
      expect(p[k]).toBeGreaterThan(CURRENT[k]);
      expect(p[k]).toBeLessThanOrEqual(100);
    }
  });

  it('strength answers consistent training faster than aesthetics', () => {
    const p = projectPillars(CURRENT, 12);
    expect(p.strength).toBeGreaterThan(p.aesthetics);
  });

  it('diminishing returns: a near-maxed pillar barely moves and stays <= 100', () => {
    const near: PillarScores = { size: 98, aesthetics: 98, strength: 98, cardio: 98 };
    const p = projectPillars(near, 52);
    expect(p.strength).toBeLessThanOrEqual(100);
    expect(p.strength - 98).toBeLessThan(2);
  });

  it('lower consistency projects smaller gains', () => {
    const full = projectPillars(CURRENT, 12, 1);
    const half = projectPillars(CURRENT, 12, 0.5);
    expect(half.strength).toBeLessThan(full.strength);
    expect(half.strength).toBeGreaterThan(CURRENT.strength);
  });
});

describe('consistencyFromMomentum', () => {
  it('clamps into [0.4, 1] and rises with momentum', () => {
    expect(consistencyFromMomentum(0)).toBeGreaterThanOrEqual(0.4);
    expect(consistencyFromMomentum(0)).toBeLessThan(consistencyFromMomentum(4));
    expect(consistencyFromMomentum(8)).toBe(1);
    expect(consistencyFromMomentum(100)).toBe(1);
  });
});

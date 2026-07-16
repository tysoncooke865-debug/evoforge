import { describe, expect, it } from 'vitest';

import {
  EVO_RATING_TIERS,
  EVO_TIER_REQUIREMENTS,
  applyTierRequirementSoftCaps,
  assembleEvoRating,
  calculateRawEvoRating,
  deriveEvoDisplay,
  descriptorFor,
  limitingPillarOf,
  qualifiesForLevel100,
} from '../evo-rating';
import type { EvoPillars, PillarResult } from '../types';

const pillar = (score: number, confidence = 80): PillarResult => ({
  score,
  confidence,
  confidenceLabel: 'high',
  evidenceCount: 3,
  missingEvidence: [],
  limitingFactors: [],
});

const pillars = (s: number, a: number, st: number, c: number, conf = 80): EvoPillars => ({
  size: pillar(s, conf),
  aesthetics: pillar(a, conf),
  strength: pillar(st, conf),
  cardio: pillar(c, conf),
});

describe('calculateRawEvoRating — 30/25/30/15 weighted geometric mean', () => {
  it('perfect pillars → 100; uniform pillars → that value', () => {
    expect(calculateRawEvoRating({ sizeScore: 100, aestheticsScore: 100, strengthScore: 100, cardioScore: 100 })).toBeCloseTo(100, 6);
    expect(calculateRawEvoRating({ sizeScore: 50, aestheticsScore: 50, strengthScore: 50, cardioScore: 50 })).toBeCloseTo(50, 6);
  });

  it('the weak link drags geometrically: 90/90/90/20 sits far below the arithmetic mean', () => {
    const raw = calculateRawEvoRating({ sizeScore: 90, aestheticsScore: 90, strengthScore: 90, cardioScore: 20 });
    expect(raw).toBeLessThan(73); // arithmetic would be 72.5 weighted ≈ 79.5
    expect(raw).toBeGreaterThan(60);
  });

  it('weights matter: weak cardio (15%) hurts less than weak size (30%)', () => {
    const weakCardio = calculateRawEvoRating({ sizeScore: 90, aestheticsScore: 90, strengthScore: 90, cardioScore: 40 });
    const weakSize = calculateRawEvoRating({ sizeScore: 40, aestheticsScore: 90, strengthScore: 90, cardioScore: 90 });
    expect(weakCardio).toBeGreaterThan(weakSize);
  });

  it('clamps garbage: zeros and NaN floor at 1, never annihilate', () => {
    const raw = calculateRawEvoRating({ sizeScore: 0, aestheticsScore: Number.NaN, strengthScore: 80, cardioScore: 80 });
    expect(raw).toBeGreaterThan(0);
  });
});

describe('deriveEvoDisplay — the spec worked example', () => {
  it('67.5432 → 67 displayed, 54/100 progress', () => {
    expect(deriveEvoDisplay(67.5432)).toEqual({ displayedRating: 67, evolutionProgress: 54 });
  });
  it('100 → 100 with full progress; garbage floors at 1', () => {
    expect(deriveEvoDisplay(100)).toEqual({ displayedRating: 100, evolutionProgress: 100 });
    expect(deriveEvoDisplay(Number.NaN).displayedRating).toBe(1);
    expect(deriveEvoDisplay(-5).displayedRating).toBe(1);
  });
});

describe('tier descriptors — every boundary', () => {
  it('covers 1..100 with no gaps and the spec names', () => {
    for (const t of EVO_RATING_TIERS) {
      expect(descriptorFor(t.min)).toBe(t.name);
      expect(descriptorFor(t.max)).toBe(t.name);
    }
    expect(descriptorFor(100)).toBe('The Standard');
  });
});

describe('applyTierRequirementSoftCaps — smooth, explained, never secret', () => {
  it('every gate boundary compresses into [gate−1, gate) when a pillar fails', () => {
    expect(EVO_TIER_REQUIREMENTS.length).toBeGreaterThan(0);
    for (const gate of EVO_TIER_REQUIREMENTS) {
      const r = applyTierRequirementSoftCaps({
        rawRating: Math.min(gate.rating + 2, 100),
        sizeScore: 100,
        aestheticsScore: 100,
        strengthScore: 100,
        cardioScore: gate.minCardio - 5, // fail cardio at every gate
      });
      expect(r.tierLocked, `gate ${gate.rating}`).toBe(true);
      expect(r.cappedRating).toBeGreaterThanOrEqual(gate.rating - 1);
      expect(r.cappedRating).toBeLessThan(gate.rating);
      expect(r.failingPillars).toContain('cardio');
      expect(r.explanations[0]).toContain(`Evo Rating ${gate.rating}`);
    }
  });

  it('the spec example: raw 92 failing the 90 cardio gate reads 89.x, never 79', () => {
    const r = applyTierRequirementSoftCaps({
      rawRating: 92, sizeScore: 95, aestheticsScore: 95, strengthScore: 95, cardioScore: 54,
    });
    expect(r.cappedRating).toBeGreaterThanOrEqual(89);
    expect(r.cappedRating).toBeLessThan(90);
    expect(r.explanations[0]).toContain('Cardio must reach 60');
  });

  it('the LOWEST failed gate binds: failing 70 and 90 gates caps below 70', () => {
    const r = applyTierRequirementSoftCaps({
      rawRating: 92, sizeScore: 95, aestheticsScore: 95, strengthScore: 95, cardioScore: 20,
    });
    expect(r.cappedRating).toBeLessThan(70);
    expect(r.lockedGate?.rating).toBe(70);
  });

  it('meeting every minimum leaves the raw rating untouched', () => {
    const r = applyTierRequirementSoftCaps({
      rawRating: 91, sizeScore: 90, aestheticsScore: 88, strengthScore: 85, cardioScore: 65,
    });
    expect(r.tierLocked).toBe(false);
    expect(r.cappedRating).toBe(91);
  });
});

describe('Level 100 — manual + elite only (spec §6)', () => {
  const bar = {
    sizeScore: 99.6, aestheticsScore: 99.6, strengthScore: 96, cardioScore: 86,
    allCoreStrengthCategoriesAtLeast85: true, overallConfidence: 96,
  };
  it('the full bar with manual verification qualifies; without it, never', () => {
    expect(qualifiesForLevel100({ ...bar, manualEliteVerification: true })).toBe(true);
    expect(qualifiesForLevel100({ ...bar, manualEliteVerification: false })).toBe(false);
  });
  it('automation caps at 99: perfect pillars without verification display 99', () => {
    const result = assembleEvoRating(pillars(100, 100, 100, 100, 96), { allCoreStrengthCategoriesAtLeast85: true });
    expect(result.displayedRating).toBe(99);
  });
  it('the verified elite reaches 100 · The Standard', () => {
    const result = assembleEvoRating(pillars(99.6, 99.6, 96, 86, 96), {
      manualEliteVerification: true,
      allCoreStrengthCategoriesAtLeast85: true,
    });
    expect(result.displayedRating).toBe(100);
    expect(result.descriptor).toBe('The Standard');
  });
});

describe('assembleEvoRating — limits, confidence, explanations travel together', () => {
  it('overall confidence is the weakest pillar (never confident with an unassessed pillar)', () => {
    const p = pillars(70, 64, 76, 43);
    p.cardio.confidence = 25;
    const result = assembleEvoRating(p);
    expect(result.overallConfidence).toBe(25);
    expect(result.confidenceLabel).toBe('provisional');
  });

  it('the spec worked example lands in the Developed band with cardio limiting', () => {
    const result = assembleEvoRating(pillars(70, 64, 76, 43));
    expect(result.displayedRating).toBeGreaterThanOrEqual(60);
    expect(result.displayedRating).toBeLessThanOrEqual(69);
    expect(result.descriptor).toBe('Developed');
    expect(result.limitingPillar).toBe('cardio');
  });

  it('limitingPillarOf weighs the drag, not just the minimum', () => {
    // Size 60 at weight .30 drags more than cardio 55 at weight .15.
    expect(limitingPillarOf({ size: 60, aesthetics: 90, strength: 90, cardio: 55 })).toBe('size');
  });
});

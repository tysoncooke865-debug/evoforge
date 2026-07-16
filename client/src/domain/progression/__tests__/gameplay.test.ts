import { describe, expect, it } from 'vitest';

import {
  calculatePlayerStats,
  calculateTechnique,
  determineEvoClass,
  equaliseStats,
  handicapTargets,
} from '../player-stats';
import { determineTraitEligibility } from '../traits';
import type { EvoPillars, PillarResult } from '../types';

const pillar = (score: number, confidence = 70): PillarResult => ({
  score,
  confidence,
  confidenceLabel: 'high',
  evidenceCount: 3,
  missingEvidence: [],
  limitingFactors: [],
});
const pillars = (s: number, a: number, st: number, c: number): EvoPillars => ({
  size: pillar(s),
  aesthetics: pillar(a),
  strength: pillar(st),
  cardio: pillar(c),
});
const TECH = { totalValidSets: 800, familiarExercises: 15, recentTrainingDays: 24 };

describe('Player Stats — the spec §25 mapping, technique from history alone', () => {
  it('maps Strength→Power, Size→Vitality, Cardio→Stamina, Aesthetics→Balance', () => {
    const s = calculatePlayerStats(pillars(70, 64, 76, 43), TECH);
    expect(s).toMatchObject({ power: 76, vitality: 70, stamina: 43, balance: 64 });
    expect(s.technique).toBeGreaterThan(50);
  });
  it('technique plateaus — a million junk sets cannot max it alone', () => {
    const grinder = calculateTechnique({ totalValidSets: 1_000_000, familiarExercises: 2, recentTrainingDays: 0 });
    expect(grinder).toBeLessThan(55);
  });
});

describe('Evo Classes — first matching versioned rule, always explainable', () => {
  it('the spec archetypes resolve', () => {
    expect(determineEvoClass({ pillars: pillars(75, 50, 75, 40), technique: 50 }).evoClass).toBe('Titan');
    expect(determineEvoClass({ pillars: pillars(85, 55, 85, 30), technique: 50 }).evoClass).toBe('Juggernaut');
    expect(determineEvoClass({ pillars: pillars(70, 70, 70, 65), technique: 60 }).evoClass).toBe('Complete Athlete');
    expect(determineEvoClass({ pillars: pillars(45, 45, 70, 45), technique: 65 }).evoClass).toBe('Striker');
    expect(determineEvoClass({ pillars: pillars(45, 40, 40, 70), technique: 60 }).evoClass).toBe('Ranger');
    expect(determineEvoClass({ pillars: pillars(40, 65, 40, 35), technique: 40 }).evoClass).toBe('Sculptor');
  });
  it('nothing matching lands in Specialist with an explanation, never a crash', () => {
    const r = determineEvoClass({ pillars: pillars(20, 20, 20, 20), technique: 10 });
    expect(r.evoClass).toBe('Specialist');
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(r.ruleVersion).toBe('1.0.0');
  });
});

describe('Traits — evidence-gated, confidence-gated', () => {
  it('high score with LOW confidence earns nothing (unverified strength is not a trait)', () => {
    const p = pillars(75, 75, 75, 70);
    p.strength.confidence = 20;
    const withLow = determineTraitEligibility(p, calculatePlayerStats(p, TECH), 8);
    expect(withLow.some((t) => t.key === 'heavy_hitter')).toBe(false);
  });
  it('a complete, consistent athlete stacks the mixed traits', () => {
    const p = pillars(75, 75, 75, 70);
    const traits = determineTraitEligibility(p, calculatePlayerStats(p, TECH), 8);
    const keys = traits.map((t) => t.key);
    expect(keys).toContain('no_weak_link');
    expect(keys).toContain('consistent_performer');
    expect(traits.every((t) => t.ruleVersion === '1.0.0')).toBe(true);
  });
});

describe('rulesets — Equalised preserves distribution; Handicap scales to ability', () => {
  it('equalised budgets match while ratios survive', () => {
    const [ea, eb] = equaliseStats(
      { power: 90, vitality: 80, stamina: 40, balance: 60, technique: 70 },
      { power: 40, vitality: 45, stamina: 80, balance: 50, technique: 55 }
    );
    const total = (s: typeof ea) => s.power + s.vitality + s.stamina + s.balance + s.technique;
    expect(Math.abs(total(ea) - total(eb))).toBeLessThanOrEqual(4); // rounding drift only
    expect(ea.power).toBeGreaterThan(ea.stamina); // A's shape survives
    expect(eb.stamina).toBeGreaterThan(eb.power); // B's shape survives
  });
  it('handicap targets ride each athlete’s own e1RM, plate-rounded', () => {
    const t = handicapTargets({ e1rmA: 120, e1rmB: 96.7 });
    expect(t.targetA).toBe(90);
    expect(t.targetB).toBe(72.5);
  });
});

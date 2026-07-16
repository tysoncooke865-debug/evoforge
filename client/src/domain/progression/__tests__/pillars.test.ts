import { describe, expect, it } from 'vitest';

import { calculateAestheticsScore, definitionScoreFromBf } from '../aesthetics-score';
import { calculateCardioScore, scoreAerobicTest } from '../cardio-score';
import { daysBetween, evidenceConfidence, recencyWeight } from '../confidence';
import { calculateSizeScore, normalisedFfmi } from '../size-score';
import {
  calculateStrengthScore,
  e1rmFor,
  movementCategoryFor,
  scoreCategory,
  type StrengthObservation,
} from '../strength-score';
import { applyConfirmedRating, initialEvoState, reclaimProgress } from '../evo-state';

const TODAY = '2026-07-16';

describe('confidence arithmetic', () => {
  it('recency: fresh full, stale floors, in-between fades', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(28)).toBe(1);
    expect(recencyWeight(90)).toBeCloseTo(0.4, 6);
    expect(recencyWeight(59)).toBeGreaterThan(0.4);
    expect(recencyWeight(59)).toBeLessThan(1);
  });
  it('evidence count raises confidence with diminishing returns', () => {
    expect(evidenceConfidence(0)).toBe(20);
    expect(evidenceConfidence(3)).toBeGreaterThan(evidenceConfidence(1));
    expect(evidenceConfidence(50)).toBeLessThanOrEqual(90);
  });
  it('daysBetween parses local-day ISO strings', () => {
    expect(daysBetween('2026-07-01', '2026-07-16')).toBe(15);
    expect(daysBetween('garbage', TODAY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('Size — height/frame/composition aware, never bodyweight alone', () => {
  it('FFMI math: 180cm 90kg at 15% bf ≈ 23.6', () => {
    expect(normalisedFfmi(180, 90, 15)).toBeCloseTo(23.6, 1);
  });
  it('a developed male scores high with full evidence', () => {
    const r = calculateSizeScore({
      sex: 'male', heightCm: 180, bodyweightKg: 90, bfLow: 12, bfHigh: 16,
      legacyMuscularity15: 12, wristCm: 17.5, scanCount: 2,
    });
    expect(r.score).toBeGreaterThan(60);
    expect(r.confidence).toBeGreaterThan(50);
  });
  it('missing evidence names itself and stays provisional — never zero', () => {
    const r = calculateSizeScore({ sex: 'male' });
    expect(r.score).toBeGreaterThan(1);
    expect(r.confidence).toBeLessThanOrEqual(35);
    expect(r.missingEvidence).toContain('height');
    expect(r.missingEvidence).toContain('body-fat estimate');
  });
  it('a wide body-fat range is soft evidence: confidence drops, not the score basis', () => {
    const narrow = calculateSizeScore({ sex: 'male', heightCm: 180, bodyweightKg: 90, bfLow: 13, bfHigh: 15, legacyMuscularity15: 10 });
    const wide = calculateSizeScore({ sex: 'male', heightCm: 180, bodyweightKg: 90, bfLow: 8, bfHigh: 20, legacyMuscularity15: 10 });
    expect(wide.confidence).toBeLessThan(narrow.confidence);
  });
  it('regional weak links are named', () => {
    const r = calculateSizeScore({
      sex: 'male', heightCm: 180, bodyweightKg: 90, bfLow: 12, bfHigh: 16,
      regionalScores: { chest: 85, biceps: 85, triceps: 82, backWidth: 80, quadriceps: 30, calves: 28 },
    });
    expect(r.limitingFactors).toContain('a lagging muscle region');
  });
});

describe('Aesthetics — proportions/definition/symmetry with safety plateaus', () => {
  it('the definition curve PLATEAUS below the healthy floor — leaner earns nothing', () => {
    expect(definitionScoreFromBf('male', 4)).toBe(definitionScoreFromBf('male', 7));
    expect(definitionScoreFromBf('female', 10)).toBe(definitionScoreFromBf('female', 15));
  });
  it('camera inconsistency lowers CONFIDENCE, never the score', () => {
    const base = { sex: 'male' as const, legacyPhysique15: 11, legacySymmetry15: 12, bfLow: 12, bfHigh: 15 };
    const consistent = calculateAestheticsScore({ ...base, scanConsistent: true });
    const wobbly = calculateAestheticsScore({ ...base, scanConsistent: false });
    expect(wobbly.score).toBeCloseTo(consistent.score, 6);
    expect(wobbly.confidence).toBeLessThan(consistent.confidence);
  });
  it('legacy 15-scales map through; nothing at all reads provisional', () => {
    const r = calculateAestheticsScore({ sex: 'female' });
    expect(r.confidence).toBeLessThanOrEqual(30);
    expect(r.missingEvidence.length).toBeGreaterThan(0);
  });
});

describe('Strength — the ONE mapping, honest evidence selection', () => {
  it('maps the spec exercises to their categories', () => {
    expect(movementCategoryFor('Barbell Bench Press (Strength)')).toBe('horizontal_press');
    expect(movementCategoryFor('Romanian Deadlift')).toBe('hip_hinge');
    expect(movementCategoryFor('Conventional Deadlift')).toBe('hip_hinge');
    expect(movementCategoryFor('Back Squat')).toBe('knee_dominant');
    expect(movementCategoryFor('Lat Pulldown')).toBe('upper_pull');
    expect(movementCategoryFor('Overhead Press')).toBe('vertical_press');
    expect(movementCategoryFor('Dumbbell Bicep Curl')).toBeNull();
  });
  it('e1RM refuses sets above 10 reps and invalid loads', () => {
    expect(e1rmFor(100, 5)).toBeCloseTo(116.67, 1);
    expect(e1rmFor(60, 15)).toBeNull();
    expect(e1rmFor(0, 5)).toBeNull();
  });
  it('best-2-of-last-4: an ancient monster PR outside the window cannot own the score', () => {
    const obs: StrengthObservation[] = [
      { exercise: 'Bench Press', weightKg: 200, reps: 3, date: '2024-01-01' }, // ancient outlier
      { exercise: 'Bench Press', weightKg: 90, reps: 5, date: '2026-07-01' },
      { exercise: 'Bench Press', weightKg: 92.5, reps: 4, date: '2026-07-08' },
      { exercise: 'Bench Press', weightKg: 90, reps: 6, date: '2026-07-12' },
      { exercise: 'Bench Press', weightKg: 87.5, reps: 6, date: '2026-07-15' },
    ];
    const r = scoreCategory('horizontal_press', obs, 'male', TODAY, 90);
    expect(r.bestE1rm).toBeLessThan(120); // the 200kg ghost is outside the last-4 window
  });
  it('single-date evidence is soft: confidence takes the 0.7 haircut', () => {
    const one: StrengthObservation[] = [
      { exercise: 'Bench Press', weightKg: 90, reps: 5, date: '2026-07-15' },
      { exercise: 'Bench Press', weightKg: 92.5, reps: 3, date: '2026-07-15' },
    ];
    const two: StrengthObservation[] = [
      { exercise: 'Bench Press', weightKg: 90, reps: 5, date: '2026-07-12' },
      { exercise: 'Bench Press', weightKg: 92.5, reps: 3, date: '2026-07-15' },
    ];
    expect(scoreCategory('horizontal_press', one, 'male', TODAY, 90).confidence).toBeLessThan(
      scoreCategory('horizontal_press', two, 'male', TODAY, 90).confidence
    );
  });
  it('a missing category is NAMED and drags geometrically, not to zero', () => {
    const r = calculateStrengthScore(
      [
        { exercise: 'Bench Press', weightKg: 100, reps: 5, date: '2026-07-10' },
        { exercise: 'Bench Press', weightKg: 100, reps: 5, date: '2026-07-14' },
      ],
      'male', TODAY, 90
    );
    expect(r.missingEvidence).toContain('Hip Hinge evidence');
    expect(r.score).toBeGreaterThan(1);
    expect(r.allCoreCategoriesAtLeast85).toBe(false);
  });
});

describe('Cardio — demonstrated performance, provisional never zero', () => {
  it('no evidence at all → conservative provisional with a named action', () => {
    const r = calculateCardioScore({ sex: 'male', aerobicTests: [], hasCardioTrainingHistory: false, todayIso: TODAY });
    expect(r.score).toBeGreaterThanOrEqual(30);
    expect(r.score).toBeLessThanOrEqual(50);
    expect(r.confidenceLabel).toBe('provisional');
    expect(r.missingEvidence[0]).toContain('1.5 km run');
  });
  it('a 7:30 1.5km male run scores in the athletic band', () => {
    const s = scoreAerobicTest('male', { testType: 'run_1_5km', value: 450, date: TODAY });
    expect(s).toBeGreaterThan(75);
    expect(s).toBeLessThan(90);
  });
  it('female normalisation shifts timed tests fairly (same time scores higher)', () => {
    const male = scoreAerobicTest('male', { testType: 'run_1_5km', value: 480, date: TODAY });
    const female = scoreAerobicTest('female', { testType: 'run_1_5km', value: 480, date: TODAY });
    expect(female).toBeGreaterThan(male);
  });
  it('wearable-only evidence caps confidence and asks for a real test', () => {
    const r = calculateCardioScore({
      sex: 'male',
      aerobicTests: [{ testType: 'vo2max_wearable', value: 50, date: TODAY }],
      hasCardioTrainingHistory: true,
      todayIso: TODAY,
    });
    expect(r.confidence).toBeLessThanOrEqual(55);
    expect(r.missingEvidence[0]).toContain('standardised aerobic test');
  });
});

describe('Evo state — current, starting, peak (spec §14)', () => {
  it('the full arc: start 51 → 69 → drop to 67: peak holds, reclaim is honest', () => {
    let s = initialEvoState(51.2);
    expect(s.startingDisplayed).toBe(51);
    s = applyConfirmedRating(s, 69.4);
    expect(s.peakDisplayed).toBe(69);
    expect(s.lifetimeEvolution).toBe(18);
    s = applyConfirmedRating(s, 67.3);
    expect(s.currentDisplayed).toBe(67);
    expect(s.peakDisplayed).toBe(69); // never decreases
    expect(s.startingDisplayed).toBe(51); // never changes
    expect(reclaimProgress(s)).toBe(Math.round((69.4 - 67.3) * 100));
  });
  it('at peak there is nothing to reclaim', () => {
    const s = initialEvoState(60);
    expect(reclaimProgress(s)).toBeNull();
  });
});

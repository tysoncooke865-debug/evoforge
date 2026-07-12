import { describe, expect, it } from 'vitest';

import {
  calculateAvatarStats,
  FEMALE_CALIBRATION,
  MALE_CALIBRATION,
  strengthScoreFromRatios,
  type AvatarStatsInputs,
} from '../avatar-stats-calc';

/**
 * SEX CALIBRATION self-consistency. The contract has two halves:
 *  1. The DEFAULT path is byte-identical male behaviour — the 3,323 goldens
 *     stay authoritative and this suite pins that omitting the calibration
 *     equals passing MALE_CALIBRATION explicitly.
 *  2. Equal RELATIVE performance earns equal points: a female athlete at her
 *     strength-standards anchors scores exactly what a male athlete scores
 *     at his, and physiologically equivalent body fat grades the same.
 */

const baseInputs = (over: Partial<AvatarStatsInputs> = {}): AvatarStatsInputs => ({
  workoutRows: [],
  level: 10,
  latestBodyweight: 60,
  bfMid: 18,
  physique: {
    physique_score: 9,
    leanness_score: 9,
    symmetry_score: 9,
    muscularity_score: 9,
  },
  cardioMinutes: 120,
  cardioDistanceKm: 15,
  profileDeadliftE1rm: null,
  ...over,
});

describe('sex calibration — the male path is unchanged', () => {
  it('omitting the calibration IS the male calibration, field for field', () => {
    const inputs = baseInputs({ latestBodyweight: 80, bfMid: 12 });
    expect(calculateAvatarStats(inputs)).toEqual(calculateAvatarStats(inputs, MALE_CALIBRATION));
  });

  it('the pinned male strength anchors still grade exactly as the goldens do', () => {
    // Intermediate on all three male anchors = 50; elite = 100.
    expect(strengthScoreFromRatios(1.25, 1.5, 1.75)).toBe(50);
    expect(strengthScoreFromRatios(2.25, 2.5, 2.75)).toBe(100);
  });

  it('POSITIVE CONTROL: the female calibration actually changes the result', () => {
    // A guard that cannot fail is not a guard: if these were equal, every
    // assertion in this file would be vacuous.
    const inputs = baseInputs();
    expect(calculateAvatarStats(inputs, FEMALE_CALIBRATION)).not.toEqual(
      calculateAvatarStats(inputs, MALE_CALIBRATION)
    );
  });
});

describe('sex calibration — equal relative performance, equal points', () => {
  it('a female at her intermediate anchors scores what a male scores at his', () => {
    expect(strengthScoreFromRatios(0.85, 1.15, 1.35, FEMALE_CALIBRATION)).toBe(
      strengthScoreFromRatios(1.25, 1.5, 1.75, MALE_CALIBRATION)
    );
  });

  it('elite is elite in both calibrations', () => {
    expect(strengthScoreFromRatios(1.6, 2.05, 2.3, FEMALE_CALIBRATION)).toBe(100);
  });

  it('the same absolute lifts grade HIGHER for a female athlete', () => {
    // 0.85x bench / 1.15x squat: intermediate for a woman, novice-ish for a man.
    const female = strengthScoreFromRatios(0.85, 1.15, 0, FEMALE_CALIBRATION);
    const male = strengthScoreFromRatios(0.85, 1.15, 0, MALE_CALIBRATION);
    expect(female).toBeGreaterThan(male);
  });

  it('16% body fat on a woman grades like 8% on a man: leanness 100', () => {
    const female = calculateAvatarStats(baseInputs({ bfMid: 16 }), FEMALE_CALIBRATION);
    const male = calculateAvatarStats(baseInputs({ bfMid: 8 }), MALE_CALIBRATION);
    expect(female.leannessScore).toBe(100);
    expect(male.leannessScore).toBe(100);
  });

  it('26% body fat is mid-scale for a woman, floor for a male grading', () => {
    const female = calculateAvatarStats(baseInputs({ bfMid: 26 }), FEMALE_CALIBRATION);
    const male = calculateAvatarStats(baseInputs({ bfMid: 26 }), MALE_CALIBRATION);
    expect(female.leannessScore).toBe(50);
    expect(male.leannessScore).toBe(0);
  });

  it('a 65 kg female is an Athletic Frame, not a Cutting Frame', () => {
    const female = calculateAvatarStats(baseInputs({ latestBodyweight: 65 }), FEMALE_CALIBRATION);
    const male = calculateAvatarStats(baseInputs({ latestBodyweight: 65 }), MALE_CALIBRATION);
    expect(female.buildType).toBe('Athletic Frame');
    expect(male.buildType).toBe('Cutting Frame');
  });

  it('the size bodyweight window no longer zeroes out a 58 kg athlete', () => {
    const female = calculateAvatarStats(baseInputs({ latestBodyweight: 58 }), FEMALE_CALIBRATION);
    const male = calculateAvatarStats(baseInputs({ latestBodyweight: 58 }), MALE_CALIBRATION);
    expect(female.sizeScore).toBeGreaterThan(male.sizeScore);
  });
});

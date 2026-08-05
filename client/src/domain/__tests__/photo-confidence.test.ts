import { describe, expect, it } from 'vitest';

import { assembleEvoRating } from '../progression/evo-rating';
import { runEvoReview, type ReviewInputs } from '../progression/evo-review';
import { confidenceLabelFor, type PillarResult } from '../progression/types';

/**
 * THE INVARIANT THE WHOLE ONBOARDING REWRITE RESTS ON
 * (docs/ONBOARDING_V3_SPEC.md §5).
 *
 *   Missing photos must lower CONFIDENCE, never SCORE.
 *
 * Under the v2 placement, declining to photograph yourself cost up to five
 * levels: physique came from the AI scan (0–15) or, on a skip, from a
 * derived default capped at 10. That is a penalty for protecting your
 * privacy, applied to exactly the athletes least comfortable being
 * photographed.
 *
 * The Evo Rating already has the right structure — `overallConfidence` is
 * the MIN of the four pillar confidences and the displayed rating derives
 * from the four SCORES alone. This suite pins that structure so it cannot be
 * "improved" into a confidence-damped rating by someone who has not read
 * the brief.
 */

const pillar = (score: number, confidence: number): PillarResult => ({
  score,
  confidence,
  confidenceLabel: confidenceLabelFor(confidence),
  evidenceCount: confidence > 0 ? 1 : 0,
  missingEvidence: [],
  limitingFactors: [],
});

/** One athlete, mid-review, with real strength evidence and no scan. */
function inputs(over: Partial<ReviewInputs> = {}): ReviewInputs {
  const today = '2026-08-05';
  return {
    todayIso: today,
    sex: 'male',
    fallbackBodyweightKg: 80,
    priorState: null,
    priorPillars: null,
    strengthObservations: [
      { exercise: 'Bench Press', weightKg: 100, reps: 5, date: '2026-08-01' },
      { exercise: 'Bench Press', weightKg: 102.5, reps: 5, date: '2026-08-04' },
      { exercise: 'Back Squat', weightKg: 140, reps: 5, date: '2026-08-02' },
      { exercise: 'Back Squat', weightKg: 140, reps: 6, date: '2026-08-04' },
      { exercise: 'Deadlift', weightKg: 180, reps: 3, date: '2026-08-01' },
      { exercise: 'Deadlift', weightKg: 185, reps: 3, date: '2026-08-04' },
      { exercise: 'Barbell Row', weightKg: 90, reps: 6, date: '2026-08-02' },
      { exercise: 'Barbell Row', weightKg: 92.5, reps: 6, date: '2026-08-04' },
      { exercise: 'Overhead Press', weightKg: 60, reps: 5, date: '2026-08-02' },
      { exercise: 'Overhead Press', weightKg: 62.5, reps: 5, date: '2026-08-04' },
    ],
    cardioEvidence: {
      sex: 'male',
      aerobicTests: [],
      workCapacityScore: null,
      hrRecovery1minBpm: null,
      hasCardioTrainingHistory: true,
      todayIso: today,
    },
    scanSize: null,
    scanAesthetics: null,
    provisionalSize: pillar(55, 20),
    provisionalAesthetics: pillar(52, 20),
    lastStrengthEvidenceIso: '2026-08-04',
    lastCardioEvidenceIso: null,
    ...over,
  };
}

describe('a photo is worth confidence, never rating', () => {
  /**
   * The controlled comparison: the SAME body, measured two ways. The scan
   * agrees exactly with the provisional estimate and is merely more certain
   * about it. Any rating difference here would be a pure privacy penalty.
   */
  const declined = runEvoReview(inputs());
  const scanned = runEvoReview(
    inputs({ scanSize: pillar(55, 80), scanAesthetics: pillar(52, 80) })
  );

  it('the displayed rating is identical whether or not the athlete photographed themselves', () => {
    expect(declined.rating.displayedRating).toBe(scanned.rating.displayedRating);
    expect(declined.rating.rawRating).toBe(scanned.rating.rawRating);
  });

  it('the physique pillars themselves are less certain without it', () => {
    expect(declined.pillars.size.confidence).toBeLessThan(scanned.pillars.size.confidence);
    expect(declined.pillars.aesthetics.confidence).toBeLessThan(scanned.pillars.aesthetics.confidence);
    expect(declined.pillars.size.score).toBe(scanned.pillars.size.score);
  });

  /**
   * OVERALL confidence is the MINIMUM of the four pillars, so a scan only
   * moves it when the physique pillars are the ones holding it down. For a
   * brand-new athlete with no cardio evidence, cardio is the floor and a
   * scan changes the headline confidence by nothing at all.
   *
   * That is worth knowing rather than papering over: it is why the
   * calibration card names the LIMITING area instead of telling every
   * athlete a photo is what they are missing. Here the claim is isolated by
   * holding the other two pillars above the physique ones.
   */
  it('and once physique is the limiting area, the headline confidence moves too', () => {
    const strong = { strength: pillar(70, 90), cardio: pillar(60, 90) };
    const withoutScan = assembleEvoRating({ size: pillar(55, 20), aesthetics: pillar(52, 20), ...strong });
    const withScan = assembleEvoRating({ size: pillar(55, 80), aesthetics: pillar(52, 80), ...strong });

    expect(withoutScan.displayedRating).toBe(withScan.displayedRating);
    expect(withoutScan.overallConfidence).toBeLessThan(withScan.overallConfidence);
    expect(withoutScan.confidenceLabel).not.toBe(withScan.confidenceLabel);
  });

  it('and the review NAMES what it left alone rather than silently guessing', () => {
    expect(declined.preserved).toContain('Size (no new scan evidence)');
    expect(declined.preserved).toContain('Aesthetics (no new scan evidence)');
    expect(scanned.preserved).not.toContain('Size (no new scan evidence)');
  });

  /**
   * POSITIVE CONTROL. Without this, the first assertion could pass for the
   * worst possible reason — a scan that changes nothing at all.
   */
  it('POSITIVE CONTROL: a scan that measures something DIFFERENT does move the rating', () => {
    const better = runEvoReview(
      inputs({ scanSize: pillar(85, 80), scanAesthetics: pillar(82, 80) })
    );
    expect(better.rating.displayedRating).toBeGreaterThan(declined.rating.displayedRating);
  });

  it('an athlete who never photographs themselves still gets a real rating', () => {
    expect(declined.rating.displayedRating).toBeGreaterThan(0);
    expect(declined.rating.descriptor).toBeTruthy();
    expect(Number.isFinite(declined.rating.overallConfidence)).toBe(true);
  });

  /**
   * The other half of the promise: a permanently photo-free athlete keeps
   * moving. Strength is recomputed from the LOG, so training — and only
   * training — is what changes their number.
   */
  it('training still raises the rating of an athlete with no scan, ever', () => {
    const stronger = runEvoReview(
      inputs({
        strengthObservations: inputs().strengthObservations.map((o) => ({
          ...o,
          weightKg: o.weightKg * 1.25,
        })),
      })
    );
    expect(stronger.rating.displayedRating).toBeGreaterThan(declined.rating.displayedRating);
    expect(stronger.pillars.size.score).toBe(declined.pillars.size.score);
  });
});

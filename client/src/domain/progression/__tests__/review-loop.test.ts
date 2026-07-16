import { describe, expect, it } from 'vitest';

import { confirmDecline, projectFromE1rm, stalenessOf } from '../evidence';
import { runEvoReview, type ReviewInputs } from '../evo-review';
import type { PillarResult } from '../types';

const TODAY = '2026-07-16';
const provisional = (score: number): PillarResult => ({
  score,
  confidence: 30,
  confidenceLabel: 'provisional',
  evidenceCount: 0,
  missingEvidence: [],
  limitingFactors: [],
});

describe('staleness — confidence erodes before any score does (spec §18)', () => {
  it('strength: fresh ≤28d, aging to 60d, stale after', () => {
    expect(stalenessOf('strength', '2026-07-01', TODAY)).toBe('fresh');
    expect(stalenessOf('strength', '2026-06-01', TODAY)).toBe('aging');
    expect(stalenessOf('strength', '2026-04-01', TODAY)).toBe('stale');
    expect(stalenessOf('strength', null, TODAY)).toBe('stale');
  });
});

describe('confirmDecline — one bad day is noise (spec §11/§17)', () => {
  const base = { expectedValue: 100, markers: [] as [] };
  it('a single low exposure never confirms', () => {
    expect(confirmDecline({ ...base, recentValues: [88, 101, 100] }).confirmed).toBe(false);
  });
  it('two of three below the noise floor confirms, at the median of the lows', () => {
    const v = confirmDecline({ ...base, recentValues: [90, 88, 101] });
    expect(v.confirmed).toBe(true);
    expect(v.confirmedValue).toBe(90);
  });
  it('declines inside the noise band do not count', () => {
    expect(confirmDecline({ ...base, recentValues: [96, 97, 98] }).reason).toBe('no_decline');
  });
  it('a deload / illness / injury marker protects the window absolutely', () => {
    const v = confirmDecline({ recentValues: [80, 78, 82], expectedValue: 100, markers: ['deload'] });
    expect(v).toMatchObject({ confirmed: false, reason: 'protected' });
  });
  it('one exposure is insufficient evidence', () => {
    expect(confirmDecline({ ...base, recentValues: [70] }).reason).toBe('insufficient_evidence');
  });
});

describe('projectFromE1rm — projections are ranges, attendance projects nothing', () => {
  it('a real e1RM gain projects a low–high range', () => {
    const p = projectFromE1rm({ category: 'Horizontal Press', previousBestE1rm: 100, newE1rm: 103 });
    expect(p).not.toBeNull();
    expect(p!.projectedImpactLow).toBeGreaterThan(0);
    expect(p!.projectedImpactHigh).toBeGreaterThan(p!.projectedImpactLow);
  });
  it('matching your old best projects nothing new', () => {
    expect(projectFromE1rm({ category: 'x', previousBestE1rm: 100, newE1rm: 100 })).toBeNull();
  });
  it('first-ever category coverage is its own kind of evidence', () => {
    expect(projectFromE1rm({ category: 'Hip Hinge', previousBestE1rm: null, newE1rm: 120 })?.sourceType).toBe(
      'new_category_coverage'
    );
  });
});

describe('runEvoReview — the weekly truth ceremony', () => {
  const baseInputs = (): ReviewInputs => ({
    todayIso: TODAY,
    sex: 'male',
    fallbackBodyweightKg: 90,
    priorState: null,
    priorPillars: null,
    strengthObservations: [
      { exercise: 'Bench Press', weightKg: 100, reps: 5, date: '2026-07-10' },
      { exercise: 'Bench Press', weightKg: 102.5, reps: 4, date: '2026-07-14' },
      { exercise: 'Back Squat', weightKg: 140, reps: 5, date: '2026-07-12' },
      { exercise: 'Back Squat', weightKg: 140, reps: 6, date: '2026-07-15' },
      { exercise: 'Conventional Deadlift', weightKg: 180, reps: 3, date: '2026-07-11' },
      { exercise: 'Barbell Row', weightKg: 90, reps: 8, date: '2026-07-13' },
      { exercise: 'Overhead Press', weightKg: 60, reps: 5, date: '2026-07-13' },
    ],
    cardioEvidence: { sex: 'male', aerobicTests: [], hasCardioTrainingHistory: true, todayIso: TODAY },
    scanSize: null,
    scanAesthetics: null,
    provisionalSize: provisional(55),
    provisionalAesthetics: provisional(50),
    lastStrengthEvidenceIso: '2026-07-15',
    lastCardioEvidenceIso: null,
  });

  it('a first review anchors starting = current = peak and explains itself', () => {
    const r = runEvoReview(baseInputs());
    expect(r.state.startingDisplayed).toBe(r.state.currentDisplayed);
    expect(r.state.peakDisplayed).toBe(r.state.currentDisplayed);
    expect(r.preserved.join()).toContain('Size');
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0]).toContain('Cardio');
  });

  it('without a new scan, Size and Aesthetics carry over EXACTLY', () => {
    const first = runEvoReview(baseInputs());
    const second = runEvoReview({
      ...baseInputs(),
      priorState: first.state,
      priorPillars: first.pillars,
    });
    expect(second.pillars.size.score).toBe(first.pillars.size.score);
    expect(second.pillars.aesthetics.score).toBe(first.pillars.aesthetics.score);
  });

  it('better strength evidence raises the rating and the peak ratchets', () => {
    const first = runEvoReview(baseInputs());
    const stronger = baseInputs();
    stronger.strengthObservations.push(
      { exercise: 'Bench Press', weightKg: 110, reps: 5, date: '2026-07-16' },
      { exercise: 'Back Squat', weightKg: 155, reps: 5, date: '2026-07-16' }
    );
    const second = runEvoReview({ ...stronger, priorState: first.state, priorPillars: first.pillars });
    expect(second.pillars.strength.score).toBeGreaterThan(first.pillars.strength.score);
    expect(second.state.peakRaw).toBeGreaterThanOrEqual(first.state.peakRaw);
    expect(second.changes.some((c) => c.pillar === 'strength')).toBe(true);
  });

  it('a weaker week lowers current but NEVER the peak; starting never moves', () => {
    const first = runEvoReview(baseInputs());
    const weaker = baseInputs();
    weaker.strengthObservations = weaker.strengthObservations.map((o) => ({ ...o, weightKg: o.weightKg * 0.8 }));
    const second = runEvoReview({ ...weaker, priorState: first.state, priorPillars: first.pillars });
    expect(second.state.currentRaw).toBeLessThan(first.state.currentRaw);
    expect(second.state.peakRaw).toBe(first.state.peakRaw);
    expect(second.state.startingRaw).toBe(first.state.startingRaw);
  });

  it('stale strength evidence cuts confidence, not the score basis', () => {
    const stale = baseInputs();
    stale.lastStrengthEvidenceIso = '2026-04-01';
    const fresh = runEvoReview(baseInputs());
    const staleR = runEvoReview(stale);
    expect(staleR.pillars.strength.confidence).toBeLessThan(fresh.pillars.strength.confidence);
  });
});

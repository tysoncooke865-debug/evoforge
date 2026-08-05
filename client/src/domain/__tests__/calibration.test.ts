import { describe, expect, it } from 'vitest';

import { calibrationSummary, type CalibrationInputs } from '../progression/calibration';

const base: CalibrationInputs = {
  row: null,
  workoutDays: 0,
  hasCardio: false,
  hasPhysiqueBaseline: false,
  photoPromptsDisabled: false,
  weeksTrained: 0,
};

const area = (input: CalibrationInputs, key: string) =>
  calibrationSummary(input).areas.find((a) => a.key === key)!;

describe('the rating while it is still learning', () => {
  it('a brand-new athlete is CALIBRATING, and is told exactly what starts it', () => {
    const s = calibrationSummary(base);
    expect(s.calibrating).toBe(true);
    expect(s.rating).toBeNull();
    expect(s.headline).toBe('CALIBRATING');
    expect(s.sub).toBe('Log your first workout to begin your rating.');
    expect(s.pillarsCalibrated).toBe(0);
  });

  it('every area names an ACTION, never a deficiency', () => {
    for (const a of calibrationSummary(base).areas) {
      expect(a.detail.length).toBeGreaterThan(0);
      expect(a.detail.toLowerCase()).not.toContain('missing');
      expect(a.detail.toLowerCase()).not.toContain('required');
    }
  });

  it('training flips the moment there is a workout, before any review runs', () => {
    expect(area(base, 'training').state).toBe('waiting');
    expect(area({ ...base, workoutDays: 1 }, 'training').state).toBe('calibrated');
    expect(area({ ...base, workoutDays: 1 }, 'training').detail).toBe('1 training day logged');
  });

  it('a provisional row reads as provisional and counts only calibrated pillars', () => {
    const s = calibrationSummary({
      ...base,
      workoutDays: 6,
      row: {
        displayed_rating: 58,
        overall_confidence: 22,
        strength_confidence: 70,
        cardio_confidence: 10,
        size_confidence: 20,
        aesthetics_confidence: 20,
        limiting_pillar: 'cardio',
        status: 'provisional',
      },
    });
    expect(s.headline).toBe('58 · PROVISIONAL');
    expect(s.sub).toBe('Provisional · 1 of 4 areas calibrated');
    expect(s.pillarsCalibrated).toBe(1);
    expect(s.limiting).toBe('cardio');
  });

  it('a confirmed row stops apologising for itself', () => {
    const s = calibrationSummary({
      ...base,
      workoutDays: 30,
      row: {
        displayed_rating: 71,
        overall_confidence: 68,
        strength_confidence: 80,
        cardio_confidence: 70,
        size_confidence: 66,
        aesthetics_confidence: 66,
        limiting_pillar: 'size',
        status: 'confirmed',
      },
    });
    expect(s.calibrating).toBe(false);
    expect(s.headline).toBe('71');
    expect(s.sub).toBe('4 of 4 areas calibrated');
  });
});

describe('the physique area, which is the one that must not nag', () => {
  it('reads as OPTIONAL, not outstanding, when no baseline exists', () => {
    expect(area(base, 'physique').state).toBe('waiting');
    expect(area(base, 'physique').detail).toBe('Optional private calibration');
  });

  it('reads as SETTLED once the athlete has said don’t ask again', () => {
    const a = area({ ...base, photoPromptsDisabled: true }, 'physique');
    expect(a.state).toBe('declined');
    expect(a.detail).toBe('Not used — you turned photo prompts off');
  });

  it('the opt-out survives even when a baseline was created earlier', () => {
    const a = area({ ...base, photoPromptsDisabled: true, hasPhysiqueBaseline: true }, 'physique');
    expect(a.state).toBe('declined');
  });

  /** The whole point: opting out of photos must not depress the number. */
  it('opting out changes no rating and no pillar count', () => {
    const row = {
      displayed_rating: 64,
      overall_confidence: 45,
      strength_confidence: 70,
      cardio_confidence: 60,
      size_confidence: 55,
      aesthetics_confidence: 55,
      limiting_pillar: 'cardio',
      status: 'confirmed',
    };
    const kept = calibrationSummary({ ...base, row, workoutDays: 20 });
    const declined = calibrationSummary({ ...base, row, workoutDays: 20, photoPromptsDisabled: true });
    expect(declined.rating).toBe(kept.rating);
    expect(declined.pillarsCalibrated).toBe(kept.pillarsCalibrated);
    expect(declined.headline).toBe(kept.headline);
  });
});

describe('robustness', () => {
  it('survives a row full of nonsense instead of rendering NaN', () => {
    const s = calibrationSummary({
      ...base,
      row: {
        displayed_rating: 'not a number',
        overall_confidence: undefined,
        limiting_pillar: 'elbows',
        status: 'confirmed',
      },
    });
    expect(s.rating).toBeNull();
    expect(s.confidence).toBeNull();
    expect(s.limiting).toBeNull();
    expect(s.headline).toBe('CALIBRATING');
    expect(s.areas).toHaveLength(5);
  });
});

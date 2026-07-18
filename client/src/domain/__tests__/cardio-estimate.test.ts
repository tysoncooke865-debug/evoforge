import { describe, expect, it } from 'vitest';

import { estimateCardioKcal } from '../cardio-estimate';

describe('estimateCardioKcal — MET arithmetic, honest nulls', () => {
  it('computes the standard MET formula (spot values)', () => {
    // Run: 9.8 MET × 3.5 × 80 kg / 200 × 30 min = 411.6 → 412
    expect(estimateCardioKcal('Run', 30, 80)).toBe(412);
    // Outdoor walk: 3.5 × 3.5 × 70 / 200 × 60 = 257.25 → 257
    expect(estimateCardioKcal('Outdoor walk', 60, 70)).toBe(257);
    // Boxing: 7.8 × 3.5 × 90 / 200 × 15 = 184.275 → 184
    expect(estimateCardioKcal('Boxing', 15, 90)).toBe(184);
  });

  it('returns null without a real bodyweight — never a fake number', () => {
    expect(estimateCardioKcal('Run', 30, null)).toBeNull();
    expect(estimateCardioKcal('Run', 30, undefined)).toBeNull();
    expect(estimateCardioKcal('Run', 30, 0)).toBeNull();
    expect(estimateCardioKcal('Run', 30, Number.NaN)).toBeNull();
  });

  it('returns null for zero minutes and unknown activities', () => {
    expect(estimateCardioKcal('Run', 0, 80)).toBeNull();
    expect(estimateCardioKcal('Run', -5, 80)).toBeNull();
    expect(estimateCardioKcal('Underwater basket weaving', 30, 80)).toBeNull();
  });

  it('covers every activity type the cardio catalogue ships', () => {
    for (const t of ['Treadmill incline walk', 'Outdoor walk', 'Run', 'Bike', 'Stairmaster', 'Boxing', 'Other']) {
      expect(estimateCardioKcal(t, 30, 80)).toBeGreaterThan(0);
    }
  });
});

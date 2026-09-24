import { describe, expect, it } from 'vitest';

import { goalTargets, type TargetInputs } from '../../../../../domain/nutrition';
import {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  buildSavePayload,
  dualIntakeError,
  dualRateInputsFromStored,
  dualRateTargets,
  dualTripleFromStored,
  legWithinDb,
  manualSavePayload,
} from '../model';

/** The domain test's reference athlete (nutrition.test.ts pins the symmetric
 *  triple 2248/2798/3348 from these at rate 0.5). Reusing them makes the
 *  asymmetry legible as a delta from a number already pinned elsewhere. */
const INPUTS: TargetInputs = {
  sex: 'male',
  weightKg: 80,
  heightCm: 180,
  age: 25,
  activity: 'moderate',
  goal: 'lose',
  ratePerWeekKg: 0.5,
};

const DUAL = {
  sex: INPUTS.sex,
  weightKg: INPUTS.weightKg,
  heightCm: INPUTS.heightCm,
  age: INPUTS.age,
  activity: INPUTS.activity,
  rateLossKgPerWeek: 0.5,
  rateGainKgPerWeek: 0.25,
} as const;

describe('dualRateTargets', () => {
  it('the asymmetry pin: cut 0.5 / bulk 0.25 quotes a modest surplus', () => {
    // Live symmetric math would say gain = 3348 (+550). The dual model says
    // +275: half the surplus, because the athlete chose half the rate.
    expect(dualRateTargets({ ...DUAL })).toEqual({ lose: 2248, maintain: 2798, gain: 3073 });
  });

  it('equal rates reproduce the live symmetric triple exactly', () => {
    expect(dualRateTargets({ ...DUAL, rateGainKgPerWeek: 0.5 })).toEqual(goalTargets(INPUTS));
  });

  it('maintain ignores both rates', () => {
    const a = dualRateTargets({ ...DUAL });
    const b = dualRateTargets({ ...DUAL, rateLossKgPerWeek: 1, rateGainKgPerWeek: 1 });
    expect(a.maintain).toBe(b.maintain);
  });

  it('the sex floor holds per leg on a small body', () => {
    const small = dualRateTargets({
      sex: 'female',
      weightKg: 45,
      heightCm: 150,
      age: 60,
      activity: 'sedentary',
      rateLossKgPerWeek: 1,
      rateGainKgPerWeek: 0.25,
    });
    expect(small.lose).toBe(1200);
    expect(small.gain).toBeGreaterThan(small.maintain);
  });
});

describe('dualRateInputsFromStored', () => {
  it('a pre-dual row (no gain rate) gets the 0.25 default, never the cut rate', () => {
    const parsed = dualRateInputsFromStored({ ...INPUTS });
    expect(parsed?.rateLossKgPerWeek).toBe(0.5);
    expect(parsed?.rateGainKgPerWeek).toBe(DEFAULT_GAIN_RATE_KG_PER_WEEK);
  });

  it('a stored gain rate survives round-trip', () => {
    const parsed = dualRateInputsFromStored({ ...INPUTS, rateGainKgPerWeek: 0.75 });
    expect(parsed?.rateGainKgPerWeek).toBe(0.75);
  });

  it('an out-of-range stored gain rate falls back to the default', () => {
    const parsed = dualRateInputsFromStored({ ...INPUTS, rateGainKgPerWeek: 4 });
    expect(parsed?.rateGainKgPerWeek).toBe(DEFAULT_GAIN_RATE_KG_PER_WEEK);
  });

  it('manual targets ({}) and garbage return null — a model is never invented', () => {
    expect(dualRateInputsFromStored({})).toBeNull();
    expect(dualRateInputsFromStored(null)).toBeNull();
    expect(dualRateInputsFromStored({ ...INPUTS, ratePerWeekKg: 9 })).toBeNull();
  });
});

describe('dualTripleFromStored', () => {
  it('stored triple columns win over derivation (081 contract)', () => {
    const row = {
      id: 'x',
      effective_from: '2026-08-01',
      daily_kcal: 2000,
      goal: 'lose' as const,
      inputs: { ...INPUTS },
      kcal_lose: 2000,
      kcal_maintain: 2500,
      kcal_gain: 2700,
    };
    expect(dualTripleFromStored(row)).toEqual({ lose: 2000, maintain: 2500, gain: 2700 });
  });

  it('null columns derive asymmetrically from inputs', () => {
    const row = {
      id: 'x',
      effective_from: '2026-08-01',
      daily_kcal: 2248,
      goal: 'lose' as const,
      inputs: { ...INPUTS },
      kcal_lose: null,
      kcal_maintain: null,
      kcal_gain: null,
    };
    expect(dualTripleFromStored(row)).toEqual({ lose: 2248, maintain: 2798, gain: 3073 });
  });
});

describe('validation + DB mirror', () => {
  it('dualIntakeError checks BOTH rates', () => {
    expect(dualIntakeError({ ...DUAL })).toBeNull();
    expect(dualIntakeError({ ...DUAL, rateLossKgPerWeek: 2 })).toMatch(/Rate/);
    expect(dualIntakeError({ ...DUAL, rateGainKgPerWeek: -1 })).toMatch(/Rate/);
  });

  it('legWithinDb mirrors the 037 CHECK', () => {
    expect(legWithinDb(1000)).toBe(true);
    expect(legWithinDb(6000)).toBe(true);
    expect(legWithinDb(999)).toBe(false);
    expect(legWithinDb(6001)).toBe(false);
    expect(legWithinDb(Number.NaN)).toBe(false);
  });
});

describe('buildSavePayload — the RECALCULATE write, pinned', () => {
  it('daily_kcal IS the chosen goal leg, and BOTH rates ride the inputs', () => {
    const p = buildSavePayload({ ...DUAL }, 'lose', '2026-09-24');
    expect(p).not.toBeNull();
    expect(p?.effectiveFrom).toBe('2026-09-24');
    expect(p?.dailyKcal).toBe(2248);
    expect(p?.goal).toBe('lose');
    expect(p?.triple).toEqual({ lose: 2248, maintain: 2798, gain: 3073 });
    expect(p?.inputs.ratePerWeekKg).toBe(0.5);
    expect(p?.inputs.rateGainKgPerWeek).toBe(0.25);
    expect(p?.inputs.age).toBe(25);
  });

  it('a maintain goal still persists both rates (nothing is forgotten)', () => {
    const p = buildSavePayload({ ...DUAL }, 'maintain', '2026-09-24');
    expect(p?.dailyKcal).toBe(2798);
    expect(p?.inputs.ratePerWeekKg).toBe(0.5);
    expect(p?.inputs.rateGainKgPerWeek).toBe(0.25);
  });

  it('unusable inputs and out-of-DB legs return null, never a payload', () => {
    expect(buildSavePayload({ ...DUAL, age: NaN }, 'lose', '2026-09-24')).toBeNull();
    expect(buildSavePayload({ ...DUAL, rateLossKgPerWeek: 3 }, 'lose', '2026-09-24')).toBeNull();
  });
});

describe('manualSavePayload — the SET MANUALLY write, pinned', () => {
  it('the in-force goal carries forward; none defaults to maintain', () => {
    expect(manualSavePayload(2600, 'lose', { ...INPUTS }, '2026-09-24')?.goal).toBe('lose');
    expect(manualSavePayload(2600, null, null, '2026-09-24')?.goal).toBe('maintain');
  });

  it('the triple is EXPLICITLY cleared and only a plausible weightKg survives', () => {
    const p = manualSavePayload(2600, 'gain', { ...INPUTS }, '2026-09-24');
    expect(p?.triple).toBeNull();
    expect(p?.inputs).toEqual({ weightKg: 80 });
    // No stored weight (manual-over-manual) → empty inputs, not an invention.
    expect(manualSavePayload(2600, 'gain', {}, '2026-09-24')?.inputs).toEqual({});
    // An implausible stored weight is dropped, not laundered into the row.
    expect(manualSavePayload(2600, 'gain', { weightKg: 9 }, '2026-09-24')?.inputs).toEqual({});
  });

  it('mirrors 037: outside 1,000–6,000 (after rounding) is refused', () => {
    expect(manualSavePayload(999, 'lose', null, '2026-09-24')).toBeNull();
    expect(manualSavePayload(6001, 'lose', null, '2026-09-24')).toBeNull();
    expect(manualSavePayload(null, 'lose', null, '2026-09-24')).toBeNull();
    expect(manualSavePayload(999.6, 'lose', null, '2026-09-24')?.dailyKcal).toBe(1000);
  });
});

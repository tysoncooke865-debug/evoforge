import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_FACTORS,
  FLOOR_KCAL,
  KJ_PER_KCAL,
  dailyTarget,
  intakeError,
  intakeProgress,
  kcalToKj,
  kjToKcal,
  meterState,
  mifflinStJeor,
  type TargetInputs,
} from '../nutrition';

// Reference bodies. The Mifflin–St Jeor numbers below are hand-computed from
// the published formula — if a "refactor" moves them, the formula changed.
const MALE = { sex: 'male', weightKg: 80, heightCm: 180, age: 25 } as const;
const FEMALE = { sex: 'female', weightKg: 65, heightCm: 165, age: 30 } as const;

const target = (over: Partial<TargetInputs> = {}): number =>
  dailyTarget({ ...MALE, activity: 'moderate', goal: 'maintain', ratePerWeekKg: 0, ...over });

describe('kJ ⇄ kcal', () => {
  it('pins the constant: 1 kcal = 4.184 kJ exactly', () => {
    expect(KJ_PER_KCAL).toBe(4.184);
  });

  it('converts an AU label: 2000 kJ ≈ 478 kcal', () => {
    expect(Math.round(kjToKcal(2000))).toBe(478);
  });

  it('round-trips without drift', () => {
    expect(kjToKcal(kcalToKj(2300))).toBeCloseTo(2300, 9);
  });
});

describe('mifflinStJeor — the published formula, verbatim', () => {
  it('male 80kg/180cm/25y = 1805 (10·80 + 6.25·180 − 5·25 + 5)', () => {
    expect(mifflinStJeor(MALE)).toBe(1805);
  });

  it('female 65kg/165cm/30y = 1370.25 (… − 161)', () => {
    expect(mifflinStJeor(FEMALE)).toBe(1370.25);
  });

  it('the sex offset is +5 / −161, nothing else differs', () => {
    expect(mifflinStJeor({ ...MALE, sex: 'female' })).toBe(1805 - 5 - 161);
  });
});

describe('dailyTarget', () => {
  it('maintain = BMR × activity, rounded (positive control: 1805 × 1.55 = 2798)', () => {
    expect(target()).toBe(2798);
  });

  it('every activity factor is wired, ascending', () => {
    const targets = (Object.keys(ACTIVITY_FACTORS) as (keyof typeof ACTIVITY_FACTORS)[]).map(
      (activity) => target({ activity })
    );
    expect(targets).toHaveLength(5); // a guard over an empty set guards nothing
    expect([...targets].sort((a, b) => a - b)).toEqual(targets);
  });

  it('lose 0.5 kg/week ≈ −550/day: 2798 − 550 = 2248', () => {
    expect(target({ goal: 'lose', ratePerWeekKg: 0.5 })).toBe(2248);
  });

  it('gain 0.25 kg/week ≈ +275/day', () => {
    expect(target({ goal: 'gain', ratePerWeekKg: 0.25 })).toBe(2798 + 275);
  });

  it('maintain ignores a stray rate', () => {
    expect(target({ goal: 'maintain', ratePerWeekKg: 1 })).toBe(2798);
  });

  it('the rate is clamped to 1 kg/week — a typo is not a plan', () => {
    expect(target({ goal: 'lose', ratePerWeekKg: 5 })).toBe(
      target({ goal: 'lose', ratePerWeekKg: 1 })
    );
    expect(target({ goal: 'lose', ratePerWeekKg: -2 })).toBe(target());
  });

  describe('THE SAFETY FLOOR — the hard rule', () => {
    // A small, older, sedentary body on an aggressive cut: the raw arithmetic
    // lands near zero. The target must refuse to follow it.
    const SMALL = { sex: 'female', weightKg: 45, heightCm: 150, age: 80 } as const;

    it('an aggressive cut cannot push a female target below 1200', () => {
      expect(
        dailyTarget({ ...SMALL, activity: 'sedentary', goal: 'lose', ratePerWeekKg: 1 })
      ).toBe(FLOOR_KCAL.female);
    });

    it('nor a male target below 1500', () => {
      expect(
        dailyTarget({ ...SMALL, sex: 'male', activity: 'sedentary', goal: 'lose', ratePerWeekKg: 1 })
      ).toBe(FLOOR_KCAL.male);
    });

    it('positive control: a normal body is NOT sitting on the floor', () => {
      // If this fails, the floor test above is passing vacuously.
      expect(target({ goal: 'lose', ratePerWeekKg: 1 })).toBeGreaterThan(FLOOR_KCAL.male);
    });
  });
});

describe('intakeError — what the review card refuses', () => {
  const OK: TargetInputs = { ...MALE, activity: 'moderate', goal: 'lose', ratePerWeekKg: 0.5 };

  it('accepts a sane intake (positive control)', () => {
    expect(intakeError(OK)).toBeNull();
  });

  it.each([
    ['age 12', { age: 12 }],
    ['age 101', { age: 101 }],
    ['age NaN', { age: Number.NaN }],
    ['weight 29', { weightKg: 29 }],
    ['weight 301', { weightKg: 301 }],
    ['height 119', { heightCm: 119 }],
    ['height 231', { heightCm: 231 }],
    ['rate 1.5 on a cut', { ratePerWeekKg: 1.5 }],
    ['negative rate', { ratePerWeekKg: -0.5 }],
  ] as const)('rejects %s', (_label, patch) => {
    expect(intakeError({ ...OK, ...patch })).not.toBeNull();
  });

  it('maintain does not care about the rate field', () => {
    expect(intakeError({ ...OK, goal: 'maintain', ratePerWeekKg: 99 })).toBeNull();
  });
});

describe('intakeProgress', () => {
  const entries = [{ kcal: 500 }, { kcal: 340 }, { kcal: 1000 }];

  it('sums the day against the target', () => {
    expect(intakeProgress(entries, 2300)).toEqual({
      consumed: 1840,
      remaining: 460,
      over: 0,
      barPct: 80,
    });
  });

  it('over budget: remaining floors at 0, over says by how much, the bar stops at 100', () => {
    const p = intakeProgress([{ kcal: 2500 }], 2300);
    expect(p).toMatchObject({ consumed: 2500, remaining: 0, over: 200 });
    expect(p.barPct).toBe(100);
  });

  it('garbage rows count nothing', () => {
    expect(intakeProgress([{ kcal: -100 }, { kcal: 'soup' }, {}], 2000).consumed).toBe(0);
  });

  it('no target yet → the bar has nowhere to go', () => {
    expect(intakeProgress(entries, 0).barPct).toBe(0);
  });
});

describe('meterState — the colour must not lie about the goal', () => {
  it('under budget is under, whatever the goal', () => {
    expect(meterState(1800, 2300, 'lose')).toBe('under');
    expect(meterState(1800, 2300, 'gain')).toBe('under');
  });

  it('a cut EXCEEDED is the warn state; landing ON the budget is not', () => {
    expect(meterState(2301, 2300, 'lose')).toBe('over_cut');
    expect(meterState(2300, 2300, 'lose')).toBe('under');
  });

  it('a bulk/maintain target REACHED is the success state — eating enough is the win', () => {
    expect(meterState(2300, 2300, 'gain')).toBe('reached');
    expect(meterState(2400, 2300, 'maintain')).toBe('reached');
  });
});

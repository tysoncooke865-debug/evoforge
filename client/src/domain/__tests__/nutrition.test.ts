import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_FACTORS,
  DEFAULT_MACRO_TARGETS,
  FLOOR_KCAL,
  KJ_PER_KCAL,
  canAddMeal,
  evalEnergyExpression,
  canRemoveMeal,
  dailyTarget,
  effectiveMealCount,
  goalTargets,
  goalTargetsFromInputs,
  highestMealNo,
  intakeError,
  GOAL_SHORT,
  intakeProgress,
  kcalToKj,
  kjToKcal,
  macroProgress,
  macroTargetsFor,
  mealMacroTotals,
  mealSlotName,
  mealTotals,
  meterState,
  mifflinStJeor,
  streakDays,
  type TargetInputs,
} from '../nutrition';

// Reference bodies. The Mifflin–St Jeor numbers below are hand-computed from
// the published formula — if a "refactor" moves them, the formula changed.
const MALE = { sex: 'male', weightKg: 80, heightCm: 180, age: 25 } as const;
const FEMALE = { sex: 'female', weightKg: 65, heightCm: 165, age: 30 } as const;

const target = (over: Partial<TargetInputs> = {}): number =>
  dailyTarget({ ...MALE, activity: 'moderate', goal: 'maintain', ratePerWeekKg: 0, ...over });

describe('the GOAL TRIPLE (081) — cut/maintain/bulk without another intake', () => {
  const INPUTS: TargetInputs = { ...MALE, activity: 'moderate', goal: 'maintain', ratePerWeekKg: 0.5 };

  it('pins all three legs against the single-goal references', () => {
    expect(goalTargets(INPUTS)).toEqual({ lose: 2248, maintain: 2798, gain: 3348 });
  });

  it('maintain ignores the rate', () => {
    expect(goalTargets({ ...INPUTS, ratePerWeekKg: 1 }).maintain).toBe(
      goalTargets({ ...INPUTS, ratePerWeekKg: 0 }).maintain
    );
  });

  it('each leg keeps the safety floor independently', () => {
    // FEMALE sedentary: TDEE 1370.25 × 1.2 = 1644; max rate subtracts 1100 →
    // the cut leg alone crosses the floor.
    const small: TargetInputs = {
      ...FEMALE, activity: 'sedentary', goal: 'maintain', ratePerWeekKg: 1,
    };
    const t = goalTargets(small);
    expect(t.lose).toBe(FLOOR_KCAL.female); // 1200 — the arithmetic went below it
    expect(t.maintain).toBe(1644);
    expect(t.maintain).toBeGreaterThan(FLOOR_KCAL.female);
  });

  it('goalTargetsFromInputs: a stored AI-intake blob derives the triple', () => {
    expect(goalTargetsFromInputs({ ...INPUTS })).toEqual({ lose: 2248, maintain: 2798, gain: 3348 });
  });

  it('manual targets ({} inputs) and garbage derive NOTHING', () => {
    expect(goalTargetsFromInputs({})).toBeNull();
    expect(goalTargetsFromInputs(null)).toBeNull();
    expect(goalTargetsFromInputs(undefined)).toBeNull();
    expect(goalTargetsFromInputs({ ...INPUTS, ratePerWeekKg: undefined })).toBeNull(); // never invent a rate
    expect(goalTargetsFromInputs({ ...INPUTS, age: 999 })).toBeNull();
    expect(goalTargetsFromInputs({ ...INPUTS, activity: 'sometimes' as never })).toBeNull();
    expect(goalTargetsFromInputs({ ...INPUTS, weightKg: 'heavy' as never })).toBeNull();
  });

  it('GOAL_SHORT speaks lifter: CUT / MAINTAIN / BULK', () => {
    expect(GOAL_SHORT).toEqual({ lose: 'CUT', maintain: 'MAINTAIN', gain: 'BULK' });
  });
});

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

describe('meals — the day structured like Train structures sets', () => {
  const meal = (n: number | null, kcal: number) => ({ meal_no: n, kcal });

  it('highestMealNo: 0 on an empty day and on quick-add-only days', () => {
    expect(highestMealNo([])).toBe(0);
    expect(highestMealNo([meal(null, 500), meal(null, 300)])).toBe(0);
  });

  it('effectiveMealCount: never touched → the default three', () => {
    expect(effectiveMealCount(null, [])).toBe(3);
  });

  it('effectiveMealCount: the athlete can shrink to one, and entries force it back UP', () => {
    expect(effectiveMealCount(1, [])).toBe(1);
    expect(effectiveMealCount(2, [meal(5, 400)])).toBe(5);
  });

  it('effectiveMealCount clamps at the ceiling', () => {
    expect(effectiveMealCount(99, [])).toBe(8);
    expect(effectiveMealCount(3, [meal(12, 200)])).toBe(8);
  });

  it('mealTotals groups by slot and ignores quick-adds, strays and garbage', () => {
    const entries = [
      meal(1, 300),
      meal(1, 200),
      meal(3, 650),
      meal(null, 999), // quick-add — no slot
      meal(9, 100), // beyond the rendered count — ignored
      { meal_no: 2, kcal: 'soup' }, // garbage kcal
    ];
    expect(mealTotals(entries, 3)).toEqual([500, 0, 650]);
  });

  it('canAddMeal stops at the ceiling', () => {
    expect(canAddMeal(7)).toBe(true);
    expect(canAddMeal(8)).toBe(false);
  });

  it('canRemoveMeal: free down to one on an empty day', () => {
    expect(canRemoveMeal(3, [])).toBe(true);
    expect(canRemoveMeal(1, [])).toBe(false);
  });

  it('canRemoveMeal: a logged slot can never be removed out from under its entries', () => {
    // Falsified once at authoring: dropped the highestMealNo floor, watched
    // this go red (canRemoveMeal(2, [meal(2)]) returned true), restored.
    expect(canRemoveMeal(2, [meal(2, 400)])).toBe(false);
    expect(canRemoveMeal(3, [meal(2, 400)])).toBe(true);
  });
});

describe('mealSlotName — position IS meaning', () => {
  it('names the first four slots, numbers the rest', () => {
    expect([1, 2, 3, 4, 5, 8].map((n) => mealSlotName(n))).toEqual([
      'BREAKFAST',
      'LUNCH',
      'DINNER',
      'SNACKS',
      'MEAL 5',
      'MEAL 8',
    ]);
  });

  it('custom names win, blanks and nulls fall back (056)', () => {
    const names = ['Morning Fuel', null, '  ', 'Post-Workout'];
    expect(mealSlotName(1, names)).toBe('MORNING FUEL');
    expect(mealSlotName(2, names)).toBe('LUNCH');
    expect(mealSlotName(3, names)).toBe('DINNER');
    expect(mealSlotName(4, names)).toBe('POST-WORKOUT');
    expect(mealSlotName(5, names)).toBe('MEAL 5');
  });

  it('clamps a custom name to 24 chars and never throws on garbage', () => {
    expect(mealSlotName(1, ['x'.repeat(40)])).toBe('X'.repeat(24));
    expect(mealSlotName(1, null)).toBe('BREAKFAST');
    expect(mealSlotName(1, undefined)).toBe('BREAKFAST');
  });
});

describe('macroProgress — grams are summed, never invented', () => {
  it('sums the macro columns and rounds', () => {
    expect(
      macroProgress([
        { protein_g: 28.4, carbs_g: 40, fat_g: 12 },
        { protein_g: 30.2, carbs_g: 22.5, fat_g: 6.1 },
      ])
    ).toEqual({ protein: 59, carbs: 63, fat: 18 });
  });

  it('a manual kcal-only entry contributes nothing', () => {
    expect(macroProgress([{ kcal: 700 }])).toEqual({ protein: 0, carbs: 0, fat: 0 });
  });

  it('garbage and negatives count nothing', () => {
    expect(macroProgress([{ protein_g: 'soup', carbs_g: -5, fat_g: null }])).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('macroTargetsFor — derived, never stored, never from the AI', () => {
  it('no target → the spec defaults, verbatim', () => {
    expect(macroTargetsFor(null)).toEqual(DEFAULT_MACRO_TARGETS);
    expect(macroTargetsFor({ daily_kcal: 0 })).toEqual(DEFAULT_MACRO_TARGETS);
  });

  it('with a body weight, protein is 2 g/kg (80 kg → 160 g)', () => {
    expect(macroTargetsFor({ daily_kcal: 2000, inputs: { weightKg: 80 } }).protein).toBe(160);
  });

  it('without a weight, protein is 30% of kcal at 4 kcal/g (2000 → 150 g)', () => {
    expect(macroTargetsFor({ daily_kcal: 2000 }).protein).toBe(150);
  });

  it('carbs 40% at 4 kcal/g, fat 30% at 9 kcal/g, rounded to 5 g', () => {
    // 2000 kcal: carbs 800/4 = 200; fat 600/9 = 66.7 → 65.
    expect(macroTargetsFor({ daily_kcal: 2000 })).toMatchObject({ carbs: 200, fat: 65 });
  });

  it('an out-of-range weight falls back to the kcal split, not 2 g/kg', () => {
    expect(macroTargetsFor({ daily_kcal: 2000, inputs: { weightKg: 999 } }).protein).toBe(150);
  });
});

describe('mealMacroTotals — kcal + protein per slot', () => {
  it('groups both numbers by slot with mealTotals tolerance', () => {
    const entries = [
      { meal_no: 1, kcal: 320, protein_g: 28 },
      { meal_no: 1, kcal: 100, protein_g: 2.4 },
      { meal_no: 3, kcal: 650 }, // manual — no macros
      { meal_no: null, kcal: 999, protein_g: 50 }, // quick-add — no slot
      { meal_no: 9, kcal: 100, protein_g: 10 }, // beyond the count
    ];
    expect(mealMacroTotals(entries, 3)).toEqual([
      { kcal: 420, protein: 30 },
      { kcal: 0, protein: 0 },
      { kcal: 650, protein: 0 },
    ]);
  });
});

describe('streakDays — the run ends when a day was truly missed', () => {
  const days = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'];

  it('counts back from a logged today', () => {
    expect(streakDays([...days, '2026-07-18'], '2026-07-18')).toBe(6);
  });

  it('an unlogged TODAY does not break the run — 7am has not failed yet', () => {
    expect(streakDays(days, '2026-07-18')).toBe(5);
  });

  it('a gap two days back ends the run', () => {
    expect(streakDays(['2026-07-15', '2026-07-17', '2026-07-18'], '2026-07-18')).toBe(2);
  });

  it('nothing logged → 0, and a month boundary walks correctly', () => {
    expect(streakDays([], '2026-07-18')).toBe(0);
    expect(streakDays(['2026-06-30', '2026-07-01'], '2026-07-01')).toBe(2);
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

describe('evalEnergyExpression — the label calculator', () => {
  it('the headline case: 435*5 is the five-serving total', () => {
    expect(evalEnergyExpression('435*5')).toBe(2175);
  });

  it('all four operators, with normal precedence', () => {
    expect(evalEnergyExpression('100+50')).toBe(150);
    expect(evalEnergyExpression('100-30')).toBe(70);
    expect(evalEnergyExpression('1650/4')).toBe(412.5);
    expect(evalEnergyExpression('2+3*4')).toBe(14); // never 20
    expect(evalEnergyExpression('1650/4+300')).toBe(712.5);
    expect(evalEnergyExpression('10-2*3')).toBe(4);
  });

  it('decimals in any position', () => {
    expect(evalEnergyExpression('12.5*4')).toBe(50);
    expect(evalEnergyExpression('.5*10')).toBe(5);
    expect(evalEnergyExpression('435*2.')).toBe(870); // mid-typing decimal
  });

  it('the keypad glyphs (× ÷ −) and x/X mean the same operators', () => {
    expect(evalEnergyExpression('435×5')).toBe(2175);
    expect(evalEnergyExpression('1650÷4')).toBe(412.5);
    expect(evalEnergyExpression('100−30')).toBe(70);
    expect(evalEnergyExpression('435x5')).toBe(2175);
    expect(evalEnergyExpression('435X5')).toBe(2175);
  });

  it('LENIENT WHILE TYPING: a trailing operator evaluates what is complete', () => {
    expect(evalEnergyExpression('435*')).toBe(435);
    expect(evalEnergyExpression('435*5+')).toBe(2175);
  });

  it('a plain number keeps pyFloat semantics (the pre-calculator contract)', () => {
    expect(evalEnergyExpression('435')).toBe(435);
    expect(evalEnergyExpression('  435 ')).toBe(435);
    expect(evalEnergyExpression('-5')).toBe(-5);
    expect(evalEnergyExpression('')).toBeNull();
  });

  it('unary minus inside an expression', () => {
    expect(evalEnergyExpression('10*-2')).toBe(-20);
    expect(evalEnergyExpression('-5+10')).toBe(5);
  });

  it('malformed input is null, never NaN/Infinity', () => {
    expect(evalEnergyExpression('abc')).toBeNull();
    expect(evalEnergyExpression('4a5*5')).toBeNull();
    expect(evalEnergyExpression('435**5')).toBeNull(); // * is not a unary op
    expect(evalEnergyExpression('10/0')).toBeNull(); // division by zero
    expect(evalEnergyExpression('1.2.3*2')).toBeNull();
    expect(evalEnergyExpression('*5')).toBeNull(); // leading binary operator
  });

  it('whitespace anywhere is tolerated', () => {
    expect(evalEnergyExpression('435 * 5')).toBe(2175);
    expect(evalEnergyExpression(' 100 + 50 ')).toBe(150);
  });
});

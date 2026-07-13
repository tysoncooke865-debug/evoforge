import { describe, expect, it } from 'vitest';

import { PPPPLA_DAYS, flattenPlan, groupPlanRows, validatePlan } from '../custom-plan';

const goodPlan = () => ({
  plan_name: 'Aesthetic Forge v1',
  rationale: 'width first',
  days: PPPPLA_DAYS.map((day) => ({
    day,
    goal: `goal for ${day}`,
    exercises: [
      { exercise: 'Incline Dumbbell Bench Press', sets: 4, reps: '8-12', reason: 'upper chest lags' },
      { exercise: 'Lat Pulldown', sets: 3, reps: '10-12', reason: 'width' },
      { exercise: 'Cable Lateral Raise', sets: 3, reps: '12-15', reason: 'delts' },
      { exercise: 'Leg Press', sets: 3, reps: '10', reason: 'volume' },
    ],
  })),
});

describe('validatePlan', () => {
  it('the canonical day list is the live routine (non-empty, six days)', () => {
    expect(PPPPLA_DAYS.length).toBe(6);
  });

  it('accepts a well-formed plan', () => {
    const { plan, error } = validatePlan(goodPlan());
    expect(error).toBeNull();
    expect(plan?.days.length).toBe(6);
  });

  it('rejects wrong day names, missing days, duplicates', () => {
    const wrongName = goodPlan();
    wrongName.days[0].day = 'Push Day Alpha';
    expect(validatePlan(wrongName).error).toMatch(/unknown day/);

    const missing = goodPlan();
    missing.days.pop();
    expect(validatePlan(missing).error).toMatch(/expected 6 days/);

    const dupe = goodPlan();
    dupe.days[1].day = dupe.days[0].day;
    expect(validatePlan(dupe).error).toMatch(/duplicate/);
  });

  it('clamps absurd sets and rejects empty exercises', () => {
    const wild = goodPlan();
    wild.days[0].exercises[0].sets = 99 as never;
    expect(validatePlan(wild).plan?.days[0].exercises[0].sets).toBe(8);

    const empty = goodPlan();
    empty.days[0].exercises[0].exercise = '';
    expect(validatePlan(empty).error).toMatch(/exercise\/reps missing/);
  });
});

describe('flatten ↔ group round-trip', () => {
  it('rows regroup into the same plan, week-ordered', () => {
    const { plan } = validatePlan(goodPlan());
    const rows = flattenPlan(plan!, '2026-07-12T10:00:00');
    expect(rows.length).toBe(24);
    expect(rows[0].muscle.length).toBeGreaterThan(0); // inferMuscleGroup ran
    const grouped = groupPlanRows(rows);
    expect(grouped?.plan_name).toBe('Aesthetic Forge v1');
    expect(grouped?.days.map((d) => d.day)).toEqual([...PPPPLA_DAYS]);
  });

  it('the NEWEST plan wins when old rows linger', () => {
    const { plan } = validatePlan(goodPlan());
    const oldRows = flattenPlan({ ...plan!, plan_name: 'Old Plan' }, '2026-07-01T10:00:00');
    const newRows = flattenPlan(plan!, '2026-07-12T10:00:00');
    const grouped = groupPlanRows([...oldRows, ...newRows]);
    expect(grouped?.plan_name).toBe('Aesthetic Forge v1');
  });

  it('empty rows → null', () => {
    expect(groupPlanRows([])).toBeNull();
  });
});

describe('REGRESSION: a custom split must survive the round-trip', () => {
  // THE BUG (shipped, found 2026-07-14): groupPlanRows kept only days whose
  // names are in PPPPLA_DAYS, so a routine-builder / onboarding-seeded split
  // ("Push", "Chest & Back", …) had EVERY day filtered out. It returned null,
  // "MY PLAN" never appeared on Train, and the athlete's split existed in the
  // database while being invisible in the app.
  const customSplit = {
    plan_name: 'Chest&Back / Arms / Legs&Core · 3 days',
    days: [
      { day: 'Chest & Back', goal: '', exercises: [{ exercise: 'Barbell Bench Press', sets: 4, reps: '5-8', reason: '' }] },
      { day: 'Arms', goal: '', exercises: [{ exercise: 'EZ-Bar Curl', sets: 3, reps: '8-12', reason: '' }] },
      { day: 'Legs & Core', goal: '', exercises: [{ exercise: 'Barbell Back Squat', sets: 4, reps: '5-8', reason: '' }] },
    ],
  };

  it('non-PPPPLA day names SURVIVE the round-trip, in their own order', () => {
    const rows = flattenPlan(customSplit, '2026-07-14T10:00:00');
    const grouped = groupPlanRows(rows);
    expect(grouped).not.toBeNull();
    expect(grouped!.days.map((d) => d.day)).toEqual(['Chest & Back', 'Arms', 'Legs & Core']);
    expect(grouped!.days[1].exercises[0].exercise).toBe('EZ-Bar Curl');
  });

  it('day order survives even when the database hands rows back SHUFFLED', () => {
    // A plain SELECT gives no order guarantee; flattenPlan stamps each row
    // distinctly and groupPlanRows sorts on it.
    const rows = flattenPlan(customSplit, '2026-07-14T10:00:00');
    const shuffled = [...rows].reverse();
    expect(groupPlanRows(shuffled)!.days.map((d) => d.day)).toEqual([
      'Chest & Back',
      'Arms',
      'Legs & Core',
    ]);
  });

  it('a plan of the built-in six still comes back in CANONICAL week order', () => {
    const { plan } = validatePlan(goodPlan());
    const rows = flattenPlan(plan!, '2026-07-14T10:00:00');
    const grouped = groupPlanRows([...rows].reverse());
    expect(grouped!.days.map((d) => d.day)).toEqual([...PPPPLA_DAYS]);
  });

  it('exercise order within a day is preserved too', () => {
    const { plan } = validatePlan(goodPlan());
    const rows = flattenPlan(plan!, '2026-07-14T10:00:00');
    const grouped = groupPlanRows([...rows].reverse());
    expect(grouped!.days[0].exercises.map((e) => e.exercise)).toEqual(
      plan!.days[0].exercises.map((e) => e.exercise)
    );
  });
});

describe("flattenPlan and the athlete's own exercises (STAGE 1)", () => {
  const customPlan = () => {
    const p = goodPlan();
    p.days[0].exercises[0] = {
      exercise: 'Jefferson Curl',
      sets: 3,
      reps: '8-12',
      reason: 'spinal flexion',
    };
    return p;
  };

  it('a custom exercise carries the muscle the ATHLETE chose', () => {
    const { plan } = validatePlan(customPlan());
    const rows = flattenPlan(plan!, '2026-07-13T10:00:00', [
      { name: 'Jefferson Curl', muscle: 'Hamstrings' },
    ]);
    expect(rows[0]).toMatchObject({ exercise: 'Jefferson Curl', muscle: 'Hamstrings' });
  });

  it('POSITIVE CONTROL: without their list, the same name only INFERS', () => {
    // Proves the previous test measured the threading, not a coincidence —
    // inferMuscleGroup has never seen "Jefferson Curl" and cannot know it is
    // a hamstring lift.
    const { plan } = validatePlan(customPlan());
    const rows = flattenPlan(plan!, '2026-07-13T10:00:00');
    expect(rows[0].muscle).not.toBe('Hamstrings');
  });

  it('the default [] keeps every existing caller byte-identical', () => {
    const { plan } = validatePlan(goodPlan());
    expect(flattenPlan(plan!, '2026-07-13T10:00:00')).toEqual(
      flattenPlan(plan!, '2026-07-13T10:00:00', [])
    );
  });
});

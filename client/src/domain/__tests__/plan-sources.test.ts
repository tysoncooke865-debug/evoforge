import { describe, expect, it } from 'vitest';

import type { CustomPlan } from '../custom-plan';
import {
  daysForSource,
  defaultSource,
  resolveActiveSource,
  resolveDayIn,
  resolvePlanSources,
  supersetsOf,
  type RoutineLike,
} from '../plan-sources';

const BUILT_IN = ['Push 1 - Strength', 'Pull 1 - Back Thickness', 'Legs'];

const plan = (name: string, days: string[]): CustomPlan => ({
  plan_name: name,
  days: days.map((d) => ({
    day: d,
    goal: '',
    exercises: [{ exercise: 'Barbell Bench Press', sets: 3, reps: '8-12', reason: '' }],
  })),
});

const AI_SHAPED = plan('Oracle Forge', BUILT_IN);
const BUILDER_SHAPED = plan('My Split', ['Chest & Back', 'Arms', 'Legs & Core']);

const EMPTY = { customPlan: null, aiPlan: null, builtInDays: BUILT_IN };

// 062: looksLikeAiPlan moved into the migration (the legacy slot was
// classified once, server-side, at copy time). The resolver is plain now.

describe('resolvePlanSources', () => {
  it('nothing anywhere → both slots empty, built-in still available', () => {
    const s = resolvePlanSources(EMPTY);
    expect(s).toMatchObject({ myPlan: null, aiPlan: null, has: { myPlan: false, aiPlan: false } });
    expect(defaultSource(s)).toBe(2);
  });

  it('THE FIX: a hand-built plan and an AI plan COEXIST', () => {
    // Before 018 these shared one slot and destroyed each other.
    const s = resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED, aiPlan: AI_SHAPED });
    expect(s.myPlan?.plan_name).toBe('My Split');
    expect(s.aiPlan?.plan_name).toBe('Oracle Forge');
    expect(s.has).toEqual({ myPlan: true, aiPlan: true });
  });

  it('062: each user_plans slot maps 1:1 — no legacy shadow input exists', () => {
    const s = resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED });
    expect(s.myPlan?.plan_name).toBe('My Split');
    expect(s.aiPlan).toBeNull();
    const s2 = resolvePlanSources({ ...EMPTY, aiPlan: AI_SHAPED });
    expect(s2.aiPlan?.plan_name).toBe('Oracle Forge');
    expect(s2.myPlan).toBeNull();
  });
});

describe('daysForSource', () => {
  const sources = resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED, aiPlan: AI_SHAPED });

  it('each source drives its own day list, in its own order', () => {
    expect(daysForSource(0, sources, BUILT_IN)).toEqual(['Chest & Back', 'Arms', 'Legs & Core']);
    expect(daysForSource(1, sources, BUILT_IN)).toEqual(BUILT_IN);
    expect(daysForSource(2, sources, BUILT_IN)).toEqual(BUILT_IN);
  });

  it('an empty source has no days (the tab says so; it never fakes a day)', () => {
    expect(daysForSource(0, resolvePlanSources(EMPTY), BUILT_IN)).toEqual([]);
  });
});

describe('defaultSource — open on what the athlete meant to train', () => {
  it('their own plan wins', () => {
    expect(defaultSource(resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED, aiPlan: AI_SHAPED }))).toBe(0);
  });
  it('else the AI’s', () => {
    expect(defaultSource(resolvePlanSources({ ...EMPTY, aiPlan: AI_SHAPED }))).toBe(1);
  });
  it('else built-in', () => {
    expect(defaultSource(resolvePlanSources(EMPTY))).toBe(2);
  });
});

describe('resolveActiveSource — the saved choice survives reloads (035)', () => {
  const BOTH = resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED, aiPlan: AI_SHAPED });

  it('never chosen (null) → exactly defaultSource, existing users unchanged', () => {
    expect(resolveActiveSource(null, BOTH)).toBe(0);
    expect(resolveActiveSource(null, resolvePlanSources({ ...EMPTY, aiPlan: AI_SHAPED }))).toBe(1);
    expect(resolveActiveSource(null, resolvePlanSources(EMPTY))).toBe(2);
  });

  it('THE FIX: a saved BUILT-IN sticks even when a custom plan exists', () => {
    // Pre-035 this snapped back to MY PLAN on every reload.
    expect(resolveActiveSource(2, BOTH)).toBe(2);
  });

  it('a saved plan choice sticks while its plan exists', () => {
    expect(resolveActiveSource(0, BOTH)).toBe(0);
    expect(resolveActiveSource(1, BOTH)).toBe(1);
  });

  it('a saved AI PLAN whose plan was deleted falls back for display', () => {
    const onlyCustom = resolvePlanSources({ ...EMPTY, customPlan: BUILDER_SHAPED });
    expect(resolveActiveSource(1, onlyCustom)).toBe(0);
  });

  it('a saved MY PLAN with no plans anywhere lands on built-in', () => {
    expect(resolveActiveSource(0, resolvePlanSources(EMPTY))).toBe(2);
  });
});

describe('065 — resolveDayIn falls back to saved routines LAST', () => {
  const builtInFor = (w: string) =>
    BUILT_IN.includes(w) ? [['Barbell Bench Press', 3, '8-12'] as const] : null;
  const ROUTINES: RoutineLike[] = [
    { name: 'Core Blast', payload: { exercises: [{ exercise: 'Plank', sets: 3, reps: '60s' }] } },
    { name: 'Legs', payload: { exercises: [{ exercise: 'Leg Press', sets: 4, reps: '10' }] } },
  ];

  it('a routine name no source holds resolves to its exercises, and reports itself', () => {
    const r = resolveDayIn(resolvePlanSources(EMPTY), builtInFor, 'Core Blast', 2, ROUTINES);
    expect(r.entries).toEqual([['Plank', 3, '60s']]);
    expect(r.from).toBeNull();
    expect(r.routine).toBe('Core Blast');
  });

  it('match is case-insensitive on trimmed names (the routines table rule)', () => {
    const r = resolveDayIn(resolvePlanSources(EMPTY), builtInFor, '  core blast ', 2, ROUTINES);
    expect(r.routine).toBe('Core Blast');
  });

  it('PLAN SOURCES WIN over a same-named routine — equal names are one workout', () => {
    const r = resolveDayIn(resolvePlanSources(EMPTY), builtInFor, 'Legs', 2, ROUTINES);
    expect(r.from).toBe(2); // the built-in answered
    expect(r.routine).toBeUndefined();
    expect(r.entries).toEqual([['Barbell Bench Press', 3, '8-12']]);
  });

  it('nobody has it (deleted routine still referenced) → empty entries, no crash', () => {
    const r = resolveDayIn(resolvePlanSources(EMPTY), builtInFor, 'Gone Routine', 2, ROUTINES);
    expect(r).toEqual({ entries: [], from: null });
  });

  it('a routine with a malformed payload degrades to empty entries', () => {
    const bare: RoutineLike[] = [{ name: 'Husk' }];
    const r = resolveDayIn(resolvePlanSources(EMPTY), builtInFor, 'Husk', 2, bare);
    expect(r.entries).toEqual([]);
    expect(r.routine).toBe('Husk');
  });
});

describe('saved supersets (supersetsOf / ResolvedDay.supersets)', () => {
  it('builds a SYMMETRIC map from one declared direction', () => {
    expect(
      supersetsOf([
        { exercise: 'A', supersetWith: 'B' },
        { exercise: 'B' },
        { exercise: 'C' },
      ])
    ).toEqual({ A: 'B', B: 'A' });
  });

  it('drops dangling and self-referencing partners; none at all → undefined', () => {
    expect(
      supersetsOf([
        { exercise: 'A', supersetWith: 'Gone' },
        { exercise: 'B', supersetWith: 'B' },
      ])
    ).toBeUndefined();
    expect(supersetsOf([{ exercise: 'A' }])).toBeUndefined();
  });

  it('resolveDayIn surfaces a plan day’s supersets', () => {
    const withPairs: CustomPlan = {
      plan_name: 'Split',
      days: [
        {
          day: 'Arms',
          goal: '',
          exercises: [
            { exercise: 'Curl', sets: 3, reps: '8-12', reason: '', supersetWith: 'Pushdown' },
            { exercise: 'Pushdown', sets: 3, reps: '8-12', reason: '' },
          ],
        },
      ],
    };
    const s = resolvePlanSources({ customPlan: withPairs, aiPlan: null, builtInDays: BUILT_IN });
    const r = resolveDayIn(s, () => null, 'Arms', 0);
    expect(r.from).toBe(0);
    expect(r.supersets).toEqual({ Curl: 'Pushdown', Pushdown: 'Curl' });
  });

  it('resolveDayIn surfaces a routine’s supersets through the name fallback', () => {
    const routines: RoutineLike[] = [
      {
        name: 'Arm Blast',
        payload: {
          exercises: [
            { exercise: 'Curl', sets: 3, reps: '8-12', supersetWith: 'Pushdown' },
            { exercise: 'Pushdown', sets: 3, reps: '8-12' },
          ],
        },
      },
    ];
    const r = resolveDayIn(resolvePlanSources(EMPTY), () => null, 'Arm Blast', 2, routines);
    expect(r.routine).toBe('Arm Blast');
    expect(r.supersets).toEqual({ Curl: 'Pushdown', Pushdown: 'Curl' });
  });
});

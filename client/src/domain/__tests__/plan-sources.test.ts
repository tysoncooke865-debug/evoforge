import { describe, expect, it } from 'vitest';

import type { CustomPlan } from '../custom-plan';
import {
  daysForSource,
  defaultSource,
  looksLikeAiPlan,
  resolveActiveSource,
  resolvePlanSources,
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

const EMPTY = { customPlan: null, aiPlan: null, legacyPlan: null, builtInDays: BUILT_IN };

describe('looksLikeAiPlan', () => {
  it('a plan made ONLY of built-in day names is the AI’s (that is its contract)', () => {
    expect(looksLikeAiPlan(AI_SHAPED, BUILT_IN)).toBe(true);
  });
  it('a plan that names its own days came from the builder', () => {
    expect(looksLikeAiPlan(BUILDER_SHAPED, BUILT_IN)).toBe(false);
  });
  it('a day-less plan claims nothing', () => {
    expect(looksLikeAiPlan(plan('Nothing', []), BUILT_IN)).toBe(false);
  });
});

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

  it('BACK-COMPAT: a legacy plan with its OWN day names shows as MY PLAN', () => {
    const s = resolvePlanSources({ ...EMPTY, legacyPlan: BUILDER_SHAPED });
    expect(s.myPlan?.plan_name).toBe('My Split');
    expect(s.aiPlan).toBeNull();
  });

  it('BACK-COMPAT: a legacy plan shaped like the AI’s shows as AI PLAN', () => {
    const s = resolvePlanSources({ ...EMPTY, legacyPlan: AI_SHAPED });
    expect(s.aiPlan?.plan_name).toBe('Oracle Forge');
    expect(s.myPlan).toBeNull();
  });

  it('an explicit post-018 plan BEATS the legacy one in the same slot', () => {
    const newer = plan('Rebuilt', ['Upper', 'Lower']);
    const s = resolvePlanSources({ ...EMPTY, customPlan: newer, legacyPlan: BUILDER_SHAPED });
    expect(s.myPlan?.plan_name).toBe('Rebuilt');
  });

  it('a legacy plan claims ONE slot, never both', () => {
    const s = resolvePlanSources({ ...EMPTY, legacyPlan: BUILDER_SHAPED });
    expect([s.myPlan, s.aiPlan].filter(Boolean)).toHaveLength(1);
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

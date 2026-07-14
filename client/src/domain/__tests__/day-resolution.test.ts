import { describe, expect, it } from 'vitest';

import type { CustomPlan } from '../custom-plan';
import { resolveDayIn, resolvePlanSources, type SourceIndex } from '../plan-sources';
import type { PlanEntry } from '../session-plan';

/**
 * THE BUG (Tyson, 2026-07-14): "the workouts don't change when switching between
 * MY PLAN, AI PLAN and BUILT-IN — it's the AI plan on all three."
 *
 * The resolver searched my-plan → AI → built-in in a FIXED order and returned the
 * first hit, ignoring the tab entirely: whichever plan happened to hold the day
 * name won, every time, on every tab. This pins the real function.
 */

const BUILT_IN_DAYS = ['Legs'];

const plan = (name: string, day: string, exercise: string): CustomPlan => ({
  plan_name: name,
  days: [{ day, goal: '', exercises: [{ exercise, sets: 3, reps: '8-12', reason: '' }] }],
});

const builtIn: Record<string, PlanEntry[]> = {
  Legs: [['Barbell Back Squat', 4, '5-8'] as const],
};
const builtInFor = (w: string): PlanEntry[] | null => builtIn[w] ?? null;

const sourcesOf = (myPlan: CustomPlan | null, aiPlan: CustomPlan | null) =>
  resolvePlanSources({ customPlan: myPlan, aiPlan, legacyPlan: null, builtInDays: BUILT_IN_DAYS });

const ALL = sourcesOf(plan('My Split', 'Legs', 'Bulgarian Split Squat'), plan('Oracle', 'Legs', 'Leg Press'));

const first = (r: { entries: PlanEntry[] }) => r.entries[0]?.[0] ?? null;

describe('THE BUG: every tab showed the same workout', () => {
  it('MY PLAN shows MY plan’s exercises', () => {
    const r = resolveDayIn(ALL, builtInFor, 'Legs', 0);
    expect(first(r)).toBe('Bulgarian Split Squat');
    expect(r.from).toBe(0);
  });

  it('AI PLAN shows the AI’s', () => {
    const r = resolveDayIn(ALL, builtInFor, 'Legs', 1);
    expect(first(r)).toBe('Leg Press');
    expect(r.from).toBe(1);
  });

  it('BUILT-IN shows the built-in routine’s', () => {
    const r = resolveDayIn(ALL, builtInFor, 'Legs', 2);
    expect(first(r)).toBe('Barbell Back Squat');
    expect(r.from).toBe(2);
  });

  it('THE THREE ARE DIFFERENT — which is the entire point', () => {
    const seen = ([0, 1, 2] as SourceIndex[]).map((s) => first(resolveDayIn(ALL, builtInFor, 'Legs', s)));
    expect(new Set(seen).size).toBe(3);
  });
});

describe('the fallback exists, and it tells the truth', () => {
  const onlyAi = sourcesOf(null, plan('Oracle', 'Arms', 'Cable Curl'));
  const noBuiltIn = (): PlanEntry[] | null => null;

  it('a day MY PLAN does not have falls back — and reports where it came from', () => {
    const r = resolveDayIn(onlyAi, noBuiltIn, 'Arms', 0);
    expect(first(r)).toBe('Cable Curl');
    // NOT 0 — the screen must not pass this off as the athlete's own plan.
    expect(r.from).toBe(1);
  });

  it('a day nobody has is empty, not a lie', () => {
    expect(resolveDayIn(onlyAi, noBuiltIn, 'Chest', 0)).toEqual({ entries: [], from: null });
  });

  it('the chosen source always outranks the fallback', () => {
    expect(resolveDayIn(ALL, builtInFor, 'Legs', 1).from).toBe(1);
    expect(resolveDayIn(ALL, builtInFor, 'Legs', 2).from).toBe(2);
  });

  it('an EMPTY day in the chosen plan is not an answer — it falls through', () => {
    const empty: CustomPlan = { plan_name: 'Mine', days: [{ day: 'Legs', goal: '', exercises: [] }] };
    const s = sourcesOf(empty, plan('Oracle', 'Legs', 'Leg Press'));
    const r = resolveDayIn(s, builtInFor, 'Legs', 0);
    expect(first(r)).toBe('Leg Press');
    expect(r.from).toBe(1);
  });
});

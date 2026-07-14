import { useCustomPlan } from './hooks';
import { useUserPlans } from './user-plans';

import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { resolvePlanSources, type PlanSources } from '@/domain/plan-sources';
import type { PlanEntry } from '@/domain/session-plan';

/**
 * TRAIN_PAGE_V2 — plan resolution, in one place.
 *
 * Train (the hub) and /workout (the page) both need to know what a day holds.
 * This is thin wiring over the existing pure domain (resolvePlanSources): no
 * new logic, no second opinion about which plan is which.
 */

/** The app's own six-day routine. Static — derived from a generated catalog. */
export const BUILT_IN_DAYS: readonly string[] = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);

export interface DayPlan {
  sources: PlanSources;
  /**
   * The exercises a day holds. A day NAME identifies a workout, so it is looked
   * up where it can actually be found: the athlete's own plan first (it is
   * theirs), then the AI's, then the built-in routine. An ad-hoc workout is not
   * in any of them and resolves to [] — its exercises live in the session store.
   */
  exercisesForDay: (workout: string) => PlanEntry[];
  /** True while the plans are still loading — [] would otherwise read as "empty day". */
  loading: boolean;
}

export function useDayPlan(): DayPlan {
  const legacyPlan = useCustomPlan(); // custom_workout_plan — the pre-018 slot
  const userPlans = useUserPlans();

  const sources = resolvePlanSources({
    customPlan: userPlans.data?.custom ?? null,
    aiPlan: userPlans.data?.ai ?? null,
    legacyPlan: legacyPlan.data ?? null,
    builtInDays: BUILT_IN_DAYS,
  });

  const exercisesForDay = (workout: string): PlanEntry[] => {
    for (const plan of [sources.myPlan, sources.aiPlan]) {
      const day = plan?.days.find((d) => d.day === workout);
      if (day) return day.exercises.map((e) => [e.exercise, e.sets, e.reps] as const);
    }
    return [...(ROUTINE[workout] ?? [])];
  };

  return {
    sources,
    exercisesForDay,
    loading: userPlans.isPending || legacyPlan.isPending,
  };
}

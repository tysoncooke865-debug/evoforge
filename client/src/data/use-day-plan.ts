import { useCustomPlan } from './hooks';
import { useUserPlans } from './user-plans';

import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import {
  resolveDayIn,
  resolvePlanSources,
  type PlanSources,
  type ResolvedDay,
  type SourceIndex,
} from '@/domain/plan-sources';
import type { PlanEntry } from '@/domain/session-plan';

/**
 * TRAIN_PAGE_V2 — plan resolution, in ONE place, and HONOURING THE CHOSEN SOURCE.
 *
 * THE BUG (Tyson, 2026-07-14): "the workouts don't change when switching between
 * MY PLAN, AI PLAN and BUILT-IN — it's the AI plan on all three." They were not
 * changing because the source was never consulted: exercisesForDay() searched
 * my-plan → AI → built-in in a FIXED order and returned the first hit, and the
 * chosen tab never even travelled to the workout page. Whichever plan happened to
 * hold the day name won, on every tab.
 *
 * Now: the SELECTED source is asked FIRST, and it is the answer whenever it has
 * the day. A fallback still exists — a day the selected plan does not contain
 * would otherwise be an empty screen — but it REPORTS ITSELF (`from`), so the
 * workout page can say "showing the AI PLAN's version" instead of quietly lying
 * about whose workout you are looking at.
 */

/** The app's own six-day routine. Static — derived from a generated catalog. */
export const BUILT_IN_DAYS: readonly string[] = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);

export interface DayPlan {
  sources: PlanSources;
  /** The exercises a day holds IN A GIVEN SOURCE, with a reporting fallback. */
  resolveDay: (workout: string, preferred: SourceIndex) => ResolvedDay;
  /** True while the plans load — [] would otherwise read as "empty day". */
  loading: boolean;
}

const builtInEntries = (workout: string): PlanEntry[] | null => {
  const day = ROUTINE[workout];
  return day && day.length > 0 ? [...day] : null;
};

export function useDayPlan(): DayPlan {
  const legacyPlan = useCustomPlan(); // custom_workout_plan — the pre-018 slot
  const userPlans = useUserPlans();

  const sources = resolvePlanSources({
    customPlan: userPlans.data?.custom ?? null,
    aiPlan: userPlans.data?.ai ?? null,
    legacyPlan: legacyPlan.data ?? null,
    builtInDays: BUILT_IN_DAYS,
  });

  // The RULE lives in the pure domain (resolveDayIn) — this is only wiring.
  const resolveDay = (workout: string, preferred: SourceIndex): ResolvedDay =>
    resolveDayIn(sources, builtInEntries, workout, preferred);

  return {
    sources,
    resolveDay,
    loading: userPlans.isPending || legacyPlan.isPending,
  };
}

export const SOURCE_LABEL: Readonly<Record<SourceIndex, string>> = {
  0: 'MY PLAN',
  1: 'AI PLAN',
  2: 'EVOFORGE PLAN',
};

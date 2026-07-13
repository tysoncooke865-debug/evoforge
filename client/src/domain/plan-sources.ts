/**
 * TYSON 2026-07-14 — which plan fills which slot on Train.
 *
 * Three sources, in the order the athlete asked for them:
 *   0 MY PLAN   — the split they built (or onboarding seeded for them)
 *   1 AI PLAN   — the one the Oracle forged
 *   2 BUILT-IN  — the six-day PPPPLA routine that ships with the app
 *
 * BACK-COMPAT is the whole difficulty. Before migration 018 both plans shared
 * custom_workout_plan, so an athlete can arrive with:
 *   - a plan in the LEGACY slot and nothing in user_plans; and
 *   - no way for us to ask them which kind it was.
 * The days answer it: the AI plan's contract is the built-in six day NAMES
 * (custom-plan.ts::PPPPLA_DAYS — the ai-plan edge function validates that
 * shape), while every builder split names its own days. So a legacy plan whose
 * days are all built-in names is the AI's; anything else is theirs.
 *
 * A legacy plan is only ever a FALLBACK: the moment a real user_plans row
 * exists for that kind, it wins — the athlete's newer, explicit choice.
 */

import type { CustomPlan } from './custom-plan';

export type SourceIndex = 0 | 1 | 2;

export interface PlanSourceInputs {
  /** user_plans kind='custom' (post-018). */
  customPlan: CustomPlan | null;
  /** user_plans kind='ai' (post-018). */
  aiPlan: CustomPlan | null;
  /** custom_workout_plan — the pre-018 single slot, still written by the AI. */
  legacyPlan: CustomPlan | null;
  /** The built-in six day names (PPPPLA_DAYS). */
  builtInDays: readonly string[];
}

export interface PlanSources {
  myPlan: CustomPlan | null;
  aiPlan: CustomPlan | null;
  /** True when a source has a plan behind it — a tab with nothing behind it is
   *  offered, but says so rather than showing an empty day. */
  has: { myPlan: boolean; aiPlan: boolean };
}

/** Every day of this plan is one of the built-in six → it can only be the AI's
 *  (that shape is the ai-plan function's validated contract). */
export function looksLikeAiPlan(plan: CustomPlan, builtInDays: readonly string[]): boolean {
  if (plan.days.length === 0) return false;
  return plan.days.every((d) => builtInDays.includes(d.day));
}

export function resolvePlanSources(input: PlanSourceInputs): PlanSources {
  const { customPlan, aiPlan, legacyPlan, builtInDays } = input;

  // The legacy plan can only claim a slot that is otherwise EMPTY.
  const legacyIsAi = legacyPlan !== null && looksLikeAiPlan(legacyPlan, builtInDays);

  const myPlan = customPlan ?? (legacyPlan !== null && !legacyIsAi ? legacyPlan : null);
  const ai = aiPlan ?? (legacyIsAi ? legacyPlan : null);

  return {
    myPlan,
    aiPlan: ai,
    has: { myPlan: myPlan !== null, aiPlan: ai !== null },
  };
}

/** The day list a source drives. BUILT-IN drives the app's own six. */
export function daysForSource(
  source: SourceIndex,
  sources: PlanSources,
  builtInDays: readonly string[]
): readonly string[] {
  if (source === 0) return sources.myPlan?.days.map((d) => d.day) ?? [];
  if (source === 1) return sources.aiPlan?.days.map((d) => d.day) ?? [];
  return builtInDays;
}

/**
 * The source to OPEN on. An athlete who built a plan means to train it; if they
 * have none, the AI's; failing both, the built-in routine. Never opens on an
 * empty tab.
 */
export function defaultSource(sources: PlanSources): SourceIndex {
  if (sources.has.myPlan) return 0;
  if (sources.has.aiPlan) return 1;
  return 2;
}

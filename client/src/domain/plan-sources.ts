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
import type { PlanEntry } from './session-plan';

export type SourceIndex = 0 | 1 | 2;

export interface PlanSourceInputs {
  /** user_plans kind='custom' (post-018). */
  customPlan: CustomPlan | null;
  /** user_plans kind='ai' (post-018). */
  aiPlan: CustomPlan | null;
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

export function resolvePlanSources(input: PlanSourceInputs): PlanSources {
  // 062 (2026-07-19): the legacy custom_workout_plan slot is retired — the
  // one-shot server copy moved every surviving legacy plan into user_plans,
  // classified by the same every-day-is-built-in rule this function used to
  // apply at read time (looksLikeAiPlan — now ported into the migration).
  const { customPlan, aiPlan } = input;
  return {
    myPlan: customPlan,
    aiPlan,
    has: { myPlan: customPlan !== null, aiPlan: aiPlan !== null },
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

/**
 * The source Train OPENS on: the athlete's SAVED choice (migration 035,
 * profile.active_plan_source) when its plan still exists, else defaultSource.
 * BUILT-IN (2) always exists, so a saved 2 always sticks — killing the
 * reload snap-back to MY PLAN. A stored source whose plan was later deleted
 * falls back FOR DISPLAY ONLY — the caller must never write the fallback
 * back, so a re-forged AI plan revives the saved choice.
 */
export function resolveActiveSource(
  stored: SourceIndex | null,
  sources: PlanSources
): SourceIndex {
  if (stored === 2) return 2;
  if (stored === 0 && sources.has.myPlan) return 0;
  if (stored === 1 && sources.has.aiPlan) return 1;
  return defaultSource(sources);
}

export interface ResolvedDay {
  entries: PlanEntry[];
  /** Which source these exercises actually came from — null when nobody has it. */
  from: SourceIndex | null;
  /** 065: set (to the routine's stored name) when no plan source had the day
   *  and a saved routine answered instead — the workout page labels it. */
  routine?: string;
  /** SAVED SUPERSETS (2026-07-21): symmetric partner map from the template's
   *  `supersetWith` fields (plan or routine payloads), partner-validated.
   *  Absent when the day carries none — built-in days never do. */
  supersets?: Record<string, string>;
}

/** The slice of a saved routine the resolver needs (data/routines.ts rows fit). */
export interface RoutineLike {
  name: string;
  payload?: {
    exercises?: readonly { exercise: string; sets: number; reps: string; supersetWith?: string }[];
  };
}

/** Symmetric, partner-validated pairing from `supersetWith` fields — a
 *  dangling or self-referencing partner is ignored, one declared direction
 *  pairs both. */
export function supersetsOf(
  exercises: readonly { exercise: string; supersetWith?: string }[]
): Record<string, string> | undefined {
  const names = new Set(exercises.map((e) => e.exercise));
  const out: Record<string, string> = {};
  for (const e of exercises) {
    const partner = e.supersetWith;
    if (partner && partner !== e.exercise && names.has(partner)) {
      out[e.exercise] = partner;
      out[partner] = e.exercise;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * THE EXERCISES A DAY HOLDS, IN THE SOURCE THE ATHLETE CHOSE.
 *
 * THE BUG (Tyson, 2026-07-14): "the workouts don't change when switching between
 * MY PLAN, AI PLAN and BUILT-IN — it's the AI plan on all three." The old
 * resolver searched my-plan → AI → built-in in a FIXED order and returned the
 * first hit, ignoring the tab entirely: whichever plan happened to hold the day
 * name won, every time, on every tab.
 *
 * THE SELECTED SOURCE IS ASKED FIRST and is the answer whenever it has the day.
 * The fallback exists only so that a day the chosen plan lacks is not a blank
 * screen — and it REPORTS ITSELF (`from`), so the screen can say whose workout it
 * is actually showing instead of quietly passing it off as theirs.
 *
 * 065: `routines` is the LAST fallback — a scheduled extra is usually a saved
 * routine's name, which no plan source holds. Sources win over a same-named
 * routine on purpose: `workout` is the grouping key in workout_log, so equal
 * names ARE the same workout. Match is case-insensitive on trimmed names
 * (the routines table's own uniqueness rule).
 */
export function resolveDayIn(
  sources: PlanSources,
  builtInFor: (workout: string) => PlanEntry[] | null,
  workout: string,
  preferred: SourceIndex,
  routines: readonly RoutineLike[] = []
): ResolvedDay {
  const inSource = (
    s: SourceIndex
  ): { entries: PlanEntry[]; supersets?: Record<string, string> } | null => {
    if (s === 2) {
      const entries = builtInFor(workout);
      return entries ? { entries } : null; // built-in days carry no supersets
    }
    const plan = s === 0 ? sources.myPlan : sources.aiPlan;
    const day = plan?.days.find((d) => d.day === workout);
    return day
      ? {
          entries: day.exercises.map((e) => [e.exercise, e.sets, e.reps] as const),
          supersets: supersetsOf(day.exercises),
        }
      : null;
  };

  const own = inSource(preferred);
  if (own && own.entries.length > 0) return { ...own, from: preferred };

  for (const s of [0, 1, 2] as SourceIndex[]) {
    if (s === preferred) continue;
    const found = inSource(s);
    if (found && found.entries.length > 0) return { ...found, from: s };
  }

  const key = workout.trim().toLowerCase();
  const routine = routines.find((r) => r.name.trim().toLowerCase() === key);
  if (routine) {
    const exercises = routine.payload?.exercises ?? [];
    const entries = exercises.map((e) => [e.exercise, e.sets, e.reps] as const);
    return {
      entries: [...entries],
      from: null,
      routine: routine.name,
      supersets: supersetsOf(exercises),
    };
  }

  return { entries: [], from: null };
}

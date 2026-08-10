import { ROUTINE, ROUTINE_ORDER } from './catalogs';
import { resolveExercise, type UserExerciseRef } from './exercise-identity';
import { libraryMuscleFor, userMuscleFor, type UserExercise } from './muscle-lookup';
import { pyInt } from './py';
import { inferMuscleGroup } from './workouts';

/**
 * IMPROVEMENT_PLAN #10: the pure core of the AI custom routine. The plan is
 * row-per-exercise in custom_workout_plan (id, timestamp, plan_name,
 * workout, exercise, sets, reps, muscle, reason, day_goal — the live
 * schema; NEVER add columns, Streamlit reads this table). Day names are the
 * six live PPPPLA days so Today's logging and any future schedule map 1:1.
 */

export const PPPPLA_DAYS: readonly string[] = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);

export interface PlanExercise {
  /** THE DISPLAY NAME. Never the identity — see `exerciseId`. */
  exercise: string;
  sets: number;
  reps: string;
  reason: string;
  /** SAVE CHANGES (2026-07-21): optional superset partner (another exercise in
   *  the SAME day). Backward-compatible — older payloads simply lack it; the
   *  ai-plan edge function never emits it. */
  supersetWith?: string;

  /**
   * IDENTITY, SEPARATED FROM PRESCRIPTION (2026-08-10).
   *
   * Everything below is OPTIONAL and every field is additive, so a plan
   * payload written before this release loads and behaves exactly as it did
   * — which matters, because these payloads are jsonb rows in user_plans
   * belonging to live athletes.
   *
   * `exerciseId` is what history is matched on. The rest is what the AI used
   * to smuggle into the NAME ("Bench Press (Strength Focused)"), and each of
   * them now has somewhere honest to live.
   */
  exerciseId?: string;
  trainingFocus?: string;
  repMin?: number;
  repMax?: number;
  rir?: number;
  tempo?: string;
}
export interface PlanDay {
  day: string;
  goal: string;
  exercises: PlanExercise[];
}
export interface CustomPlan {
  plan_name: string;
  rationale?: string;
  days: PlanDay[];
}

/** Mirror of the server-side validator — the client re-checks before accept. */
export function validatePlan(data: unknown): { plan: CustomPlan | null; error: string | null } {
  const d = (data ?? {}) as Record<string, unknown>;
  const planName = String(d.plan_name ?? '').trim();
  if (!planName) return { plan: null, error: 'plan_name missing' };
  if (!Array.isArray(d.days) || d.days.length !== PPPPLA_DAYS.length) {
    return { plan: null, error: `expected ${PPPPLA_DAYS.length} days` };
  }
  const seen = new Set<string>();
  const days: PlanDay[] = [];
  for (const raw of d.days as Record<string, unknown>[]) {
    const day = String(raw.day ?? '').trim();
    if (!PPPPLA_DAYS.includes(day)) return { plan: null, error: `unknown day: ${day}` };
    if (seen.has(day)) return { plan: null, error: `duplicate day: ${day}` };
    seen.add(day);
    if (!Array.isArray(raw.exercises) || raw.exercises.length === 0) {
      return { plan: null, error: `${day} has no exercises` };
    }
    const exercises: PlanExercise[] = [];
    for (const e of raw.exercises as Record<string, unknown>[]) {
      const exercise = String(e.exercise ?? '').trim();
      const reps = String(e.reps ?? '').trim();
      if (!exercise || !reps) return { plan: null, error: `${day}: exercise/reps missing` };
      const s = (k: string): string | undefined =>
        String((e as Record<string, unknown>)[k] ?? '').trim() || undefined;
      const n = (k: string): number | undefined => {
        const v = pyInt((e as Record<string, unknown>)[k]);
        return v === null ? undefined : v;
      };
      exercises.push({
        exercise,
        sets: Math.max(1, Math.min(8, pyInt(e.sets) ?? 3)),
        reps,
        reason: String(e.reason ?? '').trim(),
        supersetWith: String((e as { supersetWith?: unknown }).supersetWith ?? '').trim() || undefined,
        // Identity + prescription (2026-08-10). Accepts both the edge
        // function's snake_case wire shape and this module's camelCase.
        exerciseId: s('exerciseId') ?? s('exercise_id'),
        trainingFocus: s('trainingFocus') ?? s('training_focus'),
        repMin: n('repMin') ?? n('rep_min'),
        repMax: n('repMax') ?? n('rep_max'),
        rir: n('rir'),
        tempo: s('tempo'),
      });
    }
    // A supersetWith must name ANOTHER exercise in the same day — anything
    // else (dangling name, self-pair) is silently dropped, not an error.
    const dayNames = new Set(exercises.map((e) => e.exercise));
    for (const e of exercises) {
      if (e.supersetWith && (!dayNames.has(e.supersetWith) || e.supersetWith === e.exercise)) {
        delete e.supersetWith;
      }
    }
    days.push({ day, goal: String(raw.goal ?? '').trim(), exercises });
  }
  return { plan: { plan_name: planName, rationale: String(d.rationale ?? ''), days }, error: null };
}

/**
 * THE LAST GATE BEFORE A PLAN REACHES THE DATABASE (2026-08-10).
 *
 * The edge function already refuses to let a model mint an identity, but it
 * is not the only door: a plan can arrive from the PLAN SCAN photo importer,
 * from a cached pre-2026-08-10 response, or from a client running ahead of a
 * deployed function. So identity is settled HERE too, on the one path every
 * plan takes, using the one resolver.
 *
 * What it does, per exercise:
 *   - resolves (exerciseId, exercise) to a canonical identity;
 *   - REWRITES `exercise` to the catalogue's own name when it resolved, so
 *     `Bench Press (Strength Focused)` is stored as `Barbell Bench Press`;
 *   - lifts the descriptor it stripped into `trainingFocus` when the model
 *     did not name one itself, so the intent is kept rather than deleted.
 *
 * A name nothing recognises is left EXACTLY as the athlete or the model wrote
 * it. Renaming something we could not identify would be a guess, and this
 * file's whole job is to stop guesses becoming identities.
 */
export function canonicalisePlan(
  plan: CustomPlan,
  userExercises: readonly UserExerciseRef[] = []
): CustomPlan {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((e) => {
        const r = resolveExercise({ exerciseId: e.exerciseId, name: e.exercise }, userExercises);
        if (r.source === 'unknown') return e;
        const focus = e.trainingFocus ?? focusFromDescriptor(e.exercise);
        return {
          ...e,
          exercise: r.canonicalName,
          exerciseId: r.exerciseId,
          ...(focus ? { trainingFocus: focus } : {}),
        };
      }),
    })),
  };
}

/** The intent hiding in "Bench Press (Strength Focused)" — kept, not binned. */
const FOCUS_WORDS = ['strength', 'hypertrophy', 'power', 'endurance', 'technique'] as const;
function focusFromDescriptor(name: string): string | undefined {
  const lower = name.toLowerCase();
  return FOCUS_WORDS.find((w) => lower.includes(w));
}

export interface PlanRow {
  plan_name: string;
  workout: string;
  exercise: string;
  sets: number;
  reps: string;
  muscle: string;
  reason: string;
  day_goal: string;
  timestamp: string;
}

/** Flatten for insert: one row per exercise, the Streamlit row shape.
 *  STAGE 1: `userExercises` lets an athlete-created lift carry the muscle
 *  THEY chose. It defaults to [] so every existing caller — and the parity
 *  suite — behaves byte-identically (inferMuscleGroup is pinned; it moves for
 *  nobody). */
export function flattenPlan(
  plan: CustomPlan,
  timestamp: string,
  userExercises: readonly UserExercise[] = []
): PlanRow[] {
  const rows: PlanRow[] = [];
  // ORDER IS DATA. custom_workout_plan has no ordering column (Streamlit reads
  // it — never add one), and a plain SELECT gives no order guarantee, so every
  // row gets a DISTINCT, increasing timestamp: day index in minutes, exercise
  // index in seconds. Reading back ordered by timestamp then reproduces the
  // plan exactly as it was built. "Newest plan wins" still works — it compares
  // the max timestamp across plan_names, and every row of a plan shares one.
  const base = Date.parse(`${timestamp}Z`);
  plan.days.forEach((day, dayIx) => {
    day.exercises.forEach((e, exIx) => {
      const stamp = Number.isFinite(base)
        ? new Date(base + (dayIx * 60 + exIx) * 1000).toISOString().slice(0, 19)
        : timestamp;
      rows.push({
        plan_name: plan.plan_name,
        workout: day.day,
        exercise: e.exercise,
        sets: e.sets,
        reps: e.reps,
        muscle:
          userMuscleFor(e.exercise, userExercises) ??
          libraryMuscleFor(e.exercise) ??
          inferMuscleGroup(e.exercise),
        reason: e.reason,
        day_goal: day.goal,
        timestamp: stamp,
      });
    });
  });
  return rows;
}

/** Regroup stored rows into the plan shape; the newest plan_name wins. */
export function groupPlanRows(
  rows: { plan_name?: unknown; workout?: unknown; exercise?: unknown; sets?: unknown; reps?: unknown; reason?: unknown; day_goal?: unknown; timestamp?: unknown }[]
): CustomPlan | null {
  if (rows.length === 0) return null;
  let newest = '';
  let newestName = '';
  for (const r of rows) {
    const ts = String(r.timestamp ?? '');
    if (ts > newest) {
      newest = ts;
      newestName = String(r.plan_name ?? '');
    }
  }
  const mine = rows
    .filter((r) => String(r.plan_name ?? '') === newestName)
    // Stable order regardless of what the database hands back (flattenPlan
    // stamps each row distinctly for exactly this).
    .sort((a, b) => (String(a.timestamp ?? '') < String(b.timestamp ?? '') ? -1 : 1));

  const byDay = new Map<string, PlanDay>();
  for (const r of mine) {
    const day = String(r.workout ?? '');
    if (!byDay.has(day)) byDay.set(day, { day, goal: String(r.day_goal ?? ''), exercises: [] });
    byDay.get(day)!.exercises.push({
      exercise: String(r.exercise ?? ''),
      sets: pyInt(r.sets) ?? 3,
      reps: String(r.reps ?? ''),
      reason: String(r.reason ?? ''),
    });
  }

  // BUG (shipped, found 2026-07-14): this used to return ONLY days whose names
  // are in PPPPLA_DAYS — so a plan built by the routine builder, or seeded by
  // onboarding, had every day filtered out, groupPlanRows returned null, and
  // "MY PLAN" never appeared on Train. The athlete's split existed in the
  // database and was invisible in the app.
  //
  // A plan made ENTIRELY of the built-in six is presented in the canonical week
  // order (that is the AI plan's contract, and it is what those rows mean).
  // Any other plan keeps ITS OWN day order, which the timestamps preserve.
  const names = [...byDay.keys()];
  const allCanonical = names.every((d) => PPPPLA_DAYS.includes(d));
  const ordered = allCanonical ? PPPPLA_DAYS.filter((d) => byDay.has(d)) : names;
  const days = ordered.map((d) => byDay.get(d)!);
  if (days.length === 0) return null;
  return { plan_name: newestName, days };
}

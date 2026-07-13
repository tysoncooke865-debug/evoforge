import { ROUTINE, ROUTINE_ORDER } from './catalogs';
import { userMuscleFor, type UserExercise } from './exercise-search';
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
  exercise: string;
  sets: number;
  reps: string;
  reason: string;
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
      exercises.push({
        exercise,
        sets: Math.max(1, Math.min(8, pyInt(e.sets) ?? 3)),
        reps,
        reason: String(e.reason ?? '').trim(),
      });
    }
    days.push({ day, goal: String(raw.goal ?? '').trim(), exercises });
  }
  return { plan: { plan_name: planName, rationale: String(d.rationale ?? ''), days }, error: null };
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
        muscle: userMuscleFor(e.exercise, userExercises) ?? inferMuscleGroup(e.exercise),
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

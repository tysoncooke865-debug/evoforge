import { exerciseIdFor, type UserExerciseRef } from './exercise-identity';
import { canonicalFromRow, copyPreviousSet, loadFieldValue, type CanonicalSet } from './exercise-load';
import { pyFloat, pyInt } from './py';
import { isCountedSet } from './workouts';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';

/**
 * IMPROVEMENT_PLAN #2: what did this athlete do LAST time on this exercise?
 * Pure over the cached workout rows (the same client-side filtering
 * previousBest1rm uses). "Last" means the most recent PRIOR date — today's
 * rows are excluded so an in-progress session never prefills itself.
 *
 * 2026-08-10 — MATCHED BY CANONICAL IDENTITY, NOT BY STRING.
 *
 * This function used to ask `String(r.exercise) !== exercise`, which meant an
 * AI plan writing `Bench Press (Strength Focused)` found nothing: no "last
 * time", no prefill, and the athlete typing four years of bench history back
 * in from memory. It now asks whether the two names denote the SAME EXERCISE
 * (domain/exercise-identity.ts), so history follows the movement rather than
 * the wording — across AI plans, quick workouts, routines, challenges and
 * every split the athlete has ever run.
 *
 * A row's STORED exercise_id (migration 192) is preferred when present, so a
 * backfilled row skips resolution entirely; a row written before 192 resolves
 * from its name and reaches the same answer.
 */
export interface LastPerformance {
  date: string;
  /** 133: `load` carries the MODE and PARTS, so the prefill can reopen a
   *  bodyweight or assisted set as what it was rather than as a bare
   *  number that has lost its meaning. */
  /** `load` is optional so a caller (or a test) can still describe a plain
   *  weighted set as {set, weight, reps} — absence means external load,
   *  which is what every pre-133 row was. */
  sets: { set: number; weight: number; reps: number; load?: CanonicalSet }[];
}

/** A row's identity: its stored id when it has one, else resolved from name. */
export function rowExerciseId(r: WorkoutRow, userExercises: readonly UserExerciseRef[] = []): string {
  const stored = (r as WorkoutRow & { exercise_id?: unknown }).exercise_id;
  if (typeof stored === 'string' && stored !== '') return stored;
  return exerciseIdFor(String(r.exercise ?? ''), userExercises);
}

export function lastPerformance(
  rows: WorkoutRow[],
  exercise: string,
  todayIso: string,
  userExercises: readonly UserExerciseRef[] = []
): LastPerformance | null {
  let lastDate: string | null = null;
  const wanted = exerciseIdFor(exercise, userExercises);
  const valid = normaliseWorkoutLog(rows).filter((r) => {
    // The raw-name check first: it is the common case and it costs nothing.
    if (String(r.exercise) !== exercise && rowExerciseId(r, userExercises) !== wanted) return false;
    const d = String(r.date);
    return isCountedSet(r.weight, r.reps) && d < todayIso;
  });
  for (const r of valid) {
    const d = String(r.date);
    if (lastDate === null || d > lastDate) lastDate = d;
  }
  if (lastDate === null) return null;

  const sets = valid
    .filter((r) => String(r.date) === lastDate)
    .map((r) => ({
      set: pyInt(r.set) ?? 0,
      weight: pyFloat(r.weight) ?? 0,
      reps: Math.trunc(pyFloat(r.reps) ?? 0),
      load: canonicalFromRow(r as unknown as Record<string, unknown>),
    }))
    .sort((a, b) => a.set - b.set);
  return { date: lastDate, sets };
}

/**
 * The prefill for set N: the same set number last time, else the last set of
 * that session (fewer sets last time shouldn't leave later sets blank).
 *
 * 133: `weight` is now the PART belonging to the set's mode — the added 20 kg
 * of a weighted pull-up, the 30 kg of assistance on an assisted one — never
 * the effective total. `copyPreviousSet` drops the bodyweight snapshot, so
 * the new set takes a fresh one when it saves rather than inheriting a
 * reading from a different day.
 */
export function prefillForSet(
  last: LastPerformance | null,
  setNo: number
): { weight: number; reps: number; load: CanonicalSet } | null {
  if (!last || last.sets.length === 0) return null;
  const exact = last.sets.find((s) => s.set === setNo);
  const chosen = exact ?? last.sets[last.sets.length - 1];
  const load = copyPreviousSet(
    chosen.load ?? canonicalFromRow({ load_mode: 'external', weight: chosen.weight, reps: chosen.reps })
  );
  return { weight: loadFieldValue(load) ?? 0, reps: chosen.reps, load };
}

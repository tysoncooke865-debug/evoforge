/**
 * The BOOT-PATH muscle resolution seam (perf, 2026-07-23).
 *
 * Set save, the set queue and the Home/Train cards resolve an exercise name
 * to its muscle on every render/save — but they used to do it by importing
 * the ENTIRE ~1,100-entry EXERCISE_LIBRARY (~210KB source), which put the
 * whole library into the shared boot chunk every visitor downloads. This
 * module carries only the compact GENERATED name -> muscle projection
 * (muscle-by-name.generated.ts, pinned to the library by
 * __tests__/muscle-by-name.test.ts) plus the athlete's-own-exercise
 * resolver, so the full library stays behind the picker/builder route
 * chunks where it belongs.
 *
 * Precedence at every call site is unchanged:
 *   userMuscleFor (the athlete said so) > libraryMuscleFor (the library
 *   says so) > inferMuscleGroup (parity-pinned heuristic, last resort).
 */

import { MUSCLE_BY_NAME } from './muscle-by-name.generated';

export interface UserExercise {
  id?: string;
  name: string;
  muscle: string;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Built once from the generated record; a Map sidesteps prototype-key
 *  hazards a raw object lookup would have ('constructor' is a legal name). */
const BY_NAME: ReadonlyMap<string, string> = new Map(Object.entries(MUSCLE_BY_NAME));

/**
 * The muscle THE LIBRARY says this exercise trains, or null if it has never
 * heard of it. Callers fall back to inferMuscleGroup (pinned) — see
 * useSaveSet. This exists because inferMuscleGroup is a name heuristic, and
 * the ~900 imported names are not names it was tuned for: without this, a
 * logged "Landmine Twist" would land in the fallback bucket instead of Abs.
 */
export function libraryMuscleFor(exercise: string): string | null {
  return BY_NAME.get(norm(exercise)) ?? null;
}

/**
 * Resolve an exercise's muscle: an athlete's own definition wins over
 * inference, because they told us. Callers fall back to inferMuscleGroup
 * (which is parity-pinned and must not move) when this returns null.
 */
export function userMuscleFor(exercise: string, userExercises: readonly UserExercise[]): string | null {
  const hit = userExercises.find((u) => norm(u.name) === norm(exercise));
  return hit ? hit.muscle : null;
}

/**
 * PHASE_3 Stage 1 — the exercise picker's pure search.
 *
 * Merges the built-in EXERCISE_LIBRARY with the athlete's own creations
 * (which sort into their own MINE section, first — you made it, you want it).
 * Case-insensitive substring over name AND muscle, so "chest" finds the
 * chest section and "bulgarian" finds the split squat.
 *
 * `hasExactMatch` is what decides whether the picker offers CREATE "<query>":
 * offering to create something that already exists would let a user mint a
 * duplicate under a different case, and migration 016's unique index would
 * then reject it with a database error instead of a UI answer.
 */

import { EXERCISE_LIBRARY, LIBRARY_SECTIONS, type LibraryExercise } from './exercise-library';

// Moved to muscle-lookup.ts (perf, 2026-07-23): set save + Home/Train only
// need these, and importing them from HERE pulled the full library into the
// shared boot chunk. Re-exported so picker-side callers keep one import.
import { userMuscleFor, type UserExercise } from './muscle-lookup';

export { userMuscleFor, type UserExercise };

export const MINE = 'Mine';

export interface SearchSection {
  label: string;
  exercises: LibraryExercise[];
}

export interface SearchResult {
  sections: SearchSection[];
  /** An exercise with exactly this name already exists (case-insensitive). */
  hasExactMatch: boolean;
  /** Total exercises across all sections. */
  count: number;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Every fine-grained muscle tag, grouped under its UI section — the tag
 *  chips the CREATE flow offers. */
export function muscleOptions(): { label: string; muscles: readonly string[] }[] {
  return LIBRARY_SECTIONS.map((s) => ({ label: s.label, muscles: s.muscles }));
}

export function searchExercises(query: string, userExercises: readonly UserExercise[] = []): SearchResult {
  const q = norm(query);
  const mine: LibraryExercise[] = userExercises.map((u) => ({ name: u.name, muscle: u.muscle }));

  const matches = (e: LibraryExercise): boolean =>
    q === '' || norm(e.name).includes(q) || norm(e.muscle).includes(q);

  const sections: SearchSection[] = [];

  const mineHits = mine.filter(matches);
  if (mineHits.length > 0) sections.push({ label: MINE, exercises: mineHits });

  for (const section of LIBRARY_SECTIONS) {
    const hits = EXERCISE_LIBRARY.filter((e) => section.muscles.includes(e.muscle) && matches(e));
    if (hits.length > 0) sections.push({ label: section.label, exercises: [...hits] });
  }

  const all = [...EXERCISE_LIBRARY, ...mine];
  const hasExactMatch = q !== '' && all.some((e) => norm(e.name) === q);

  return {
    sections,
    hasExactMatch,
    count: sections.reduce((n, s) => n + s.exercises.length, 0),
  };
}

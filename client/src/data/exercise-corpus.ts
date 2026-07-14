import { digestHistory, type ExerciseHistory } from '@/domain/exercise-history';
import { EXERCISE_LIBRARY } from '@/domain/exercise-library';
import type { RankContext } from '@/domain/exercise-rank';
import type { UserExercise } from '@/domain/exercise-search';
import type { LibraryExercise } from '@/domain/exercise-taxonomy';
import type { WorkoutRow } from '@/domain/summary';

import { prefSets, type ExercisePref } from './exercise-prefs';

/**
 * THE CORPUS RECIPE — extracted from exercise-picker.tsx (2026-07-15) so the
 * inline ExerciseSearchBar and the full picker rank against the SAME world:
 * the athlete's own exercises merged into the library (popularity 90, no
 * special case), favourites/hidden from prefs, history digested from rows the
 * app already holds, and the day's program driving target muscles.
 *
 * A pure function over query data — NO hooks — so callers can gate the work:
 * this digests a 2,500-row log and merges a 960-entry library, and the picker
 * learned the hard way (PERF note, 2026-07-14) that running it on every
 * parent render is a real cost. Call it only when actually searching.
 */

export interface ExerciseCorpus {
  library: LibraryExercise[];
  /** Every set definite — buildSections needs them, rankExercises accepts it. */
  context: Required<RankContext>;
  isCustom: (name: string) => boolean;
  history: ExerciseHistory;
}

export function buildCorpus(
  sources: {
    userExercises?: readonly UserExercise[];
    prefRows?: ExercisePref[];
    workoutRows?: WorkoutRow[];
  },
  opts: {
    programExercises?: readonly string[];
    excludeNames?: readonly string[];
  } = {}
): ExerciseCorpus {
  const programExercises = opts.programExercises ?? [];
  const excludeNames = opts.excludeNames ?? [];

  const history = digestHistory(sources.workoutRows);
  const { favourites, hidden } = prefSets(sources.prefRows);

  // The athlete's own exercises are part of the library, not a special case.
  const library: LibraryExercise[] = [
    ...(sources.userExercises ?? []).map((u) => ({ name: u.name, muscle: u.muscle, popularity: 90 })),
    ...EXERCISE_LIBRARY,
  ];
  const customNames = new Set((sources.userExercises ?? []).map((u) => u.name));

  const alreadyAdded = new Set(excludeNames.map((n) => n.toLowerCase()));

  // The WHOLE library — the athlete's own exercises carry a real muscle, and
  // a day built from them would otherwise yield no target muscles at all,
  // silently deleting SUGGESTED FOR TODAY for exactly the athletes who
  // customised most.
  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e.muscle]));
  const targetMuscles = new Set<string>();
  for (const p of programExercises) {
    const m = byName.get(p.toLowerCase());
    if (m) targetMuscles.add(m);
  }

  const context: Required<RankContext> = {
    inProgram: new Set(programExercises.map((p) => p.toLowerCase())),
    performed: history.performed,
    favourites,
    targetMuscles,
    alreadyAdded,
    hidden,
  };

  return { library, context, isCustom: (n: string) => customNames.has(n), history };
}

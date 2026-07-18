import { pyFloat, pyInt } from './py';
import { isCountedSet } from './workouts';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';

/**
 * IMPROVEMENT_PLAN #2: what did this athlete do LAST time on this exercise?
 * Pure over the cached workout rows (the same client-side filtering
 * previousBest1rm uses). "Last" means the most recent PRIOR date — today's
 * rows are excluded so an in-progress session never prefills itself.
 */
export interface LastPerformance {
  date: string;
  sets: { set: number; weight: number; reps: number }[];
}

export function lastPerformance(
  rows: WorkoutRow[],
  exercise: string,
  todayIso: string
): LastPerformance | null {
  let lastDate: string | null = null;
  const valid = normaliseWorkoutLog(rows).filter((r) => {
    if (String(r.exercise) !== exercise) return false;
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
    }))
    .sort((a, b) => a.set - b.set);
  return { date: lastDate, sets };
}

/** The prefill for set N: the same set number last time, else the last set
 *  of that session (fewer sets last time shouldn't leave later sets blank). */
export function prefillForSet(last: LastPerformance | null, setNo: number): { weight: number; reps: number } | null {
  if (!last || last.sets.length === 0) return null;
  const exact = last.sets.find((s) => s.set === setNo);
  const chosen = exact ?? last.sets[last.sets.length - 1];
  return { weight: chosen.weight, reps: chosen.reps };
}

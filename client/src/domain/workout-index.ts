import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { isCountedSet } from './workouts';

/**
 * THE WORKOUT INDEX (audit B1/B3, 2026-07-19). Train's carousel cards, its
 * week bars and Home's mission/streak/PR/totals each re-filtered the full
 * normalised log per render — up to ~12 full scans of 2,500 rows on one
 * Train render. This builds the shared lookups ONCE per data change; it is
 * exposed through TanStack's `select` (data/hooks.ts::useWorkoutIndex), so
 * every consumer shares one memoised instance and no component needs a
 * hand-written useMemo (the React Compiler rule).
 *
 * Keys: `byDateWorkout` = `${date}|${workout}` → that session's rows;
 * `countedByDateWorkout` mirrors it with only COUNTED sets (the 061 rule).
 */
export interface WorkoutIndex {
  rows: WorkoutRow[];
  byDate: Map<string, WorkoutRow[]>;
  byDateWorkout: Map<string, WorkoutRow[]>;
  countedByDateWorkout: Map<string, WorkoutRow[]>;
}

export const dwKey = (date: string, workout: string): string => `${date}|${workout}`;

export function buildWorkoutIndex(raw: readonly WorkoutRow[] | null | undefined): WorkoutIndex {
  const rows = normaliseWorkoutLog((raw ?? []) as WorkoutRow[]);
  const byDate = new Map<string, WorkoutRow[]>();
  const byDateWorkout = new Map<string, WorkoutRow[]>();
  const countedByDateWorkout = new Map<string, WorkoutRow[]>();
  for (const r of rows) {
    const d = String(r.date);
    const k = dwKey(d, String(r.workout));
    let a = byDate.get(d);
    if (!a) byDate.set(d, (a = []));
    a.push(r);
    let b = byDateWorkout.get(k);
    if (!b) byDateWorkout.set(k, (b = []));
    b.push(r);
    if (isCountedSet(r.weight, r.reps)) {
      let c = countedByDateWorkout.get(k);
      if (!c) countedByDateWorkout.set(k, (c = []));
      c.push(r);
    }
  }
  return { rows, byDate, byDateWorkout, countedByDateWorkout };
}

import { pyFloat } from './py';
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
export interface WorkoutSession {
  date: string;
  sets: number;
  totalReps: number;
}

export interface WorkoutIndex {
  rows: WorkoutRow[];
  byDate: Map<string, WorkoutRow[]>;
  byDateWorkout: Map<string, WorkoutRow[]>;
  countedByDateWorkout: Map<string, WorkoutRow[]>;
  /** Per workout, its COUNTED sessions (one per date), date-ascending — the
   *  index behind lastSessionForWorkout so the kcal briefing is an O(sessions)
   *  lookup, not a full-log scan per carousel card (perf, 2026-07-19). */
  sessionsByWorkout: Map<string, WorkoutSession[]>;
}

export const dwKey = (date: string, workout: string): string => `${date}|${workout}`;

export function buildWorkoutIndex(raw: readonly WorkoutRow[] | null | undefined): WorkoutIndex {
  const rows = normaliseWorkoutLog((raw ?? []) as WorkoutRow[]);
  const byDate = new Map<string, WorkoutRow[]>();
  const byDateWorkout = new Map<string, WorkoutRow[]>();
  const countedByDateWorkout = new Map<string, WorkoutRow[]>();
  // workout -> date -> aggregated counted session.
  const sessionAgg = new Map<string, Map<string, WorkoutSession>>();
  for (const r of rows) {
    const d = String(r.date);
    const w = String(r.workout);
    const k = dwKey(d, w);
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
      let m = sessionAgg.get(w);
      if (!m) sessionAgg.set(w, (m = new Map()));
      let s = m.get(d);
      if (!s) m.set(d, (s = { date: d, sets: 0, totalReps: 0 }));
      s.sets += 1;
      s.totalReps += pyFloat(r.reps) ?? 0;
    }
  }
  const sessionsByWorkout = new Map<string, WorkoutSession[]>();
  for (const [w, m] of sessionAgg) {
    const arr = [...m.values()]
      .map((s) => ({ date: s.date, sets: s.sets, totalReps: Math.trunc(s.totalReps) }))
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    sessionsByWorkout.set(w, arr);
  }
  return { rows, byDate, byDateWorkout, countedByDateWorkout, sessionsByWorkout };
}

/**
 * The athlete's most recent COUNTED session of `workout` strictly BEFORE
 * `beforeDate` — the index-backed twin of workout-estimates.lastSessionWork
 * (identical predicate + "strictly before + most recent" rule), O(sessions)
 * instead of a full-log scan.
 */
export function lastSessionForWorkout(
  index: WorkoutIndex | null | undefined,
  workout: string,
  beforeDate: string
): { sets: number; totalReps: number } | null {
  const arr = index?.sessionsByWorkout.get(workout);
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].date < beforeDate) return { sets: arr[i].sets, totalReps: arr[i].totalReps };
  }
  return null;
}

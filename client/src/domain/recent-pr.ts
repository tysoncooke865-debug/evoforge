/**
 * HOME_REDESIGN — the most recent personal record, digested from rows the
 * app already holds. Display only: nothing here grants, announces or
 * persists — the live PR pipeline stays in set-save.ts::decideSetSave.
 *
 * THE RULE IS set-save's rule: a set is a PR when its e1RM beats the best
 * e1RM of every EARLIER set of that exercise, and only when an earlier best
 * exists (previousBest > 0 — a first-ever set is a baseline, not a record).
 * Chronology is (date, timestamp) ascending, the same ordering the log's
 * own convention writes.
 */

import { pyFloat, pyInt } from './py';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { estimated1rm } from './workouts';

export interface RecentPr {
  exercise: string;
  weightKg: number;
  reps: number;
  /** YYYY-MM-DD */
  date: string;
}

export function recentPr(rows: WorkoutRow[] | undefined): RecentPr | null {
  if (!rows || rows.length === 0) return null;

  // Valid sets only, oldest first. normaliseWorkoutLog dedupes edited sets
  // keep-last, so an in-place edit is judged once, at its final values.
  const sets = normaliseWorkoutLog(rows)
    .map((r) => ({
      exercise: String(r.exercise ?? '').trim(),
      date: String(r.date ?? ''),
      timestamp: String(r.timestamp ?? ''),
      weight: pyFloat(r.weight) ?? 0,
      reps: pyInt(r.reps) ?? 0,
    }))
    .filter((s) => s.exercise !== '' && s.date !== '' && s.weight > 0 && s.reps > 0)
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
    );

  const best = new Map<string, number>();
  let latest: RecentPr | null = null;
  for (const s of sets) {
    const key = s.exercise.toLowerCase();
    const previousBest = best.get(key) ?? 0;
    const current = estimated1rm(s.weight, s.reps);
    if (current > previousBest && previousBest > 0) {
      latest = { exercise: s.exercise, weightKg: s.weight, reps: s.reps, date: s.date };
    }
    if (current > previousBest) best.set(key, current);
  }
  return latest;
}

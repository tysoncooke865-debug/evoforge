/**
 * The pure decision core of `domain/workouts.py :: save_set_auto()`.
 *
 * Python interleaves the decision with the writes; here the decision is a
 * pure function over the cached rows (unit-testable), and the mutation hook
 * executes its verdict. THE INVARIANT THE SPLIT PROTECTS: a set is a flat
 * XP_PER_SET whatever the weight and reps, and the ledger grant is keyed to
 * `workout_log.id` with RLS forbidding deletes -- so an EDIT must update the
 * row in place (same id, same grant, no announcement) and only a genuinely
 * NEW set inserts + grants + announces. Delete-and-insert here would double
 * the XP or strand the grant. Never reintroduce it.
 */

import { pyFloat, pyInt } from './py';
import { normaliseWorkoutLog, type WorkoutRow } from './summary';
import { estimated1rm } from './workouts';

export interface SetInput {
  workoutDate: string; // YYYY-MM-DD
  workout: string;
  exercise: string;
  setNo: number;
  weight: number;
  reps: number;
  /** DROP SETS (2026-07-18): back-off mini-sets ride the SET's notes column
   *  ("DROPS: 50x6, 40x5") — one set row, one XP grant, honest storage. */
  notes?: string;
}

export type SetVerdict =
  | { action: 'reject' } // weight or reps not positive
  | { action: 'noop'; is_pr: boolean; current1rm: number; previousBest: number } // identical to stored
  | {
      action: 'update'; // existing row, same id, NO grant, NO announcement
      rowId: string;
      is_pr: boolean;
      current1rm: number;
      previousBest: number;
    }
  | {
      action: 'insert'; // new set: insert, grant XP keyed to the new id, announce
      is_pr: boolean;
      current1rm: number;
      previousBest: number;
      /** Filled in by the mutation after the insert returns its id, so
       *  callers (the Battle Arena) can reference the confirmed row. */
      rowId?: string;
    };

/** `get_previous_best_1rm`: best e1RM for the exercise, excluding the set being saved. */
export function previousBest1rm(
  rows: WorkoutRow[],
  exercise: string,
  excludeDate?: string,
  excludeSet?: number
): number {
  let best = 0;
  for (const r of rows) {
    if (String(r.exercise) !== exercise) continue;
    if (
      excludeDate !== undefined &&
      excludeSet !== undefined &&
      String(r.date) === String(excludeDate) &&
      (pyInt(r.set) ?? 0) === Math.trunc(excludeSet)
    ) {
      continue;
    }
    const weight = pyFloat(r.weight) ?? 0;
    const reps = pyFloat(r.reps) ?? 0;
    best = Math.max(best, reps > 0 ? weight * (1 + reps / 30) : 0);
  }
  return best;
}

export function decideSetSave(rows: WorkoutRow[], input: SetInput): SetVerdict {
  // 061: 0 kg is a valid (bodyweight) set — reps still gate. A 0 kg set's
  // e1RM is 0, so the PR comparison below can never crown it (previousBest
  // must be strictly positive AND beaten).
  if (input.weight < 0 || input.reps <= 0) {
    return { action: 'reject' };
  }

  const previousBest = previousBest1rm(rows, input.exercise, input.workoutDate, input.setNo);
  const current1rm = estimated1rm(input.weight, Math.trunc(input.reps));
  const is_pr = current1rm > previousBest && previousBest > 0;

  const normalised = normaliseWorkoutLog(rows);
  const existing = normalised.filter(
    (r) =>
      String(r.date) === input.workoutDate &&
      String(r.workout) === input.workout &&
      String(r.exercise) === input.exercise &&
      (pyInt(r.set) ?? 0) === Math.trunc(input.setNo)
  );

  if (existing.length > 0) {
    const old = existing[existing.length - 1];
    const sameWeight = (pyFloat(old.weight) ?? NaN) === input.weight;
    const sameReps = Math.trunc(pyFloat(old.reps) ?? NaN) === Math.trunc(input.reps);
    if (sameWeight && sameReps) {
      return { action: 'noop', is_pr: false, current1rm, previousBest };
    }
    const rowId = old.id;
    if (rowId) {
      return { action: 'update', rowId: String(rowId), is_pr, current1rm, previousBest };
    }
    // A row written before `id` was selected: Python falls back to
    // delete-and-insert. Every row the hooks fetch carries id, so reaching
    // here means the cache is malformed -- treat as insert and let the
    // partial unique ledger index absorb any duplicate grant attempt.
  }

  return { action: 'insert', is_pr, current1rm, previousBest };
}

/** The row shape both write paths send; mirrors save_set_auto's supabase_row. */
export function buildSetRow(input: SetInput, muscle: string, timestamp: string) {
  return {
    date: input.workoutDate,
    workout: input.workout,
    exercise: input.exercise,
    set: Math.trunc(input.setNo),
    weight: input.weight,
    reps: Math.trunc(input.reps),
    timestamp,
    muscle,
    estimated_1rm: estimated1rm(input.weight, Math.trunc(input.reps)),
    volume: input.weight * Math.trunc(input.reps),
    notes: input.notes ?? '',
  };
}

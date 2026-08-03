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

import {
  type CanonicalSet,
  calculateEffectiveResistanceKg,
  normaliseExerciseSet,
} from './exercise-load';
import { type ExerciseLoadModel, loadModelFor } from './exercise-load-models';
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
  /**
   * BODYWEIGHT LOAD MODES (133). OPTIONAL, and absence is the legacy path:
   * a caller that passes only `weight` gets exactly the behaviour it always
   * had (external load), so every weighted exercise — bench, squat,
   * dumbbell, cable, machine — is untouched by this feature.
   *
   * When present, `load` carries the set's MODE and PARTS and `weight`
   * becomes derived rather than authoritative.
   */
  load?: Partial<CanonicalSet>;
  /** Resolved by the caller (it holds the library + custom exercises). */
  loadModel?: ExerciseLoadModel;
}

/**
 * The set's canonical form. Legacy callers (weight only) resolve to plain
 * external load, which is why this feature cannot regress ordinary lifting.
 */
export function canonicalSetFor(input: SetInput): { set: CanonicalSet; model: ExerciseLoadModel } {
  const model = input.loadModel ?? (input.load ? loadModelFor(input.exercise).model : 'external_load');
  const set = normaliseExerciseSet(
    input.load
      ? { ...input.load, reps: input.load.reps ?? input.reps }
      : { loadMode: 'external', weightKg: input.weight, reps: input.reps },
    model
  );
  return { set, model };
}

/**
 * What goes in the legacy `weight` column.
 *
 * EXTERNAL LOAD ONLY, never bodyweight and never a computed total. A
 * weighted pull-up stores its ADDED 20 kg, an assisted pull-up and a plain
 * bodyweight set store 0. That keeps `weight` meaning exactly what it has
 * always meant to every reader in the app, so nothing that aggregates it
 * silently changes meaning under them.
 */
export function legacyWeightFor(set: CanonicalSet): number {
  switch (set.loadMode) {
    case 'external':
      return set.weightKg ?? 0;
    case 'weighted_bodyweight':
      return set.externalLoadKg ?? 0;
    default:
      return 0;
  }
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

  const { set } = canonicalSetFor(input);
  // 133: the e1RM of a bodyweight-family set is computed from EFFECTIVE
  // resistance, which is what fixes "a bodyweight set can never set a
  // record" — `estimated1rm(0, reps)` was always 0, so twelve strict
  // pull-ups were permanently invisible to PR detection. With no bodyweight
  // on file the effective resistance is null and we fall back to 0, which
  // keeps the old (silent) behaviour rather than inventing a weight.
  const effective = calculateEffectiveResistanceKg(set);
  const loadForRm = effective ?? legacyWeightFor(set);

  const previousBest = previousBest1rm(rows, input.exercise, input.workoutDate, input.setNo);
  const current1rm = estimated1rm(loadForRm, Math.trunc(input.reps));
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
    // 133: compare the LEGACY weight (external load) and the MODE. Editing
    // a set from `bodyweight` to `assisted 30 kg` leaves the legacy weight
    // at 0 in both cases, so weight-and-reps alone would call a real edit a
    // no-op and silently discard it.
    const sameWeight = (pyFloat(old.weight) ?? NaN) === legacyWeightFor(set);
    const oldMode = (old as WorkoutRow & { load_mode?: string }).load_mode ?? 'external';
    const sameMode = oldMode === set.loadMode;
    const oldAssist = pyFloat((old as WorkoutRow & { assistance_kg?: number }).assistance_kg) ?? null;
    const sameAssist = oldAssist === (set.assistanceKg ?? null);
    const sameReps = Math.trunc(pyFloat(old.reps) ?? NaN) === Math.trunc(input.reps);
    if (sameWeight && sameReps && sameMode && sameAssist) {
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

/** The columns migration 133 adds. Named once so the fallback below and the
 *  migration can be checked against each other by eye. */
export const LOAD_COLUMNS = [
  'load_mode',
  'external_load_kg',
  'assistance_kg',
  'assistance_type',
  'assistance_description',
  'bodyweight_snapshot_kg',
  'duration_seconds',
  'distance_meters',
  'reps_per_side',
  'load_migration_status',
] as const;

/**
 * THE CLIENT SHIPS BEFORE THE MIGRATION DOES.
 *
 * Migrations here are applied BY HAND, separately from the deploy, so there
 * is always a window where this build is live against a database without the
 * 133 columns. PostgREST rejects an INSERT that names a column it cannot
 * find (PGRST204), which would fail EVERY set save — the release-critical
 * regression this whole feature exists to avoid.
 *
 * So a write that fails on an unknown column is retried once without them.
 * The set lands with its legacy meaning intact (weight/reps/e1RM/volume are
 * all still correct — see legacyWeightFor) and only the new detail is lost,
 * which is exactly the pre-133 behaviour. Applying the migration turns the
 * detail on with no further deploy.
 */
export function isMissingLoadColumn(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /PGRST204|schema cache|does not exist|could not find/i.test(message) &&
    LOAD_COLUMNS.some((c) => message.includes(c))
  );
}

export function stripLoadColumns<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = { ...row };
  for (const c of LOAD_COLUMNS) delete out[c];
  return out as Partial<T>;
}

/**
 * The row shape both write paths send; mirrors save_set_auto's supabase_row.
 *
 * 133 adds the canonical load columns. A caller that passes no `load` emits
 * `load_mode: 'external'` with the weight it always sent — byte-identical
 * behaviour for every ordinary lift.
 */
export function buildSetRow(input: SetInput, muscle: string, timestamp: string) {
  const { set, model } = canonicalSetFor(input);
  const reps = Math.trunc(input.reps);
  const legacyWeight = legacyWeightFor(set);
  const effective = calculateEffectiveResistanceKg(set);

  // TONNAGE. Only movements whose effective resistance is honestly ~the
  // athlete's bodyweight contribute it (pull-ups, chin-ups, dips). A push-up
  // does NOT move ~100% of bodyweight, so it contributes its external load —
  // zero — rather than a fabricated fraction. Unknown bodyweight also
  // contributes zero: excluded, never guessed.
  const counts = loadModelFor(input.exercise, {}).contributesToTonnage;
  const volumeLoad = counts ? (effective ?? legacyWeight) : legacyWeight;

  return {
    date: input.workoutDate,
    workout: input.workout,
    exercise: input.exercise,
    set: Math.trunc(input.setNo),
    weight: legacyWeight,
    reps,
    timestamp,
    muscle,
    estimated_1rm: estimated1rm(effective ?? legacyWeight, reps),
    volume: volumeLoad * reps,
    notes: input.notes ?? '',
    // ---- 133 canonical load columns ----
    load_mode: set.loadMode,
    external_load_kg: set.externalLoadKg,
    assistance_kg: set.assistanceKg,
    assistance_type: set.assistanceType,
    assistance_description: set.assistanceDescription,
    bodyweight_snapshot_kg: set.bodyweightSnapshotKg,
    duration_seconds: set.durationSeconds,
    distance_meters: set.distanceMeters,
    reps_per_side: set.repsPerSide ?? null,
    // The load MODEL is deliberately not persisted: it belongs to the
    // EXERCISE, not the set. Storing it per row would let a set disagree
    // with its own exercise's definition.
    load_migration_status: 'untouched' as const,
  };
}

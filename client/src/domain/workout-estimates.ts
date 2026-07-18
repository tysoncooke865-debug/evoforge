import { pyFloat } from './py';
import { isCountedSet } from './workouts';
import type { WorkoutRow } from './summary';

/**
 * TRAIN_OVERHAUL — the hero card's numbers, pure and tunable.
 *
 * Estimates are LABELLED estimates (the ≈ in the stat row) and live in this one
 * file so tuning a constant later is a one-line change with tests. Nothing here
 * touches the network or the clock.
 *
 * KCAL is the SURPLUS over resting metabolism — the extra energy the training
 * costs, not what a body burns just existing for that long. The session splits
 * into work intervals (lifting, MET 6.0) and rest intervals (recovering
 * between sets, MET 1.5), and each contributes only its excess over the
 * 1-MET resting baseline. Rep counts from the athlete's LAST session of the
 * same workout (lastSessionWork) size the work intervals where history exists.
 */

/** Seconds a set costs: ~45s of work + the default rest between sets.
 *  The rest half mirrors ui/train/rest-timer.tsx::DEFAULT_REST_SECONDS (120) — a UI
 *  module the pure domain must not import; change one, change the other. */
const WORK_SECONDS = 45;
const REST_SECONDS = 120;
const SET_SECONDS = WORK_SECONDS + REST_SECONDS;

/** Whole workout in minutes, rounded to the nearest 5. 20 sets ≈ 55 min. */
export function estimateMinutes(totalSets: number): number {
  if (!(totalSets > 0)) return 0;
  const minutes = (totalSets * SET_SECONDS) / 60;
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/**
 * NET calories for the session — the extra above resting — rounded to the
 * nearest 10.
 *
 * net kcal = [(MET_WORK − 1) × workMin + (MET_REST − 1) × restMin] × 3.5 × kg / 200
 *
 * Work intervals are sized by reps (SECONDS_PER_REP each) when the caller has
 * rep history, else the WORK_SECONDS default (≈11 reps). Burn is computed over
 * the UNROUNDED minutes — the 5-minute display grid must not leak into the
 * energy estimate.
 */
const MET_WORK = 6.0; // resistance training, vigorous — while actually lifting
const MET_REST = 1.5; // standing between sets, breathing elevated
const SECONDS_PER_REP = 4;
const REPS_PER_SET_MIN = 3;
const REPS_PER_SET_MAX = 30;
export function estimateNetKcal(
  totalSets: number,
  repsPerSet: number | null,
  bodyweightKg: number
): number {
  if (!(totalSets > 0) || !(bodyweightKg > 0)) return 0;
  const workSecondsPerSet =
    repsPerSet !== null && repsPerSet > 0
      ? Math.min(REPS_PER_SET_MAX, Math.max(REPS_PER_SET_MIN, repsPerSet)) * SECONDS_PER_REP
      : WORK_SECONDS;
  const workMin = (totalSets * workSecondsPerSet) / 60;
  const restMin = (totalSets * REST_SECONDS) / 60;
  const perMetMinute = (3.5 * bodyweightKg) / 200;
  const net = ((MET_WORK - 1) * workMin + (MET_REST - 1) * restMin) * perMetMinute;
  return Math.round(net / 10) * 10;
}

/**
 * The athlete's most recent completed session of `workout` STRICTLY BEFORE
 * `beforeDate` — an in-progress session today is not "last workout", and using
 * it would shrink the briefing mid-session. Counted set = weight >= 0 AND
 * reps > 0 after coercion, the same predicate summary.ts and the hub's
 * setsFor apply.
 */
export function lastSessionWork(
  rows: readonly WorkoutRow[],
  workout: string,
  beforeDate: string
): { sets: number; totalReps: number } | null {
  let bestDate = '';
  let sets = 0;
  let totalReps = 0;
  for (const r of rows) {
    if (String(r.workout) !== workout) continue;
    const date = String(r.date ?? '');
    if (date === '' || date >= beforeDate) continue;
    const reps = pyFloat(r.reps) ?? 0;
    if (!isCountedSet(r.weight, r.reps)) continue;
    if (date > bestDate) {
      bestDate = date;
      sets = 0;
      totalReps = 0;
    }
    if (date === bestDate) {
      sets += 1;
      totalReps += reps;
    }
  }
  return bestDate === '' ? null : { sets, totalReps: Math.trunc(totalReps) };
}

/**
 * 'Push 2 - Hypertrophy' → title 'Push 2', sub 'Hypertrophy'. The FIRST ' - '
 * splits; a name without one has no sub. The hero card renders the title big
 * and the sub quiet beneath it.
 */
export function splitWorkoutName(name: string): { title: string; sub: string | null } {
  const idx = name.indexOf(' - ');
  if (idx === -1) return { title: name.trim(), sub: null };
  const title = name.slice(0, idx).trim();
  const sub = name.slice(idx + 3).trim();
  if (title === '' || sub === '') return { title: name.trim(), sub: null };
  return { title, sub };
}

// The muscle pills moved to domain/muscle-map.ts (pillLabelsFor): the chips
// and the body map now share one fine-grained vocabulary — a Push day reads
// Chest · Shoulders · Triceps, never a vague "Arms".

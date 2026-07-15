/**
 * TRAIN_OVERHAUL — the hero card's numbers, pure and tunable.
 *
 * Estimates are LABELLED estimates (the ≈ in the stat row) and live in this one
 * file so tuning a constant later is a one-line change with tests. Nothing here
 * touches the network or the clock.
 */

/** Seconds a set costs: ~45s of work + the default rest between sets.
 *  The rest half mirrors ui/rest-timer.tsx::DEFAULT_REST_SECONDS (120) — a UI
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
 * Calories for the session, rounded to the nearest 10.
 *
 * MET 5.0 (resistance training, moderate effort): kcal/min = MET × 3.5 ×
 * kg / 200. Burn is computed over the UNROUNDED minutes — the 5-minute display
 * grid must not leak into the energy estimate.
 */
const MET_RESISTANCE = 5.0;
export function estimateKcal(totalSets: number, bodyweightKg: number): number {
  if (!(totalSets > 0) || !(bodyweightKg > 0)) return 0;
  const minutes = (totalSets * SET_SECONDS) / 60;
  const kcalPerMin = (MET_RESISTANCE * 3.5 * bodyweightKg) / 200;
  return Math.round((kcalPerMin * minutes) / 10) * 10;
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

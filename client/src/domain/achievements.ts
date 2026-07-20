/**
 * The pure core of `domain/achievements.py :: check_achievements()`: sweep
 * every condition over injected inputs, return the newly-earned achievement
 * ids. The caller batch-inserts once and claims nothing the database refused.
 *
 * Kept cheap on purpose -- Python runs this on EVERY set save, and so do we.
 * The `pending` guard survives the port: two conditions naming the same
 * achievement in one sweep must not produce a duplicate row (the unique
 * (user_id, achievement_id) index would reject the whole batch).
 */

import { ACHIEVEMENTS } from './catalogs';
import { pyFloat } from './py';
import type { WorkoutRow } from './summary';

export interface BodyweightStats {
  latest: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export interface BodyfatStats {
  latest: number | null;
  count: number;
}

export interface CardioStatsInput {
  minutes: number;
  distance: number;
  count: number;
  types: ReadonlySet<string>;
}

export interface SweepInputs {
  /** Normalised workout rows (the hooks already fetch them normalised-shaped). */
  workoutRows: WorkoutRow[];
  totalSets: number;
  bestBench1rm: number;
  level: number;
  heat: ReadonlyMap<string, number>;
  bw: BodyweightStats;
  bf: BodyfatStats;
  cardio: CardioStatsInput;
  /** Latest "Body Fat" target value, or null when none set. */
  bfTarget: number | null;
}

const PPPPLA_DAYS = [
  'Push 1 - Strength',
  'Pull 1 - Back Thickness',
  'Push 2 - Hypertrophy',
  'Pull 2 - Width / V-Taper',
  'Legs',
  'Aesthetics',
];

export function uniqueTrainingDays(rows: WorkoutRow[]): number {
  const days = new Set<string>();
  for (const r of rows) {
    if (r.date !== null && r.date !== undefined && String(r.date) !== '') {
      days.add(String(r.date));
    }
  }
  return days.size;
}

export function loggedAllPppplaDays(rows: WorkoutRow[]): boolean {
  if (rows.length === 0) return false;
  const logged = new Set(rows.map((r) => String(r.workout ?? '')));
  return PPPPLA_DAYS.every((d) => logged.has(d));
}

export function muscleSetsCount(heat: ReadonlyMap<string, number>, names: string[]): number {
  let total = 0;
  for (const n of names) total += heat.get(n) ?? 0;
  return Math.trunc(total);
}

export function exerciseMaxes(rows: WorkoutRow[], exercise: string): { maxWeight: number; maxE1rm: number } {
  let maxWeight = 0;
  let maxE1rm = 0;
  let any = false;
  for (const r of rows) {
    if (String(r.exercise) !== exercise) continue;
    any = true;
    const weight = pyFloat(r.weight) ?? 0;
    const reps = pyFloat(r.reps) ?? 0;
    maxWeight = Math.max(maxWeight, weight);
    maxE1rm = Math.max(maxE1rm, reps > 0 ? weight * (1 + reps / 30) : 0);
  }
  return any ? { maxWeight, maxE1rm } : { maxWeight: 0, maxE1rm: 0 };
}

/** Returns newly-earned achievement ids, in unlock order, no duplicates. */
export function sweepAchievements(inputs: SweepInputs, alreadyHeld: ReadonlySet<string>): string[] {
  const pending: string[] = [];
  const unlock = (key: string) => {
    if (!(key in ACHIEVEMENTS) || alreadyHeld.has(key)) return;
    if (pending.includes(key)) return;
    pending.push(key);
  };

  const { workoutRows: rows, totalSets, bestBench1rm, level, heat, bw, bf, cardio, bfTarget } = inputs;

  // Basic logging
  if (totalSets >= 1) unlock('first_set');
  if (totalSets >= 10) unlock('first_workout');
  if (totalSets >= 100) unlock('hundred_sets');
  if (totalSets >= 500) unlock('five_hundred_sets');
  if (totalSets >= 1000) unlock('thousand_sets');

  // Consistency
  const days = uniqueTrainingDays(rows);
  if (days >= 3) unlock('three_day_streak');
  if (days >= 7) unlock('seven_day_streak');
  if (days >= 14) unlock('fourteen_day_streak');
  if (days >= 30) unlock('thirty_day_streak');
  if (loggedAllPppplaDays(rows)) unlock('full_ppppla_week');

  // Strength - bench (e1RM thresholds use the summary's valid-set best)
  if (bestBench1rm >= 100) unlock('bench_100_est');
  if (bestBench1rm >= 120) unlock('bench_120_est');

  if (bw.latest) {
    if (bestBench1rm >= bw.latest) unlock('bench_bw');
    if (bestBench1rm >= bw.latest * 1.25) unlock('bench_1_25_bw');
    if (bestBench1rm >= bw.latest * 1.5) unlock('bench_1_5_bw');
  }

  // Raw bench weight thresholds use max WEIGHT over all rows, like Python.
  const bench = exerciseMaxes(rows, 'Barbell Bench Press (Strength)');
  if (bench.maxWeight >= 60) unlock('bench_60');
  if (bench.maxWeight >= 80) unlock('bench_80');
  if (bench.maxWeight >= 90) unlock('bench_90');
  if (bench.maxWeight >= 100) unlock('bench_100');
  if (bench.maxWeight >= 110) unlock('bench_110');
  if (bench.maxWeight >= 120) unlock('bench_120');

  // Strength - squat
  const squat = exerciseMaxes(rows, 'Barbell Back Squat');
  if (squat.maxWeight >= 100) unlock('squat_100');
  if (squat.maxWeight >= 140) unlock('squat_140');
  if (squat.maxWeight >= 160) unlock('squat_160');
  if (squat.maxWeight >= 180) unlock('squat_180');
  if (squat.maxWeight >= 200) unlock('squat_200');

  if (bw.latest && squat.maxE1rm) {
    if (squat.maxE1rm >= bw.latest * 1.5) unlock('squat_1_5_bw');
    if (squat.maxE1rm >= bw.latest * 2) unlock('squat_2_bw');
  }

  // Bodyweight / cut / bulk
  if (bw.count >= 1) unlock('first_bw_log');
  if (bw.latest && bw.latest <= 75) unlock('bw_75');
  if (bw.latest && bw.latest >= 80) unlock('bw_80');
  if (bw.latest && bw.latest >= 85) unlock('bw_85');
  if (bw.min !== null && bw.latest !== null) {
    if (bw.latest - bw.min >= 2) unlock('bulk_2kg');
    if (bw.latest - bw.min >= 5) unlock('bulk_5kg');
  }
  if (bw.max !== null && bw.latest !== null) {
    if (bw.max - bw.latest >= 2) unlock('cut_2kg');
    if (bw.max - bw.latest >= 5) unlock('cut_5kg');
  }

  // Body fat
  if (bf.count >= 1) unlock('first_bf_log');
  if (bf.latest && bf.latest < 15) unlock('bf_under_15');
  if (bf.latest && bf.latest < 13) unlock('bf_under_13');
  if (bf.latest && bf.latest < 12) unlock('bf_under_12');
  if (bf.latest && bf.latest <= 10) unlock('bf_under_10');
  if (bf.latest && bfTarget && bf.latest <= bfTarget) unlock('bf_target_hit');

  // Cardio
  if (cardio.count >= 1) unlock('first_cardio');
  if (cardio.minutes >= 100) unlock('cardio_100');
  if (cardio.minutes >= 300) unlock('cardio_300');
  if (cardio.minutes >= 1000) unlock('cardio_1000');
  if (cardio.distance >= 5) unlock('cardio_5k_total');
  if (cardio.distance >= 25) unlock('cardio_25k_total');
  if (cardio.distance >= 100) unlock('cardio_100k_total');
  if (cardio.types.has('Boxing')) unlock('boxing_logged');

  // Muscle heat map / volume
  if (muscleSetsCount(heat, ['Chest', 'Upper Chest']) >= 50) unlock('chest_50');
  if (muscleSetsCount(heat, ['Chest', 'Upper Chest']) >= 150) unlock('chest_150');
  if (muscleSetsCount(heat, ['Back', 'Back Width', 'Back Thickness']) >= 50) unlock('back_50');
  if (muscleSetsCount(heat, ['Back', 'Back Width', 'Back Thickness']) >= 150) unlock('back_150');
  const deltSets = muscleSetsCount(heat, ['Delts', 'Side Delts', 'Rear Delts']);
  if (deltSets >= 50) unlock('delts_50');
  if (deltSets >= 150) unlock('delts_150');
  if (muscleSetsCount(heat, ['Biceps', 'Triceps']) >= 100) unlock('arms_100');
  if (muscleSetsCount(heat, ['Legs', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves']) >= 100)
    unlock('legs_100');
  if (muscleSetsCount(heat, ['Abs']) >= 50) unlock('abs_50');

  // Rank achievements
  if (level >= 40) unlock('aesthetic_tier');
  if (level >= 60) unlock('elite_physique');
  if (level >= 75) unlock('chad_lite');
  if (level >= 90) unlock('chad');
  if (level >= 100) unlock('true_adam');

  return pending;
}
